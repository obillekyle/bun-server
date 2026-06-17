import { Bakery } from '@server/core/bakery'
import { log } from '@server/logger'
import { deferredValue, is, Try } from '@server/utils/common'
import './core/init'
import { startCompileService } from './compiler'
import {
  handleRequest,
  handleRequestError,
  processResponse,
  serveWebSocket,
} from './core/router'
import { Session } from './core/session'
import {
  printStartupRoutes,
  runStartupBanner,
  setupServer,
} from './core/startup'
import type { Handler } from './handlers'
import { errorMsg, serveLog } from './logger'

const isDevWorker = import.meta.env.WORKER

try {
  await setupServer()
} catch (error: any) {
  serveLog.UNHANDLED_ERR({ error: `Server setup failed: ${errorMsg(error)}` })
  process.exit(1)
}

await printStartupRoutes()

Bakery.server = Bun.serve({
  port: parseInt(process.env.PORT || '0', 10) ?? Bakery.config.port,
  hostname: Bakery.config.host,
  maxRequestBodySize: Bakery.config.maxBodySize,

  async fetch(req) {
    const path = new URL(req.url).pathname
    req.startNs = Bun.nanoseconds()
    deferredValue(req, 'session', Session.from)

    const resp: Handler.Response | symbol = await Try.return(
      async function fetchHandler() {
        const res = await handleRequest(req)

        const isResError = res instanceof Response && res.status >= 400
        const isObjError =
          is.object(res) && 'status' in res && res.status >= 400

        switch (true) {
          case isResError:
          case isObjError:
            return await handleRequestError(path, req, res)
          default:
            return res
        }
      },

      async function errorHandler(error) {
        serveLog.UNHANDLED_ERR({ error: errorMsg(error) })
        return await handleRequestError(path, req, error)
      },
    )

    return processResponse(resp, req)
  },

  websocket: serveWebSocket,

  async error(error: Error, req?: Request): Promise<any> {
    serveLog.UNHANDLED_ERR({ error: errorMsg(error) })
    return await handleRequestError('/', req)
  },
})

if (isDevWorker) {
  startCompileService(Bakery.server).catch(e =>
    serveLog.WATCHER_ERR({ error: String(e) }),
  )
}

setTimeout(() => runStartupBanner(), 100)

async function handleShutdown(signal: string) {
  log({ level: 'info', msg: `Received ${signal}, shutting down...` })
  serveLog.SHUTTING_DOWN()

  Bakery.server?.stop(true)

  for (const hook of Bakery.shutdownHooks) {
    try {
      await hook()
    } catch (err: any) {
      serveLog.UNHANDLED_ERR({
        error: `Error in shutdown hook: ${err?.message || String(err)}`,
      })
    }
  }

  const { PluginHooks } = await import('./core/plugins')
  await PluginHooks.onShutdown()

  process.exit(0)
}

setTimeout(() => {
  Bun.gc(true)
  log({ level: 'info', msg: 'Initial garbage collection complete' })
}, 3000)

process.on('SIGINT', () => handleShutdown('SIGINT'))
process.on('SIGTERM', () => handleShutdown('SIGTERM'))
