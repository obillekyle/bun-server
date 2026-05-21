import { statSync } from 'fs';
import { dirname, relative, resolve } from 'path';

const ROOT = import.meta.dir;

const transpiler = new Bun.Transpiler({
  loader: 'ts',
  inline: true,
  trimUnusedImports: true,
  minifyWhitespace: true,
  target: 'browser',
});

export async function compile(path: string): Promise<string> {
  const source = await Bun.file(path).text();
  let output = transpiler.transformSync(source);
  const fileDir = dirname(path);

  output = output.replace(
    /\b(from|import)\s*(["'])(\.\.?\/[^"']+)\2/g,
    (match, keyword, quote, importPath) => {
      const fileName = importPath.split('/').pop() || '';
      const hasExtension = fileName.includes('.');

      const targetPath = resolve(fileDir, importPath);
      let isDir = false;

      try {
        isDir = statSync(targetPath).isDirectory();
      } catch {}

      let webPath = relative(ROOT, targetPath).replace(/\\/g, '/');

      switch (true) {
        case !webPath.startsWith('/'):
          webPath = '/' + webPath;
          break;
      }

      switch (true) {
        case hasExtension:
          return `${keyword}${quote}${webPath}${quote}`;

        default:
          return `${keyword}${quote}${webPath}${isDir ? '/index' : ''}.js${quote}`;
      }
    },
  );

  return output;
}

export async function bundleModule(
  modulePath: string,
  isDevWorker: boolean,
): Promise<{ success: boolean; content?: string }> {
  const build = await Bun.build({
    entrypoints: [modulePath],
    target: 'browser',
    format: 'esm',
    minify: !isDevWorker,
  });

  if (build.success && build.outputs.length > 0) {
    return { success: true, content: await build.outputs[0].text() };
  }

  return { success: false };
}

