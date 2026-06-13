import { Database } from 'bun:sqlite'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path/posix'
import { Bakery } from '@server/core/bakery'

const dbFilePath = `${Bakery.dataDir}/shared-cache.db`
await mkdir(dirname(dbFilePath), { recursive: true })

export const cacheDb = new Database(dbFilePath, { create: true })
cacheDb.run('PRAGMA journal_mode = WAL;')
cacheDb.run('PRAGMA synchronous = NORMAL;')
cacheDb.run('PRAGMA temp_store = memory;')
cacheDb.run('PRAGMA cache_size = -2000;')
cacheDb.run('PRAGMA busy_timeout = 5000;')
cacheDb.run('PRAGMA mmap_size = 0;')
