import { AsyncLocalStorage } from 'node:async_hooks'
import { createDatabaseConnection, type DBAdapter } from './adapters'

let cachedConnection: any = null
let connectionPromise: Promise<any> | null = null

export function initializeDatabaseConnection(): Promise<DBAdapter> {
  if (connectionPromise) return connectionPromise
  connectionPromise = (async () => {
    cachedConnection = await createDatabaseConnection()
    return cachedConnection
  })()
  return connectionPromise
}

function getConn() {
  if (!cachedConnection) {
    throw new Error(
      "Database connection not initialized. Please call 'await initializeDatabaseConnection()' first.",
    )
  }
  return cachedConnection
}

export const connection: DBAdapter = new Proxy({} as any, {
  get(target, prop, receiver) {
    if (prop === 'then' || prop === 'inspect' || prop === 'prototype') {
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

export const transactionStorage = new AsyncLocalStorage<any>()

export function getActiveConnection() {
  return transactionStorage.getStore() ?? connection
}
