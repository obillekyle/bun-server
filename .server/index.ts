#!/usr/bin/env bun

import './init';

import { compile } from './compiler';
import { getSession, Session, setSession } from './session';
import { jsonResponse, processBody, tryCatch } from './utils';
import { watch } from 'node:fs/promises';
import { networkInterfaces, platform } from 'node:os';
import { Logger, messageLogger } from './logger';
import { syncSQLSchema } from '@database/sync';
import { Server } from 'node:http';

const serveMsgs = {
  STARTING: 'I Starting server in {mode} mode...',
  START_WATCHER: 'I Starting DEV watcher...',
  RESTART_REQ: 'I Dev server restart requested from sync engine!',
  UNHANDLED_ERR: 'E Unhandled Server Error: {error}',
  SHUTTING_DOWN: 'W Shutting down server...',
  BACKEND_CHANGE: 'I Backend change detected: {file}',
  SERVER_STARTED: 'I Server running at:',
  SERVER_URL: 'I   ➜ {type}: http://{host}:{port}',
  WATCHER_ERR: 'E Watcher error: {error}',
  CONFIG_LOADED: 'I Loaded server.config.ts',
  AUTO_MAP: 'I Auto-mapped {count} packages from node_modules!',
  PROXY_REQ: 'I Proxying {path} -> {target}',
  TSCONFIG_SYNCED: 'I Synced tsconfig.app.json paths with server.config.ts!',
  PRESS_D: 'I Press "d" to spawn the dedicated client logger terminal!',
  SPAWN_LOGGER: 'I Spawning client logger terminal...',
  MANUAL_RELOAD: 'I Manual reload triggered from client logger!',
} as const;

const compileMsgs = {
  FILE_STATUS: 'I File is {status}: {file}',
  COMPILE_FAIL: 'E Failed to compile {file}: {error}',
  COMPILE_OK: 'I Compiled {file} successfully.',
  FILE_DEL: 'I File deleted: {file}',
} as const;

const clientMsgs = {
  INFO: 'I 💻 {msg}',
  WARN: 'W 💻 {msg}',
  ERROR: 'E 💻 {msg}',
} as const;

const serveLog = messageLogger(new Logger('serve'), serveMsgs);
const compLog = messageLogger(new Logger('compile'), compileMsgs);
const clientLog = messageLogger(new Logger('client'), clientMsgs);

const MAX_CACHE_SIZE = 1000;
const jsCache = new Map<string, string>();

const blockedExtensions = [
  '.env',
  '.ts',
  '.sql',
  '.db',
  '.json',
  '.yaml',
  '.yml',
  '.lock',
];
const blockedDirs = ['.server', '.database', '_internal'];
const blockedSubstrings = ['..', '\0'];

const isDev = process.argv.includes('--dev');
const isDevWorker = process.argv.includes('--dev-worker');

const toMS = (ns: number) => parseFloat((ns / 1e6).toFixed(2));
const getElapsed = (start: number) => toMS(Bun.nanoseconds() - start);

let serverConfig: AppConfig = {
  port: 3000,
  host: '0.0.0.0',
  importMap: {},
  proxy: {},
};
let userImportMap: Record<string, string> = {};

const configExists = await Bun.file('./server.config.ts').exists();
const module = configExists
  ? await import(process.cwd() + '/server.config.ts').catch(() => null)
  : null;

serverConfig = module?.default
  ? { ...serverConfig, ...module.default }
  : serverConfig;
userImportMap = module?.default?.importMap
  ? { ...module.default.importMap }
  : userImportMap;
configExists && module?.default && !isDevWorker && serveLog.CONFIG_LOADED();

