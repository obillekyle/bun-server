import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  req: Request
  body: any
}

export const requestStorage = new AsyncLocalStorage<RequestContext>()
