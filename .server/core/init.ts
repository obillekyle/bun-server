import './overrides'
import { Comment, createElement, Fragment, html } from './jsx'

const isDevWorker = process.argv.includes('--dev-worker')
const isDev = process.argv.includes('--dev') || isDevWorker
const isTest = process.env.NODE_ENV === 'test' || Bun.env.NODE_ENV === 'test'
const mode = isDevWorker ? 'dev-worker' : isDev ? 'development' : 'production'

const getter = (v: any) => ({
  get: () => v,
  enumerable: true,
  configurable: true,
})

Object.defineProperties(process.env, {
  DEV: getter(isDev),
  TEST: getter(isTest),
  PROD: getter(!isDev),
  WORKER: getter(isDevWorker),
  MODE: getter(mode),
})

Object.assign(globalThis, {
  createElement,
  Fragment,
  Comment,
  html,
})

process.on('SIGHUP', () => {})
process.on('SIGBREAK', () => {})

