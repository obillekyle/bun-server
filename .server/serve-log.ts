import { Logger, messageLogger } from './logger';

export const serveMsgs = {
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

export const serveLog = messageLogger(new Logger('serve'), serveMsgs);

export const compileMsgs = {
  FILE_STATUS: 'I File is {status}: {file}',
  COMPILE_FAIL: 'E Failed to compile {file}: {error}',
  COMPILE_OK: 'I Compiled {file} successfully.',
  FILE_DEL: 'I File deleted: {file}',
} as const;

export const compLog = messageLogger(new Logger('compile'), compileMsgs);

export const errorMsg = (err: any) => err?.stack || err?.message || String(err);

export const toMS = (ns: number) => parseFloat((ns / 1e6).toFixed(2));
export const getElapsed = (start: number) => toMS(Bun.nanoseconds() - start);
