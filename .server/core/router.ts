import { Bakery } from '@server/core/bakery'
import { Session } from '@server/core/session'
import { DefaultErrorHandler } from '@server/handlers/assets/static'
import type { Handler } from '@server/handlers/core/$base'
import { ErrorHandler } from '@server/handlers/core/$error'
import { WebSocketHandler } from '@server/handlers/core/$websocket'
import { log } from '@server/logger'
import { JsonResponseData } from '@server/utils'
import { is } from '@server/utils/common'
import { DEFAULT_BLOCKED_GLOBS } from '@server/utils/constants'
import { ETag, injectIfHtml, response } from '@server/utils/http'
import { errorMsg, getElapsed, serveLog } from '../logger'
import { PluginHooks } from './plugins'

const dummyRequest = new Request('http://localhost/__internal__')

export async function upgradeWebsocket(
  req: Request,
  path: string,
): Promise<boolean | undefined> {
  try {
    const wSockH = Bakery.handlers.websocket
    const cached = await wSockH.getValidCache(path, req)

    if (cached) {
      const upgraded = await cached.handle(path, req)
      return Boolean(upgraded)
    }

    for (const HandlerClass of wSockH.list()) {
      const canHandle = await HandlerClass.canHandle(path, req)
      if (canHandle) {
        wSockH.routeCache.set(path, HandlerClass)
        const upgraded = await HandlerClass.handle(path, req)
        return Boolean(upgraded)
      }
    }
  } catch (err: any) {
    serveLog.UNHANDLED_ERR({
      error: `Error checking WebSocketHandler: ${errorMsg(err)}`,
    })

    return false
  }
}

export function handleRequest(
  req: Request,
): Handler.Response | MixedPromise<symbol>
export async function handleRequest(req: Request) {
  const url = new URL(req.url)
  const path = url.pathname
  if (DEFAULT_BLOCKED_GLOBS.some(glob => path.includes(glob))) {
    return new Response('Forbidden', { status: 403 })
  }

  if (Bakery.config.blocked.match(path)) {
    return new Response('Forbidden', { status: 403 })
  }

  if (req.headers.get('Upgrade') === 'websocket') {
    const wsHandled = await upgradeWebsocket(req, path)
    return wsHandled
      ? WebSocketHandler.WS_UPGRADE
      : response.error('WebSocket Upgrade Failed', 400)
  }

  await PluginHooks.onRoute(req)

  const pluginResponse = await PluginHooks.onRequest(req)
  if (pluginResponse) return pluginResponse

  const fetchH = Bakery.handlers.fetch
  const cached = await fetchH.getValidCache(path, req)

  if (cached) return await cached.handle(path, req)

  for (const HandlerClass of fetchH.list()) {
    const canHandle = await HandlerClass.canHandle(path, req)
    if (canHandle) return await HandlerClass.handle(path, req)
  }

  return new Response('Not Found', { status: 404 })
}

const isWSHandler = (handler: any) =>
  handler &&
  (handler.prototype instanceof WebSocketHandler ||
    handler === WebSocketHandler)

