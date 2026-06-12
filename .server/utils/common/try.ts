import { log } from '@server/logger/logger'
import { is } from './misc'

type Wrapped<T, Args extends any[] = []> = T | ((...args: Args) => T)
type MixedPromise<T> = Promise<T> | T

type CatchReturn<T extends MixedPromise<any>> =
  T extends Promise<infer V>
    ? Promise<[Error, null] | [null, V]>
    : MixedPromise<[Error, null] | [null, T]>

function tryThrow<T>(
  callback: () => MixedPromise<T>,
  error?: string | Error,
): Promise<T> {
  return Promise.try(callback).catch((err: any) => {
    throw typeof error === 'string' ? new Error(error) : error || err
  })
}

const errorMsg = (err: any) => err?.stack || err?.message || String(err)

function tryReturn<T extends MixedPromise<any>, D extends MixedPromise<any>>(
  value: Wrapped<T>,
  defaultValue: Wrapped<D, [Error]>,
): T | D {
  try {
    const unwrapped = is.function(value) ? (value as any)() : value
    return unwrapped
  } catch (error: any) {
    log({
      by: 'debug',
      level: 'debug',
      msg: `Try.return caught an error${errorMsg(error)}`,
    })

    const unwrappedDefault = is.function(defaultValue)
      ? (defaultValue as any)(error)
      : defaultValue
    return unwrappedDefault
  }
}

function trySilent<T extends MixedPromise<any>>(value: Wrapped<T>) {
  return tryReturn(value, null)
}

type TryType = {
  <T extends MixedPromise<any>>(value: Wrapped<T>): T | null
  catch<T extends MixedPromise<any>>(value: Wrapped<T>): CatchReturn<T>
  return<T extends MixedPromise<any>, D extends MixedPromise<any>>(
    value: Wrapped<T>,
    defaultValue: Wrapped<D, [Error]>,
  ): T | D
  throw: typeof tryThrow
  silent<T extends MixedPromise<any>>(value: Wrapped<T>): T | null
}

export const Try: TryType = Object.assign(
  function Try<T extends MixedPromise<any>>(value: Wrapped<T>): T | null {
    return trySilent(value)
  },
  {
    catch<T extends MixedPromise<any>>(value: Wrapped<T>): CatchReturn<T> {
      if (is.function(value)) {
        return Promise.try(value)
          .then(data => [null, data])
          .catch(error => [error, null]) as any
      }
      if (value instanceof Promise) {
        return value
          .then(data => [null, data])
          .catch(error => [error, null]) as any
      }
      return [null, value] as any
    },
    return: tryReturn,
    throw: tryThrow,
    silent: trySilent,
  },
)
