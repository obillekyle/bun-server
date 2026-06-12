import { LRUCache } from '@server/cache/lru'
import type { Handler } from './$base'

export class HandlerMap<T = typeof Handler> extends Map<any, number> {
  public routeCache = new LRUCache<string, T>(5000)

  private cachedList: T[] | null = null

  constructor(entries?: readonly (readonly [any, number])[] | null) {
    super()
    if (!entries) return

    for (const [handlerClass, priority] of entries) {
      this.set(handlerClass, priority)
    }
  }

  set(handlerClass: any, priority: number = 10): this {
    super.set(handlerClass, priority)
    this.cachedList = null
    return this
  }

  add(handlerClass: any, priority?: number): this {
    return this.set(handlerClass, priority)
  }

  list(): T[] {
    if (this.cachedList) {
      return this.cachedList
    }
    this.cachedList = Array.from(this.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0])

    return this.cachedList
  }
}
