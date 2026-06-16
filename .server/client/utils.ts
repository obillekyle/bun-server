const matchDefault = Symbol('matchDefault')

function matchStringCase(value: string, cases: any) {
  if (value in cases) {
    const result = cases[value]
    return is.function(result) ? result(value) : result
  }
  if (matchDefault in cases) {
    const result = cases[matchDefault]
    return is.function(result) ? result(value) : result
  }
  return undefined
}

function matchArrayCases(value: any, cases: any[]) {
  for (const [predicate, result] of cases) {
    if (
      predicate === match ||
      predicate === matchDefault ||
      predicate === value ||
      (is.function(predicate) && Boolean(predicate(value)))
    ) {
      return is.function(result) ? result(value) : result
    }
  }
  return undefined
}

const match = (value: any, cases: any) => {
  if (is.string(value) && !Array.isArray(cases)) {
    return matchStringCase(value, cases)
  }
  if (Array.isArray(cases)) {
    return matchArrayCases(value, cases)
  }
  return undefined
}

match.default = matchDefault
;(match as any)[Symbol.toPrimitive] = () => matchDefault

function tryThrow<T>(
  callback: () => Promise<T> | T,
  error?: string | Error,
): Promise<T> {
  return Promise.try(callback).catch((err: any) => {
    throw typeof error === 'string' ? new Error(error) : error || err
  })
}

function tryReturn<T, D>(
  value: Wrapped<T>,
  defaultValue: Wrapped<D, [Error]>,
): T | D {
  try {
    const unwrapped = is.function(value) ? (value as any)() : value
    return unwrapped as T
  } catch (error: any) {
    const unwrappedDefault = is.function(defaultValue)
      ? (defaultValue as any)(error)
      : defaultValue
    return unwrappedDefault as D
  }
}

function trySilent<T>(value: Wrapped<T>): T | null {
  return tryReturn(value, null as any)
}

type TryType = {
  <T>(value: Wrapped<T>): T | null
  catch<T>(
    promise: Wrapped<Promise<T> | T>,
  ): Promise<[Error, null] | [null, T]> | ([Error, null] | [null, T])
  return<T, D>(value: Wrapped<T>, defaultValue: Wrapped<D, [Error]>): T | D
  throw: typeof tryThrow
  silent<T>(value: Wrapped<T>): T | null
}

const Try: TryType = Object.assign(
  function Try<T>(value: Wrapped<T>): T | null {
    return trySilent(value)
  },
  {
    catch<T>(
      promise: Wrapped<Promise<T> | T>,
    ): Promise<[Error, null] | [null, T]> | ([Error, null] | [null, T]) {
      if (typeof promise === 'function') {
        return Promise.try(promise as any)
          .then(data => [null, data] as [null, T])
          .catch(error => [error, null] as [Error, null])
      }
      if (promise instanceof Promise) {
        return promise
          .then(data => [null, data] as [null, T])
          .catch(error => [error, null] as [Error, null])
      }
      return [null, promise] as [null, T]
    },

    return: tryReturn,

    throw: tryThrow,

    silent: trySilent,
  },
)

const tryCatch = Try.catch

const assert = (condition: any, message?: string): asserts condition => {
  if (!condition) {
    throw new Error(message || 'Assertion failed')
  }
}
const any = <T = any>(v: any): T => v
const repeat = (n: number, fn?: (i: number) => any): any[] =>
  Array.from({ length: n }, (_, k) => (fn ? fn(k) : k))

