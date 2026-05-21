import { serverConfig } from '../utils/config';
import { tryCatch, jsonResponse } from '../utils';
import { serveLog } from '../serve-log';

export async function handleProxy(
  req: Request,
  path: string,
  url: URL,
): Promise<Response | null> {
  const proxyEntries = Object.entries(serverConfig.proxy || {});
  let proxyUrl = '';
  for (const [prefix, target] of proxyEntries) {
    if (path.startsWith(prefix)) {
      const trailingPath = path.substring(prefix.length);
      const baseTarget = target.endsWith('/') ? target.slice(0, -1) : target;

      proxyUrl =
        baseTarget +
        (trailingPath.startsWith('/') ? '' : '/') +
        trailingPath +
        url.search;
      break;
    }
  }

  if (proxyUrl) {
    serveLog.PROXY_REQ({ path, target: proxyUrl });

    const proxyHeaders = new Headers(req.headers);
    proxyHeaders.delete('accept-encoding');
    proxyHeaders.delete('host');

    const proxyReq = new Request(proxyUrl, {
      method: req.method,
      headers: proxyHeaders,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
    });

    const [proxyErr, proxyRes] = await tryCatch(fetch(proxyReq));
    if (proxyErr) {
      const msg = proxyErr.message || 'Unable to connect to proxy target.';
      return jsonResponse.object(502, 'Bad Gateway: ' + msg) as Response;
    }

    const resHeaders = new Headers(proxyRes.headers);
    resHeaders.delete('content-encoding');
    return new Response(proxyRes.body, {
      status: proxyRes.status,
      statusText: proxyRes.statusText,
      headers: resHeaders,
    });
  }

  return null;
}
