import { Bakery } from '@server/core/bakery'
import { injectIfHtml, response } from '@server/utils/http'
import { DynamicHandler, type Handler } from '../core/$base'
import { DynamicErrorHandler } from '../core/$error'

export class HTMLHandler extends DynamicHandler {
  static get config() {
    return {
      ext: ['html'],
      dir: Bakery.serveRoot,
    }
  }

  static canHandle(path: string, req: Request) {
    return path.endsWith('.html') || super.canHandle(path, req)
  }

  static handle = sharedHandler
}

export class HTMLErrorHandler extends DynamicErrorHandler {
  static get config() {
    return {
      ext: ['html'],
      dir: Bakery.serveRoot,
      include: ['**/error.html', '**/error-*.html'],
    }
  }

  static handle = sharedHandler
}

async function sharedHandler(
  this: typeof DynamicHandler | typeof DynamicErrorHandler,
  path: string,
  req: Request,
  errors?: Handler.Error.Data,
) {
  const errorData = errors || (this as any).DEFAULT_ERROR
  const routeInfo = await this.resolveRoute(path, errorData)

  if (!routeInfo) return response.error('Not Found')

  const params = await this.params(req, routeInfo.params)
  const content = await routeInfo.info.file.text()
  const data = Object.assign({}, params, errorData)

  if (import.meta.env.DEV) {
    data.__file = routeInfo.info.path
  }

  const html = await injectIfHtml(content, data)
  return html || response.error('Not Found')
}
