/** biome-ignore-all lint: any */
import { type ChildProcess, spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, rmdirSync, statSync } from 'node:fs'
import { platform } from 'node:os'
import { Try } from '@server/utils/common/try'
import { fs } from '@server/utils/fs'
import { serveLog } from '../logger'

interface ProcessInfo {
  pid: number
  logFile: string
  args: string[]
  startedAt: number
  token?: string
}

const safeLog = (file: string, msg: string) =>
  Try(() => appendFileSync(file, msg))

const isAlive = (pid: number): boolean =>
  Try(() => (process.kill(pid, 0), true)) ?? false

function trySpawn(cmd: string[], errorMsg?: string): boolean {
  return Try.return(
    () => (Bun.spawn(cmd).unref(), true),
    err => {
      errorMsg && serveLog.UNHANDLED_ERR({ error: `${errorMsg}: ${err}` })
      return false
    },
  )
}

export class CLI {
  protected constructor() {}

  // 📂 Centralized Paths
  private static get dir() {
    return `${fs.cwd}/.server/.data`
  }
  private static get procFile() {
    return `${this.dir}/processes.json`
  }
  private static get lockDir() {
    return `${this.dir}/processes.lock`
  }

  static daemon(
    scriptPath: string,
    args: string[],
    cwd: string,
    env: Record<string, string | undefined>,
    logFd?: number,
  ): ChildProcess {
    return spawn(process.execPath, ['--smol', scriptPath, ...args], {
      stdio: logFd ? ['ignore', logFd, logFd] : 'ignore',
      detached: true,
      windowsHide: true,
      cwd,
      env,
    })
  }

  static openTerminal(scriptArgs: string): void {
    switch (platform()) {
      case 'win32':
        return void this.spawnWindows(scriptArgs)
      case 'darwin':
        return void this.spawnMac(scriptArgs)
      default:
        return void this.spawnLinux(scriptArgs)
    }
  }

  private static spawnWindows = (args: string) =>
    trySpawn(
      ['cmd.exe', '/c', 'start', 'cmd.exe', '/c', args],
      'Failed on Windows',
    )

  private static spawnMac = (args: string) =>
    trySpawn(
      [
        'osascript',
        '-e',
        `tell application "Terminal" to do script "cd \\"${process.cwd()}\\" && ${args}"`,
      ],
      'Failed on macOS',
    )

  private static spawnLinux(scriptArgs: string): void {
    const terms = [
      ['x-terminal-emulator', '-e', scriptArgs],
      ['gnome-terminal', '--', 'sh', '-c', scriptArgs],
      ['konsole', '-e', scriptArgs],
      ['xfce4-terminal', '-e', scriptArgs],
      ['kitty', 'sh', '-c', scriptArgs],
      ['alacritty', '-e', 'sh', '-c', scriptArgs],
      ['xterm', '-e', scriptArgs],
    ]

    !terms.some(cmd => trySpawn(cmd)) &&
      serveLog.UNHANDLED_ERR({
        error: 'Could not spawn client logger terminal.',
      })
  }

  private static normPath = (p: string) => p.replace(/\\/g, '/').toLowerCase()

  private static parsePid(target: string, exampleCmd: string): number {
    if (!target) {
      console.error(`Error: Please specify a PID. Example: ${exampleCmd}`)
      return process.exit(1)
    }

    const pid = parseInt(target, 10)
    return Number.isNaN(pid)
      ? (console.error(`Error: Invalid PID "${target}"`), process.exit(1))
      : pid
  }

