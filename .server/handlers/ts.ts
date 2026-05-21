import { jsCache, MAX_CACHE_SIZE } from '../utils/cache';
import { compile } from '../compiler';

export async function handleTS(targetPath: string): Promise<Response> {
  let content = jsCache.get(targetPath);

  if (!content) {
    content = await compile(targetPath);
    if (jsCache.size >= MAX_CACHE_SIZE) {
      jsCache.clear();
    }

    jsCache.set(targetPath, content);
  }

  return new Response(content, {
    headers: { 'Content-Type': 'application/javascript' },
  });
}
