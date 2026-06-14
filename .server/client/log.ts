import { log } from '@server/logger'
import { match, Try } from '@server/utils/common'
import '../core/init'

export async function startClientLogger(parentPid?: number) {
  if (parentPid) {
    setInterval(() => {
      Try.return(
        () => process.kill(parentPid, 0),
        () => process.exit(0),
      )
    }, 1000)
  }

  let port = 3000
  let host = 'localhost'

  await Try.silent(async function getNetworkConfig() {
    const confFile = `${process.cwd()}/server.config.ts`
    const module = await Try.silent(() => import(confFile))
    const config = module?.default || {}

    port = config.port || port
    host = !['::', '0.0.0.0'].includes(config.host) ? config.host : host
  })

  let wsInstance: WebSocket | null = null
  let wasConnected = false

  console.clear()
  log({ level: 'debug', by: 'connect', msg: 'Waiting for backend...' })

  function connect() {
    const ws = new WebSocket(`ws://${host}:${port}/_livereload`)
    wsInstance = ws

    ws.onopen = () => {
      console.clear()
      log({ by: 'websocket', msg: 'Connected! Listening for client logs...' })
      log({ by: 'logger', msg: 'Press "r" to reload all connected clients' })
      ws.send(JSON.stringify({ type: 'subscribe_logger' }))
      wasConnected = true
    }

    ws.onmessage = e => {
      Try.silent(function websocketMessage() {
        const data = JSON.parse(e.data)
        const msg = data.payload || (data.args ? data.args.join(' ') : '')
        data.type === 'client_log' &&
          log({
            msg,
            level: data.level,
            by: data.by || 'client',
          })
      })
    }

    ws.onclose = () => {
      wsInstance = null
      if (wasConnected) {
        log({
          level: 'warn',
          by: 'connect',
          msg: 'Hot-reload active. Backend rebooting...',
        })
        wasConnected = false
      }
      setTimeout(connect, 1000)
    }

    ws.onerror = () => ws.close()
  }

  connect()

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (key: string) => {
      match(key.toLowerCase(), {
        '\u0003': () => process.exit(0),
        r: () => {
          log({ by: 'websocket', msg: 'Triggering global browser reload...' })
          wsInstance?.readyState === WebSocket.OPEN &&
            wsInstance.send(JSON.stringify({ type: 'force_reload' }))
        },
      })
    })
  }
}

if (import.meta.main) {
  const parentPid = parseInt(process.argv[2], 10)
  startClientLogger(Number.isNaN(parentPid) ? undefined : parentPid)
}