  private static async runLocked<T>(fn: () => Promise<T>): Promise<T> {
    let acquired = false

    for (let i = 0; i < 200; i++) {
      if (Try(() => (mkdirSync(this.lockDir), true))) {
        acquired = true
        break
      }

      const stats = Try(() => statSync(this.lockDir))
      if (stats && Date.now() - stats.mtimeMs > 5000) {
        Try(() => rmdirSync(this.lockDir))
        continue
      }
      await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * 15)))
    }

    const [err, res] = await Try.catch(fn)
    acquired && Try(() => rmdirSync(this.lockDir))

    if (err) throw err
    return res as T
  }

  private static async readProcesses(): Promise<ProcessInfo[]> {
    const file = Bun.file(this.procFile)
    if (!(await file.exists())) return []

    const [err, data] = await Try.catch(() => file.json())
    return err || !Array.isArray(data) ? [] : data
  }

  private static async writeProcesses(procs: ProcessInfo[]) {
    await fs.mkdir(this.dir)
    await Bun.write(this.procFile, JSON.stringify(procs, null, 2))
  }

  private static async getActiveProcessesInternal(): Promise<ProcessInfo[]> {
    const procs = await this.readProcesses()
    const active = procs.filter(p => isAlive(p.pid))
    active.length !== procs.length && (await this.writeProcesses(active))
    return active
  }

  private static getActiveProcesses = () =>
    this.runLocked(() => this.getActiveProcessesInternal())

  private static async addActiveProcess(proc: Omit<ProcessInfo, 'startedAt'>) {
    await this.runLocked(async () => {
      const active = await this.getActiveProcessesInternal()
      if (
        active.some(
          p =>
            p.pid === proc.pid ||
            this.normPath(p.logFile) === this.normPath(proc.logFile),
        )
      )
        return
      active.push({ ...proc, startedAt: Date.now() })
      await this.writeProcesses(active)
    })
  }

  private static tryKillProcess(pid: number): boolean {
    return Try.return(
      () => (process.kill(pid, 'SIGTERM'), true),
      e => (console.error(`Failed to kill PID ${pid}:`, e), false),
    )
  }

  private static async handleKill(target: string) {
    const active = await this.getActiveProcesses()
    if (active.length === 0) {
      console.log('No active background processes found.')
      return process.exit(0)
    }

    if (target === 'all') {
      await this.runLocked(async () => this.writeProcesses([]))
      active.forEach(p => {
        console.log(`Killing ${p.pid}...`)
        this.tryKillProcess(p.pid)
      })
      console.log('All processes terminated.')
      return process.exit(0)
    }

    const pid = this.parsePid(target, 'bun run .server kill 12345')
    console.log(`Killing process ${pid}...`)

    await this.runLocked(async () => {
      const activeProcs = await this.getActiveProcessesInternal()
      await this.writeProcesses(activeProcs.filter(p => p.pid !== pid))
    })

    !this.tryKillProcess(pid) && process.exit(1)

    console.log(`Process ${pid} terminated.`)
    process.exit(0)
  }

  private static async streamLogs(logFile: string, pid: number) {
    const file = Bun.file(logFile)
    let lastSize = 0

    const printLogs = async () => {
      if (!(await file.exists())) return
      const currentSize = file.size
      if (currentSize <= lastSize) return

      const stream = file.slice(lastSize, currentSize).stream()
      const decoder = new TextDecoder()
      for await (const chunk of stream)
        process.stdout.write(decoder.decode(chunk))
      lastSize = currentSize
    }

    await printLogs()
    const interval = setInterval(printLogs, 250)

    const checkInterval = setInterval(() => {
      if (!isAlive(pid)) {
        console.log(`\nProcess ${pid} has terminated.`)
        clearInterval(interval)
        clearInterval(checkInterval)
        process.exit(0)
      }
    }, 1000)

    process.on('SIGINT', () => {
      console.log(
        '\nDetached from logs. Process continues to run in the background.',
      )
      process.exit(0)
    })
  }

  private static async handleAttach(target: string) {
    const pid = this.parsePid(target, 'bun run .server attach 12345')
    const active = await this.getActiveProcesses()
    const proc = active.find(p => p.pid === pid)

    if (!proc) {
      console.error(`Error: No active background process found with PID ${pid}`)
      return process.exit(1)
    }

    console.log(
      `Attaching to process ${pid} logs (${proc.logFile}). Press Ctrl+C to detach.\n`,
    )
    await this.streamLogs(proc.logFile, pid)
    await new Promise(() => {})
  }

  private static async handleDetach() {
    const childArgs = process.argv.slice(2).filter(a => a !== 'detach')
    await fs.mkdir(this.dir)
    const logFilePath = `${this.dir}/process-${Date.now()}.log`
    const token = Bun.randomUUIDv7()

    console.log(`Spawning background process...`)
    const proc = CLI.daemon('.server/index.ts', childArgs, fs.cwd, {
      ...process.env,
      DETACHED: '1',
      DETACHED_MONITOR: '1',
      LOG_FILE_PATH: logFilePath,
      DETACHED_TOKEN: token,
    })
    proc.unref()

    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 50))
      const registered = (await this.getActiveProcesses()).find(
        p => p.token === token,
      )

      if (registered) {
        console.log(`\nServer is running in background (detached).`)
        console.log(`PID:      ${registered.pid}\nLog file: ${logFilePath}`)
        console.log(
          `\nTo view logs:   bun run .server attach ${registered.pid}`,
        )
        console.log(`To stop server: bun run .server kill ${registered.pid}`)
        return process.exit(0)
      }
    }

    console.error('Error: Failed to spawn background process.')
    process.exit(1)
  }

  static async registerBackgroundProcess() {
    process.env.DETACHED === '1' &&
      process.env.LOG_FILE_PATH &&
      (await this.addActiveProcess({
        pid: process.pid,
        logFile: process.env.LOG_FILE_PATH,
        args: process.argv.slice(2),
      }))
  }

  private static setupMonitorSignals(
    logFile: string,
    getChild: () => ChildProcess | null,
  ) {
    const killChild = () => Try(() => getChild()?.kill('SIGTERM'))

    const handleFatal = (type: string, err?: any) => {
      safeLog(
        logFile,
        `\n[Monitor] ${type}: ${err?.stack || err?.message || String(err || '')}\n`,
      )
      killChild()
      process.exit(1)
    }

    process.on('SIGTERM', () =>
      handleFatal('Received SIGTERM', 'Terminating child...'),
    )
    process.on('SIGINT', () =>
      handleFatal('Received SIGINT', 'Terminating child...'),
    )
    process.on('uncaughtException', e => handleFatal('Uncaught Exception', e))
    process.on('unhandledRejection', e => handleFatal('Unhandled Rejection', e))
    process.on('SIGHUP', () =>
      safeLog(logFile, `\n[Monitor] Received SIGHUP (ignored)\n`),
    )
    process.on('SIGBREAK', () =>
      safeLog(logFile, `\n[Monitor] Received SIGBREAK (ignored)\n`),
    )
  }

  private static async runMonitor(args: string[], logFile: string) {
    safeLog(
      logFile,
      `[Monitor] Starting monitor process (PID: ${process.pid})...\n`,
    )

    process.env.DETACHED_TOKEN &&
      (await this.addActiveProcess({
        pid: process.pid,
        logFile,
        args,
        token: process.env.DETACHED_TOKEN,
      }))

    let child: ChildProcess | null = null
    this.setupMonitorSignals(logFile, () => child)

    let crashes: number[] = []
    const childEnv = { ...process.env }
    delete childEnv.DETACHED_MONITOR

    while (true) {
      const childOrError = Try.return(
        () =>
          spawn(process.execPath, ['--smol', '.server/index.ts', ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: fs.cwd,
            env: childEnv,
            detached: platform() !== 'win32',
            windowsHide: true,
          }),
        e => e as Error,
      )

      if (childOrError instanceof Error) {
        safeLog(
          logFile,
          `\n[Monitor] Failed to spawn child process: ${childOrError.message}\n`,
        )
        break
      }

      child = childOrError

      const pipe = async (stream: any) => {
        for await (const chunk of stream) safeLog(logFile, chunk)
      }

      const { code, signal } = await new Promise<{
        code: number | null
        signal: string | null
      }>(res => {
        child!.on('exit', (c, s) => res({ code: c, signal: s }))
      })

      await Promise.all([pipe(child.stdout), pipe(child.stderr)])

      if (
        !(await this.getActiveProcesses()).some(
          p => this.normPath(p.logFile) === this.normPath(logFile),
        )
      ) {
        safeLog(
          logFile,
          `\n[Monitor] Process was removed from active processes list. Exiting monitor.\n`,
        )
        break
      }

      if (signal === 'SIGTERM' || signal === 'SIGINT' || code === 0) {
        safeLog(
          logFile,
          `\n[Monitor] Process exited cleanly (${signal || `code ${code}`}). Exiting monitor.\n`,
        )
        break
      }

      crashes = [...crashes.filter(t => t > Date.now() - 60000), Date.now()]
      safeLog(
        logFile,
        `\n[Monitor] Process crashed (code: ${code}, signal: ${signal}). Crash count in last minute: ${crashes.length}/3.\n`,
      )

      if (crashes.length >= 3) {
        safeLog(
          logFile,
          `[Monitor] Process crashed 3 times within 1 minute. Disabling autorestart. Exiting.\n`,
        )
        break
      }

      safeLog(logFile, `[Monitor] Restarting in 1 second...\n`)
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  static async handleCLI() {
    const args = process.argv.slice(2)
    const getArg = (cmd: string) => {
      const idx = process.argv.indexOf(cmd)
      return idx !== -1 ? process.argv[idx + 1] : null
    }

    if (process.env.DETACHED_MONITOR === '1' && process.env.LOG_FILE_PATH) {
      await this.runMonitor(
        args.filter(a => a !== 'detach'),
        process.env.LOG_FILE_PATH,
      )
      return process.exit(0)
    }

    switch (true) {
      case process.argv.includes('kill'):
        return await this.handleKill(getArg('kill')!)

      case process.argv.includes('attach'):
        return await this.handleAttach(getArg('attach')!)

      case process.argv.includes('detach'):
        return await this.handleDetach()

      case process.argv.includes('log'): {
        const pidStr = getArg('log')!
        const parentPid = parseInt(pidStr, 10)
        const { startClientLogger } = await import('../client/log')
        await startClientLogger(Number.isNaN(parentPid) ? undefined : parentPid)
        return process.exit(0)
      }
    }

    await this.registerBackgroundProcess()
  }
}
