import { compile } from '../compiler';
import { jsCache } from '../utils/cache';

const lrScript = './.server/client/livereload.ts';
const clientUtils = './.server/client/utils.ts';
const isDevWorker = process.argv.includes('--dev-worker');

export async function handleVirtualAsset(
  path: string,
): Promise<Response | null> {
  switch (path) {
    case '/_client/utils.js': {
      let content = jsCache.get(clientUtils);

      if (!content) {
        content = await compile(clientUtils).catch(() => '');
        content && jsCache.set(clientUtils, content);
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
    case '/_client/livereload.js': {
      if (!isDevWorker) return null;

      let content = jsCache.get(lrScript);

      if (!content) {
        content = await compile(lrScript).catch(() => '');
        content && jsCache.set(lrScript, content);
      }

      return new Response(content, {
        headers: {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-cache',
        },
      });
    }
    default:
      return null;
  }
}
