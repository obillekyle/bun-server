import { serverConfig } from '../utils/config';
import { tryCatch, jsonResponse } from '../utils';
import { serveLog, errorMsg } from '../serve-log';
import { injectIfHtml } from '../utils/html-utils';

export async function handleMiddleware(
  req: Request,
  server: any,
  isDevWorker: boolean,
): Promise<Response | null> {
  for (const middleware of serverConfig.middleware || []) {
    const [mErr, mRes] = await tryCatch(middleware(req, server));
    if (mErr) {
      serveLog.UNHANDLED_ERR({ error: 'Middleware error: ' + errorMsg(mErr) });
      return jsonResponse.object(500, 'Internal Server Error') as Response;
    }
    if (mRes instanceof Response) {
      const injectedRes = await injectIfHtml(mRes, isDevWorker);
      return injectedRes || mRes;
    }
  }

  const intercepted = await serverConfig.onRequest?.(req, server);

  if (intercepted) {
    const injectedRes = await injectIfHtml(intercepted, isDevWorker);
    if (injectedRes) return injectedRes;
    if (intercepted instanceof Response) return intercepted;
  }

  return null;
}
