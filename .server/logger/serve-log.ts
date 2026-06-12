import { Logger, messageLogger } from './logger'

export const serveMsgs = {
  STARTING: 'I Starting server in %c{mode}%* mode...',
  START_WATCHER: 'I Starting %yDEV%* watcher...',
  RESTART_REQ: 'I Dev server restart requested from %ysync engine%*!',
  UNHANDLED_ERR: 'E Unhandled Server Error: %r{error}%*',
  SHUTTING_DOWN: 'W %yShutting down server...%*',
  BACKEND_CHANGE: 'I Backend change detected: %y{file}%*',
  SERVER_STARTED: 'I %gServer running at:%*',
  SERVER_URL: 'I   ➜ %w{type}%*: %bhttp://{host}:{port}%*',
  WATCHER_ERR: 'E Watcher error: %r{error}%*',
  CONFIG_LOADED: 'I Loaded %yserver.config.ts%*',
  TSCONFIG_SYNCED:
    'I Synced %ytsconfig.app.json%* paths with %yserver.config.ts%*!',
  PRESS_D: 'I Press "%yd%*" to spawn the dedicated client logger terminal!',
  SPAWN_LOGGER: 'I Spawning client logger terminal...',
  MANUAL_RELOAD: 'I %yManual reload%* triggered from client logger!',
  CONFIG_IMPORT_ERR: 'E Failed to import %yserver.config.ts%*: %r{error}%*',
  WEBSOCKET_ERR: 'E WebSocket error from %y{ip}%*: %r{error}%*',
} as const

export const serveLog = messageLogger(new Logger('serve'), serveMsgs)

export const handlerMsgs = {
  API_IMPORT_ERR: 'E Failed to import API module (%y{file}%*): %r{error}%*',
  TSX_IMPORT_ERR: 'E Failed to import TSX module (%y{file}%*): %r{error}%*',
  TSX_EXPORT_NOT_FUNCTION:
    'E TSX module does not export a function: %y{file}%*',
  PROXY_REQ: 'I Proxying %y{path}%* -> %b{target}%*',
  ERROR_HANDLER_ERR: 'E Error in custom ErrorHandler (%y{name}%*): %r{error}%*',
  CUSTOM_ERROR_PAGE_ERR: 'E Failed to render custom error page: %r{error}%*',
  MIDDLEWARE_ERR: 'E Middleware error: %r{error}%*',
  DISK_CACHE_WRITE_ERR: 'E Failed to write node module disk cache: %r{error}%*',
  BUNDLE_ERR: 'E Failed to bundle module (%y{file}%*): %r{error}%*',
  UNHANDLED_ERR: 'E Unhandled Handler Error: %r{error}%*',
} as const

export const handlerLog = messageLogger(new Logger('handlers'), handlerMsgs)

export const compileMsgs = {
  FILE_STATUS: 'I File is %y{status}%*: %w{file}%*',
  COMPILE_FAIL: 'E Failed to compile %y{file}%*: %r{error}%*',
  COMPILE_OK: 'I Compiled %w{file}%* %gsuccessfully%*.',
  FILE_DEL: 'I File deleted: %w{file}%*',
} as const

export const compLog = messageLogger(new Logger('compile'), compileMsgs)
export const pluginLog = messageLogger(new Logger('plugins'), {
  UNHANDLED_ERR: 'E Unhandled Plugin Error: %r{error}%*',
} as const)

export const errorMsg = (err: any) => err?.stack || err?.message || String(err)

export const toMS = (ns: number) => parseFloat((ns / 1e6).toFixed(2))
export const getElapsed = (start: number) => toMS(Bun.nanoseconds() - start)
