import { Bakery } from '@server/core/bakery'
import { FileSystem } from '@server/utils/fs'
import { response } from '@server/utils/http'
import { DynamicHandler, type Handler, type Route } from '../core/$base'
import { ErrorHandler } from '../core/$error'

export class ApiHandler extends DynamicHandler {
  static canHandle(path: string) {
    return path.startsWith('/api/')
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

    const params = routeInfo.params
    const body = await this.params(req, params)

    const filePath = FileSystem.resolve(this.config.dir, routeInfo.info.path)
    const result = await this.executeModule(filePath, req, body)

    return result ?? response.error('No response from handler')
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
