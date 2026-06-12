import { Bakery } from '@server/core/bakery'
import { requestStorage } from '@server/core/context'
import { FileSystem } from '@server/utils/fs'
import { response } from '@server/utils/http'
import { DynamicHandler, type Handler, type Route } from '../core/$base'
import { ErrorHandler } from '../core/$error'

export class ApiHandler extends DynamicHandler {
  static canHandle(path: string, req: Request) {
    return path.startsWith('/api/') || super.canHandle(path, req)
  }

  static get config() {
    return {
      ext: ['ts', 'js'],
      dir: FileSystem.resolve(Bakery.root, 'api'),
    }
  }

  static routes() {
    const routes: MapOf<Route.Meta> = {}
    for (const [path, info] of this.cache.entries()) {
      routes[path] = {
        type: 'endpoint',
        isRoot: path === '/',
        fileName: info.file.name || '(unknown)',
      }
    }

    return routes
  }

  static resolveRoute(path: string) {
    path = path.slice(4) // remove api prefix
    return super.resolveRoute(path)
  }

  static async handle(path: string, req: Request) {
    const routeInfo = await this.resolveRoute(path)
    if (!routeInfo) return response.error('No API handler found')

    const params = 'params' in routeInfo ? routeInfo.params : {}
    const body = await this.params(req, params)

    const filePath = FileSystem.resolve(this.config.dir, routeInfo.info.path)
    if (!FileSystem.exists(filePath)) {
      return response.error('API handler file not found')
    }
    
    const handler = await import(filePath).catch(() => null)

    
    if (!handler || handler.default === undefined) {
      return response.error('Handler Not Found')
    }

    const result =
      typeof handler.default === 'function'
        ? await requestStorage.run({ req, body }, () =>
            handler.default(req, body),
          )
        : handler.default

    switch (true) {
      case result instanceof Response:
        return result
      case typeof result === 'object':
        return response.json(200, 'Success', result)
      default:
        return response.text(String(result))
    }
  }
}

export class ApiErrorHandler extends ErrorHandler {
  static canHandle(path: string) {
    return path.startsWith('/api/')
  }

  static handle(_p: string, _r: Request, error: Handler.Error.Data) {
    return response.json.error(error.errorCode, error.errorBody)
  }
}
