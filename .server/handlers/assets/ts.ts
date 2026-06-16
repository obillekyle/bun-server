import { compile } from '@server/compiler'
import { Bakery } from '@server/core/bakery'
import { toHash } from '@server/utils/common'
import { fs } from '@server/utils/fs'
import { response } from '@server/utils/http'
import { DynamicHandler } from '../core/$base'

export class TSHandler extends DynamicHandler {
  static get config() {
    return {
      ext: ['ts'],
      dir: Bakery.serveRoot,
    }
  }

  static get cacheDir() {
    return fs.resolve(Bakery.cacheDir, 'ts_cache')
  }

  static async canHandle(path: string, req: Request) {
    if (path.endsWith('.ts')) return true
    if (path.endsWith('.js')) path = path.slice(0, -3)
    return await super.canHandle(path, req)
  }

  static async handle(path: string) {
    const routeInfo = await this.resolveRoute(path)
    if (!routeInfo) return response.error('Not Found')

    const file = routeInfo.info.file
    const id = toHash(routeInfo.info.path)
    const cacheName = `${id}.js`
    const fileOrig = fs.resolve(this.config.dir, routeInfo.info.path)

    const cached = await fs.getOrCreateCachedFile(
      this.cacheDir,
      cacheName,
      file.lastModified,
      async function compileTS() {
        return await compile(fileOrig)
      },
    )

    return cached || response.error('Compilation Failed')
  }
}
