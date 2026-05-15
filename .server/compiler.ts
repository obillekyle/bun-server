#!/usr/bin/env bun

import { statSync, watch } from 'fs';
import { readdir, stat, unlink } from 'fs/promises';
import { dirname, extname, join, relative, resolve } from 'path';

const ROOT = import.meta.dir;
const REBUILD_DELAY = 150;

const skipDir = new Set(['.git', '.vscode', 'node_modules', 'uploads']);
const skipRootTs = new Set(['compile.ts', 'server.ts']);

const transpiler = new Bun.Transpiler({
  loader: 'ts',
  inline: true,
  trimUnusedImports: true,
  minifyWhitespace: true,
  target: 'browser',
});

const isTsFile = (filePath: string): boolean =>
  extname(filePath) === '.ts' && !filePath.endsWith('.d.ts');

const toJsFile = (filePath: string): string => filePath.slice(0, -3) + '.js';

const gatherTs = async (
  dirPath: string,
  out: string[] = [],
): Promise<string[]> => {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!skipDir.has(entry.name)) {
        await gatherTs(fullPath, out);
      }
      continue;
    }

    if (entry.isFile() && isTsFile(fullPath)) {
      const relPath = relative(ROOT, fullPath).replace(/\\/g, '/');

      if (skipRootTs.has(relPath)) {
        continue;
      }

      out.push(fullPath);
    }
  }

  return out;
};

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

export const compileFile = async (filePath: string): Promise<void> => {
  const output = await compile(filePath);
  const target = toJsFile(filePath);
  await Bun.write(target, output);

  console.log(
    `[compile] ${relative(ROOT, filePath)} -> ${relative(ROOT, target)}`,
  );
};

export const compileAll = async (): Promise<void> => {
  const files = await gatherTs(ROOT);

  for (const filePath of files) {
    await compileFile(filePath);
  }

  console.log(`[compile] done (${files.length} files)`);
};

export const startCompileService = async (
  options: { watch?: boolean } = {},
): Promise<{ close: () => void }> => {
  await compileAll();

  if (!options.watch) {
    return { close: () => {} };
  }

  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(ROOT, { recursive: true }, async (_, changed) => {
    const relPath = changed?.replace(/\\/g, '/') || '';

    if (!changed || !isTsFile(changed) || skipRootTs.has(relPath)) {
      return;
    }

    const filePath = resolve(ROOT, changed);

    try {
      const fileStat = await stat(filePath);

      if (!fileStat.isFile()) {
        return;
      }

      if (rebuildTimer) {
        clearTimeout(rebuildTimer);
      }

      rebuildTimer = setTimeout(async () => {
        try {
          await compileFile(filePath);
        } catch (err) {
          console.error(
            `[compile] failed ${relative(ROOT, filePath)}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }, REBUILD_DELAY);
    } catch {
      const jsPath = toJsFile(filePath);
      const jsFile = Bun.file(jsPath);

      if (await jsFile.exists()) {
        await unlink(jsPath);
        console.log(`[compile] removed ${relative(ROOT, jsPath)}`);
      }
    }
  });

  return {
    close: () => watcher.close(),
  };
};

if (import.meta.main) {
  const watchMode = process.argv.includes('--watch');
  const service = await startCompileService({ watch: watchMode });

  if (!watchMode) {
    service.close();
    process.exit(0);
  }

  process.on('SIGINT', () => {
    console.log('\n[compile] shutting down');
    service.close();
    process.exit(0);
  });
}