if (!isDevWorker) {
  const tsConfigPath = './tsconfig.app.json';
  try {
    let tsConfig: any = { compilerOptions: { paths: {} } };
    if (await Bun.file(tsConfigPath).exists())
      tsConfig = await Bun.file(tsConfigPath)
        .json()
        .catch(() => tsConfig);

    tsConfig.compilerOptions = tsConfig.compilerOptions || {};
    delete tsConfig.compilerOptions.baseUrl;

    const oldPaths = JSON.stringify(tsConfig.compilerOptions.paths || {});
    const newPaths: Record<string, string[]> = {};

    for (const [key, val] of Object.entries(userImportMap)) {
      const tsKey = key.endsWith('/') ? key.slice(0, -1) + '/*' : key;
      let tsVal = val.startsWith('/') ? '.' + val : val;
      tsVal = tsVal.endsWith('/') ? tsVal.slice(0, -1) + '/*' : tsVal;
      newPaths[tsKey] = [tsVal];
    }

    if (oldPaths !== JSON.stringify(newPaths)) {
      tsConfig.compilerOptions.paths = newPaths;
      await Bun.write(tsConfigPath, JSON.stringify(tsConfig, null, 2));
      serveLog.TSCONFIG_SYNCED();
    }
  } catch (err) {}
}

const autoImportMap: Record<string, string> = {};
try {
  const pkgPath = process.cwd() + '/package.json';
  if (await Bun.file(pkgPath).exists()) {
    const pkg = await Bun.file(pkgPath).json();
    const deps = Object.keys({
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    });

    for (const dep of deps) {
      autoImportMap[`${dep}/`] = `/node_modules/${dep}/`;
      const depPkgPath = process.cwd() + `/node_modules/${dep}/package.json`;

      if (await Bun.file(depPkgPath).exists()) {
        const depPkg = await Bun.file(depPkgPath).json();
        let mainFile =
          depPkg.module || depPkg.browser || depPkg.main || 'index.js';

        mainFile =
          typeof mainFile !== 'string'
            ? depPkg.module || depPkg.main || 'index.js'
            : mainFile;
        autoImportMap[dep] =
          `/node_modules/${dep}/${mainFile.replace(/^\.\//, '')}`;
      }
    }
    !isDevWorker &&
      deps.length > 0 &&
      serveLog.AUTO_MAP({ count: deps.length });
  }
} catch (err) {}

serverConfig.importMap = { ...autoImportMap, ...serverConfig.importMap };

if (!isDevWorker) {
  serveLog.STARTING({ mode: isDev ? 'development' : 'production' });
  const [error] = await tryCatch(syncSQLSchema());
  if (error) {
    const e = error?.stack || error?.message || String(error);
    serveLog.UNHANDLED_ERR({ error: 'SQL sync error: ' + e });
    process.exit(1);
  }
}

if (process.argv.includes('--dev') && !process.env.DEV_WATCHER_ACTIVE) {
  serveLog.START_WATCHER();
  serveLog.PRESS_D();

  let workerProc: Bun.Subprocess<'inherit', 'inherit', 'inherit'> | null = null;

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key: string) => {
      if (key === '\u0003') {
        workerProc?.kill('SIGINT');
        return;
      }

      if (key.toLowerCase() === 's') {
        process.emit('SIGINT');
        return;
      }

      if (key.toLowerCase() === 'd') {
        serveLog.SPAWN_LOGGER();
        const os = platform();
        const scriptArgs = `bun ./.server/client-log.ts ${process.pid}`;

        match(os, {
          win32: () =>
            Bun.spawn([
              'cmd.exe',
              '/c',
              'start',
              'cmd.exe',
              '/c',
              scriptArgs,
            ]).unref(),
          darwin: () =>
            Bun.spawn([
              'osascript',
              '-e',
              `tell application "Terminal" to do script "cd \\"${process.cwd()}\\" && ${scriptArgs}"`,
            ]).unref(),
          [match.default]: () =>
            Bun.spawn(['x-terminal-emulator', '-e', scriptArgs]).unref(),
        });
      }
    });
  }

  async function startWatcher(): Promise<never> {
    workerProc = Bun.spawn(['bun', Bun.main, '--dev-worker'], {
      stdio: ['inherit', 'inherit', 'inherit'],
      env: { ...process.env, DEV_WATCHER_ACTIVE: '1' },
    });

    const code = (await workerProc.exited) ?? 0;

    if (code === 42) {
      serveLog.RESTART_REQ();
      console.clear();

      return startWatcher();
    }

    if (code === 130) {
      serveLog.SHUTTING_DOWN();
      process.exit(0);
    }

    log({ by: 'process', msg: 'Exited with code ' + code, level: 'error' });
    process.exit(code);
  }

  await startWatcher();
}

