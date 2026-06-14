import { spawn, type ChildProcess } from 'node:child_process'
import { openSync, closeSync, appendFileSync } from 'node:fs'
import { platform } from 'node:os'
import { fs } from '@server/utils/fs'
import { serveLog } from '../logger'

interface ProcessInfo {
  pid: number
  logFile: string
  args: string[]
  startedAt: number
}

function trySpawn(cmd: string[], errorMsg?: string): boolean {
  try {
    Bun.spawn(cmd).unref()
    return true
  } catch (err) {
    if (errorMsg) serveLog.UNHANDLED_ERR({ error: `${errorMsg}: ${err}` })
    return false
  }
}

export class CLI {
  protected constructor() {}

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
    const os = platform()
    switch (os) {
      case 'win32':
        this.spawnWindows(scriptArgs)
        break
      case 'darwin':
        this.spawnMac(scriptArgs)
        break
      default:
        this.spawnLinux(scriptArgs)
        break
    }
  }

  private static spawnWindows(scriptArgs: string): void {
    trySpawn(
      ['cmd.exe', '/c', 'start', 'cmd.exe', '/c', scriptArgs],
      'Failed to spawn logger terminal on Windows',
    )
  }

  private static spawnMac(scriptArgs: string): void {
    trySpawn(
      [
        'osascript',
        '-e',
        `tell application "Terminal" to do script "cd \\"${process.cwd()}\\" && ${scriptArgs}"`,
      ],
      'Failed to spawn logger terminal on macOS',
    )
  }

  private static spawnLinux(scriptArgs: string): void {
    const terminals = [
      ['x-terminal-emulator', '-e', scriptArgs],
      ['gnome-terminal', '--', 'sh', '-c', scriptArgs],
      ['konsole', '-e', scriptArgs],
      ['xfce4-terminal', '-e', scriptArgs],
      ['kitty', 'sh', '-c', scriptArgs],
      ['alacritty', '-e', 'sh', '-c', scriptArgs],
      ['xterm', '-e', scriptArgs],
    ]

    const spawned = terminals.some(cmd => trySpawn(cmd))
    if (!spawned) {
      serveLog.UNHANDLED_ERR({
        error:
          'Could not spawn client logger terminal. Make sure x-terminal-emulator, gnome-terminal, konsole, or xterm is installed.',
      })
    }
  }

  private static getProcessesFile() {
    return `${fs.cwd}/.server/.data/processes.json`
  }

  private static async ensureDataDir() {
    await fs.mkdir(`${fs.cwd}/.server/.data`)
  }

  private static normPath(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase()
  }

  private static parsePid(target: string, exampleCmd: string): number {
    if (!target) {
      console.error(`Error: Please specify a PID. Example: ${exampleCmd}`)
      process.exit(1)
    }
    const pid = parseInt(target, 10)
    if (Number.isNaN(pid)) {
      console.error(`Error: Invalid PID "${target}"`)
      process.exit(1)
    }
    return pid
  }

  private static async readProcesses(): Promise<ProcessInfo[]> {
    const file = Bun.file(this.getProcessesFile())
    if (!(await file.exists())) return []
    try {
      const data = await file.json()
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  private static async writeProcesses(procs: ProcessInfo[]) {
    await this.ensureDataDir()
    await Bun.write(this.getProcessesFile(), JSON.stringify(procs, null, 2))
  }

  private static async getActiveProcesses(): Promise<ProcessInfo[]> {
    const procs = await this.readProcesses()
    const active: ProcessInfo[] = []
    for (const proc of procs) {
      try {
        process.kill(proc.pid, 0)
        active.push(proc)
      } catch {}
    }
    if (active.length !== procs.length) {
      await this.writeProcesses(active)
    }
    return active
  }

  private static tryKillProcess(pid: number): boolean {
    try {
      process.kill(pid, 'SIGTERM')
      return true
    } catch (e) {
      console.error(`Failed to kill PID ${pid}:`, e)
      return false
    }
  }

  private static async killAll(active: ProcessInfo[]) {
    if (active.length === 0) {
      console.log('No active background processes found.')
      return
    }
    await this.writeProcesses([])
    for (const proc of active) {
      console.log(`Killing background process with PID ${proc.pid}...`)
      this.tryKillProcess(proc.pid)
    }
    console.log('All processes terminated.')
  }

  private static async killOne(pid: number, active: ProcessInfo[]) {
    console.log(`Killing process with PID ${pid}...`)
    const procInfo = active.find(p => p.pid === pid)
    if (procInfo) {
      await this.writeProcesses(active.filter(p => p.pid !== pid))
    }
    const success = this.tryKillProcess(pid)
    if (!success) {
      process.exit(1)
    }
    console.log(`Process ${pid} terminated.`)
  }

  private static async handleKill(target: string) {
    const active = await this.getActiveProcesses()
    if (target === 'all') {
      await this.killAll(active)
      process.exit(0)
    }

    const pid = this.parsePid(target, 'bun run .server kill 12345 (or all)')
    await this.killOne(pid, active)
    process.exit(0)
  }

  private static async handleAttach(target: string) {
    const pid = this.parsePid(target, 'bun run .server attach 12345')
    const active = await this.getActiveProcesses()
    const proc = active.find(p => p.pid === pid)
    if (!proc) {
      console.error(`Error: No active background process found with PID ${pid}`)
      process.exit(1)
    }

    console.log(
      `Attaching to process ${pid} logs (${proc.logFile}). Press Ctrl+C to detach.\n`,
    )

    const file = Bun.file(proc.logFile)
    let lastSize = 0

    const printNewLogs = async () => {
      if (await file.exists()) {
        const currentSize = file.size
        if (currentSize > lastSize) {
          const stream = file.slice(lastSize, currentSize).stream()
          const reader = stream.getReader()
          const decoder = new TextDecoder()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            process.stdout.write(decoder.decode(value))
          }
          lastSize = currentSize
        }
      }
    }

    await printNewLogs()
    const interval = setInterval(printNewLogs, 250)

    const checkInterval = setInterval(() => {
      try {
        process.kill(pid, 0)
      } catch {
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

    await new Promise(() => {})
  }

  private static async handleDetach() {
    const childArgs = process.argv.slice(2).filter(arg => arg !== 'detach')
    const timestamp = Date.now()
    await this.ensureDataDir()
    const logFilePath = `${fs.cwd}/.server/.data/process-${timestamp}.log`

    console.log(`Spawning background process...`)

    const proc = CLI.daemon('.server/index.ts', childArgs, fs.cwd, {
      ...process.env,
      DETACHED: '1',
      DETACHED_MONITOR: '1',
      LOG_FILE_PATH: logFilePath,
    })

    const newPid = proc.pid
    if (!newPid) {
      console.error('Error: Failed to spawn background process.')
      process.exit(1)
    }
    proc.unref()

    // Wait a short moment to verify it started successfully
    await new Promise(resolve => setTimeout(resolve, 800))

    if (proc.exitCode !== null) {
      console.error(
        `Error: Background process exited immediately with code ${proc.exitCode}`,
      )
      process.exit(1)
    }

    // Register PID temporarily; server will replace it with actual PID on boot
    const active = await this.getActiveProcesses()
    const exists = active.some(
      p =>
        p.pid === newPid ||
        this.normPath(p.logFile) === this.normPath(logFilePath),
    )
    if (!exists) {
      active.push({
        pid: newPid,
        logFile: logFilePath,
        args: childArgs,
        startedAt: timestamp,
      })
      await this.writeProcesses(active)
    }

    console.log(`\nServer is running in background (detached).`)
    console.log(`PID:      ${newPid}`)
    console.log(`Log file: ${logFilePath}`)
    console.log(`\nTo view logs:   bun run .server attach ${newPid}`)
    console.log(`To stop server: bun run .server kill ${newPid}`)
    process.exit(0)
  }

  static async registerBackgroundProcess() {
    if (process.env.DETACHED !== '1' || !process.env.LOG_FILE_PATH) return

    const logFilePath = process.env.LOG_FILE_PATH
    const active = await this.getActiveProcesses()

    if (active.some(p => p.pid === process.pid)) return

    const existingIndex = active.findIndex(
      p => this.normPath(p.logFile) === this.normPath(logFilePath),
    )
    if (existingIndex !== -1) {
      active[existingIndex].pid = process.pid
    } else {
      active.push({
        pid: process.pid,
        logFile: logFilePath,
        args: process.argv.slice(2),
        startedAt: Date.now(),
      })
    }
    await this.writeProcesses(active)
  }

  private static async runMonitor(args: string[], logFile: string) {
    try {
      appendFileSync(logFile, `[Monitor] Starting monitor process (PID: ${process.pid})...\n`)
    } catch (err: any) {
      console.error('Failed to write startup log:', err)
    }

    process.on('uncaughtException', (err) => {
      try {
        appendFileSync(logFile, `\n[Monitor] Uncaught Exception: ${err?.stack || err?.message || String(err)}\n`)
      } catch {}
      process.exit(1)
    })

    process.on('unhandledRejection', (reason: any) => {
      try {
        appendFileSync(logFile, `\n[Monitor] Unhandled Rejection: ${reason?.stack || reason?.message || String(reason)}\n`)
      } catch {}
      process.exit(1)
    })

    process.on('SIGHUP', () => {
      try { appendFileSync(logFile, `\n[Monitor] Received SIGHUP (ignored)\n`) } catch {}
    })

    process.on('SIGBREAK', () => {
      try { appendFileSync(logFile, `\n[Monitor] Received SIGBREAK (ignored)\n`) } catch {}
    })

    let crashes: number[] = []

    while (true) {
      try {
        const childEnv = { ...process.env }
        delete childEnv.DETACHED_MONITOR

        let child;
        try {
          child = spawn(process.execPath, ['--smol', '.server/index.ts', ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: fs.cwd,
            env: childEnv,
            detached: true,
          })
        } catch (e: any) {
          appendFileSync(logFile, `\n[Monitor] Failed to spawn child process: ${e?.message || String(e)}\n`)
          break
        }

        const pipeToLog = async (stream: any) => {
          try {
            for await (const chunk of stream) {
              appendFileSync(logFile, chunk)
            }
          } catch {}
        }

        const stdoutPromise = pipeToLog(child.stdout)
        const stderrPromise = pipeToLog(child.stderr)

        const { code, signal } = await new Promise<{ code: number | null; signal: string | null }>(resolve => {
          child.on('exit', (code, signal) => {
            resolve({ code, signal })
          })
        })

        await Promise.all([stdoutPromise, stderrPromise])

        const activeProcs = await this.getActiveProcesses()
        const stillRegistered = activeProcs.some(
          p => this.normPath(p.logFile) === this.normPath(logFile)
        )

        if (!stillRegistered) {
          appendFileSync(logFile, `\n[Monitor] Process was removed from active processes list. Exiting monitor.\n`)
          break
        }

        if (signal === 'SIGTERM' || signal === 'SIGINT') {
          appendFileSync(logFile, `\n[Monitor] Process exited cleanly via signal ${signal}. Exiting monitor.\n`)
          break
        }

        if (code === 0) {
          appendFileSync(logFile, `\n[Monitor] Process exited cleanly with code 0. Exiting monitor.\n`)
          break
        }

        // Crash!
        const now = Date.now()
        crashes.push(now)

        const oneMinuteAgo = now - 60000
        crashes = crashes.filter(t => t > oneMinuteAgo)

        appendFileSync(
          logFile,
          `\n[Monitor] Process crashed (exit code: ${code}, signal: ${signal}). Crash count in last minute: ${crashes.length}/3.\n`
        )

        if (crashes.length >= 3) {
          appendFileSync(
            logFile,
            `[Monitor] Process crashed ${crashes.length} times within 1 minute. Disabling autorestart. Exiting.\n`
          )
          break
        }

        appendFileSync(logFile, `[Monitor] Restarting in 1 second...\n`)
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (err: any) {
        appendFileSync(logFile, `\n[Monitor] Loop error: ${err?.stack || err?.message || String(err)}\n`)
        break
      }
    }
  }

  static async handleCLI() {
    if (process.env.DETACHED_MONITOR === '1') {
      const logFile = process.env.LOG_FILE_PATH
      if (logFile) {
        const childArgs = process.argv.slice(2).filter(arg => arg !== 'detach')
        await this.runMonitor(childArgs, logFile)
        process.exit(0)
      }
    }

    const killIndex = process.argv.indexOf('kill')
    if (killIndex !== -1) {
      await this.handleKill(process.argv[killIndex + 1])
    }

    const attachIndex = process.argv.indexOf('attach')
    if (attachIndex !== -1) {
      await this.handleAttach(process.argv[attachIndex + 1])
    }

    const detachIndex = process.argv.indexOf('detach')
    if (detachIndex !== -1) {
      await this.handleDetach()
    }

    const logIndex = process.argv.indexOf('log')
    if (logIndex !== -1) {
      const parentPid = parseInt(process.argv[logIndex + 1], 10)
      const { startClientLogger } = await import('../client/log')
      await startClientLogger(Number.isNaN(parentPid) ? undefined : parentPid)
      process.exit(0)
    }

    await this.registerBackgroundProcess()
  }
}
