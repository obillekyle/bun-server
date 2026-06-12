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
      '/_client/utils.js': '.server/client/utils.ts',
      '/_client/livereload.js': '.server/client/livereload.ts',
    }

    for (const key in clientAssets) {
      clientAssets[key] = fs.resolve(Bakery.root, clientAssets[key])
    }

    if (path in clientAssets) {
      const masterPath = clientAssets[path]
      const masterFile = Bun.file(masterPath)

      if (!fs.exists(masterFile)) return null

      const parsed = fs.parse(masterPath)
      const fileId = `client-${parsed.name}-${parsed.ext}`

      const routeInfo: Route.Info = {
        file: masterFile,
        valid: true,
        path: relative(fs.cwd, masterPath),
        params: [],
      }

      const content = await compile(masterPath).catch(() => '')
      if (!content) return null

      const cachePath = fs.resolve(this.cacheDir, fileId)
      routeInfo.file = Bun.file(cachePath)
      await routeInfo.file.write(content)

      this.cache.set(path, routeInfo)

      return routeInfo
    }

    return null
  }

  static async handleVirtualAsset(path: string): Promise<Route.Info | null> {
    const id = path.slice('/_virtual/'.length)
    const resolvedPath = Strings.getValue(id)
    if (!resolvedPath) return null

    const assetFile = Bun.file(resolvedPath)
    if (!fs.exists(assetFile)) return null

    const cachePath = fs.resolve(this.cacheDir, id)

    const routeInfo: Route.Info = {
      valid: true,
      file: Bun.file(cachePath),
      path: relative(fs.cwd, resolvedPath),
      params: [],
    }

    if (assetFile.lastModified < routeInfo.file.lastModified) {
      this.cache.set(path, routeInfo)
      return routeInfo
    }

    const content = await compile(resolvedPath).catch(() => '')
    if (!content) return null

    await routeInfo.file.write(content)
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
