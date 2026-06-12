import { watch } from 'node:fs/promises'
import { platform } from 'node:os'
import { relative, resolve } from 'node:path'
import { Bakery } from '@server/core/bakery'
import { Glob } from '@server/utils/fs'
import { compLog, serveLog } from '../logger'

export function notifySockets(server: any, filename: string) {
  const serveRoot = Bakery.serveRoot || '.'
  const relativePath = relative(resolve(serveRoot), resolve(filename)).replace(
    /\\/g,
    '/',
  )
  server?.publish('livereload', relativePath)
}

export function spawnLoggerTerminal() {
  const os = platform()
  const scriptArgs = `bun ./.server/client/log.ts ${process.pid}`

  switch (os) {
    case 'win32':
      try {
        Bun.spawn([
          'cmd.exe',
          '/c',
          'start',
          'cmd.exe',
          '/c',
          scriptArgs,
        ]).unref()
      } catch (err) {
        serveLog.UNHANDLED_ERR({
          error: `Failed to spawn logger terminal on Windows: ${err}`,
        })
      }
      break
    case 'darwin':
      try {
        Bun.spawn([
          'osascript',
          '-e',
          `tell application "Terminal" to do script "cd \\"${process.cwd()}\\" && ${scriptArgs}"`,
        ]).unref()
      } catch (err) {
        serveLog.UNHANDLED_ERR({
          error: `Failed to spawn logger terminal on macOS: ${err}`,
        })
      }
      break
    default: {
      const terminals = [
        ['x-terminal-emulator', '-e', scriptArgs],
        ['gnome-terminal', '--', 'sh', '-c', scriptArgs],
        ['konsole', '-e', scriptArgs],
        ['xfce4-terminal', '-e', scriptArgs],
        ['kitty', 'sh', '-c', scriptArgs],
        ['alacritty', '-e', 'sh', '-c', scriptArgs],
        ['xterm', '-e', scriptArgs],
      ]
      let spawned = false
      let lastError: any = null
      for (const cmd of terminals) {
        try {
          Bun.spawn(cmd).unref()
          spawned = true
          break
        } catch (err) {
          lastError = err
        }
      }
      if (!spawned) {
        serveLog.UNHANDLED_ERR({
          error: `Could not spawn client logger terminal. Make sure x-terminal-emulator, gnome-terminal, konsole, or xterm is installed. (Last error: ${lastError?.message || lastError})`,
        })
      }
    }
  }
}

export async function handleDevMaster(): Promise<never> {
  let workerProc: Bun.Subprocess<'inherit', 'inherit', 'inherit'> | null = null

  process.on('SIGINT', () => workerProc?.kill('SIGINT'))
  process.on('SIGTERM', () => workerProc?.kill('SIGTERM'))

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (key: string) => {
      switch (key.toLowerCase()) {
        case '\u0003':
          return workerProc?.kill('SIGINT')
        case 's':
          return process.emit('SIGINT')
        case 'd':
          serveLog.SPAWN_LOGGER()
          spawnLoggerTerminal()
          return
      }
    })
  }

  async function startWatcher(): Promise<never> {
    workerProc = Bun.spawn(
      ['bun', '--smol', '.server/worker.ts', '--dev', '--dev-worker'],
      {
        stdio: ['inherit', 'inherit', 'inherit'],
        env: { ...process.env, DEV_WATCHER_ACTIVE: '1' },
      },
    )

    const code = (await workerProc.exited) ?? 0

    switch (code) {
      case 42:
        serveLog.RESTART_REQ()
        console.clear()
        return startWatcher()
      case 130:
        serveLog.SHUTTING_DOWN()
        process.exit(0)
        break
      default:
        process.exit(code)
    }
  }

  await startWatcher()
  process.exit(0)
}

const pkgFilesGlob = Glob.strings('package.json', 'bun.lock', 'bun.lockb')
const fileTypeGlob = Glob.fromExt(['ts', 'tsx', 'js', 'jsx', 'css', 'html'])
const watchIgnores = Glob.strings(
  'node_modules/**/*',
  '**/.git/**/*',
  '**/.vscode/**/*',
  '**/.backups/**/*',
  '**/.cache/**/*',
)

const prioFilesGlob = Glob.strings(
  'server.config.ts',
  'schema.ts',
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
        process.exit(42)
        break

      case fileTypeGlob.match(filePath):
        notifySockets(server, filePath)
        break
    }
  }

  const exists = await Bun.file(filePath).exists()

  if (exists) {
    compLog.FILE_STATUS({ status: 'changed', file: filePath })
    return
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
