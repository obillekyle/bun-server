import { Strings } from '@server/cache/string'
import { compile } from '@server/compiler'
import { Bakery } from '@server/core/bakery'
import { toHash } from '@server/utils'
import { FileSystem as fs } from '@server/utils/fs'
import { Handler } from '../core/$base'

export class VirtualAssetHandler extends Handler {
  static canHandle(path: string) {
    return path.startsWith('/_client/') || path.startsWith('/_virtual/')
  }

  static get cacheDir() {
    return fs.resolve(Bakery.cacheDir, 'virtual')
  }

  static routes() {
    return {
      '/_client/utils.js': {
        type: 'static',
        isRoot: false,
        fileName: 'utils.js',
      },
      '/_client/livereload.js': {
        type: 'static',
        isRoot: false,
        fileName: 'livereload.js',
      },
      '/_virtual/*': {
        type: 'static',
        isRoot: false,
        fileName: '(virtual)',
      },
    } as MapOf<Handler.Route.Meta>
  }

  static get clientAssets(): MapOf<string> {
    return {
      '/_client/utils.js': fs.resolve(Bakery.root, '.server/client/utils.ts'),
      '/_client/livereload.js': fs.resolve(
        Bakery.root,
        '.server/client/livereload.ts',
      ),
    }
  }

  static async handleClientAsset(path: string) {
    const masterPath = this.clientAssets[path]
    if (!masterPath) return null

    const masterFile = Bun.file(masterPath)
    if (!fs.exists(masterFile)) return null

    const parsed = fs.parse(masterPath)
    const fileId = `client-${parsed.name}.js`

    const cachedFile = await fs.getOrCreateCachedFile(
      this.cacheDir,
      fileId,
      masterFile.lastModified,
      async function compileClient() {
        return await compile(masterPath).catch(() => null)
      },
    )

    if (!cachedFile) return null

    const routeInfo = new Handler.Route.Info(
      cachedFile.name!,
      path.slice(1),
      [],
    )

    this.cache.set(path, routeInfo)
    return routeInfo
  }

  static async handleVirtualAsset(path: string) {
    const id = path.slice('/_virtual/'.length)
    const resolvedPath = Strings.getValue(id)
    if (!resolvedPath) return null

    const assetFile = Bun.file(resolvedPath)
    if (!fs.exists(assetFile)) return null

    const ext = fs.parse(resolvedPath).ext
    const cacheName = `${toHash(resolvedPath)}${ext}`

    const cachedFile = await fs.getOrCreateCachedFile(
      this.cacheDir,
      cacheName,
      assetFile.lastModified,
      async function getVirtualAsset() {
        await assetFile.arrayBuffer()
      },
    )

    if (!cachedFile) return null

    const routeInfo = new Handler.Route.Info(
      cachedFile.name!,
      path.slice(1),
      [],
    )

    this.cache.set(path, routeInfo)
    return routeInfo
  }

  static async getRouteInfo(path: string) {
    switch (true) {
      case path.startsWith('/_client/'):
        return await this.handleClientAsset(path)
      case path.startsWith('/_virtual/'):
        return await this.handleVirtualAsset(path)
    }
  }

  static async handle(path: string) {
    const route = this.cache.get(path)
    if (route?.valid) return route.file

    return (await this.getRouteInfo(path))?.file
  }
}
