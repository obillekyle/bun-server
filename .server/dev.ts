import './core/init'
import { Bakery } from './core/bakery'
import { errorMsg, log, serveLog } from './logger'

log({
  by: 'process',
  msg: `Starting server (PID: ${process.pid})...`,
})
serveLog.STARTING({ mode: 'development' })

const { initConfig } = await import('./core/config')
const { initImportMap } = await import('./utils/http')
const { syncTSConfigPaths } = await import('./core/tsconfig-sync')

try {
  await initConfig()
  await initImportMap()
  await syncTSConfigPaths(Bakery.config.importMap)
} catch (error: any) {
  console.error('Config init error stack:', error)
  serveLog.UNHANDLED_ERR({ error: `Config init failed: ${errorMsg(error)}` })
  process.exit(1)
}

try {
  const { SyncService } = await import('@database/sync')
  await SyncService.run()
} catch (error: any) {
  serveLog.UNHANDLED_ERR({ error: `Startup failed: ${errorMsg(error)}` })
  process.exit(1)
}

await import('./worker')
