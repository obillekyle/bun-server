import { matchDynamicRoute } from '../utils/router-utils';
import { injectIfHtml } from '../utils/html-utils';
import { tryCatch, jsonResponse, processBody } from '../utils';
import { serveLog, errorMsg, getElapsed } from '../serve-log';

const isDevWorker = process.argv.includes('--dev-worker');

export async function handleApi(
  req: Request,
  path: string,
  now: number,
  server: any,
): Promise<Response> {
  const endpoint = path.replace('/api/', '');

  if (!/^[a-zA-Z0-9_/ \-]+$/.test(endpoint)) {
    return jsonResponse.object(400, 'Invalid endpoint name') as Response;
  }

  const body = await processBody(req);

  let data: any = {
    time: getElapsed(now),
    status: 404,
    message: 'Endpoint not found for ' + endpoint,
  };

  let apiModule: any = null;
  let apiFileExists = false;
  let foundApiPath = '';
  let params: Record<string, string> = {};

  for (const ext of ['.ts', '.tsx']) {
    const checkPath = `./api/${endpoint}${ext}`;
    if (await Bun.file(checkPath).exists()) {
      apiFileExists = true;
      foundApiPath = checkPath;
      break;
    }
  }

  if (!apiFileExists) {
    const segments = endpoint.split('/').filter(Boolean);
    const matched = matchDynamicRoute('./api', segments);
    if (matched) {
      apiFileExists = true;
      foundApiPath =
        './api/' +
        matched.targetPath
          .replace(/\\/g, '/')
          .replace(/^\.\//, '')
          .replace(/^api\//, '');
      params = matched.params;
    }
  }

  if (apiFileExists) {
    const [err, mod] = await tryCatch(
      import(process.cwd() + foundApiPath.slice(1)),
    );

    if (err) {
      serveLog.API_IMPORT_ERR({ file: foundApiPath, error: errorMsg(err) });
      return jsonResponse.object(500, `Internal Server Error`) as Response;
    }

    apiModule = mod;
  }

  if (apiModule) {
    if (typeof apiModule.default !== 'function') {
      serveLog.API_IMPORT_ERR({
        file: foundApiPath,
        error: 'Default export must be a function',
      });
      return jsonResponse.object(500, `Internal Server Error`) as Response;
    }
    (req as any).params = params;
    data = await apiModule.default(req, body, server);
  }

  const injectedRes = await injectIfHtml(data, isDevWorker);
  if (injectedRes) return injectedRes;

  return match(typeof data, {
    string: () => new Response(String(data)),
    number: () => new Response(String(data)),
    object: () => {
      assert(typeof data === 'object');
      if (data === null) return new Response('null');
      if (data instanceof Response) return data;
      if (data instanceof Blob) return new Response(data);

      data.time ||= getElapsed(now);
      return Response.json(data, { status: data.status || 200 });
    },
    [match.default]: () => new Response('No content', { status: 404 }),
  });
}
