declare global {
  const matchDefault: unique symbol
  var match: import('../types').Match<typeof matchDefault>
  var is: import('../global.d.ts').ISFunction
  type TryThrow = {
    <T>(callback: () => T, error?: string | Error): T
    <T>(callback: () => Promise<T>, error?: string | Error): Promise<T>
  }
  var Try: {
    <T>(value: Wrapped<T>): T | null
    catch: typeof tryCatch
    return: <T, D>(
      value: Wrapped<T>,
      defaultValue: Wrapped<D, [Error]>,
    ) => T | D
    throw: TryThrow
    silent: <T>(value: Wrapped<T>) => T | null
  }
  var Case: {
    kebab: (str: string) => string
    camel: (str: string) => string
    pascal: (str: string) => string
    snake: (str: string) => string
    upper: (str: string) => string
    lower: (str: string) => string
    caps: (str: string) => string
  }
  var Math2: {
    clamp: (value: number, min?: number, max?: number) => number
    step: (value: number, step: number) => number
  }
  var throws: (message: string | Error) => never
  var assert: (condition: any, message?: string) => asserts condition
  var any: <T = any>(v: any) => T
  var repeat: {
    (n: number): number[]
    <T>(n: number, fn: (i: number) => T): T[]
  }
  var tryCatch: <T = any>(
    promise: Wrapped<Promise<T> | T>,
  ) => Promise<[Error, null] | [null, T]> | ([Error, null] | [null, T])

  var Bakery: {
    version: string
    virtual(path: string): Promise<any>
    params<T = MapOf<any>>(): T
  }

  var request: <T = any>(
    url: string,
    method?: string,
    body?: any,
  ) => Promise<JsonResponse<T>>
  var randomId: () => string

  interface ImportMeta {
    env: {
      BAKERY_VERSION: string
      WORKER: boolean
      DEV: boolean
      PROD: boolean
      [key: string]: any
    }
  }
}

export {}

declare module '@client/utils' {
  export * from '../utils'
}
