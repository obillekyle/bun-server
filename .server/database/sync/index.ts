import '@server/core/init'

import { Logger, messageLogger } from '@server/logger'
import { Try } from '@server/utils'
import { connection, initializeDatabaseConnection } from '../connection'
import type * as SyncTypes from './types'

const logger = new Logger('db-sync')

const syncMsgs = {
  INVALID_SCHEMA: 'W %yschema.ts is invalid or corrupt. Treating as new.%*',
  NO_DBINFO: 'W %yDBInfo namespace not found in schema.ts!%*',
} as const

const MESSAGES = messageLogger(logger, syncMsgs)

export async function syncSQLSchema() {
  await initializeDatabaseConnection()
  const schemaPath = `${process.cwd()}/schema.ts`
  const schemaFile = Bun.file(schemaPath)

  let constraints: SyncTypes.DBConstraints = {}
  let tsIndexes: SyncTypes.DBIndexes = {}

  if (await schemaFile.exists()) {
    const [err, schemaModule] = await Try.catch(
      import(`${schemaPath}?t=${Date.now()}`),
    )

    if (err) MESSAGES.INVALID_SCHEMA()

    if (schemaModule?.DBInfo) {
      constraints = schemaModule.DBInfo.constraints ?? {}
      tsIndexes = schemaModule.DBInfo.indexes ?? schemaModule.indexes ?? {}
    } else if (!err) {
      MESSAGES.NO_DBINFO()
    }
  }

  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
Usage: bun run db:sync [--choose=db|ts] [--dry-run] [--force-sync] [--help]

Flags:
  --choose=db     Generate schema.ts from the database (DB wins)
  --choose=ts     Apply schema.ts to the database (TS wins, default)
  --dry-run       Preview planned changes without applying them
  --force-sync    In production, allow destructive changes
  --help, -h      Show this help message
`)
    return
  }

  await connection.syncSchema(constraints, tsIndexes, schemaPath)
}

if (import.meta.main) {
  await syncSQLSchema()
  process.exit(0)
}
