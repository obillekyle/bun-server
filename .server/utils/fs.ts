import { mkdir as fsMkdir } from 'node:fs/promises'
import { relative as nodeRelative, resolve } from 'node:path'
import { parse as parsedPath } from 'node:path/posix'
import { is, Try } from './common'

type MixedArray<T> = T | T[]

function toArray<T>(val?: MixedArray<T>): T[] {
  if (val === undefined) return []
  return Array.isArray(val) ? val : [val]
}

function safeResolve(...paths: string[]) {
  return resolve(...paths).replace(/\\/g, '/')
}
// prettier-ignore
const compressable = new Set([ 
  'html', 'htm', 'xml', 'css', 'js', 'jsx', 'ts', 'tsx', 
  'json', 'ttf', 'otf', 'txt', 'text', 'svg', 'md', 'wasm', 
  'map', 'csv', 'yml', 'yaml', 'mdx',
])

export namespace Glob {
  export type Pattern = string | Bun.Glob
  export type Patterns = Pattern | Pattern[]
  export type PatternInfo = {
    folder: string
    ext?: MixedArray<string>
    exclude?: Glob.Patterns
  }

  export type ArrayOfGlobs = {
    globs: Bun.Glob[]
  } & Bun.Glob

  export function pattern(patternInfo: PatternInfo): Bun.Glob {
    let { folder, ext, exclude } = patternInfo

    ext = toArray(ext)
    folder = folder ? `${safeResolve(folder)}/` : ''
    ext = ext.length > 0 ? `**/*.{${ext.join(',')}}` : '**/*'
    const excludeGlob = fromArray(toArray(exclude))
    const globPattern = from(folder + ext)

    return {
      async *scan() {
        for await (const entry of globPattern.scan()) {
          if (excludeGlob.match(entry)) continue
          yield entry
        }
      },

      match(path: string) {
        return globPattern.match(path) && !excludeGlob.match(path)
      },

      *scanSync() {
        const entries = globPattern.scanSync()
        for (const entry of entries) {
          if (excludeGlob.match(entry)) continue
          yield entry
        }
      },
    }
  }

  export function from(pattern: Pattern): Bun.Glob {
    if (pattern instanceof Bun.Glob) return pattern
    return new Bun.Glob(pattern)
  }

  export function match(globs: Patterns, path: string): boolean {
    return fromArray(toArray(globs)).match(safeResolve(path))
  }

  export function strings(...patterns: string[]): Bun.Glob {
    const pattern = `{${patterns.join(',')}}`
    return pattern.length ? new Bun.Glob(pattern) : new Bun.Glob('')
  }

  export function fromArray(globs: Pattern[]): ArrayOfGlobs {
    const pattern: Bun.Glob[] = []
    const strings: string[] = []

    for (const p of globs) {
      if (p instanceof Bun.Glob) pattern.push(p)
      else if (is.string(p)) strings.push(p)
    }

    if (strings.length) pattern.push(Glob.strings(...strings))

    return {
      globs: pattern,
      match(path: string) {
        for (const g of this.globs) if (g.match(path)) return true
        return false
      },
      async *scan() {
        for (const g of this.globs) yield* g.scan()
      },
      *scanSync() {
        for (const g of this.globs) yield* g.scanSync()
      },
    }
  }

  export function patterns(...patterns: Pattern[]): ArrayOfGlobs {
    return fromArray(patterns)
  }

  export function fromExt(ext: MixedArray<string>, root = ''): Bun.Glob {
    ext = toArray(ext)
    root = root ? `${safeResolve(root)}/` : ''
    if (ext.length === 0) return new Bun.Glob('')
    return new Bun.Glob(`${root}**/*.{${ext.join(',')}}`)
  }
}

export namespace FileSystem {
  export type AbsolutePath = string & {}
  export type RelativePath = string & {}
  export type RequestPath = string & {}
  export type ParsedPath = {
    dir: string
    name: string
    ext: string
  }

  export async function* glob(pattern: Glob.Pattern, exclude?: Glob.Patterns) {
    const glob = Glob.from(pattern)
    const excludeGlob = Glob.fromArray(toArray(exclude))

    for await (const entry of glob.scan()) {
      if (excludeGlob.match(entry)) continue
      yield entry as AbsolutePath
    }
  }

  export const resolve = safeResolve
  export const cwd = safeResolve(process.cwd())
  export const parse = parsedPath
  export function relative(from: string, to: string) {
    return nodeRelative(from, to).replace(/\\/g, '/')
  }

  export async function isDir(path: string) {
    return (await Try.silent(Bun.file(path).stat()))?.isDirectory() || false
  }

  export function exists(path: string | Bun.BunFile): boolean {
    const file = typeof path === 'string' ? Bun.file(path) : path
    const lastMod = file.lastModified
    return Boolean(!lastMod || lastMod < Date.now() || file.size)
  }

  export async function mkdir(path: string) {
    await fsMkdir(path, { recursive: true })
  }

  export async function* readdir(info?: Glob.PatternInfo) {
    info ||= { folder: cwd }
    const glob = Glob.pattern(info)
    for await (let entry of glob.scan()) {
      entry = FileSystem.resolve(entry)
      const file = Bun.file(entry)
      yield {
        file,
        stat: await file.stat(),
        path: resolve(entry) as AbsolutePath,
      }
    }
  }

  export async function* files(info?: Glob.PatternInfo) {
    for await (const entry of readdir(info)) {
      if (entry.stat.isFile()) yield entry
    }
  }

  export function isCompressible(ext: string): boolean {
    const cleanExt = ext.toLowerCase().replace(/^\./, '')
    const mimeType = getMimeType(cleanExt)
    if (mimeType.startsWith('text/') || mimeType === 'application/json') {
      return true
    }

    return compressable.has(cleanExt)
  }

  export async function getOrCreateCachedFile(
    cacheDir: string,
    cacheName: string,
    sourceMtime: number | null,
    compiler: () => Promise<
      string | Uint8Array<ArrayBuffer> | ArrayBuffer | null | undefined
    >,
  ) {
    const ext = parse(cacheName).ext
    const compressible = isCompressible(ext)

    const rawPath = resolve(cacheDir, cacheName)
    const gzPath = `${rawPath}.gz`
    const zstPath = `${rawPath}.zst`

    const rawFile = Bun.file(rawPath)
    const gzFile = Bun.file(gzPath)
    const zstFile = Bun.file(zstPath)

    const targetFile = compressible ? zstFile : rawFile

    if (
      exists(targetFile) &&
      (!compressible || (exists(rawFile) && exists(gzFile))) &&
      (!sourceMtime || sourceMtime <= targetFile.lastModified)
    ) {
      return targetFile
    }

    const content = await compiler()
    if (content == null) return null

    await mkdir(cacheDir)

    await Promise.all([
      rawFile.write(content),
      ...(compressible
        ? [
            gzFile.write(Bun.gzipSync(content)),
            zstFile.write(Bun.zstdCompressSync(content)),
          ]
        : []),
    ])

    return Bun.file(targetFile.name!)
  }

  export function getMimeType(ext: string): string {
    const fileDummy = Bun.file(`dummy.${ext}`)
    return fileDummy.type || 'application/octet-stream'
  }
}

export { FileSystem as fs }
