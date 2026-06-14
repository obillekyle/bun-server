import { appendFileSync } from 'node:fs'

if (process.env.DETACHED === '1' && process.env.LOG_FILE_PATH) {
  const logFile = process.env.LOG_FILE_PATH
  const writeToLog = (data: string | Uint8Array) => {
    try {
      appendFileSync(logFile, data)
    } catch {}
  }

  // Override console.write (Bun-specific)
  console.write = (...data: any[]): number => {
    let bytesWritten = 0
    for (const item of data) {
      writeToLog(item)
      if (typeof item === 'string') {
        bytesWritten += item.length
      } else if (item instanceof Uint8Array || item instanceof ArrayBuffer) {
        bytesWritten += item.byteLength
      } else {
        bytesWritten += String(item).length
      }
    }
    return bytesWritten
  }

  // Override process.stdout.write
  process.stdout.write = (data: any, _encoding?: any, cb?: any) => {
    writeToLog(data)
    if (typeof cb === 'function') cb()
    return true
  }

  // Override process.stderr.write
  process.stderr.write = (data: any, _encoding?: any, cb?: any) => {
    writeToLog(data)
    if (typeof cb === 'function') cb()
    return true
  }

  const formatArgs = (args: any[]) => {
    return `${args
      .map(arg => {
        if (arg instanceof Error) return arg.stack || arg.message
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        }
        return String(arg)
      })
      .join(' ')}\n`
  }

  // Override console functions
  console.log = (...args: any[]) => {
    writeToLog(formatArgs(args))
  }
  console.info = console.log
  console.warn = (...args: any[]) => {
    writeToLog(formatArgs(args))
  }
  console.error = (...args: any[]) => {
    writeToLog(formatArgs(args))
  }
}
