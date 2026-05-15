import { Database } from 'bun:sqlite';

export const connection = new Database(import.meta.dir + '/server.db', {
  create: true,
});
