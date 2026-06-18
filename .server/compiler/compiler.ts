import { Strings } from '@server/cache/string'
import { Bakery } from '@server/core/bakery'
import { is } from '@server/utils/common'
import { FileSystem as fs } from '@server/utils/fs'

import pkg from '../../package.json' with { type: 'json' }

const isDevWorker = !!import.meta.env.WORKER
const isDev = !!import.meta.env.DEV
const mode = import.meta.env.MODE || 'production'

const defines = {
  'import.meta.env.DEV': JSON.stringify(isDev),
  'import.meta.env.PROD': JSON.stringify(!isDev),
  'import.meta.env.WORKER': JSON.stringify(isDevWorker),
  'import.meta.env.MODE': JSON.stringify(mode),
  'import.meta.env.BAKERY_VERSION': JSON.stringify(pkg.version),
}

const RX_IMPORT =
  /import\s+(?:(?:\*\s+as\s+)?([a-zA-Z_$\d\s{},/*]+?)\s+from\s+)?['"]([^'"]+?\.([a-zA-Z0-9]+))['"](?:\s+(?:with|assert)\s*\{[^}]+\})?\s*;?/gm

let transpilerInstance: Bun.Transpiler | null = null
function getTranspiler() {
  if (!transpilerInstance) {
    transpilerInstance = new Bun.Transpiler({
      loader: 'ts',
      inline: true,
      trimUnusedImports: true,
      minifyWhitespace: true,
      target: 'browser',
      deadCodeElimination: true,
      define: defines,
    })
  }
  return transpilerInstance
}

function preprocessImports(source: string, filePath: fs.AbsolutePath): string {
  const fileDir = fs.resolve(filePath)

  const matches = [...source.matchAll(RX_IMPORT)]

  for (const [string, varName, importPath, ext] of matches) {
    const assetPath = fs.resolve(fileDir, importPath)
    const randomId = Math.random().toString(36).slice(2, 8)
    const id = Strings.getKey(assetPath) || `${Date.now()}_${randomId}.${ext}`

    const url = `/_virtual/${id}`
    const quotedUrl = JSON.stringify(url)

    if (ext !== 'css' && ext !== 'json') continue

    const replacement = varName
      ? `const ${varName} = await Bakery.virtual(${quotedUrl});`
      : `await Bakery.virtual(${quotedUrl});`

    source = source.replace(string, replacement)
    Strings.set(url, assetPath)
  }

  return source
}

export async function compile(path: fs.AbsolutePath): Promise<string> {
  let source = await Bun.file(path).text()
  source = preprocessImports(source, path)
  const content = await getTranspiler().transform(source)

  const importRegex = /\b(from|import)(\s*\(?\s*)(["'])([^"']+)\3(\)?)/g
  const matches = [...content.matchAll(importRegex)]

  if (!matches.length) return content

  const { dir } = fs.parse(path)
  const serveRoot = Bakery.serveRoot
  const importMap = Bakery.config.importMap
  const mapKeys = Object.keys(importMap)

  const replacements = await Promise.all(
    matches.map(
      async ([fullMatch, keyword, spacing, quote, importPath, closing]) => {
        const hasExtension = (importPath.split('/').pop() || '').includes('.')
        if (hasExtension) return fullMatch

        const prefix = mapKeys.find(k => importPath.startsWith(k))

        if (!prefix && !importPath.startsWith('.')) return fullMatch

        const targetPath = prefix
          ? fs.resolve(
              serveRoot,
              importMap[prefix],
              importPath.slice(prefix.length),
            )
          : fs.resolve(dir, importPath)

        const isDir = await fs.isDir(targetPath)

        return `${keyword}${spacing}${quote}${importPath}${isDir ? '/index' : ''}.js${quote}${closing}`
      },
    ),
  )

  return content.replace(importRegex, () => replacements.shift()!)
}

type CompileResult = {
  success: boolean
  content?: string
  errors?: string[]
}

export async function bundleModule(
  path: fs.AbsolutePath,
): Promise<CompileResult> {
  const build = await Bun.build({
    entrypoints: [path],
    target: 'browser',
    format: 'esm',
    minify: !isDevWorker,
    define: defines,
  })

  if (build.success && build.outputs.length > 0) {
    return { success: true, content: await build.outputs[0].text() }
  }

  const errors = build.logs
    .map(log => {
      if (!log) return ''
      if (is.string(log)) return log
      const msg = log.message || ''
      const pos = log.position
      if (!pos) return msg

      return `${pos.file || ''}:${pos.line || 0}:${pos.column || 0} - ${msg}`
    })
    .filter(Boolean)

  return { success: false, errors }
}