async function notifySockets(filename: string) {
  server.publish('livereload', filename);
}

const connectedLoggers = new Set<any>();

const server = Bun.serve({
  port: serverConfig.port,
  hostname: serverConfig.host,

  async fetch(req, server) {
    const url = new URL(req.url);
    const now = Bun.nanoseconds();
    const path = url.pathname;

    const intercepted = serverConfig.onRequest
      ? await serverConfig.onRequest(req, server)
      : null;
    if (intercepted instanceof Response) return intercepted;

    const [error, session] = await tryCatch(async () => getSession(req));

    if (isDevWorker && path === '/_livereload') {
      if (server.upgrade(req)) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    if (!session) return setSession(path);

    const segments = path.split('/');
    const isNodeModule = path.startsWith('/node_modules/');

    const isFrontendTS = path.endsWith('.ts') && path !== '/server.config.ts';

    const isBlocked =
      blockedSubstrings.some((sub) => path.includes(sub)) ||
      blockedDirs.some((dir) => segments.includes(dir)) ||
      (blockedExtensions.some((ext) => path.endsWith(ext)) &&
        !isFrontendTS &&
        !isNodeModule) ||
      path === '/server.config.ts';

    if (isBlocked) return new Response('Forbidden', { status: 403 });

    const proxyEntries = Object.entries(serverConfig.proxy || {});
    let proxyUrl = '';
    for (const [prefix, target] of proxyEntries) {
      if (path.startsWith(prefix)) {
        const trailingPath = path.substring(prefix.length);
        const baseTarget = target.endsWith('/') ? target.slice(0, -1) : target;
        proxyUrl =
          baseTarget +
          (trailingPath.startsWith('/') ? '' : '/') +
          trailingPath +
          url.search;
        break;
      }
    }

    if (proxyUrl) {
      serveLog.PROXY_REQ({ path, target: proxyUrl });

      const proxyHeaders = new Headers(req.headers);
      proxyHeaders.delete('accept-encoding');
      proxyHeaders.delete('host');

      const proxyReq = new Request(proxyUrl, {
        method: req.method,
        headers: proxyHeaders,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      });

      const [proxyErr, proxyRes] = await tryCatch(fetch(proxyReq));

      if (proxyErr) {
        const msg = proxyErr.message || 'Unable to connect to proxy target.';
        return jsonResponse.object(502, 'Bad Gateway: ' + msg);
      }

      const resHeaders = new Headers(proxyRes.headers);
      resHeaders.delete('content-encoding');

      return new Response(proxyRes.body, {
        status: proxyRes.status,
        statusText: proxyRes.statusText,
        headers: resHeaders,
      });
    }

    switch (true) {
      case path.startsWith('/api/'):
        const endpoint = path.replace('/api/', '');

        if (!/^[a-zA-Z0-9_/ \-]+$/.test(endpoint))
          return jsonResponse.object(400, 'Invalid endpoint name');

        const filePath = endpoint + '.ts';
        const body = await processBody(req);

        let data: Awaited<ReturnType<ResponseFn>> = {
          time: getElapsed(now),
          status: 404,
          message: 'Endpoint not found for ' + endpoint,
          data: null,
        };

        const module = await import(`@api/${filePath}`).catch(() => null);
        if (module && typeof module.default === 'function')
          data = await module.default(req, body, server);

        return match(typeof data, {
          string: () => new Response(String(data)),
          number: () => new Response(String(data)),
          object: () => {
            assert(typeof data === 'object');
            if (data instanceof Response) return data;
            if (data instanceof Blob) return new Response(data);
            data.time ||= getElapsed(now);
            return Response.json(data, { status: data.status || 200 });
          },
          [match.default]: () => new Response('No content', { status: 404 }),
        });
    }

    let targetPath = '.' + path;
    let file = Bun.file(targetPath);
    let stat = await file.stat().catch(() => null);

    stat?.isDirectory() &&
      ((targetPath = '.' + path + '/index.html'),
      (file = Bun.file(targetPath)),
      (stat = await file.stat().catch(() => null)));

    !stat &&
      !path.split('/').pop()?.includes('.') &&
      ((targetPath = '.' + path + '.html'),
      (file = Bun.file(targetPath)),
      (stat = await file.stat().catch(() => null)));

    !stat &&
      !isNodeModule &&
      ((targetPath = path.endsWith('.js')
        ? '.' + path.slice(0, -3) + '.ts'
        : '.' + path + '.ts'),
      (file = Bun.file(targetPath)),
      (stat = await file.stat().catch(() => null)));

    if (!stat) return new Response('Not Found', { status: 404 });

    if (targetPath.endsWith('.ts') && !isNodeModule) {
      let content = jsCache.get(targetPath);
      if (!content) {
        content = await compile(targetPath);
        jsCache.size >= MAX_CACHE_SIZE && jsCache.clear();
        jsCache.set(targetPath, content);
      }
      return new Response(content, {
        headers: { 'Content-Type': 'application/javascript' },
      });
    }

    if (
      (isDevWorker && targetPath.endsWith('.html')) ||
      (stat && !stat.isDirectory() && file.name?.endsWith('.html'))
    ) {
      try {
        let html = await file.text();

        const utilsScript = `
        <script>
          (function() {
            window.assert = function(condition, message) {
              if (!condition) throw new Error(message || 'Assertion failed');
            };
            const matchDefault = Symbol('matchDefault');
            window.match = function(value, cases) {
              const isString = typeof value === 'string';
              const isArray = Array.isArray(cases);
              switch(true) {
                case isString && !isArray:
                  if (value in cases) return typeof cases[value] === 'function' ? cases[value](value) : cases[value];
                  if (matchDefault in cases) return typeof cases[matchDefault] === 'function' ? cases[matchDefault](value) : cases[matchDefault];
                  break;
                case isArray:
                  for (const [predicate, result] of cases) {
                    switch(true) {
                      case predicate === window.match: case predicate === matchDefault: case predicate === value: case typeof predicate === 'function' && Boolean(predicate(value)):
                        return typeof result === 'function' ? result(value) : result;
                    }
                  }
              }
            };
            window.match.default = matchDefault;
            window.request = async function(endpoint, options) {
              try {
                const res = await fetch('/api/' + endpoint.replace(/^\\//, ''), options);
                const data = await res.json().catch(() => ({}));
                switch(true) {
                  case !res.ok:
                    console.error('[API Error]', endpoint, data.message || res.statusText);
                    return data.status ? data : { time: 0, status: res.status, message: data.message || res.statusText, data: null };
                  default:
                    return data;
                }
              } catch(err) {
                return { time: 0, status: 500, message: err.message, data: null };
              }
            };
          })();
        </script>`;

        let headInjects = '';
        let bodyInjects = utilsScript;

        const styles: string[] = (serverConfig as any).styles || [];
        for (const href of styles) {
          headInjects += `\n  <link rel="stylesheet" href="${href}" />`;
        }

        const scripts: any[] = (serverConfig as any).scripts || [];
        for (const script of scripts) {
          let tag = '<script ';
          let placeInBody = false;

          switch (true) {
            case typeof script === 'string':
              tag += `src="${script}" defer></script>`;
              break;
            case typeof script === 'object':
              tag += `src="${script.src}" `;
              script.module && (tag += 'type="module" ');
              script.async && (tag += 'async ');
              script.defer && (tag += 'defer ');
              tag += '></script>';
              placeInBody = !!script.inBody;
              break;
          }

          switch (true) {
            case placeInBody:
              bodyInjects += `\n  ${tag}`;
              break;
            default:
              headInjects += `\n  ${tag}`;
              break;
          }
        }

        const lrScript = `
        <script>
          (function() {
            let needsReload = false;
            let isDead = false;

            function connect() {
              const ws = new WebSocket('ws://' + location.host + '/_livereload');

              const sendLog = (level, args) => {
                if (ws.readyState === WebSocket.OPEN) {
                  const payload = Array.from(args).map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
                  ws.send(JSON.stringify({ type: 'client_log', level, payload }));
                }
              };

              const ogLog = console.log, ogWarn = console.warn, ogErr = console.error;
              console.log = (...args) => (ogLog(...args), sendLog('info', args));
              console.warn = (...args) => (ogWarn(...args), sendLog('warn', args));
              console.error = (...args) => (ogErr(...args), sendLog('error', args));

              window.onerror = (m, s, l, c) => sendLog('error', [\`\${m} at \${s}:\${l}:\${c}\`]);
              window.addEventListener('unhandledrejection', (e) => sendLog('error', [\`Unhandled Promise: \${e.reason}\`]));

              const handleUpdate = (filename) => {
                const isCSS = filename.endsWith('.css');
                const isSelfHTML = filename.endsWith('.html') && location.pathname.endsWith(filename.split('/').pop() || '');
                const isOtherHTML = filename.endsWith('.html') && !isSelfHTML;

                if (isOtherHTML) return;

                switch (true) {
                  case isCSS:
                    console.log('[LiveReload] CSS change detected: ' + filename);
                    const links = document.querySelectorAll('link[rel="stylesheet"]');
                    for (const link of links) {
                      const url = new URL(link.href, location.href);
                      url.searchParams.set('v', Date.now());
                      link.href = url.pathname + url.search;
                    }
                    break;

                  default:
                    if (document.visibilityState === 'visible') {
                      location.reload();
                    } else {
                      needsReload = true;
                    }
                    break;
                }
              };

              ws.onmessage = (e) => handleUpdate(e.data);

              ws.onopen = () => {
                switch (true) {
                  case isDead:
                    console.log('[LiveReload] Server is back! Refreshing...');
                    location.reload();
                    break;
                  default:
                    console.log('[LiveReload] Connected');
                    break;
                }
              };

              ws.onclose = () => {
                isDead = true;
                setTimeout(connect, 1000);
              };

              ws.onerror = () => ws.close();
            }

            connect();

            document.addEventListener('visibilitychange', () => {
              if (document.visibilityState === 'visible' && needsReload) {
                location.reload();
              }
            });
          })();
        </script>
        `;

        switch (true) {
          case isDevWorker:
            bodyInjects += `\n${lrScript}`;
            break;
        }

        switch (true) {
          case headInjects.length > 0 && html.includes('</head>'):
            html = html.replace('</head>', headInjects + '\n  </head>');
            break;
          case headInjects.length > 0:
            html = headInjects + '\n' + html;
            break;
        }

        switch (true) {
          case bodyInjects.length > 0 && html.includes('</body>'):
            html = html.replace('</body>', bodyInjects + '\n  </body>');
            break;
          case bodyInjects.length > 0:
            html = html + '\n' + bodyInjects;
            break;
        }

        const hasImportMap =
          Object.keys(serverConfig.importMap || {}).length > 0;
        const importMapTag = hasImportMap
          ? `\n<script type="importmap">\n${JSON.stringify({ imports: serverConfig.importMap }, null, 2)}\n</script>\n`
          : '';

        switch (true) {
          case hasImportMap && html.includes('<head>'):
            html = html.replace('<head>', '<head>' + importMapTag);
            break;
          case hasImportMap:
            html = importMapTag + html;
            break;
        }

        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      } catch (err) {
        return new Response('Not Found', { status: 404 });
      }
    }

    return new Response(file);
  },

  websocket: {
    message(ws, message) {
      try {
        const parsed = JSON.parse(String(message));

        match(parsed.type, {
          subscribe_logger: () => void connectedLoggers.add(ws),
          force_reload: () => {
            serveLog.MANUAL_RELOAD();
            server.publish('livereload', 'force_reload');
          },
          client_log: () => {
            connectedLoggers.forEach((loggerWs) => loggerWs.send(message));

            connectedLoggers.size === 0 &&
              match(parsed.level, {
                info: () => clientLog.INFO({ msg: parsed.payload }),
                warn: () => clientLog.WARN({ msg: parsed.payload }),
                error: () => clientLog.ERROR({ msg: parsed.payload }),
                [match.default]: () => clientLog.INFO({ msg: parsed.payload }),
              });
          },
          [match.default]: () => {},
        });
      } catch (e) {}
    },
    open(ws) {
      ws.subscribe('livereload');
    },
    close(ws) {
      connectedLoggers.delete(ws);
    },
  },

  async error(error: Error) {
    const customResponse = serverConfig.onError
      ? await serverConfig.onError(error)
      : null;
    if (customResponse instanceof Response) return customResponse;

    return match((error as any)?.code, {
      ENOENT: () => jsonResponse.object(404, 'Resource not found'),
      [match.default]: () => {
        serveLog.UNHANDLED_ERR({
          error: error?.stack || error?.message || String(error),
        });
        return jsonResponse.object(500, 'Server Error: ' + error.message);
      },
    });
  },
});

process.on('SIGINT', () => {
  serveLog.SHUTTING_DOWN();
  process.exit(0);
});

async function startCompileService() {
  const watcher = watch('./', { recursive: true });

  for await (let { filename } of watcher) {
    if (typeof filename !== 'string') continue;

    const filePath = './' + filename.replace(/\\/g, '/');

    if (isDevWorker && filePath.includes('/.server/schema.ts')) continue;

    if (isDevWorker) {
      switch (true) {
        case filePath.includes('/.database/schema.ts'):
          continue;
        case filePath.includes('/.database/'):
        case filePath.includes('/.server/'):
        case filePath.includes('server.config.ts'):
          serveLog.BACKEND_CHANGE({ file: filePath });
          process.exit(42);
        case filePath.endsWith('.css'):
        case filePath.endsWith('.html'):
          notifySockets(filePath);
          break;
        case !filePath.endsWith('.ts'):
          continue;
      }
    }

    const exists = await Bun.file(filePath).exists();
    const status = exists ? 'changed' : 'deleted';

    if (!jsCache.has(filePath)) continue;

    if (exists) {
      compLog.FILE_STATUS({ status, file: filePath });
      const [err, data] = await tryCatch(compile(filePath));
      const error = err?.stack || err?.message || String(err);

      if (err) {
        compLog.COMPILE_FAIL({ file: filePath, error: error });
        continue;
      }

      compLog.COMPILE_OK({ file: filePath });
      jsCache.set(filePath, data);
      isDevWorker && notifySockets(filePath);
    } else {
      compLog.FILE_DEL({ file: filePath });
      jsCache.delete(filePath);
    }
  }
}

startCompileService().catch((e) => serveLog.WATCHER_ERR({ error: String(e) }));

setTimeout(async () => {
  const host = serverConfig.host || '0.0.0.0';
  const port = serverConfig.port || 3000;

  serveLog.SERVER_STARTED();

  const logAllNets = () => {
    serveLog.SERVER_URL({ type: 'Local  ', host: 'localhost', port });
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        net.family === 'IPv4' &&
          !net.internal &&
          serveLog.SERVER_URL({ type: 'Network', host: net.address, port });
      }
    }
  };

  match(host, {
    '0.0.0.0': logAllNets,
    '::': logAllNets,
    [match.default]: () => serveLog.SERVER_URL({ type: 'Local  ', host, port }),
  });

  serverConfig.onStart && (await serverConfig.onStart(server));
}, 100);
