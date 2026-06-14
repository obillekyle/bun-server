import { relative } from 'node:path/posix'
import { LRUCache } from '@server/cache/lru'
import { Bakery } from '@server/core/bakery'
import { requestStorage } from '@server/core/context'
import { fs, Glob } from '@server/utils/fs'
import { processBody } from '@server/utils/http'

export namespace Handler {
  export type Response = MixedPromise<
    globalThis.Response | Bun.BunFile | undefined | object | string | void
  >

  export namespace Route {
    export type Info = {
      file: Bun.BunFile
      path: fs.RelativePath
      params: string[]
      valid: boolean
    }

    export type Meta = {
      type: 'endpoint' | 'route' | 'proxy' | 'static'
      isRoot: boolean
      fileName: string
    }

    export type Resolved =
      | {
          type: 'static'
          params: MapOf<string>
          info: Info
        }
      | {
          type: 'dynamic'
          params: MapOf<string>
          info: Info
          regex: RegExp
        }
  }

  export namespace Dynamic {
    export type Config = {
      ext: string[]
      dir?: fs.AbsolutePath
      include?: string[]
    }

    export type Route = {
      pattern: RegExp
      params: string[]
    }
  }

  export namespace Error {
    export type Data = {
      errorCode: number
      errorText: string
      errorBody: string
    }
  }
}

export namespace Route {
  export type Resolved = Handler.Route.Resolved
  export type Info = Handler.Route.Info
  export type Meta = Handler.Route.Meta
}

function setPropVal<T>(obj: any, prop: string, cb: () => T): T {
  if (obj[prop]) return obj[prop]
  const val = cb()
  obj[prop] = val
  return val
}

async function* scanForFiles(ext: string[], folder?: string) {
  folder ||= Bakery.serveRoot || process.cwd()
  folder = fs.resolve(folder)

  const globPattern = fs.readdir({
    ext,
    folder,
    exclude: Bakery.config.blocked,
  })
  for await (const entry of globPattern) {
    yield entry
  }
}

export class Handler {
  static cacheSize = 100
  protected constructor() {}

  static get cache(): HandlerCache<string, Route.Info> {
    const handlerName = `${this.name}_cache`
    return setPropVal(this, handlerName, () => new HandlerCache())
  }

  static canHandle(path: string, req: Request): MixedPromise<boolean>
  static canHandle(): boolean {
    return false
  }

  static routes(): MixedPromise<MapOf<Route.Meta>>
  static routes() {
    const routes: MapOf<Route.Meta> = {}
    for (const [path, info] of this.cache.entries()) {
      routes[path] = {
        type: 'route',
        isRoot: path === '/',
        fileName: info.file.name || '(unknown)',
      }
    }

    return routes
  }

  static initRoutes(): MixedPromise<void> {}

  static async params(
    req: Request,
    overrides?: MapOf<any>,
  ): Promise<MapOf<any>> {
    const body = await processBody(req)
    return Object.assign({}, body, overrides)
  }

  static handle(path: string, req: Request): Handler.Response
  static handle() {
    return undefined
  }

  static [Symbol.hasInstance](instance: any): boolean {
    if (!instance) return false
    return (
      instance === this ||
      (typeof instance === 'function' && instance.prototype instanceof this) ||
      Object.prototype.isPrototypeOf.call(this.prototype, instance)
    )
  }
}

export class DynamicHandler extends Handler {
  static get config(): Handler.Dynamic.Config {
    return {
      ext: [],
      dir: Bakery.serveRoot,
      include: ['**/*'],
    }
  }

  static get dynamicCache(): HandlerCache<RegExp, Route.Info> {
    const cacheName = `${this.name}_dynamicCache`
    return setPropVal(this, cacheName, () => new HandlerCache())
  }

  static async initRoutes() {
    const { ext, dir, include } = this.config

    const routes = await getRoutes(ext, dir, include)

    this.cache.clear()
    this.dynamicCache.clear()

    for (const [path, info] of routes.routes) {
      this.cache.set(path, info)
    }

    for (const [pattern, info] of routes.dynamic) {
      this.dynamicCache.set(pattern, info)
    }
  }

  static routes() {
    const routes: MapOf<Route.Meta> = {}
    for (const [path, info] of this.cache.entries()) {
      routes[path] = {
        type: 'route',
        isRoot: path === '/',
        fileName: info.file.name || '(unknown)',
      }
    }

    return routes
  }

  static canHandle(path: string, req: Request): MixedPromise<boolean>
  static canHandle(path: string): boolean {
    if (RX_DYNAMIC.test(path)) return false
    if (this.cache.has(path)) return true
    for (const pattern of this.dynamicCache.keys()) {
      if (pattern.test(path)) return true
    }
    return false
  }

  static async executeModule(
    file: fs.AbsolutePath,
    req: Request,
    body: any,
  ): Promise<any> {
    const mod = await import(file).catch(() => null)
    if (mod?.default === undefined) return null
    if (typeof mod.default !== 'function') return mod.default

    return await requestStorage.run({ req, body }, () => mod.default(req, body))
  }

  static bindParams(path: string, regex: RegExp, params: string[]) {
    const match = path.match(regex)
    if (!match) return null

    const boundParams: MapOf<string> = {}
    for (let i = 0; i < params.length; i++) {
      boundParams[params[i]] = match[i + 1]
    }
    return boundParams as MapOf<string>
  }

