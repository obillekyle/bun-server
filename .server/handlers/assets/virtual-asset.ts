import { relative } from 'node:path/posix'
import { Strings } from '@server/cache/string'
import { compile } from '@server/compiler'
import { Bakery } from '@server/core/bakery'
import { FileSystem as fs } from '@server/utils/fs'
import { Handler, type Route } from '../core/$base'

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
    } as MapOf<Route.Meta>
  }

  static async handleClientAsset(path: string): Promise<Route.Info | null> {
    const clientAssets: MapOf<string> = {
      '/_client/utils.js': fs.resolve(Bakery.root, '.server/client/utils.ts'),
      '/_client/livereload.js': fs.resolve(Bakery.root, '.server/client/livereload.ts'),
    }

    const masterPath = clientAssets[path]
    if (!masterPath) return null

    const masterFile = Bun.file(masterPath)
    if (!fs.exists(masterFile)) return null

    const parsed = fs.parse(masterPath)
    const fileId = `client-${parsed.name}-${parsed.ext}`

    const cachedFile = await fs.getOrCreateCachedFile(
      this.cacheDir,
      fileId,
      masterFile.lastModified,
      () => compile(masterPath).catch(() => null),
    )
    if (!cachedFile) return null

    const routeInfo: Route.Info = {
      file: cachedFile,
      valid: true,
      path: relative(fs.cwd, masterPath),
      params: [],
    }

    this.cache.set(path, routeInfo)
    return routeInfo
  }

  static async handleVirtualAsset(path: string): Promise<Route.Info | null> {
    const id = path.slice('/_virtual/'.length)
    const resolvedPath = Strings.getValue(id)
    if (!resolvedPath) return null

    const assetFile = Bun.file(resolvedPath)
    if (!fs.exists(assetFile)) return null

    const cachedFile = await fs.getOrCreateCachedFile(
      this.cacheDir,
      id,
      assetFile.lastModified,
      () => compile(resolvedPath).catch(() => null),
    )
    if (!cachedFile) return null

    const routeInfo: Route.Info = {
      valid: true,
      file: cachedFile,
      path: relative(fs.cwd, resolvedPath),
      params: [],
    }

    this.cache.set(path, routeInfo)
    return routeInfo
  }

  static async getRouteInfo(path: string) {
    if (this.cache.has(path)) {
      return this.cache.get(path)!
    }

    if (path.startsWith('/_client/')) {
      return await this.handleClientAsset(path)
    }

    if (path.startsWith('/_virtual/')) {
      return await this.handleVirtualAsset(path)
    }

    return null
  }

  static async handle(path: string) {
    const route = this.cache.get(path)
    if (route) return route.file

    const routeInfo = await this.getRouteInfo(path)
    if (!routeInfo) return

    return routeInfo.file
  }
}
