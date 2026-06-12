import { relative } from 'node:path/posix'
import { Bakery } from '@server/core/bakery'
import { is } from '../common/misc'
import { Try } from '../common/try'

const specBlock = (eagerness: 'conservative' | 'moderate' | 'aggressive') => [
  {
    source: 'document',
    where: {
      and: [
        { href_matches: '/*' },
        {
          not: {
            or: [
              { href_matches: '/*\\?*utm_*' },
              { href_matches: '/*\\?*fbclid*' },
              { href_matches: '/*\\.pdf' },
              { href_matches: '/*\\.zip' },
              { href_matches: '/*#*' },
            ],
          },
        },
      ],
    },
    eagerness,
  },
]

const specString = JSON.stringify({
  prefetch: specBlock('moderate'),
  prerender: specBlock('conservative'),
})

type PackageJson = {
  name: string
  version: string
  main?: string
  module?: string
  browser?: string | MapOf<string>
  dependencies?: MapOf<string>
  devDependencies?: MapOf<string>
}

let depMap = ''

function resolveDepModule(pkgData: PackageJson, baseMod: string): string {
  if (is.string(pkgData.browser)) {
    return pkgData.browser
  }
  if (is.object(pkgData.browser)) {
    const cleanBase = baseMod.replace(/^\.\//, '')
    const browserField = pkgData.browser as MapOf<string>
    const lookupKeys = [baseMod, `./${cleanBase}`, cleanBase]
    const matchedOverride = lookupKeys.find(key => browserField[key])
    return matchedOverride ? browserField[matchedOverride] : baseMod
  }
  return baseMod
}

export async function initImportMap() {
  const pkg = require('~/package.json')
  const map = Bakery.config.importMap || {}
  const deps = pkg.dependencies || {}

  const resolvedMap: MapOf<string> = {}

  const imports = await Promise.all(
    Object.keys(deps).map(async dep => {
      const pkgData = await Try.silent(
        Bun.file(`./node_modules/${dep}/package.json`).json(),
      )

      return { dep, pkgData: pkgData as PackageJson | null }
    }),
  )

  for (const { dep, pkgData } of imports) {
    if (!pkgData) continue

    const actualName = pkgData.name || dep
    resolvedMap[`${actualName}/`] = `/_nm/${actualName}/`

    const baseMod = pkgData.module || pkgData.main || 'index.js'
    const mod = resolveDepModule(pkgData, baseMod)

    const finalMod = typeof mod === 'string' ? mod : 'index.js'
    resolvedMap[actualName] =
      `/_nm/${actualName}/${finalMod.replace(/^\.\//, '')}`
  }

  for (const [k, v] of Object.entries(map)) {
    const cleanKey = k.replace(/\*$/, '')
    const cleanVal = String(v).replace(/\*$/, '')

    if (
      cleanVal === '.server/client/utils' ||
      cleanVal === './.server/client/utils' ||
      cleanKey === '@client/utils'
    ) {
      resolvedMap[cleanKey] = '/_client/utils.js'
      continue
    }

    resolvedMap[cleanKey] = cleanVal
      .replace(/^\.(?=\/)/, '')
      .replace(/^(?!(?:\/|https?:\/\/))/, '/')
  }

  depMap = JSON.stringify({ imports: resolvedMap })
}

export namespace DOMTools {
  type ScriptOptions = Omit<InjectScript, 'src'>
  export function script(src: string | InjectScript, opts?: ScriptOptions) {
    const finalSrc = is.string(src) ? src : src.src
    opts = opts || (is.object(src) ? src : {})

    let tag = '<script '

    tag += `src="${finalSrc}" `
    if (opts.module) tag += 'type="module" '
    if (opts.async) tag += 'async '
    if (opts.defer) tag += 'defer '

    tag += '></script>'

    return `${tag}`
  }

  export function style(href: string) {
    if (href.startsWith('http') || href.startsWith('//')) {
      return `<link rel="stylesheet" href="${href}" />`
    }

    if (href.startsWith('/')) {
      return `<link rel="stylesheet" href="${href}" />`
    }

    const path = relative(Bakery.serveRoot, href)
    return `<link rel="stylesheet" href="/${path}" />`
  }

  export function speculation() {
    return `<script type="speculationrules">${specString}</script>`
  }

  export function importMap() {
    return `<script type="importmap">${depMap}</script>`
  }

  export function params(params: MapOf<string>) {
    const json = JSON.stringify(params).replace(/</g, '\\u003c')
    return `<script>window.__PAGE_PARAMS__ = ${json}</script>`
  }

  type HTMLContent = {
    content: string
    responseInit: ResponseInit & { headers?: any }
  }

  const RX_IS_HTML = /<[a-z/][\s\S]*>/i

  async function checkBlobHtml(data: Blob): Promise<string> {
    const isMimeHtml = data.type.startsWith('text/html')
    const sample = isMimeHtml ? '' : await data.slice(0, 512).text()
    const isHtml = isMimeHtml || RX_IS_HTML.test(sample)
    return isHtml ? await data.text() : ''
  }

  async function checkResponseHtml(
    data: Response,
  ): Promise<{ html: string; init: ResponseInit }> {
    const contentType = data.headers.get('content-type') || ''
    const isMimeHtml = contentType.includes('text/html')

    let isHtml = isMimeHtml
    if (!isHtml && data.body) {
      const cloned = data.clone()
      const reader = cloned.body?.getReader()
      if (reader) {
        const result = await reader.read()
        const sample = new TextDecoder().decode(result.value?.slice(0, 512))
        isHtml = RX_IS_HTML.test(sample)
        reader.releaseLock()
      }
    }

    if (!isHtml) return { html: '', init: {} }

    const html = await data.text()
    const headers = new Headers(data.headers)
    headers.delete('content-length')

    return {
      html,
      init: {
        status: data.status,
        statusText: data.statusText,
        headers,
      },
    }
  }

  export async function isHTML(
    data: string | Response | Blob,
  ): Promise<HTMLContent> {
    if (is.string(data)) {
      const isHtml = RX_IS_HTML.test(data.slice(0, 512))
      return { content: isHtml ? data : '', responseInit: {} }
    }

    if (data instanceof Blob) {
      const html = await checkBlobHtml(data)
      return { content: html, responseInit: {} }
    }

    if (data instanceof Response) {
      const res = await checkResponseHtml(data)
      return { content: res.html, responseInit: res.init }
    }

    return { content: '', responseInit: {} }
  }
}
