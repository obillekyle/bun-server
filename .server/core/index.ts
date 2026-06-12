import type { Handler } from '@server/handlers'
import { Logger, log } from '../logger'
import { definePlugin as _definePlugin } from '../plugins/types'
import { Case, is, Math2, match, repeat, Try } from '../utils/common'
import { response } from '../utils/http'
import Bakery from './bakery'
import { getConfig, NOOP } from './config'
import { createElement, Fragment, html } from './jsx'

type ResponseFn = (req: Request, body: MapOf<any>) => Handler.Response

// Definitions
export const defineConfig = <T extends AppConfig>(config: T): T => config
export const definePlugin = _definePlugin
export const defineApi = <T>(handler: T): T => handler
export const defineRoute = <T>(handler: T): T => handler
export const respond = <T>(callback: T): T => callback
export const ApiBody = <T extends ResponseFn>(callback: T): T => callback
export const defineSchema = <T>(schema: T): T => schema

// Core exports
// JSX & HTML
// Utilities
export {
  Bakery,
  Case,
  createElement,
  Fragment,
  getConfig,
  html,
  html as HTMLBody,
  is,
  Logger,
  log,
  Math2,
  match,
  NOOP,
  repeat,
  response,
  Try,
}

// Helper wrappers
export const any = <T = any>(x: any): T => x
export const assert = (condition: any, message?: string): asserts condition => {
  if (!condition) throw new Error(message || 'Assertion failed')
}
export const redirect = response.href
export const throws = (message: string | Error): never => {
  throw is.string(message) ? new Error(message) : message
}
export const trace = (msg: string, data: any) => {
  log({ level: 'trace', by: 'tracer', msg })
  console.log(data)
}

// Default export
export default Bakery
