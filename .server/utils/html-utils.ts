import { existsSync } from 'node:fs';
import { serverConfig } from '../utils/config';

const jsMod = (src = '') => `\n <script type="module" src="${src}"></script>\n`;
const jsMap = (map: any) =>
  `\n <script type="importmap">\n${JSON.stringify({ imports: map }, null, 2)}\n</script>\n`;

export function assembleHtml(
  html: string,
  isDevWorker: boolean,
  targetPath?: string,
) {
  const styles: string[] = (serverConfig as any).styles || [];
  const scripts: any[] = (serverConfig as any).scripts || [];

  let headInjects = jsMod('/_client/utils.js');
  let bodyInjects = '';

  if (isDevWorker) {
    headInjects += jsMod('/_client/livereload.js');
  }

  // Look for adjacent .css and .ts files if targetPath is provided
  if (targetPath && targetPath.endsWith('.tsx')) {
    const cleanPath = targetPath.replace(/^\.\//, '').replace(/\\/g, '/');
    const basePath = cleanPath.slice(0, -4); // remove .tsx
    const cssPath = basePath + '.css';
    const tsPath = basePath + '.ts';

    if (existsSync(cssPath)) {
      headInjects += `\n  <link rel="stylesheet" href="/${cssPath}" />`;
    }
    if (existsSync(tsPath)) {
      headInjects += `\n  <script type="module" src="/${basePath}.js"></script>`;
    }
  }

  for (const href of styles) {
    headInjects += `\n  <link rel="stylesheet" href="${href}" />`;
  }

  for (const script of scripts) {
    let tag = '<script ';
    let placeInBody = false;

    switch (typeof script) {
      case 'string':
        tag += `src="${script}" defer></script>`;
        break;
      case 'object':
        tag += `src="${script.src}" `;
        script.module && (tag += 'type="module" ');
        script.async && (tag += 'async ');
        script.defer && (tag += 'defer ');
        tag += '></script>';
        placeInBody = !!script.inBody;
        break;
    }

    switch (true) {
      case placeInBody:
        bodyInjects += `\n  ${tag}`;
        break;
      default:
        headInjects += `\n  ${tag}`;
        break;
    }
  }

  const importMap = serverConfig.importMap || {};

  html = /(<head[^>]*>)/i.test(html)
    ? html.replace(/(<head[^>]*>)/i, '$1' + jsMap(importMap) + headInjects)
    : jsMap(importMap) + headInjects + '\n' + html;

  html = /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, bodyInjects + '\n</body>')
    : html + '\n' + bodyInjects;

  return html;
}

export async function injectIfHtml(
  data: any,
  isDevWorker: boolean,
  targetPath?: string,
): Promise<Response | null> {
  switch (true) {
    case typeof data === 'string' && data.trim().startsWith('<'):
      const htmlStr = assembleHtml(data, isDevWorker, targetPath);
      return new Response(htmlStr, {
        headers: { 'Content-Type': 'text/html' },
      });

    case data instanceof Response:
      if (data.headers.get('content-type')?.includes('text/html')) {
        const text = await data.text();
        const htmlStr = assembleHtml(text, isDevWorker, targetPath);

        const newHeaders = new Headers(data.headers);
        newHeaders.delete('content-length');

        return new Response(htmlStr, {
          status: data.status,
          statusText: data.statusText,
          headers: newHeaders,
        });
      }
      break;

    case data instanceof Blob:
      if (data.type.includes('text/html')) {
        const text = await data.text();
        const htmlBlob = assembleHtml(text, isDevWorker, targetPath);
        return new Response(htmlBlob, {
          headers: { 'Content-Type': 'text/html' },
        });
      }
      break;
  }
  return null;
}
