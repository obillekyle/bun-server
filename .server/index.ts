#!/usr/bin/env bun

import './init';

import { compile } from './compiler';
import { getSession, setSession } from './session';
import { jsonResponse, processBody, tryCatch } from './utils';
import { watch } from 'node:fs/promises';
import { networkInterfaces, platform } from 'node:os';
import { Logger, messageLogger, log } from './logger'; // 🔌 Explicitly import log to prevent WebSocket ReferenceErrors!
import { syncSQLSchema } from '@database/sync';

// ==========================================
// 1. MESSAGES & LOGGER SETUPS
// ==========================================

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
  API_IMPORT_ERR: 'E Failed to import API module ({file}): {error}',
  TSX_IMPORT_ERR: 'E Failed to import TSX module ({file}): {error}',
  TSX_EXPORT_NOT_FUNCTION: 'E TSX module does not export a function: {file}',
  CONFIG_IMPORT_ERR: 'E Failed to import server.config.ts: {error}',
  WEBSOCKET_ERR: 'E WebSocket error from {ip}: {error}',
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

// ==========================================
// 2. CONSTANTS & SYSTEM RULES
// ==========================================

const lrScript = './.server/client-livereload.ts';
const clientUtils = './.server/client-utils.ts';
const configFile = process.cwd() + '/server.config.ts';

const MAX_CACHE_SIZE = 1000;

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
const blockedDirs = ['.server', '.database', '_internal', '.git', '.vscode'];
const blockedSubstrings = ['..', '\0'];

// ==========================================
// 3. GLOBAL STATES & MEMORY CACHES
// ==========================================

const jsCache = new Map<string, string>();
const connectedLoggers = new Set<any>();

// 🛡️ DEV STATE FIX: If we are a dev worker, we are intrinsically in dev mode!
const isDevWorker = process.argv.includes('--dev-worker');
const isDev = process.argv.includes('--dev') || isDevWorker;

let serverConfig: AppConfig = {
  port: 3000,
  host: '0.0.0.0',
  importMap: {},
  proxy: {},
};
let userImportMap: Record<string, string> = {};
const autoImportMap: Record<string, string> = {};

// 🔌 Global server pointer initialized to safely resolve circular TDZ dependencies
let server: any;

// ==========================================
// 4. PURE UTILITIES & MATHEMATICAL HELPERS
// ==========================================

const toMS = (ns: number) => parseFloat((ns / 1e6).toFixed(2));
const getElapsed = (start: number) => toMS(Bun.nanoseconds() - start);
const errorMsg = (err: any) => err?.stack || err?.message || String(err);

// ==========================================
// 5. ASYNCHRONOUS COMPILERS & HTML ASSEMBLERS
// ==========================================

const jsMod = (src = '') => `\n <script type="module" src="${src}"></script>\n`;
const jsMap = (map: any) =>
  `\n <script type="importmap">\n${JSON.stringify({ imports: map }, null, 2)}\n</script>\n`;

