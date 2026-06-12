import { Bakery } from '@server/core/bakery'
import { is, jsonResponse } from '@server/utils/common'
import { response, injectIfHtml } from '@server/utils/http'
import { fs } from '@server/utils/fs'
import { DynamicHandler, type Handler } from '../core/$base'
import { DynamicErrorHandler } from '../core/$error'
import { requestStorage } from '@server/core/context'

type TSXModule = {
  default: (
    req: Request,
    body: MapOf<any>,
  ) => MixedPromise<string | Response | MapOf<any>>
}

export class TSXHandler extends DynamicHandler {
  static get config() {
    return {
      ext: ['tsx'],
      dir: Bakery.serveRoot,
    }
  }

  static handle = sharedHandler
  static async canHandle(path: string, req: Request) {
    return path.endsWith('.tsx') || (await super.canHandle(path, req))
  }
}

export class TSXErrorHandler extends DynamicErrorHandler {
  static get config() {
    return {
      ext: ['tsx'],
      dir: Bakery.serveRoot,
      include: ['**/error.tsx', '**/error-*.tsx'],
    }
  }

  static async canHandle(path: string, req: Request) {
    return path.endsWith('.tsx') || (await super.canHandle(path, req))
  }

  static handle = sharedHandler
}

//
//
async function sharedHandler(
  this: typeof DynamicHandler | typeof DynamicErrorHandler,
  path: string,
  req: Request,
  errors?: Handler.Error.Data,
) {
  const errorData = errors || (this as any).DEFAULT_ERROR
  const routeInfo = await this.resolveRoute(path, errorData)
  if (!routeInfo) return response.error('Not Found')

  const modulePath = fs.resolve(Bakery.serveRoot, routeInfo.info.path)
  const params = routeInfo.params || {}
  if (import.meta.env.DEV) {
    params.__file = routeInfo.info.path
  }
  const finalParams = Object.assign({}, params, errorData)
  const body = await this.params(req, finalParams)

  const resData = await requestStorage.run({ req, body }, async () => {
    const mod = (await import(modulePath).catch(() => null)) as TSXModule
    if (!mod || mod.default === undefined) return null
    return typeof mod.default === 'function'
      ? await mod.default(req, body)
      : mod.default
  })

  if (resData === null) return response.error('Not Found')
  const code = errorData?.errorCode || 200

  if (is.object(resData)) {
    if (resData instanceof Response) return resData
    return jsonResponse(code, 'Success', resData)
  }

  const html = await injectIfHtml(resData, params)
  if (html) return html
  if (is.string(resData)) return response.text(resData)

  return response.error('Not Found')
}
