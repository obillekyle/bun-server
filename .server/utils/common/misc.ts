export const is: ISFunction = new Proxy<any>(
  function is(value: any, type?: string) {
    switch (type) {
      case 'array':
        return Array.isArray(value)
      case 'null':
        return value === null
      case 'undefined':
        return value === undefined
      default:
        return typeof value === type
    }
  },
  {
    get(target, prop: string) {
      return (value: any) => target(value, prop)
    },
  },
)

export function repeat(n: number): number[]
export function repeat<T>(n: number, fn: (i: number) => T): T[]
export function repeat<T>(n: number, fn?: (i: number) => T): unknown[] {
  return Array.from({ length: n }, (_, k) => (fn ? fn(k) : k))
}

export function range(n: number): IterableIterator<number>
export function range(start: number, end: number): IterableIterator<number>
export function* range(start: number, end?: number): IterableIterator<number> {
  if (end === undefined) {
    end = start
    start = 0
  }
  for (let i = start; i < end; i++) {
    yield i
  }
}

const _range = range
const _repeat = repeat

export namespace Array2 {
  export const range = _range
  export const repeat = _repeat

  export function chunk<T>(array: T[], size: number): T[][] {
    const result: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size))
    }
    return result
  }

  export function from<T>(data: T | T[]): T[] {
    return Array.isArray(data) ? data : [data]
  }
}

export const Math2 = {
  clamp(value: number, min?: number, max?: number): number {
    min ??= -Infinity
    max ??= Infinity
    return Math.min(Math.max(value, min), max)
  },

  step(value: number, step: number): number {
    return Math.round(value / step) * step
  },
}

const DEFERRED = Symbol('deferred')
export function deferredValue<O extends object, T>(
  object: O,
  key: string,
  value: (this: O, o: O) => T,
) {
  if (!(DEFERRED in object)) {
    Object.defineProperty(object, DEFERRED, {
      enumerable: false,
      configurable: false,
      writable: false,
      value: {},
    })
  }

  const map = (object as any)[DEFERRED] as MapOf<any>

  Object.defineProperty(object, key, {
    enumerable: true,
    configurable: true,
    get() {
      if (key in map) return map[key]
      map[key] = value.call(this, this)
      return map[key]
    },
    set(val) {
      map[key] = val
    },
  })
}

export function hasDeferredValue<
  O extends object,
  T extends keyof O | (string & {}),
>(object: object, key: T): boolean {
  if (!(DEFERRED in object)) return false
  const map = object[DEFERRED] as MapOf<any>
  return key in map
}

export function assert(condition: any, message?: string): asserts condition {
  if (!condition) throw new Error(message || 'Assertion failed')
}

export function throws(message: string | Error): never {
  throw is.string(message) ? new Error(message) : message
}

export const any = <T = any>(x: any): T => x
