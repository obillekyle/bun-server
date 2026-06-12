import { HandlerMap } from '@server/handlers/core/$registry'
import { fs } from '@server/utils/fs'
import pkg from '../../package.json' with { type: 'json' }
import { getConfig } from './config'
import { requestStorage } from './context'

export const Bakery: globalThis.Bakery = {
  getRequest<T = any>(): Request & { body: T } {
    const store = requestStorage.getStore()
    if (!store) {
      throw new Error(
        `Cannot access request context outside of a request execution lifecycle.`,
      )
    }
    return new Proxy(store.req, {
      get(target, prop, receiver) {
        if (prop === 'body') {
          return store.body
        }
        const val = Reflect.get(target, prop, receiver)
        if (typeof val === 'function') {
          return val.bind(target)
        }
        return val
      },
      set(target, prop, value, receiver) {
        if (prop === 'body') {
          store.body = value
          return true
        }
        return Reflect.set(target, prop, value, receiver)
      },
    }) as any
  },
  get config(): Readonly<ProcessedAppConfig> {
    return getConfig()
  },
  get serveRoot() {
    return this.config.root
  },
  root: fs.cwd,
  version: pkg.version,
  cacheDir: `${fs.cwd}/.server/.cache`,
  dataDir: `${fs.cwd}/.server/.data`,
  startNs: Bun.nanoseconds(),
  handlers: {
    fetch: new HandlerMap(),
    error: new HandlerMap(),
    websocket: new HandlerMap(),
  },
  shutdownHooks: [] as any[],
  onShutdown(hook: () => Promise<void> | void) {
    this.shutdownHooks.push(hook)
  },
}

export default Bakery
