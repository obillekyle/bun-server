import { Bakery } from '@server/core/bakery'
import { is } from '@server/utils/common/misc'

type Server = Bun.Server<any>

export const Fragment = ({ children }: { children?: any }) => {
  return is.array(children) ? children.flat(Infinity).join('') : children || ''
}

export const Comment = ({ children }: { children?: any }) => {
  const content = is.array(children)
    ? children.flat(Infinity).join('')
    : children || ''

  return `<!-- ${content} -->`
}

export const createElement = (
  tag: any,
  props: MapOf<any> | null,
  ...children: any[]
): string => {
  if (is.function(tag)) return tag({ ...props, children })

  const childStr = children
    .flat(Infinity)
    .map(c => {
      switch (true) {
        case c === null:
        case c === undefined:
        case is.boolean(c):
          return ''
        default:
          return c
      }
    })
    .join('')

  let attrStr = ''
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'children') continue
    if (value === false || value === null || value === undefined) continue

    if (value === true) {
      attrStr += ` ${key}`
      continue
    }

    let attrKey = key

    switch (true) {
      case key === 'className':
        attrKey = 'class'
        break
      case key === 'htmlFor':
        attrKey = 'for'
        break
    }

    const safeValue = String(value).replace(/"/g, '&quot;')
    attrStr += ` ${attrKey}="${safeValue}"`
  }

  const isVoid = [
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ].includes(tag)

  return isVoid
    ? `<${tag}${attrStr}>`
    : `<${tag}${attrStr}>${childStr}</${tag}>`
}

type RenderFn = (
  req: Request,
  body: MapOf<any>,
  server: Server,
) => string | Promise<string> | Promise<Response> | Response

export function html(render: RenderFn) {
  return async (req: Request, body: MapOf<any>) => {
    const rawDom = await render(req, body, Bakery.server!)

    if (rawDom instanceof Response) {
      return rawDom
    }

    switch (true) {
      case rawDom.trim().toLowerCase().startsWith('<html'):
        return `<!DOCTYPE html>\n${rawDom}`
      case rawDom.trim().toLowerCase().startsWith('<!doctype'):
        return rawDom
      default: {
        let title = 'Document'
        const dom = rawDom.replace(/<title>(.*?)<\/title>/i, (_, t) => {
          title = t
          return ''
        })

        return `
          <!DOCTYPE html>
          <html>
            <head>
              <title>${title}</title>
            </head>
            <body>
              ${dom}
            </body>
          </html>
        `
      }
    }
  }
}
