type Server = Bun.Server<any>;

// 1. The Fragment Handler
export const Fragment = ({ children }: { children?: any }) => {
  switch (true) {
    case Array.isArray(children):
      return children.flat(Infinity).join('');
    case !!children:
      return children;
    default:
      return '';
  }
};

// 2. The JSX-to-String Engine
export const createElement = (
  tag: any,
  props: Record<string, any> | null,
  ...children: any[]
): string => {
  switch (true) {
    case typeof tag === 'function':
      return tag({ ...props, children });
  }

  const childStr = children
    .flat(Infinity)
    .map((c) => {
      switch (true) {
        case c === null:
        case c === undefined:
        case typeof c === 'boolean':
          return '';
        default:
          return c;
      }
    })
    .join('');

  let attrStr = '';
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      switch (true) {
        case key === 'children':
          continue;
        case value === true:
          attrStr += ` ${key}`;
          break;
        case value !== false && value !== null && value !== undefined:
          let attrKey = key;

          // Map React-isms to standard HTML, but allow standard HTML too!
          switch (true) {
            case key === 'className':
              attrKey = 'class';
              break;
            case key === 'htmlFor':
              attrKey = 'for';
              break;
          }

          const safeValue = String(value).replace(/"/g, '&quot;');
          attrStr += ` ${attrKey}="${safeValue}"`;
          break;
      }
    }
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
  ].includes(tag);

  switch (true) {
    case isVoid:
      return `<${tag}${attrStr}>`;
    default:
      return `<${tag}${attrStr}>${childStr}</${tag}>`;
  }
};

// 3. The Endpoint Wrapper
type RenderFn = (
  req: Request,
  body: Record<string, any>,
  server: Server,
) => string | Promise<string>;

export function html(render: RenderFn) {
  return async (req: Request, body: Record<string, any>, server: Server) => {
    const rawDom = await render(req, body, server);

    switch (true) {
      // Auto-inject doctype if they return a full document!
      case rawDom.trim().toLowerCase().startsWith('<html'):
        return '<!DOCTYPE html>\n' + rawDom;
      default:
        return rawDom;
    }
  };
}
