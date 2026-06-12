import { Bakery } from '@server/core/bakery'
import { NOOP } from '@server/core/config'
import { Try } from '@server/utils/common'
import { injectIfHtml } from '@server/utils/http'
import { Handler } from './$base'

export class MiddlewareHandler extends Handler {
  static handlerResult = null as any

  protected static get hasMiddleware() {
    return Boolean(
      Bakery.config.middleware.length || Bakery.config.onRequest !== NOOP,
    )
  }

  static async canHandle(path: string, req: Request) {
    this.handlerResult = await this.handle(path, req)
    return Boolean(this.handlerResult)
  }

  static async handle(_path: string, req: Request) {
    if (this.handlerResult) {
      const res = this.handlerResult
      this.handlerResult = null
      return res
    }

    let data: any

    const intercepted = await Bakery.config.onRequest(req!)

    if (!intercepted) {
      for (const middleware of Bakery.config.middleware) {
        const result = await Try.silent(() => middleware(req, Bakery.server!))

        if (result instanceof Response) {
          data = result
          break
        }
      }
    }

    const injectedRes = await injectIfHtml(data)
    return injectedRes || data
  }
}