function assembleHtml(html: string, isDevWorker: boolean) {
  const styles: string[] = (serverConfig as any).styles || [];
  const scripts: any[] = (serverConfig as any).scripts || [];

  let headInjects = jsMod('/_client/utils.js');
  let bodyInjects = '';

  if (isDevWorker) {
    headInjects += jsMod('/_client/livereload.js');
  }

  for (const href of styles) {
    headInjects += `\n  <link rel="stylesheet" href="${href}" />`;
  }

  for (const script of scripts) {
    let tag = '<script ';
    let placeInBody = false;

    switch (typeof script) {
      case 'string':
        tag += `src="${script}" defer></script>`;
        break;
      case 'object':
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

  const importMap = serverConfig.importMap || {};

  html = /(<head[^>]*>)/i.test(html)
    ? html.replace(/(<head[^>]*>)/i, '$1' + jsMap(importMap) + headInjects)
    : jsMap(importMap) + headInjects + '\n' + html;

  html = /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, bodyInjects + '\n</body>')
    : html + '\n' + bodyInjects;

  return html;
}

async function injectIfHtml(
  data: any,
  isDevWorker: boolean,
): Promise<Response | null> {
  //
  switch (true) {
    case typeof data === 'string' && data.trim().startsWith('<'):
      const htmlStr = assembleHtml(data, isDevWorker);
      return new Response(htmlStr, {
        headers: { 'Content-Type': 'text/html' },
      });

    case data instanceof Response:
      if (data.headers.get('content-type')?.includes('text/html')) {
        const text = await data.text();
        const htmlStr = assembleHtml(text, isDevWorker);

        const newHeaders = new Headers(data.headers);
        newHeaders.delete('content-length');

        return new Response(htmlStr, {
          status: data.status,
          statusText: data.statusText,
          headers: newHeaders,
        });
      }
      break;

    case data instanceof Blob:
      if (data.type.includes('text/html')) {
        const text = await data.text();
        const htmlBlob = assembleHtml(text, isDevWorker);
        return new Response(htmlBlob, {
          headers: { 'Content-Type': 'text/html' },
        });
      }
      break;
  }
  return null;
}

// ==========================================
// 6. INTERNAL CONFIGURATION SYNC ENGINES
// ==========================================

async function syncTSConfigPaths() {
  const tsConfigPath = './tsconfig.app.json';
  try {
    let tsConfig: any = { compilerOptions: { paths: {} } };
    const file = Bun.file(tsConfigPath);

    if (await file.exists()) tsConfig = await file.json().catch(() => tsConfig);

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

    if (oldPaths === JSON.stringify(newPaths)) return;

    tsConfig.compilerOptions.paths = newPaths;
    await Bun.write(tsConfigPath, JSON.stringify(tsConfig, null, 2));
    serveLog.TSCONFIG_SYNCED();
    //
  } catch (err: any) {
    serveLog.UNHANDLED_ERR({ error: 'TSConfig sync error: ' + errorMsg(err) });
  }
}

async function autoMapNodeModules() {
  const pkgPath = process.cwd() + '/package.json';
  const file = Bun.file(pkgPath);

  if (!(await file.exists())) return;

  const pkg = await file.json();
  const deps = Object.keys(pkg.dependencies || {});

  for (const dep of deps) {
    autoImportMap[`${dep}/`] = `/node_modules/${dep}/`;
    const depPkgPath = process.cwd() + `/node_modules/${dep}/package.json`;
    const file = Bun.file(depPkgPath);

    if (!(await file.exists())) continue;

    const depPkg = await file.json();
    let mod = depPkg.module || depPkg.browser || depPkg.main || 'index.js';
    autoImportMap[dep] = `/node_modules/${dep}/${mod.replace(/^\.\//, '')}`;
  }

  if (deps.length > 0) serveLog.AUTO_MAP({ count: deps.length });
}

async function setupConfig() {
  const configExists = await Bun.file('./server.config.ts').exists();
  let module: any = null;

  if (configExists) {
    const [importErr, importedModule] = await tryCatch(import(configFile));
    if (importErr) serveLog.CONFIG_IMPORT_ERR({ error: errorMsg(importErr) });

    module = importedModule || {};
  }

  serverConfig = module?.default
    ? { ...serverConfig, ...module.default }
    : serverConfig;
  userImportMap = module?.default?.importMap
    ? { ...module.default.importMap }
    : userImportMap;

  if (!isDevWorker) {
    if (configExists && module?.default) serveLog.CONFIG_LOADED();

    await syncTSConfigPaths();
    await autoMapNodeModules();
  }

  serverConfig.importMap = { ...autoImportMap, ...serverConfig.importMap };
}

// ==========================================
// 7. PATH ROUTERS & VIRTUAL ASSETS
// ==========================================

async function resolveFileRoute(path: string, isNodeModule: boolean) {
  let targetPath = '.' + path;
  let file = Bun.file(targetPath);
  let stat = await file.stat().catch(() => null);

  // Match directory
  if (stat?.isDirectory()) {
    for (const ext of ['/index.tsx', '/index.html'])
      if (await Bun.file(targetPath + ext).exists()) targetPath += ext;

    file = Bun.file(targetPath);
    stat = await file.stat().catch(() => null);
  }

  // Match extensionless file
  if (!stat && !path.split('/').pop()?.includes('.')) {
    for (const ext of ['.tsx', '.html'])
      if (await Bun.file(targetPath + ext).exists()) targetPath += ext;

    file = Bun.file(targetPath);
    stat = await file.stat().catch(() => null);
  }

  // if typescript or javascript file
  if (!stat && !isNodeModule) {
    targetPath = path.endsWith('.js')
      ? '.' + path.slice(0, -3) + '.ts'
      : '.' + path + '.ts';
    file = Bun.file(targetPath);
    stat = await file.stat().catch(() => null);
  }

  return { targetPath, file, stat };
}

async function handleVirtualClientAsset(
  path: string,
): Promise<Response | null> {
  switch (path) {
    case '/_client/utils.js': {
      let content = jsCache.get(clientUtils);

      if (!content) {
        content = await compile(clientUtils).catch(() => '');
        content && jsCache.set(clientUtils, content);
      }

      return new Response(content, {
        headers: {
          'Content-Type': 'application/javascript',
          'Cache-Control': isDevWorker
            ? 'no-cache'
            : 'public, max-age=31536000, immutable',
        },
      });
    }
    case '/_client/livereload.js': {
      if (!isDevWorker) return null;

      let content = jsCache.get(lrScript);

      if (!content) {
        content = await compile(lrScript).catch(() => '');
        content && jsCache.set(lrScript, content);
      }

      return new Response(content, {
        headers: {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-cache',
        },
      });
    }
    default:
      return null;
  }
}

// ==========================================
// 8. WATCHERS & CONSOLE PROCESS COORDINATORS
// ==========================================

async function notifySockets(filename: string) {
  server && server.publish('livereload', filename);
}

async function spawnLoggerTerminal() {
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

async function handleDevMaster(): Promise<never> {
  serveLog.START_WATCHER();
  serveLog.PRESS_D();

  let workerProc: Bun.Subprocess<'inherit', 'inherit', 'inherit'> | null = null;

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key: string) => {
      switch (key.toLowerCase()) {
        case '\u0003':
          workerProc?.kill('SIGINT');
          return;
        case 's':
          process.emit('SIGINT');
          return;
        case 'd':
          serveLog.SPAWN_LOGGER();
          spawnLoggerTerminal();
          return;
      }
    });
  }

  async function startWatcher(): Promise<never> {
    // 🛡️ PASS DOWN --dev FLAG SO THE WORKER KNOWS ITS IDENTITY
    workerProc = Bun.spawn(['bun', Bun.main, '--dev', '--dev-worker'], {
      stdio: ['inherit', 'inherit', 'inherit'],
      env: { ...process.env, DEV_WATCHER_ACTIVE: '1' },
    });

    const code = (await workerProc.exited) ?? 0;

    switch (code) {
      case 42:
        serveLog.RESTART_REQ();
        console.clear();
        return startWatcher();
      case 130:
        serveLog.SHUTTING_DOWN();
        process.exit(0);
      default:
        process.exit(code);
    }
  }

  await startWatcher();
  process.exit(0);
}

