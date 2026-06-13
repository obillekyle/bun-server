import { platform } from 'node:os'
import { serveLog } from '../logger'

function trySpawn(cmd: string[], errorMsg?: string): boolean {
  try {
    Bun.spawn(cmd).unref()
    return true
  } catch (err) {
    if (errorMsg) serveLog.UNHANDLED_ERR({ error: `${errorMsg}: ${err}` })
    return false
  }
}

export class Spawn {
  protected constructor() {}

  static open(scriptArgs: string): void {
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
}
