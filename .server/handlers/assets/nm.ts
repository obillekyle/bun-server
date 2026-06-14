import { bundleModule } from '@server/compiler'
import { Bakery } from '@server/core/bakery'
import { toHash } from '@server/utils/common'
import { fs } from '@server/utils/fs'
import pkg from '~/package.json' with { type: 'json' }
import { Handler } from '../core/$base'

export class NMHandler extends Handler {
  static get cacheDir() {
    return fs.resolve(Bakery.cacheDir, 'nm_cache')
  }

  static canHandle(path: string) {
    return path.startsWith('/_nm/')
  }

  static routes() {
    const deps = pkg.dependencies || {}
    const routes: MapOf<Handler.Route.Meta> = {}

    for (const [dep, ver] of Object.entries(deps)) {
      routes[`/_nm/${dep}`] = {
        type: 'proxy',
        isRoot: false,
        fileName: `${dep}@v${ver}`,
      }
    }

    return routes
  }

  static async handle(path: string) {
    const nmPath = path.replace(/^\/_nm\//, 'node_modules/')
    const nodeModulesPath = fs.resolve(Bakery.root, nmPath)
    const nmFile = Bun.file(nodeModulesPath)
    const sourceMtime = fs.exists(nmFile) ? nmFile.lastModified : null

    const cacheId = toHash(nmPath)
    const cacheName = `${cacheId}.js`

    const cached = await fs.getOrCreateCachedFile(
      this.cacheDir,
      cacheName,
      sourceMtime,
      async () => {
        const module = await bundleModule(nodeModulesPath)
        return module.success && module.content ? module.content : null
      },
    )

    return cached || undefined
  }
}