async function startCompileService() {
  const watcher = watch('./', { recursive: true });
  const watchIgnoredDirs = ['.git', '.vscode', 'node_modules', '.backups'];

  for await (let { filename } of watcher) {
    if (typeof filename !== 'string') continue;

    const filePath = './' + filename.replace(/\\/g, '/');
    const segments = filePath.split('/');

    if (segments.some((seg) => watchIgnoredDirs.includes(seg))) continue;

    if (isDevWorker) {
      switch (true) {
        case filePath.includes('/.database/schema.ts'):
          continue;

        case filePath.includes('/api/'):
        case filePath.includes('/.database/'):
        case filePath.includes('/.server/'):
        case filePath.includes('server.config.ts'):
        case filePath.endsWith('.tsx'):
          serveLog.BACKEND_CHANGE({ file: filePath });
          process.exit(42);

        case filePath.endsWith('.css'):
        case filePath.endsWith('.html'):
          notifySockets(filePath);
          break;
      }
    }

    const exists = await Bun.file(filePath).exists();
    const status = exists ? 'changed' : 'deleted';

    if (exists) {
      compLog.FILE_STATUS({ status, file: filePath });

      if (jsCache.has(filePath)) {
        const [err, data] = await tryCatch(compile(filePath));

        if (err) {
          compLog.COMPILE_FAIL({ file: filePath, error: errorMsg(err) });
          continue;
        }

        compLog.COMPILE_OK({ file: filePath });
        jsCache.set(filePath, data);

        if (isDevWorker) notifySockets(filePath);
      }

      continue;
    }

    compLog.FILE_DEL({ file: filePath });
    jsCache.delete(filePath);

    if (isDevWorker) notifySockets(filePath);
    //
  }
}

// ==========================================
// 9. ACTIVE RUNTIME EXECUTION BLOCK
// ==========================================

const isParentWatcher = isDev && !isDevWorker;

// 🚀 FIX: Unconditionally load the config for BOTH the master and the worker!
try {
  await setupConfig();
} catch (error: any) {
  serveLog.UNHANDLED_ERR({ error: 'Config setup failed: ' + errorMsg(error) });
  process.exit(1);
}

