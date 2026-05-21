import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function matchDynamicRoute(
  currentDir: string,
  segments: string[],
  params: Record<string, string> = {},
): { targetPath: string; params: Record<string, string> } | null {
  if (segments.length === 0) {
    const indexFiles = ['index.tsx', 'index.html', 'index.ts', 'index.js'];
    for (const file of indexFiles) {
      const fullPath = join(currentDir, file);
      try {
        if (statSync(fullPath).isFile()) {
          return { targetPath: fullPath, params };
        }
      } catch {}
    }
    return null;
  }

  const segment = segments[0];
  const remaining = segments.slice(1);

  let entries: string[] = [];
  try {
    entries = readdirSync(currentDir);
  } catch {
    return null;
  }

  //  Exact match
  if (entries.includes(segment)) {
    const nextPath = join(currentDir, segment);
    try {
      const stat = statSync(nextPath);
      if (stat.isDirectory()) {
        const res = matchDynamicRoute(nextPath, remaining, params);
        if (res) return res;
      } else if (remaining.length === 0) {
        return { targetPath: nextPath, params };
      }
    } catch {}
  }

  //  Extension match
  if (remaining.length === 0) {
    for (const ext of ['.tsx', '.html', '.ts', '.js']) {
      const checkName = segment + ext;
      if (entries.includes(checkName)) {
        const fullPath = join(currentDir, checkName);
        try {
          if (statSync(fullPath).isFile()) {
            return { targetPath: fullPath, params };
          }
        } catch {}
      }
    }
  }

  //  Dynamic folder
  for (const entry of entries) {
    if (entry.startsWith('[') && entry.endsWith(']')) {
      const nextPath = join(currentDir, entry);
      try {
        const stat = statSync(nextPath);
        if (stat.isDirectory()) {
          const paramName = entry.slice(1, -1);
          const nextParams = { ...params, [paramName]: segment };
          const res = matchDynamicRoute(nextPath, remaining, nextParams);
          if (res) return res;
        }
      } catch {}
    }
  }

  //  Dynamic file
  if (remaining.length === 0) {
    for (const entry of entries) {
      const match = entry.match(/^\[([^\]]+)\]\.(ts|tsx|html|js)$/);
      if (match) {
        const paramName = match[1];
        const fullPath = join(currentDir, entry);
        try {
          if (statSync(fullPath).isFile()) {
            return {
              targetPath: fullPath,
              params: { ...params, [paramName]: segment },
            };
          }
        } catch {}
      }
    }
  }

  return null;
}

export async function resolveFileRoute(path: string, isNodeModule: boolean) {
  let targetPath = '.' + path;
  let file = Bun.file(targetPath);
  let stat = await file.stat().catch(() => null);
  let params: Record<string, string> = {};

  if (stat && !stat.isDirectory()) {
    return { targetPath, file, stat, params };
  }

  if (stat?.isDirectory()) {
    for (const ext of ['/index.tsx', '/index.html']) {
      const checkPath = targetPath + ext;
      if (await Bun.file(checkPath).exists()) {
        targetPath = checkPath;
        file = Bun.file(targetPath);
        stat = await file.stat().catch(() => null);
        return { targetPath, file, stat, params };
      }
    }
  }

  if (!stat && !path.split('/').pop()?.includes('.')) {
    for (const ext of ['.tsx', '.html']) {
      const checkPath = targetPath + ext;
      if (await Bun.file(checkPath).exists()) {
        targetPath = checkPath;
        file = Bun.file(targetPath);
        stat = await file.stat().catch(() => null);
        return { targetPath, file, stat, params };
      }
    }
  }

  if (!stat && !isNodeModule) {
    const checkPath = path.endsWith('.js')
      ? '.' + path.slice(0, -3) + '.ts'
      : '.' + path + '.ts';
    if (await Bun.file(checkPath).exists()) {
      targetPath = checkPath;
      file = Bun.file(targetPath);
      stat = await file.stat().catch(() => null);
      return { targetPath, file, stat, params };
    }
  }

  if (!stat && !isNodeModule) {
    const segments = path.split('/').filter(Boolean);
    const matched = matchDynamicRoute('./', segments);
    if (matched) {
      targetPath =
        './' + matched.targetPath.replace(/\\/g, '/').replace(/^\.\//, '');
      file = Bun.file(targetPath);
      stat = await file.stat().catch(() => null);
      params = matched.params;
    }
  }

  return { targetPath, file, stat, params };
}