export const serveWebSocket: Bun.WebSocketHandler<any> = {
  async message(ws: any, message) {
    try {
      ws.data ||= {}
      const mainData = ws.data
      if (isWSHandler(mainData.this)) {
        mainData.data ||= {}
        const data = mainData.data || {}
        await mainData.this.message(ws, message, data)
        return
      }

      Bakery.config.websocket.message(ws, message)
    } catch (err: any) {
      serveLog.UNHANDLED_ERR({
        error: `WebSocket message error: ${errorMsg(err)}`,
      })
    }
  },
  async open(ws: any) {
    try {
      ws.data ||= {}
      const mainData = ws.data
      if (isWSHandler(mainData.this)) {
        mainData.data ||= {}
        const data = mainData.data
        mainData.this.open(ws, data)
        return
      }

      await Bakery.config.websocket.open?.(ws)
    } catch (err: any) {
      serveLog.UNHANDLED_ERR({
        error: `WebSocket open error: ${errorMsg(err)}`,
      })
    }
  },
  async close(ws: any, code: number, reason: string) {
    try {
      ws.data ||= {}
      const mainData = ws.data
      if (isWSHandler(mainData.this)) {
        mainData.data ||= {}
        const data = mainData.data

        mainData.this.close(ws, code, reason, data)
        return
      }

      await Bakery.config.websocket.close?.(ws, code, reason)
    } catch (err: any) {
      serveLog.UNHANDLED_ERR({
        error: `WebSocket close error: ${errorMsg(err)}`,
      })
    }
  },
  async drain(ws: any) {
    try {
      ws.data ||= {}
      const mainData = ws.data
      if (isWSHandler(mainData.this)) {
        mainData.data ||= {}
        const data = mainData.data

        mainData.this.drain(ws, data)
        return
      }

      await Bakery.config.websocket.drain?.(ws)
    } catch (err: any) {
      serveLog.UNHANDLED_ERR({
        error: `WebSocket drain error: ${errorMsg(err)}`,
      })
    }
  },
}

export function handleRequestError(
  path: string,
  req?: Request,
  error?: Handler.Error.Data,
): Handler.Response
export async function handleRequestError(
  path: string,
  req?: Request,
  error?: Handler.Error.Data,
) {
  req ||= dummyRequest
  error ||= ErrorHandler.DEFAULT_ERROR

  const pluginRes = await PluginHooks.onError(error, req)
  if (pluginRes) return pluginRes

  const bakeryError = Object.assign({}, error, {
    errorBody: `${error.errorBody} at ${path}`,
  })

  const configError = await Bakery.config.onError(bakeryError)
  if (configError instanceof Response) {
    const injectedRes = await injectIfHtml(configError)
    return injectedRes || configError
  }

  try {
    const errorH = Bakery.handlers.error
    const cached = await errorH.getValidCache(path, req, error)
    if (cached) return await cached.handle(path, req, error)

    for (const HandlerClass of Bakery.handlers.error.list()) {
      const canHandle = await HandlerClass.canHandle(path, req, error)
      if (canHandle) {
        errorH.routeCache.set(path, HandlerClass)
        return await HandlerClass.handle(path, req, error)
      }
    }
  } catch (err: any) {
    serveLog.UNHANDLED_ERR({
      error: `Error in ErrorHandler: ${errorMsg(err)}`,
    })
  }

  return DefaultErrorHandler.handle(path, req, error)
}

export async function processResponse(
  data: Handler.Response | MixedPromise<symbol>,
  req: Request,
): Promise<Response | undefined> {
  data = await data
  if (data === WebSocketHandler.WS_UPGRADE) return
  if (data === null || data === undefined)
    return new Response(null, { status: 204 })

  const resp = await (async function getResponse() {
    if (data instanceof Response) {
      return (await injectIfHtml(data)) || data
    }

    if (data instanceof Blob) {
      return ETag.sendFile(data as Bun.BunFile)
    }

    if (typeof data === 'string') {
      const injected = await injectIfHtml(data)
      return injected || response.text(data)
    }

    if (data instanceof JsonResponseData) {
      data.time = getElapsed(req.startNs)
      const json = data.toJson()
      return response.type(json, 'application/json')
    }

    if (is.object(data)) {
      const stringified = JSON.stringify(data)
      return response.type(stringified, 'application/json')
    }

    return new Response(String(data))
  })()

  const sess = Session.getCookie(req)

  sess && resp.headers.set('Set-Cookie', sess)
  const final = ETag.sendResponse(req, resp)
  if (!(final instanceof Response)) {
    log({
      by: 'final-response',
      level: 'error',
      msg: 'ETag failed to generate a valid response',
    })
  }

  return final
}
