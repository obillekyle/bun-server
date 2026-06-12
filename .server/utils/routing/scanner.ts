import type { Dirent } from 'node:fs'
import { readdir as fsReaddir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { Bakery } from '@server/core/bakery'

const blockedDirs = [
  '.server',
  '.database',
  '.dashboard',
  '.plugins',
  '_internal',
  '.git',
  '.vscode',
  'node_modules',
]

export interface ScannedFile {
  relativePath: string
  absolutePath: string
  projectPath: string
  extension: string
}

export async function walkWorkspace(): Promise<ScannedFile[]> {
  const results: ScannedFile[] = []

  async function handleDirectory(
    dirent: Dirent,
    fullPath: string,
    baseDir: string,
    isApiDir: boolean,
  ) {
    try {
      if (blockedDirs.includes(dirent.name)) return
      if (
        !isApiDir &&
        Bakery.serveRoot &&
        fullPath === resolve(Bakery.serveRoot)
      ) {
        return
      }
      await walk(fullPath, baseDir, isApiDir)
    } catch {}
  }

  function handleFile(
    dirent: Dirent,
    fullPath: string,
    baseDir: string,
    isApiDir: boolean,
  ) {
    try {
      const file = dirent.name
      if (file === 'server.config.ts') return
      const ext = file.includes('.')
        ? file.substring(file.lastIndexOf('.'))
        : ''
      const relPath = relative(baseDir, fullPath).replace(/\\/g, '/')
      const projPath = `./${relative(process.cwd(), fullPath).replace(/\\/g, '/')}`
      results.push({
        relativePath: isApiDir ? `api/${relPath}` : relPath,
        absolutePath: fullPath.replace(/\\/g, '/'),
        projectPath: projPath,
        extension: ext,
      })
    } catch {}
  }

  async function walk(currentDir: string, baseDir: string, isApiDir: boolean) {
    let entries: Dirent[] = []
    try {
      entries = await fsReaddir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const dirent of entries) {
      if (dirent.name.startsWith('.')) continue
      const fullPath = join(currentDir, dirent.name)

      if (dirent.isDirectory()) {
        await handleDirectory(dirent, fullPath, baseDir, isApiDir)
      } else if (dirent.isFile()) {
        handleFile(dirent, fullPath, baseDir, isApiDir)
      }
    }
  }

  const appRoot = Bakery.serveRoot || '.'
  await walk(resolve(appRoot), resolve(appRoot), false)

  if (Bakery.serveRoot) {
    const apiDir = resolve('./api')
    try {
      await fsReaddir(apiDir)
      await walk(apiDir, apiDir, true)
    } catch {
      // no api dir
    }
  }

  return results
}
