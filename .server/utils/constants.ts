export const DEFAULT_PORT = 3000
export const DEFAULT_HOST = '0.0.0.0'

export const DEFAULT_MAX_BODY_SIZE = 20 * 1024 * 1024
export const DEFAULT_MAX_CACHE_SIZE = 500

export const DEFAULT_DB_BACKUPS = 10

export const DEFAULT_SESSION_TTL = 1000 * 60 * 60 * 24
export const DEFAULT_SESSION_PERSIST = DEFAULT_SESSION_TTL * 30
export const DEFAULT_SESSION_FILE = '.server/.cache/sessions.json'
export const CACHE_DIR = '.server/.cache/node-modules'

export const DEFAULT_BLOCKED_GLOBS = [
  '**/.env',
  '**/*.env',
  '**/*.sql',
  '**/*.db',
  '**/*.json',
  '**/*.yaml',
  '**/*.yml',
  '**/*.lock',
  '**/.server/**',
  '**/_internal/**',
  '**/.git/**',
  '**/.vscode/**',
  '**/node_modules/**',
  '**/server.config.ts',
  '**/schema.ts',
  '**/.gitignore',
  '**/*.exe',
]

export const DEFAULT_BLOCKED_SUBSTRINGS = ['..', '\0']
