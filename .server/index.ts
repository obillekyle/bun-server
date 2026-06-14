#!/usr/bin/env bun
import { CLI } from './core/cli'

import './core/init'

await CLI.handleCLI()

const isDev = import.meta.env.DEV
const isDevWorker = import.meta.env.WORKER

switch (true) {
  case !isDev:
    await import('./prod')
    break
  case isDevWorker:
    await import('./dev')
    break
  default:
    await import('./watcher')
}
