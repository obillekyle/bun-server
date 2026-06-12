#!/usr/bin/env bun
import { log } from '@server/logger'

import './core/init'
import { handleDevMaster } from './compiler/dev-service'

const isDev = import.meta.env.DEV
const isDevWorker = import.meta.env.WORKER
const isParentWatcher = isDev && !isDevWorker

log({
  by: 'process',
  msg: `Starting server (PID: ${process.pid})...`,
})

isParentWatcher ? await handleDevMaster() : await import('./worker')
