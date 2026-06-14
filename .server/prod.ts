import './core/init'
import { errorMsg, log, serveLog } from './logger'

log({
  by: 'process',
  msg: `Starting server (PID: ${process.pid})...`,
})
serveLog.STARTING({ mode: 'production' })

const { initConfig } = await import('./core/config')
const { initImportMap } = await import('./utils/http')

try {
  await initConfig()
  await initImportMap()
} catch (error: any) {
  console.error('Config init error stack:', error)
  serveLog.UNHANDLED_ERR({ error: `Config init failed: ${errorMsg(error)}` })
  process.exit(1)
}

try {
  const { initDB } = await import('@database/connection')
  await initDB()
} catch (error: any) {
  serveLog.UNHANDLED_ERR({
    error: `Database initialization failed: ${errorMsg(error)}`,
  })
  process.exit(1)
}

await import('./worker')
