import { jsCache, MAX_CACHE_SIZE } from '../utils/cache';
import { serveLog } from '../serve-log';
import { bundleModule } from '../compiler';

export async function handleNodeModule(
  targetPath: string,
  isDevWorker: boolean,
): Promise<Response> {
  const modulePath = targetPath.replace(/^\.\//, '');
  if (!(await Bun.file(modulePath).exists())) {
    return new Response('Not Found', { status: 404 });
  }

  const cacheKey = `nm:${modulePath}`;
  let content = jsCache.get(cacheKey);

  if (!content) {
    const build = await bundleModule(modulePath, isDevWorker);

    if (build.success && build.content) {
      content = build.content;
      if (jsCache.size >= MAX_CACHE_SIZE) jsCache.clear();
      jsCache.set(cacheKey, content);
    } else {
      serveLog.UNHANDLED_ERR({ error: `Failed to bundle ${modulePath}` });
      return new Response(Bun.file(modulePath));
    }
  }

  return new Response(content, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': isDevWorker
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    },
  });
}