if (!isDevWorker) {
  serveLog.STARTING({ mode: isDev ? 'development' : 'production' });

  try {
    await syncSQLSchema();
    //
  } catch (error: any) {
    serveLog.UNHANDLED_ERR({ error: 'Startup failed: ' + errorMsg(error) });
    process.exit(1);
  }
}

isParentWatcher && (await handleDevMaster());

server = Bun.serve({
  port: serverConfig.port,
  hostname: serverConfig.host,

  async fetch(req, server) {
    const url = new URL(req.url);
    const now = Bun.nanoseconds();
    const path = url.pathname;

    const isClientRoute = path.startsWith('/_client/');

    if (isClientRoute) {
      const clientAsset = await handleVirtualClientAsset(path);
      return clientAsset || new Response('Not Found', { status: 404 });
    }

    let intercepted = await serverConfig.onRequest?.(req, server);

    if (intercepted) {
      const injectedRes = await injectIfHtml(intercepted, isDevWorker);
      if (injectedRes) return injectedRes;
      if (intercepted instanceof Response) return intercepted;
    }

    const [error, session] = await tryCatch(async () => getSession(req));
    if (!session) return setSession(path);

    if (isDevWorker && path === '/_livereload')
      return server.upgrade(req)
        ? undefined
        : new Response('WebSocket upgrade failed', { status: 400 });

    const segments = path.split('/');
    const isNodeModule = path.startsWith('/node_modules/');
    const isFrontendTS = path.endsWith('.ts') && path !== '/server.config.ts';

    const isBlocked =
      blockedSubstrings.some((sub) => path.includes(sub)) ||
      blockedDirs.some((dir) => segments.includes(dir)) ||
      path === '/server.config.ts' ||
      path.endsWith('.env') ||
      path.endsWith('.db') ||
      (blockedExtensions.some((ext) => path.endsWith(ext)) &&
        !isFrontendTS &&
        !isNodeModule);

    if (isBlocked) return new Response('Forbidden', { status: 403 });

    // =================================
    // PROXY HANDLER
    // =================================

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

    if (path.startsWith('/api/')) {
      const endpoint = path.replace('/api/', '');

      if (!/^[a-zA-Z0-9_/ \-]+$/.test(endpoint)) {
        return jsonResponse.object(400, 'Invalid endpoint name');
      }

      const body = await processBody(req);

      let data: Awaited<ReturnType<ResponseFn>> = {
        time: getElapsed(now),
        status: 404,
        message: 'Endpoint not found for ' + endpoint,
      };

      let apiModule: any = null;
      let apiFileExists = false;
      let foundApiPath = '';

      for (const ext of ['.ts', '.tsx']) {
        const checkPath = `./api/${endpoint}${ext}`;
        if (await Bun.file(checkPath).exists()) {
          apiFileExists = true;
          foundApiPath = checkPath;
          break;
        }
      }

      if (apiFileExists) {
        const [err, mod] = await tryCatch(
          import(process.cwd() + foundApiPath.slice(1)),
        );

        if (err) {
          serveLog.API_IMPORT_ERR({ file: foundApiPath, error: errorMsg(err) });
          return jsonResponse.object(500, `Internal Server Error`);
        }

        apiModule = mod;
      }

      if (typeof apiModule.default !== 'function') {
        data = await apiModule.default(req, body, server);
      }

      const injectedRes = await injectIfHtml(data, isDevWorker);
      if (injectedRes) return injectedRes;

      return match(typeof data, {
        string: () => new Response(String(data)),
        number: () => new Response(String(data)),
        object: () => {
          assert(typeof data === 'object');
          if (data === null) return new Response('null');
          if (data instanceof Response) return data;
          if (data instanceof Blob) return new Response(data);

          data.time ||= getElapsed(now);
          return Response.json(data, { status: data.status || 200 });
        },
        [match.default]: () => new Response('No content', { status: 404 }),
      });
    }

    const { targetPath, file, stat } = await resolveFileRoute(
      path,
      isNodeModule,
    );

    if (!stat) {
      return new Response('Not Found', { status: 404 });
    }

    if (isNodeModule) {
      const modulePath = targetPath.replace(/^\.\//, '');
      if (!(await Bun.file(modulePath).exists())) {
        return new Response('Not Found', { status: 404 });
      }

      const cacheKey = `nm:${modulePath}`;
      let content = jsCache.get(cacheKey);

      if (!content) {
        const build = await Bun.build({
          entrypoints: [modulePath],
          target: 'browser',
          format: 'esm',
          minify: !isDevWorker,
        });

        if (build.success && build.outputs.length > 0) {
          content = await build.outputs[0].text();
          if (jsCache.size >= MAX_CACHE_SIZE) jsCache.clear();
          jsCache.set(cacheKey, content);
        } else {
          serveLog.UNHANDLED_ERR({ error: `Failed to bundle ${modulePath}` });
          return new Response(Bun.file(modulePath));
        }
      }

      return new Response(content, {
        headers: {
          'Content-Type': 'application/javascript',
          'Cache-Control': isDevWorker
            ? 'no-cache'
            : 'public, max-age=31536000, immutable',
        },
      });
    }

    if (targetPath.endsWith('.tsx')) {
      const modulePath = process.cwd() + '/' + targetPath.replace(/^\.\//, '');
      const [error, tsxModule] = await tryCatch(import(modulePath));

      if (error) {
        serveLog.TSX_IMPORT_ERR({ file: targetPath, error: errorMsg(error) });
        return jsonResponse.object(500, `Internal Server Error`);
      }

      if (typeof tsxModule.default !== 'function') {
        serveLog.TSX_EXPORT_NOT_FUNCTION({ file: targetPath });
        return jsonResponse.object(500, 'Internal Server Error');
      }

      const body = await processBody(req);
      let data = await tsxModule.default(req, body, server);

      const injectedRes = await injectIfHtml(data, isDevWorker);

      if (injectedRes) return injectedRes;
      if (typeof data === 'string')
        return new Response(data, {
          headers: { 'Content-Type': 'text/plain' },
        });

      if (data instanceof Response) return data;
      return Response.json(data);
    }

    if (targetPath.endsWith('.ts')) {
      let content = jsCache.get(targetPath);

      if (!content) {
        content = await compile(targetPath);
        if (jsCache.size >= MAX_CACHE_SIZE) {
          jsCache.clear();
        }

        jsCache.set(targetPath, content);
      }

      return new Response(content, {
        headers: { 'Content-Type': 'application/javascript' },
      });
    }

    if (targetPath.endsWith('.html')) {
      let html = await file.text();
      html = assembleHtml(html, isDevWorker);
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }

    return new Response(file);
  },

  websocket: {
    message(ws, message) {
      const ipAddr = ws.remoteAddress;
      try {
        const parsed = JSON.parse(String(message));
        const { type, level, payload } = parsed;

        match(type, {
          subscribe_logger: () => void connectedLoggers.add(ws),
          force_reload: () => {
            serveLog.MANUAL_RELOAD();
            server.publish('livereload', 'force_reload');
          },
          client_log: () => {
            const message = JSON.stringify({ ...parsed, by: ipAddr });
            connectedLoggers.forEach((loggerWs) => loggerWs.send(message));

            if (connectedLoggers.size) return;

            log({ by: ipAddr, msg: payload, level });
            //
          },
          [match.default]: () => {},
        });
        //
      } catch (err: any) {
        serveLog.WEBSOCKET_ERR({ ip: ipAddr, error: errorMsg(err) });
      }
    },
    open: (ws) => ws.subscribe('livereload'),
    close: (ws) => void connectedLoggers.delete(ws),
  },

  async error(error: Error) {
    const customResponse = await serverConfig.onError?.(error);

    if (customResponse instanceof Response) {
      const injectedRes = await injectIfHtml(customResponse, isDevWorker);
      return injectedRes || customResponse;
    }

    return match((error as any)?.code, {
      ENOENT: () => jsonResponse.object(404, 'Resource not found'),
      [match.default]: () => {
        serveLog.UNHANDLED_ERR({ error: errorMsg(error) });
        return jsonResponse.object(502, 'Server Error: ' + error.message);
      },
    });
  },
});

if (isDevWorker) {
  startCompileService().catch((e) =>
    serveLog.WATCHER_ERR({ error: String(e) }),
  );
}

setTimeout(async () => {
  const host = serverConfig.host || '0.0.0.0';
  const port = serverConfig.port || 3000;

  serveLog.SERVER_STARTED();

  const logAllNets = () => {
    serveLog.SERVER_URL({ type: 'Local  ', host: 'localhost', port });
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.internal) continue;
        if (net.family !== 'IPv4') continue;
        serveLog.SERVER_URL({ type: 'Network', host: net.address, port });
      }
    }
  };

  match(host, {
    '0.0.0.0': logAllNets,
    '::': logAllNets,
    [match.default]: () => serveLog.SERVER_URL({ type: 'Local ', host, port }),
  });

  await serverConfig.onStart?.(server);
  //
}, 100);
