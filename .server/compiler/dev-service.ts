import { watch } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { initRoutes } from '@server/cache'
import { Bakery } from '@server/core/bakery'
import { CLI } from '@server/core/cli'
import { Try } from '@server/utils'
import { Glob } from '@server/utils/fs'
import { compLog, serveLog } from '../logger'
import { PromptTracker } from './prompt-tracker'

export function notifySockets(server: any, filename: string) {
  const serveRoot = Bakery.serveRoot || '.'
  const relativePath = relative(resolve(serveRoot), resolve(filename)).replace(
    /\\/g,
    '/',
  )
  server?.publish('livereload', relativePath)
}

export function spawnLoggerTerminal() {
  const scriptArgs = `bun run .server log ${process.pid}`
  CLI.openTerminal(scriptArgs)
}

function setupPingInterval(
  url: string,
  signal: AbortSignal,
  onServerUp: () => void,
): any {
  const interval = setInterval(async () => {
    if (signal.aborted) return clearInterval(interval)

    try {
      await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'dev-watcher-ping' },
      })
      onServerUp()
      clearInterval(interval)
    } catch {
      // Continue waiting
    }
  }, 200)
  return interval
}

function setupPromptCheckInterval(
  workerPid: number,
  signal: AbortSignal,
  isRawModeActive: () => boolean,
  isServerUp: () => boolean,
  disableRaw: () => void,
  enableRaw: () => void,
): any {
  const interval = setInterval(() => {
    if (signal.aborted) return clearInterval(interval)

    const promptActive = PromptTracker.isActive(workerPid)

    if (promptActive && isRawModeActive()) return disableRaw()
    if (!promptActive && isServerUp() && !isRawModeActive()) return enableRaw()
  }, 100)

  return interval
}

function createTTYManager(getWorker: () => Bun.Subprocess | null) {
  let rawModeActive = false

  const stdinHandler = (key: string) => {
    switch (key.toLowerCase()) {
      case '\u0003':
        return getWorker()?.kill('SIGINT')
      case 's':
        return process.emit('SIGINT')
      case 'd':
        serveLog.SPAWN_LOGGER()
        return spawnLoggerTerminal()
    }
  }

  return {
    get isRawModeActive() {
      return rawModeActive
    },
    disableRawMode: () => {
      rawModeActive = false
      if (!process.stdin.isTTY) return

      Try(() => process.stdin.setRawMode(false))
      process.stdin.off('data', stdinHandler)
      Try(() => process.stdin.pause())
    },
    enableRawMode: () => {
      rawModeActive = true
      if (!process.stdin.isTTY) return

      Try(() => {
        process.stdin.setRawMode(true)
        process.stdin.resume()
        process.stdin.setEncoding('utf8')
        process.stdin.off('data', stdinHandler)
        process.stdin.on('data', stdinHandler)
      })
    },
  }
}

export async function handleDevMaster(): Promise<never> {
  const { initConfig } = await import('@server/core/config')
  const config = await initConfig()

  const port = process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : config.port || 3000
  const host =
    config.host === '0.0.0.0' ? '127.0.0.1' : config.host || '127.0.0.1'
  const url = `http://${host}:${port}/`

  let workerProc: Bun.Subprocess<'inherit', 'inherit', 'inherit'> | null = null
  let abortController: AbortController | null = null

  const tty = createTTYManager(() => workerProc)

  const cleanupAndExit = () => {
    workerProc?.kill('SIGINT')
    tty.disableRawMode()
    if (workerProc?.pid) {
      PromptTracker.deactivate(workerProc.pid)
    }
    process.exit(0)
  }

  process.on('SIGINT', cleanupAndExit)
  process.on('SIGTERM', cleanupAndExit)

  async function startWatcher(): Promise<never> {
    tty.disableRawMode()
    abortController?.abort()
    abortController = new AbortController()
    const signal = abortController.signal

    if (workerProc?.pid) {
      PromptTracker.deactivate(workerProc.pid)
    }

    const isDetached = process.env.DETACHED === '1'
    const inspectArgs = [
      ...process.execArgv,
      ...process.argv,
    ].filter(arg => arg.startsWith('--inspect'))

    workerProc = Bun.spawn(
      [
        process.execPath,
        '--smol',
        ...inspectArgs,
        '.server/index.ts',
        '--dev',
        '--dev-worker',
      ],
      {
        stdio: [isDetached ? 'ignore' : 'inherit', 'inherit', 'inherit'],
        windowsHide: isDetached,
        env: {
          ...process.env,
          DEV_WATCHER_ACTIVE: '1',
        },
      },
    )

    let serverUp = false
    const pingInterval = setupPingInterval(url, signal, () => {
      serverUp = true
    })
    const checkInterval = setupPromptCheckInterval(
      workerProc.pid,
      signal,
      () => tty.isRawModeActive,
      () => serverUp,
      tty.disableRawMode,
      tty.enableRawMode,
    )

    const code = (await workerProc.exited) ?? 0

    clearInterval(pingInterval)
    clearInterval(checkInterval)
    tty.disableRawMode()
    if (workerProc?.pid) {
      PromptTracker.deactivate(workerProc.pid)
    }

    switch (code) {
      case 42:
        serveLog.RESTART_REQ()
        console.clear()
        return startWatcher()
      case 130:
        serveLog.SHUTTING_DOWN()
        return process.exit(0)
      default:
        return process.exit(code)
    }
  }

  await startWatcher()
  process.exit(0)
}

const pkgFilesGlob = Glob.strings('package.json', 'bun.lock', 'bun.lockb')
const fileTypeGlob = Glob.fromExt(['css', 'html', 'ts', 'js', 'tsx', 'jsx'])
const tsScriptGlob = Glob.fromExt(['ts', 'js', 'html'])
const watchIgnores = Glob.strings(
  'node_modules/**/*',
  '**/.git/**/*',
  '**/.vscode/**/*',
  '**/.backups/**/*',
  '**/.cache/**/*',
  'schema.ts',
)

const prioFilesGlob = Glob.strings(
  'server.config.ts',
  'api/**/*',
  '**/.server/**/*',
  '**/*.tsx',
)

async function processFileEvent(
  filePath: string,
  server: any,
  isDevWorker: boolean,
) {
  if (isDevWorker) {
    switch (true) {
      case prioFilesGlob.match(filePath):
        serveLog.BACKEND_CHANGE({ file: filePath })
        return process.exit(42)
      case tsScriptGlob.match(filePath):
        initRoutes()
        return notifySockets(server, filePath)
      case fileTypeGlob.match(filePath):
        return notifySockets(server, filePath)
    }
  }

  if (await Bun.file(filePath).exists()) {
    return compLog.FILE_STATUS({ status: 'changed', file: filePath })
  }

  compLog.FILE_DEL({ file: filePath })
  if (isDevWorker) notifySockets(server, filePath)
}

export async function startCompileService(server: any): Promise<void> {
  const watcher = watch('./', { recursive: true })
  const isDevWorker = import.meta.env.WORKER

  for await (const { filename } of watcher) {
    if (!filename) continue
    const filePath = filename.replace(/\\/g, '/')

    switch (true) {
      case watchIgnores.match(filePath):
      case !fileTypeGlob.match(filePath):
        continue
      case pkgFilesGlob.match(filePath):
        compLog.FILE_STATUS({ status: 'changed', file: filePath })
        continue
      default:
        await processFileEvent(filePath, server, isDevWorker)
    }
  }
}
