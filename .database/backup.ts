import { messageLogger } from '@server/logger';
import { tryCatch } from '@server/utils';
import { mkdir, copyFile, readdir } from 'fs/promises';
import config from '../server.config';

const MESSAGES = messageLogger(new Logger('db-backup'), {
  BACKUP_CREATED: 'I Created database backup: {file}',
  BACKUP_FAILED: 'E Failed to create database backup: {error}',
  BACKUP_CLEANUP: 'I Auto-deleted {count} old backup(s) to maintain limit.',
} as const);

export async function backupDatabase(currentDbVersion: number) {
  const dbPath = import.meta.dir + '/server.db';
  const backupDir = import.meta.dir + '/.backups';

  const timestamp = Date.now();
  const backupName = `server.v${currentDbVersion}.${timestamp}.db`;
  const backupPath = backupDir + '/' + backupName;

  const [err] = await tryCatch(async () => {
    await mkdir(backupDir, { recursive: true });

    if (await Bun.file(dbPath).exists()) {
      await copyFile(dbPath, backupPath);
      MESSAGES.BACKUP_CREATED({ file: backupName });

      const configCount = config.backups ?? 10;

      if (configCount > 0) {
        const files = await readdir(backupDir);
        const backupFiles = files
          .filter((f) => f.startsWith(`server.v${currentDbVersion}.`))
          .map((f) => ({ name: f, time: Number(f.split('.')[2]) || 0 }))
          .sort((a, b) => b.time - a.time);

        const oldBackups = backupFiles.slice(configCount);

        if (oldBackups.length > 0) return;

        await Promise.all(
          oldBackups.map((backup) =>
            Bun.file(backupDir + '/' + backup.name).delete(),
          ),
        );

        MESSAGES.BACKUP_CLEANUP({ count: oldBackups.length });
      }
    }
  });

  if (err) {
    MESSAGES.BACKUP_FAILED({ error: err.message });
  }
}
