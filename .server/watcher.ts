import './core/init'
import { handleDevMaster } from './compiler/dev-service'
import { log } from './core'

setTimeout(
  () =>
    log({
      by: 'process',
      msg: `File watcher is active`,
    }),
  2000,
)
await handleDevMaster()
