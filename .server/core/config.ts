import { log } from '@server/logger'
import {
  DEFAULT_BLOCKED_GLOBS,
  DEFAULT_DB_BACKUPS,
  DEFAULT_HOST,
  DEFAULT_PORT,
} from '@server/utils/constants'
import { fs } from '@server/utils/fs'

export const NOOP = () => {}

const defaultConfig: Required<AppConfig> = {
  port: DEFAULT_PORT,
  host: DEFAULT_HOST,
  maxBodySize: 20 * 1024 * 1024, // 20MB
  middleware: [],
  backups: DEFAULT_DB_BACKUPS,
  blocked: [],
  head: '',
  body: '',
  plugins: [],
  onStart: NOOP,
  onError(e) {
    log({ level: 'warn', msg: e.errorBody })
  },
  onShutdown: NOOP,
  maxCacheSize: 500,
  importMap: {
    '@client/utils': '.server/client/utils',
  },
  onRequest: NOOP,
  proxy: {},
  root: 'src',
  websocket: {
    message: NOOP,
    open: NOOP,
    close: NOOP,
    drain: NOOP,
  },
}

let cachedConfig: ProcessedAppConfig | null = null

export async function initConfig(): Promise<Readonly<ProcessedAppConfig>> {
  if (cachedConfig) return cachedConfig

  const serverConfig = (await import(`${fs.cwd}/server.config.ts`))
    .default as AppConfig
  const overriden = Object.assign({}, defaultConfig, serverConfig)

  overriden.importMap = Object.assign(
    { '@client/utils': '.server/client/utils' },
    serverConfig.importMap || {},
  )

  const blockedGlob = [
    ...DEFAULT_BLOCKED_GLOBS,
    ...overriden.blocked.map(pattern =>
      pattern.startsWith('**/') ? pattern : `**/${pattern}`,
    ),
  ].join(',')

  cachedConfig = Object.assign(overriden, {
    blocked: new Bun.Glob(`{${blockedGlob}}`),
    root: fs.resolve(overriden.root),
  })

  return Object.freeze(cachedConfig)
}

export function getConfig(): Readonly<ProcessedAppConfig> {
  if (!cachedConfig) {
    throw new Error('Config has not been initialized. Call initConfig() first.')
  }
  return cachedConfig
}
