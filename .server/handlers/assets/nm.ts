import { Bakery } from '@server/core/bakery'
import { bundleModule } from '@server/compiler'
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
    const cacheId = toHash(nmPath)

    const cachePath = fs.resolve(this.cacheDir, `${cacheId}.js`)
    const cached = Bun.file(cachePath)

    if (await cached.exists()) {
      return cached
    }

    const module = await bundleModule(nodeModulesPath)
    if (module.success && module.content) {
      await fs.mkdir(this.cacheDir)
      await cached.write(module.content)
      return cached
    }
  }
}
