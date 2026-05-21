#!/usr/bin/env bun

import './init';

import { syncSQLSchema } from '@database/sync';
import { watch } from 'node:fs/promises';
import { networkInterfaces, platform } from 'node:os';
import { compile } from './compiler';
import {
  connectedLoggers,
  handleDashboardRequest,
  setupDashboard,
} from '../.dashboard';
import {
  handleApi,
  handleHTML,
  handleMiddleware,
  handleNodeModule,
  handleProxy,
  handleStatic,
  handleTS,
  handleTSX,
  handleVirtualAsset,
} from './handlers';
import { log } from './logger';
import { compLog, errorMsg, serveLog } from './serve-log';
import { getSession, setSession } from './session';
import { jsonResponse, tryCatch } from './utils';
import { jsCache } from './utils/cache';
import { serverConfig, updateConfig } from './utils/config';
import { injectIfHtml } from './utils/html-utils';
import { resolveFileRoute } from './utils/router-utils';

// ==========================================
//  CONSTANTS & SYSTEM RULES
// ==========================================

const configFile = process.cwd() + '/server.config.ts';

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
const blockedDirs = ['.server', '.database', '.dashboard', '_internal', '.git', '.vscode'];
const blockedSubstrings = ['..', '\0'];

// ==========================================
//  GLOBAL STATES & MEMORY CACHES
// ==========================================

const isDevWorker = process.argv.includes('--dev-worker');
const isDev = process.argv.includes('--dev') || isDevWorker;

if (isDev) {
  setupDashboard();
}

let userImportMap: Record<string, string> = {};
const autoImportMap: Record<string, string> = {};

let server: any;

// ==========================================
//  INTERNAL CONFIGURATION SYNC ENGINES
// ==========================================

async function syncTSConfigPaths() {
  try {
    const newPaths: Record<string, string[]> = {};

    for (const [key, val] of Object.entries(userImportMap)) {
      const tsKey = key.endsWith('/') ? key.slice(0, -1) + '/*' : key;
      let tsVal = val.startsWith('/') ? '.' + val : val;
      if (!tsVal.startsWith('./')) tsVal = './' + tsVal;
      tsVal = tsVal.endsWith('/') ? tsVal.slice(0, -1) + '/*' : tsVal;
      if (!tsVal.endsWith('/*')) tsVal += '/*';
      newPaths[tsKey] = [tsVal];
    }

    let changed = false;

    const appPath = './tsconfig.app.json';
    let appConfig: any = { compilerOptions: { paths: {} } };
    if (await Bun.file(appPath).exists()) appConfig = await Bun.file(appPath).json().catch(() => appConfig);
    appConfig.compilerOptions = appConfig.compilerOptions || {};
    delete appConfig.compilerOptions.baseUrl;
    
    if (JSON.stringify(appConfig.compilerOptions.paths || {}) !== JSON.stringify(newPaths)) {
      appConfig.compilerOptions.paths = newPaths;
      await Bun.write(appPath, JSON.stringify(appConfig, null, 2));
      changed = true;
    }

    const rootPath = './tsconfig.json';
    let rootConfig: any = { compilerOptions: { paths: {} } };
    if (await Bun.file(rootPath).exists()) {
      try {
        const text = await Bun.file(rootPath).text();
        const stripped = text.replace(new RegExp('//.*$', 'gm'), '').replace(new RegExp('/\\\\*[\\\\s\\\\S]*?\\\\*/', 'g'), '');
        rootConfig = JSON.parse(stripped);
      } catch (e) {}
    }
    rootConfig.compilerOptions = rootConfig.compilerOptions || {};
    
    const mergedRootPaths = { ...(rootConfig.compilerOptions.paths || {}), ...newPaths };
    
    if (JSON.stringify(rootConfig.compilerOptions.paths || {}) !== JSON.stringify(mergedRootPaths)) {
      rootConfig.compilerOptions.paths = mergedRootPaths;
      await Bun.write(rootPath, JSON.stringify(rootConfig, null, 2));
      changed = true;
    }

    if (changed) serveLog.TSCONFIG_SYNCED();
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

  if (module?.default) {
    updateConfig({ ...serverConfig, ...module.default });
  }

  const rawMap = module?.default?.importMap || {};
  userImportMap = {};
  for (const [k, v] of Object.entries(rawMap)) {
    let bv = String(v);
    if (bv.startsWith('./')) bv = bv.slice(1);
    if (!bv.startsWith('/') && !bv.startsWith('http')) bv = '/' + bv;
    userImportMap[k] = bv;
  }

  if (!isDevWorker) {
    if (configExists && module?.default) serveLog.CONFIG_LOADED();

    await syncTSConfigPaths();
    await autoMapNodeModules();
  }

  updateConfig({
    ...serverConfig,
    importMap: { ...autoImportMap, ...serverConfig.importMap },
  });
}

// ==========================================
//  WATCHERS & CONSOLE PROCESS COORDINATORS
// ==========================================

async function notifySockets(filename: string) {
  server && server.publish('livereload', filename);
}

async function spawnLoggerTerminal() {
  const os = platform();

  const scriptArgs = `bun ./.server/client/log.ts ${process.pid}`;
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
    if (!/\.(ts|tsx|js|jsx|css|html)$/.test(filePath)) continue;

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
//  ACTIVE RUNTIME EXECUTION BLOCK
// ==========================================

const isParentWatcher = isDev && !isDevWorker;

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
      const clientAsset = await handleVirtualAsset(path);
      return clientAsset || new Response('Not Found', { status: 404 });
    }

    if (isDevWorker && path === '/_livereload')
      return server.upgrade(req)
        ? undefined
        : new Response('WebSocket upgrade failed', { status: 400 });

    // Execute modular middleware chain
    const middlewareRes = await handleMiddleware(req, server, isDevWorker);
    if (middlewareRes) return middlewareRes;

    const [_, session] = await tryCatch(async () => getSession(req));
    if (!session) return setSession(path);

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
    const proxyRes = await handleProxy(req, path, url);
    if (proxyRes) return proxyRes;

    // =================================
    // DEVELOPER CONSOLE DASHBOARD ROUTING
    // =================================
    const dashboardResponse = await handleDashboardRequest(req, server);
    if (dashboardResponse) return dashboardResponse;

    // =================================
    // API HANDLER
    // =================================
    if (path.startsWith('/api/')) {
      return handleApi(req, path, now, server);
    }

    const { targetPath, file, stat, params } = await resolveFileRoute(
      path,
      isNodeModule,
    );

    switch (true) {
      case !stat:
        return new Response('Not Found', { status: 404 });
      case isNodeModule:
        return handleNodeModule(targetPath, isDevWorker);
      case targetPath.endsWith('.tsx'):
        return handleTSX(req, targetPath, server, isDevWorker, params);
      case targetPath.endsWith('.ts'):
        return handleTS(targetPath);
      case targetPath.endsWith('.html'):
        return handleHTML(file, isDevWorker);
      default:
        return handleStatic(file);
    }
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