  static matchDynamicRoute(path: string): Route.Resolved | null {
    for (const [pattern, info] of this.dynamicCache) {
      const params = this.bindParams(path, pattern, info.params)

      if (!params) continue
      if (!info.valid) return null

      return {
        type: 'dynamic',
        regex: pattern,
        params,
        info,
      }
    }
    return null
  }

  static validateCachedRoute(path: string, route: Route.Resolved | null) {
    if (!route) return null
    if (fs.exists(route.info.file)) return route
    this.cache.delete(path)
    if (route.type === 'dynamic') {
      this.dynamicCache.delete(route.regex)
    }
    return null
  }

  static resolveRoute(path: string): Promise<Route.Resolved | null>
  static async resolveRoute(path: string) {
    const staticInfo = this.cache.get(path)
    let route: Route.Resolved | null = staticInfo?.valid
      ? { type: 'static', info: staticInfo, params: {} }
      : this.matchDynamicRoute(path)

    route = this.validateCachedRoute(path, route)
    if (route) return route

    route = await getSingleRoute(path, this.config.ext)
    if (!route) return null

    this.cache.set(path, route.info)

    if (route.type === 'dynamic') {
      this.dynamicCache.set(route.regex, route.info)
    }

    return route
  }
}

export class HandlerCache<K, V> extends LRUCache<K, V> {
  constructor(cacheSize = 500) {
    super(cacheSize)
  }
}

const RX_PARAM = /[.*+?^${}()|[\]\\]/g
const RX_DYNAMIC = /\[[^/]+\]/

function getDynamicRoute(path: string): Handler.Dynamic.Route | null {
  path = path.replace(/^\/+/, '')
  const params: string[] = []
  const paths = path.split('/')

  for (let i = 0; i < paths.length; i++) {
    const segment = paths[i]

    if (segment.startsWith('[') && segment.endsWith(']')) {
      const paramName = segment.slice(1, -1)
      params.push(paramName)
      paths[i] = '([^/]+?)'
      continue
    }

    paths[i] = segment.replace(RX_PARAM, '\\$&')
  }

  return {
    pattern: new RegExp(`^/${paths.join('/')}(?:\\.([a-z]*))?$`),
    params: params,
  }
}

type CompiledRoutes = {
  routes: Map<string, Route.Info>
  dynamic: Map<RegExp, Route.Info>
}

function splitFileName(fileName: string): [string, string] {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot === -1) return [fileName, '']
  return [fileName.substring(0, lastDot), fileName.substring(lastDot + 1)]
}

export async function getRoutes(
  ext: string[],
  folder?: fs.AbsolutePath,
  include?: string[],
) {
  folder ||= Bakery.serveRoot || fs.cwd
  folder = fs.resolve(folder)
  include ||= ['**/*']
  include = include.map(pattern => {
    const normalized = pattern.startsWith('/') ? pattern.slice(1) : pattern
    return fs.resolve(folder, normalized)
  })

  const includes = Glob.strings(...include)

  const routes = new Map<string, Route.Info>()
  const dynamic = new Map<RegExp, Route.Info>()

  const routeFiles = scanForFiles(ext, folder)

  for await (const { path, file } of routeFiles) {
    if (!includes.match(path)) continue

    const relativePath = relative(folder, path)
    const [name, ext] = splitFileName(relativePath)
    const isDynamic = name.match(RX_DYNAMIC)
    const routeInfo: Route.Info = {
      file,
      path: relativePath,
      params: [],
      valid: true,
    }

    if (isDynamic) {
      const dynamicRoute = getDynamicRoute(name)
      if (!dynamicRoute) continue

      routeInfo.params = dynamicRoute.params
      dynamic.set(dynamicRoute.pattern, routeInfo)
      // continue <-- let dynamic routes also be cached statically for route listing
    }

    let urlPath = `/${name}`

    routes.set(urlPath, routeInfo)
    routes.set(`${urlPath}.${ext}`, routeInfo)

    if (!urlPath.endsWith('/index')) continue
    urlPath = urlPath.slice(0, -6) || '/'

    if (routes.has(urlPath)) continue
    routes.set(urlPath, routeInfo)
  }

  return { routes, dynamic } as CompiledRoutes
}

export async function getSingleRoute(
  path: string,
  ext: string[],
  folder?: fs.AbsolutePath,
) {
  folder ||= Bakery.serveRoot || fs.cwd
  folder = fs.resolve(folder)
  path = path.replace(/^\/+/, '')

  const parsed = fs.parse(path)
  const rootFolder = fs.resolve(folder)
  const targetPath = fs.resolve(rootFolder, parsed.dir, parsed.name)
  const exts = ext.join(',').replaceAll('.', '')

  const possibleGlob = Glob.from(`${targetPath}{/index,}.{${exts}}`)

  try {
    for await (const entry of possibleGlob.scan()) {
      const file = Bun.file(entry)
      const path = relative(folder, entry)
      const isDynamic = entry.match(/\[[^/]+\]/)

      if (isDynamic) {
        const [name] = splitFileName(path)
        const dynamicRoute = getDynamicRoute(name)
        if (!dynamicRoute) continue

        return {
          type: 'dynamic',
          info: { file, path, params: dynamicRoute.params },
          regex: dynamicRoute.pattern,
        } as Route.Resolved
      }

      return {
        type: 'static',
        info: { file, path: entry, params: {} },
      } as Route.Resolved
    }
  } catch {}
  return null
}
