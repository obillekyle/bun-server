import { tryCatch, jsonResponse, processBody } from '../utils';
import { serveLog, errorMsg } from '../serve-log';
import { injectIfHtml } from '../utils/html-utils';

export async function handleTSX(
  req: Request,
  targetPath: string,
  server: any,
  isDevWorker: boolean,
  params: Record<string, string>,
): Promise<Response> {
  const modulePath = process.cwd() + '/' + targetPath.replace(/^\.\//, '');
  const [error, tsxModule] = await tryCatch(import(modulePath));

  if (error) {
    serveLog.TSX_IMPORT_ERR({ file: targetPath, error: errorMsg(error) });
    return jsonResponse.object(500, `Internal Server Error`) as Response;
  }

  if (typeof tsxModule.default !== 'function') {
    serveLog.TSX_EXPORT_NOT_FUNCTION({ file: targetPath });
    return jsonResponse.object(500, 'Internal Server Error') as Response;
  }

  const body = await processBody(req);
  (req as any).params = params;
  let data = await tsxModule.default(req, body, server);

  const injectedRes = await injectIfHtml(data, isDevWorker, targetPath);

  if (injectedRes) return injectedRes;
  if (typeof data === 'string')
    return new Response(data, {
      headers: { 'Content-Type': 'text/plain' },
    });

  if (data instanceof Response) return data;
  return Response.json(data);
}
