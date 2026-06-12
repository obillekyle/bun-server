import { Bakery } from '@server/core/bakery'
import { Try, is, any } from '@server/utils/common'
import { log } from '@server/logger'
import './core/init'
import { startCompileService } from './compiler'
import {
  handleRequest,
  handleRequestError,
  processResponse,
  serveWebSocket,
} from './core/router'
import { Session } from './core/session'
import { printStartupRoutes, runStartupBanner, startup } from './core/startup'
import type { Handler } from './handlers'
import { errorMsg, serveLog } from './logger'

const isDevWorker = import.meta.env.WORKER

await startup()

await printStartupRoutes()

const { ErrorHandler: RuntimeErrorHandler } = await import('./handlers')

const isTest = process.env.NODE_ENV === 'test' || Bun.env.NODE_ENV === 'test'
Bakery.server = Bun.serve({
  port: isTest
    ? 0
    : process.env.PORT
      ? parseInt(process.env.PORT, 10)
      : Bakery.config.port,
  hostname: Bakery.config.host,

  maxRequestBodySize: Bakery.config.maxBodySize,

  async fetch(req) {
    const path = new URL(req.url).pathname
    req.startNs = Bun.nanoseconds()
    Object.defineProperty(req, 'session', {
      get() {
        this._session ||= Session.from(this)
        return this._session
      },
      set(val) {
        this._session = val
      },
      configurable: true,
      enumerable: true,
    })

    const resp: Handler.Response | symbol = await Try.return(
      async function fetchHandler() {
        const response = await handleRequest(req)
        if (response instanceof Response) {
          if (response.status >= 400) {
            return await handleRequestError(
              path,
              req,
              RuntimeErrorHandler.extractErrorData(response),
            )
          }
        }

        if (is.object(response)) {
          if ('status' in response && response.status >= 400) {
            return await handleRequestError(
              path,
              req,
              RuntimeErrorHandler.extractErrorData(response),
            )
          }
        }

        return response
      },

      async function errorHandler(error) {
        serveLog.UNHANDLED_ERR({ error: errorMsg(error) })
        const errorData = RuntimeErrorHandler.extractErrorData(error)

        return await handleRequestError(path, req, errorData)
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

process.on('SIGINT', () => handleShutdown('SIGINT'))
process.on('SIGTERM', () => handleShutdown('SIGTERM'))
