import { Database } from 'bun:sqlite';

const dbEnvPath = process.env.DB_PATH || import.meta.env.DB_PATH || '';

let dbPath = process.cwd() + '/' + (dbEnvPath || '.database/server.db');
dbPath = dbEnvPath === ':memory:' ? dbEnvPath : dbPath;

export const connection = new Database(dbPath, { create: true });
