import { relative } from 'node:path/posix'
import { Bakery } from '@server/core/bakery'
import { is } from '../common/misc'
import { Try } from '../common/try'

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
  switch (true) {
    case is.string(pkgData.browser):
      return pkgData.browser as string

    case is.object(pkgData.browser): {
      const cleanBase = baseMod.replace(/^\.\//, '')
      const browserField = pkgData.browser as MapOf<string>
      const lookupKeys = [baseMod, `./${cleanBase}`, cleanBase]
      const matchedOverride = lookupKeys.find(key => browserField[key])

      return matchedOverride ? browserField[matchedOverride] : baseMod
    }

    default:
      return baseMod
  }
}

export async function initImportMap() {
  const pkg = require('~/package.json')
  const map = Bakery.config.importMap
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
    const isAbsoluteOrRoot =
      href.startsWith('http') || href.startsWith('//') || href.startsWith('/')

    return isAbsoluteOrRoot
      ? `<link rel="stylesheet" href="${href}" />`
      : `<link rel="stylesheet" href="/${relative(Bakery.serveRoot, href)}" />`
  }

  const EXCLUDED_TAGS = ['link', 'base', 'meta', 'script', 'style']
  const RX_HREF = new RegExp(
    `<(?!(?:${EXCLUDED_TAGS.join('|')})\\b)[a-z0-9-]+[^>]*?\\s+href=(["'])(.*?)\\1`,
    'gi',
  )

  export function speculation(html: string) {
    const urls = new Set<string>()

    for (const match of html.matchAll(RX_HREF)) {
      const url = match[2]?.trim()

      if (!url || url.startsWith('#') || url.includes(':')) continue

      const lower = url.toLowerCase()
      if (
        lower.includes('?utm_') ||
        lower.includes('?fbclid') ||
        lower.endsWith('.pdf') ||
        lower.endsWith('.zip')
      )
        continue

      urls.add(url)
    }

    if (urls.size === 0) return ''

    const specList = Array.from(urls)
    const specString = JSON.stringify({
      prefetch: [{ source: 'list', urls: specList, eagerness: 'eager' }],
      prerender: [{ source: 'list', urls: specList, eagerness: 'eager' }],
    })

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
  const RX_IS_SVG_XML = /^\s*<(\?xml|svg|math)/i

  function isHTMLType(contentType: string): boolean {
    return (
      contentType.startsWith('text/html') ||
      contentType.startsWith('application/xhtml+xml')
    )
  }

  async function checkBlobHtml(data: Blob): Promise<string> {
    const type = data.type || ''
    const isHtml = isHTMLType(type)

    return isHtml ? await data.text() : ''
  }

  async function checkResponseHtml(
    data: Response,
  ): Promise<{ html: string; init: ResponseInit }> {
    const contentType = data.headers.get('content-type') || ''
    const isHtml = isHTMLType(contentType)

    if (!isHtml) return { html: '', init: {} }

    const headers = new Headers(data.headers)
    headers.delete('content-length')

    return {
      html: await data.text(),
      init: { status: data.status, statusText: data.statusText, headers },
    }
  }

  export async function isHTML(
    data: string | Response | Blob,
  ): Promise<HTMLContent> {
    switch (true) {
      case is.string(data): {
        const sample = (data as string).slice(0, 512)
        const isHtml = RX_IS_HTML.test(sample) && !RX_IS_SVG_XML.test(sample)
        return { content: isHtml ? (data as string) : '', responseInit: {} }
      }

      case data instanceof Blob: {
        const html = await checkBlobHtml(data as Blob)
        return { content: html, responseInit: {} }
      }

      case data instanceof Response: {
        const res = await checkResponseHtml(data as Response)
        return { content: res.html, responseInit: res.init }
      }

      default:
        return { content: '', responseInit: {} }
    }
  }
}
