import { AsyncLocalStorage } from 'node:async_hooks'
import { createDbAdapter, type DBAdapter } from './adapters'

let dbCache: any = null
let dbPromise: Promise<any> | null = null

export function initDB(): Promise<DBAdapter> {
  if (dbPromise) return dbPromise

  dbPromise = (async () => {
    dbCache = await createDbAdapter()
    return dbCache
  })()

  return dbPromise
}

function getConn() {
  if (!dbCache) {
    throw new Error("DB not initialized. Call 'await initDb()' first.")
  }
  return dbCache
}

export const connection: DBAdapter = new Proxy({} as any, {
  get(target, prop, receiver) {
    switch (prop) {
      case 'then':
      case 'inspect':
      case 'prototype':
        return (target as any)[prop]
    }
    return Reflect.get(getConn(), prop, receiver)
  },
  set(_target, prop, value, receiver) {
    return Reflect.set(getConn(), prop, value, receiver)
  },
  has(_target, prop) {
    return Reflect.has(getConn(), prop)
  },
  ownKeys(_target) {
    return Reflect.ownKeys(getConn())
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(getConn(), prop)
  },
})

export const txStorage = new AsyncLocalStorage<any>()

export function getActiveDb() {
  return txStorage.getStore() ?? connection
}
