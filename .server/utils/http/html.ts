import { Bakery } from '@server/core/bakery'
import { is } from '../common/misc'
import { DOMTools } from './dom'
import { ETag } from './etag'

function injectBrand(res: Response) {
  return Object.defineProperty(res, '__injected__', {
    value: true,
    enumerable: false,
  })
}

function isInjected(res: Response) {
  return (res as any).__injected__
}

export async function injectIfHtml(
  data: string | Response | Blob,
  params?: MapOf<string>,
): Promise<Response | null> {
  if (data instanceof Response && isInjected(data)) return data

  const { content, responseInit } = await DOMTools.isHTML(data)
  if (!content) return null

  const headers = new Headers(responseInit?.headers)
  const html = assembleHtml(content, params)

  headers.set('Content-Type', 'text/html; charset=utf-8')
  headers.set('ETag', ETag.fromText(html))

  const response = new Response(html, {
    ...responseInit,
    headers,
  })

  return injectBrand(response)
}

const RX_CURLY_PARAMS = /{{\s*([^,\s}]+)(?:\s*,\s*([^}]+))?\s*}}/g
const RX_HEAD_TAG = /<head[^>]*>/i
const RX_BODY_END = /<\/body>/i

export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function assembleHtml(content: string, params?: MapOf<string>) {
  const styles: string[] = []
  const injects: string[] = []
  const scripts: string[] = [
    DOMTools.importMap(),
    DOMTools.speculation(),
    DOMTools.params(params || {}),
    DOMTools.script('/_client/utils.js', { module: true }),
  ]

  if (import.meta.env.DEV) {
    scripts.push(DOMTools.script('/_client/livereload.js', { module: true }))
  }

  for (const style of Bakery.config.styles) {
    styles.push(DOMTools.style(style))
  }

  for (const script of Bakery.config.scripts) {
    const tag = DOMTools.script(script)
    const inBody = is.object(script) && script.inBody

    inBody ? injects.push(tag) : scripts.push(tag)
  }

  const headInjects = styles.join('') + scripts.join('')
  const bodyInjects = injects.join('')

  let html = content

  html = RX_HEAD_TAG.test(html)
    ? html.replace(RX_HEAD_TAG, `$&${headInjects}`)
    : headInjects + html

  html = RX_BODY_END.test(html)
    ? html.replace(RX_BODY_END, `${bodyInjects}$&`)
    : html + bodyInjects

  RX_CURLY_PARAMS.lastIndex = 0
  html = html.replace(RX_CURLY_PARAMS, (_, key, fallback) => {
    const val = params?.[key] ?? fallback?.trim()
    return val !== undefined ? escapeHtml(val) : `{{${key}}}`
  })

  return html
}
