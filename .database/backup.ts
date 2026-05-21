import { Logger, messageLogger } from '@server/logger';
import { tryCatch } from '@server/utils';
import { mkdir, copyFile, readdir } from 'fs/promises';
import path from 'path';
import config from '../server.config';
import { connection } from './conn';

const MESSAGES = messageLogger(new Logger('db-backup'), {
  BACKUP_CREATED: 'I Created database backup: {file}',
  BACKUP_FAILED: 'E Failed to create database backup: {error}',
  BACKUP_CLEANUP: 'I Auto-deleted {count} old backup(s) to maintain limit.',
} as const);

export async function backupDatabase(currentDbVersion: number) {
  const dbPath = connection.filename;

  // Skip in-memory databases
  if (dbPath === ':memory:' || !dbPath) {
    return;
  }

  const ext = path.extname(dbPath);
  const base = path.basename(dbPath, ext);
  const backupDir = path.dirname(dbPath) + '/.backups';

  const timestamp = Date.now();
  const backupName = `${base}.v${currentDbVersion}.${timestamp}${ext}`;
  const backupPath = backupDir + '/' + backupName;

  const [err] = await tryCatch(async () => {
    await mkdir(backupDir, { recursive: true });

    if (await Bun.file(dbPath).exists()) {
      await copyFile(dbPath, backupPath);
      MESSAGES.BACKUP_CREATED({ file: backupName });

      const configCount = config.backups ?? 10;

      if (configCount > 0) {
        const files = await readdir(backupDir);
        
        // Escape special characters in base name and extension for Regex matching
        const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^${escapedBase}\\.v${currentDbVersion}\\.(\\d+)${escapedExt}$`);

        const backupFiles = files
          .map((f) => {
            const match = f.match(regex);
            return match ? { name: f, time: Number(match[1]) || 0 } : null;
          })
          .filter((item): item is { name: string; time: number } => item !== null)
          .sort((a, b) => b.time - a.time);

        const oldBackups = backupFiles.slice(configCount);

        if (oldBackups.length > 0) {
          await Promise.all(
            oldBackups.map((backup) =>
              Bun.file(backupDir + '/' + backup.name).delete(),
            ),
          );
          MESSAGES.BACKUP_CLEANUP({ count: oldBackups.length });
        }
      }
    }
  });

  if (err) {
    MESSAGES.BACKUP_FAILED({ error: err.message });
  }
}