const is: ISFunction = new Proxy<any>(
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

function kebab(s: string) {
  return s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

function camel(s: string) {
  return s
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, m => m.toLowerCase())
}

function pascal(s: string) {
  const c = camel(s)
  return c.charAt(0).toUpperCase() + c.slice(1)
}

function snake(s: string) {
  return s
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

const Case = Object.assign(
  function Case(
    type: 'kebab' | 'camel' | 'pascal' | 'snake',
    str: string,
  ): string {
    switch (type) {
      case 'kebab':
        return kebab(str)
      case 'camel':
        return camel(str)
      case 'pascal':
        return pascal(str)
      case 'snake':
        return snake(str)
      default:
        return str
    }
  },
  {
    kebab,
    camel,
    pascal,
    snake,
    upper: (str: string) => str.toUpperCase(),
    lower: (str: string) => str.toLowerCase(),
    caps: (str: string) => str.toUpperCase().replace(/[\s_-]+/g, ''),
  },
)

const Math2 = {
  clamp(value: number, min?: number, max?: number): number {
    const minVal = min ?? -Infinity
    const maxVal = max ?? Infinity
    return Math.min(Math.max(value, minVal), maxVal)
  },

  step(value: number, step: number): number {
    return Math.round(value / step) * step
  },
}

const throws = (message: string | Error): never => {
  throw typeof message === 'string' ? new Error(message) : message
}

function processGetBody(
  body: FormData | MapOf<any> | URLSearchParams | string,
) {
  switch (true) {
    case body instanceof URLSearchParams:
      return body.toString()

    case body instanceof FormData:
    case is.object(body) && body !== null: {
      const urlSearchParams = new URLSearchParams()
      const entries =
        body instanceof FormData ? body.entries() : Object.entries(body)

      for (const [key, value] of entries) {
        urlSearchParams.append(key, (value as any).toString())
      }
      return urlSearchParams.toString()
    }

    default:
      return String(body)
  }
}

function randomId(length = 8) {
  const arr = new Uint8Array(Math.ceil(length / 2))
  crypto.getRandomValues(arr)
  return Array.from(arr, dec => dec.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}

type RequestJson = RequestInit & { body?: any }

async function request(
  url: string,
  init: RequestJson = {},
): Promise<JsonResponse> {
  const method = (init.method || 'GET').toUpperCase()
  const body = init.body || {}

  if (method === 'GET') {
    const query = processGetBody(body)
    if (query) {
      url = `${url}?${query}`
    }
  }

  const response = await fetch(url, {
    ...init,
    method,
    body: method === 'GET' ? undefined : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const [err, data] = await tryCatch(response.json.bind(response))

  if (err) {
    throws(`Request failed: ${err.message || 'Unknown error'}`)
  }

  if (
    data &&
    typeof data === 'object' &&
    'status' in data &&
    'message' in data
  ) {
    const status = (data as any).status
    if (status >= 200 && status < 300) {
      return data as JsonResponse
    }
    throws((data as any).message)
  }

  return data
}

Object.assign(globalThis, {
  match,
  matchDefault,
  Try,
  tryCatch,
  is,
  Case,
  Math2,
  throws,
  assert,
  any,
  repeat,
  request,
  randomId,
  Bakery: {
    version: import.meta.env.BAKERY_VERSION,
    async virtual(path: string) {
      const response = await fetch(path)
      if (!response.ok) {
        return null
      }

      const contentType = response.headers.get('Content-Type') || ''
      if (contentType.includes('application/json')) {
        return response.json()
      } else {
        const text = await response.text()

        if (path.endsWith('.css')) {
          const style = document.createElement('style')
          style.textContent = text
          document.head.appendChild(style)
          return null
        }

        return response.text()
      }
    },

    params<T = MapOf<any>>(): T {
      return any(window).__PAGE_PARAMS__ as T
    },
  },
})

if (typeof document !== 'undefined') {
  const initSpeculationRules = () => {
    if (
      typeof HTMLScriptElement !== 'undefined' &&
      HTMLScriptElement.supports &&
      HTMLScriptElement.supports('speculationrules')
    ) {
      const urls = new Set<string>()
      const elements = document.querySelectorAll('[href]')
      const ignoreTags = ['LINK', 'BASE']
      for (const element of elements) {
        if (ignoreTags.includes(element.tagName)) continue
        const url = element.getAttribute('href')?.trim()
        if (!url || url.startsWith('#') || url.includes(':')) continue
        const lower = url.toLowerCase()
        if (
          lower.includes('?utm_') ||
          lower.includes('?fbclid') ||
          lower.endsWith('.pdf') ||
          lower.endsWith('.zip')
        )
          continue
        urls.add(url)
      }
      if (urls.size > 0) {
        const existing = document.querySelector('script[type="speculationrules"]')
        if (existing) existing.remove()

        const specScript = document.createElement('script')
        specScript.type = 'speculationrules'
        specScript.textContent = JSON.stringify({
          prefetch: [
            { source: 'list', urls: Array.from(urls), eagerness: 'immediate' },
          ],
          prerender: [
            { source: 'list', urls: Array.from(urls), eagerness: 'immediate' },
          ],
        })
        document.head.appendChild(specScript)
      }
    }
  }
  setTimeout(initSpeculationRules, 0)
}
