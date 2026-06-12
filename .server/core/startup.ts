import { networkInterfaces } from 'node:os'
import { Bakery } from '@server/core/bakery'
import { Logger } from '@server/logger'
import { match } from '@server/utils/common'
import { errorMsg, serveLog } from '../logger'

export async function setupServer(): Promise<void> {
  const {
    ProxyHandler,
    StaticHandler,
    LiveReloadHandler,
    HTMLErrorHandler,
    TSXErrorHandler,
    DefaultErrorHandler,
    VirtualAssetHandler,
    NMHandler,
    ApiHandler,
    ApiErrorHandler,
    TSXHandler,
    TSHandler,
    HTMLHandler,
    MiddlewareHandler,
    ImageHandler,
  } = await import('@server/handlers')
  const { setupPlugins } = await import('./plugins')

  await LiveReloadHandler.init()

  Bakery.handlers.websocket.set(LiveReloadHandler)
  Bakery.handlers.error.set(ApiErrorHandler, 30)
  Bakery.handlers.error.set(TSXErrorHandler, 20)
  Bakery.handlers.error.set(HTMLErrorHandler, 10)
  Bakery.handlers.error.set(DefaultErrorHandler, 0)

  Bakery.handlers.fetch.set(MiddlewareHandler, 100)
  Bakery.handlers.fetch.set(ProxyHandler, 95)
  Bakery.handlers.fetch.set(VirtualAssetHandler, 90)
  Bakery.handlers.fetch.set(ImageHandler, 85)
  Bakery.handlers.fetch.set(NMHandler, 80)
  Bakery.handlers.fetch.set(ApiHandler, 70)
  Bakery.handlers.fetch.set(TSXHandler, 60)
  Bakery.handlers.fetch.set(TSHandler, 55)
  Bakery.handlers.fetch.set(HTMLHandler, 50)
  Bakery.handlers.fetch.set(StaticHandler, 0)

  await setupPlugins()

  for (const HandlerClass of Bakery.handlers.fetch.list()) {
    await HandlerClass.initRoutes()
  }

  for (const HandlerClass of Bakery.handlers.error.list()) {
    await HandlerClass.initRoutes()
  }
}

export async function runStartupBanner(): Promise<void> {
  const host = Bakery.config.host || '0.0.0.0'
  const port = process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : Bakery.config.port || 3000

  serveLog.SERVER_STARTED()

  const logAllNets = () => {
    serveLog.SERVER_URL({ type: 'Local  ', host: 'localhost', port })
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.internal) continue
        if (net.family !== 'IPv4') continue
        serveLog.SERVER_URL({ type: 'Network', host: net.address, port })
      }
    }
  }

  match(host, {
    '0.0.0.0': logAllNets,
    '::': logAllNets,
    [match]: () => serveLog.SERVER_URL({ type: 'Local ', host, port }),
  })

  const { PluginHooks } = await import('./plugins')
  await PluginHooks.onStart(Bakery.server!)
  await Bakery.config.onStart()
}

export async function printStartupRoutes(): Promise<void> {
  const routeLogger = new Logger('routes')
  const { printRoutesTree } = await import('../utils/routing')
  const { apiLines, pageLines } = printRoutesTree()
  routeLogger.log('')
  for (const line of apiLines) routeLogger.log(line)
  for (const line of pageLines) routeLogger.log(line)
  routeLogger.log('')
}

export function registerShutdownHooks(): void {}

export async function startup(): Promise<void> {
  const isDev = import.meta.env.DEV || process.argv.includes('--dev')

  serveLog.STARTING({ mode: isDev ? 'development' : 'production' })

  try {
    const { initConfig } = await import('./config')
    const { initImportMap } = await import('../utils/http')
    const { syncTSConfigPaths } = await import('./tsconfig-sync')
    await initConfig()
    await initImportMap()
    await syncTSConfigPaths(Bakery.config.importMap || {})
  } catch (error: any) {
    console.error('Config init error stack:', error)
    serveLog.UNHANDLED_ERR({ error: `Config init failed: ${errorMsg(error)}` })
    process.exit(1)
  }

  try {
    const { syncSQLSchema } = await import('@database/sync')
    await syncSQLSchema()
  } catch (error: any) {
    serveLog.UNHANDLED_ERR({ error: `Startup failed: ${errorMsg(error)}` })
    process.exit(1)
  }

  try {
    await setupServer()
  } catch (error: any) {
    serveLog.UNHANDLED_ERR({ error: `Server setup failed: ${errorMsg(error)}` })
    process.exit(1)
  }

  registerShutdownHooks()
}
