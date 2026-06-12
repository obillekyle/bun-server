import { Logger, messageLogger } from '@server/logger'
import type { DBAdapter } from '../adapters/base'
import { generateSchemaFile } from './builder'
import {
  buildSyncPlan,
  calculateIndexDiff,
  executeSyncPlan,
  hasOldWrappers,
  logPlannedChanges,
} from './helpers'
import type * as SyncTypes from './types'

// prettier-ignore
export const syncMsgs = {
  GEN_TYPES: 'I Generating types...',
  SYNC_SUCCESS: 'I %gschema.ts successfully synced%* to Database!',
  INVALID_SCHEMA: 'W %yschema.ts is invalid or corrupt. Treating as new.%*',
  NO_DBINFO: 'W %yDBInfo namespace not found in schema.ts!%*',
  PERFECT_SYNC: 'I %gschema.ts is perfectly synced%* with Database!',
  DB_NEWER: 'I Database is newer than TS. Generating types...',
  TS_NEWER: 'I %yschema.ts is newer! Syncing to the database...%*',
  BACKUP_CREATED: 'I Created database backup: %y{file}%*',
  NO_CONSTRAINTS:
    'E Could not find %rDBInfo.constraints%* in schema.ts to run the reverse sync!',
  COL_MISMATCH:
    "W Table '%y{table}%*' needs rebuild because of column '%y{column}%*' mismatch:",
  COL_MISMATCH_TS:
    'W   - TS: type=%c{tsType}%*, nullable=%c{tsNullable}%*, default=%c{tsDefault}%*',
  COL_MISMATCH_DB:
    'W   - DB: type=%c{dbType}%*, nullable=%c{dbNullable}%*, default=%c{dbDefault}%*',
  DANGER_ZONE: 'W %rDANGER ZONE: Destructive or major changes detected!%*',
  DROP_TABLES: 'W Tables to drop: %r{tables}%*',
  RENAME_TABLES: 'I Tables to rename: %y{tables}%*',
  DROP_COLS: 'W Columns to drop: %r{cols}%*',
  RENAME_COLS: 'I Columns to rename: %y{cols}%*',
  ADD_COLS: 'I Columns to add: %g{cols}%*',
  REBUILD_TABLES: 'W Tables to rebuild (schema modified): %r{tables}%*',
  UPDATE_VIEWS: 'I Views to update/recreate: %y{views}%*',
  DROP_INDEXES: 'I Indexes to drop: %r{indexes}%*',
  ADD_INDEXES: 'I Indexes to add: %g{indexes}%*',
  REVIEW_WARNING: 'W %yThese changes may affect data. Review carefully.%*',
  SYNC_ABORTED: 'I %ySync aborted. Your data is safe!%*',
  EXEC_RENAME_TABLE: 'I Renaming table: %y{oldName}%* -> %y{newName}%*...',
  EXEC_RENAME_COL:
    'I Renaming column: %y{table}.{oldColumn}%* -> %y{newColumn}%*...',
  EXEC_DROP_TABLE: 'I Dropping %y{type}%*: %r{table}%*...',
  EXEC_DROP_COL: 'I Dropping column: %r{table}.{column}%*...',
  EXEC_ADD_COL: 'I Adding column: %g{table}.{column}%*...',
  EXEC_DROP_INDEX: 'I Dropping index: %r{idx}%*...',
  EXEC_REBUILD:
    'I Rebuilding table to apply schema modifications: %y{table}%*...',
  EXEC_SYNC_VIEW: 'D Syncing view: %y{view}%*...',
  EXEC_SYNC_CONS: 'D Syncing constraints for: %y{table}%*...',
  EXEC_ADD_INDEX: 'I Creating %y{type}%* index: %g{name}%*...',
  CATCH_UP_SUCCESS: 'I %gDatabase successfully caught up%*!',
  PROD_FORCE_REQUIRED: 'E %rProduction requires %y--force-sync%* to proceed.%*',
  OVERRIDE_SCHEMA:
    'I %yschema.ts contains _oldTable/_transform wrappers. Overriding file to match DB.%*',
  FATAL_ERROR:
    'E %rFATAL ERROR: Sync failed! All changes have been safely rolled back. Detail: {error}%*',
} as const

const logger = new Logger('db-sync')
export const MESSAGES = messageLogger(logger, syncMsgs)

async function checkEmptyConstraints(
  adapter: DBAdapter,
  constraints: SyncTypes.DBConstraints,
  genLocal: (c?: any) => Promise<void>,
): Promise<boolean> {
  if (Object.keys(constraints).length) return false

  MESSAGES.NO_CONSTRAINTS()
  const dbConstraints = await adapter.getConstraints()

  if (Object.keys(dbConstraints).length) {
    MESSAGES.DB_NEWER()
    await genLocal(constraints)
  } else {
    console.log('Database and schema.ts are empty. Nothing to sync!')
  }

  if (process.env.DEV_WATCHER_ACTIVE && Object.keys(dbConstraints).length) {
    process.exit(42)
  }
  return true
}

function adjustSqlitePlan(adapter: DBAdapter, plan: any): void {
  if (adapter.driver !== 'sqlite' || !plan.columnsToRename.length) return

  for (const table of plan.tablesToRename) {
    plan.tablesToRebuild.add(table.oldName)
  }
  plan.columnsToRename = []
}

function evaluateChanges(plan: any, indexesToDrop: any, indexesToAdd: any) {
  const isDangerous = Boolean(
    plan.tablesToDrop.length ||
      plan.tablesToRename.length ||
      plan.columnsToDrop.length ||
      plan.columnsToRename.length ||
      plan.tablesToRebuild.size,
  )

  const hasChanges = Boolean(
    isDangerous ||
      plan.unmappedTsTables.size ||
      plan.columnsToAdd.length ||
      plan.viewsToUpdate.length ||
      indexesToDrop.size ||
      indexesToAdd.size,
  )

  return { isDangerous, hasChanges }
}

function handleSafetyChecks(isDangerous: boolean, argv: string[]): void {
  if (!isDangerous) return

  const isProd =
    process.env.NODE_ENV === 'production' || process.env.PROD === 'true'
  const force = argv.includes('--force-sync')

  if (!force)
    logger.log("I Tip: use '--choose=db', '--choose=ts', or '--dry-run'.")

  if (isProd && !force) {
    MESSAGES.PROD_FORCE_REQUIRED()
    process.exit(1)
  }

  if (!isProd && !force && !logger.confirm('Proceed with sync?')) {
    MESSAGES.SYNC_ABORTED()
    process.exit(0)
  }
}

class SyncSession implements AsyncDisposable {
  constructor(private adapter: DBAdapter) {}
  async [Symbol.asyncDispose]() {
    await (this.adapter as any).postSync?.(this.adapter)
  }
}

async function executeSyncPipeline(
  adapter: DBAdapter,
  plan: any,
  constraints: SyncTypes.DBConstraints,
  indexesToDrop: any,
  indexesToAdd: any,
  genLocal: (c?: any) => Promise<void>,
): Promise<void> {
  await import('../backup').then(m => m.backupDatabase(adapter))
  await (adapter as any).preSync?.(adapter)

  {
    await using _session = new SyncSession(adapter)
    await adapter.transaction(tx =>
      executeSyncPlan(
        tx,
        plan,
        constraints,
        indexesToDrop,
        indexesToAdd,
        MESSAGES,
      ),
    )
  }

  MESSAGES.CATCH_UP_SUCCESS()

  if (hasOldWrappers(constraints)) {
    MESSAGES.OVERRIDE_SCHEMA()
    await genLocal(constraints)
  }
}

export async function syncDatabaseSchema(
  adapter: DBAdapter,
  constraints: SyncTypes.DBConstraints,
  tsIndexes: SyncTypes.DBIndexes,
  schemaPath: string,
): Promise<void> {
  const genLocal = (c: any = {}) =>
    generateSchemaFile(adapter, schemaPath, MESSAGES, c)

  const isEmpty = await checkEmptyConstraints(adapter, constraints, genLocal)
  if (isEmpty) return

  const plan = await buildSyncPlan(adapter, constraints, logger, MESSAGES)
  adjustSqlitePlan(adapter, plan)

  const dbIndexes = await adapter.getIndexes()
  const { indexesToDrop, indexesToAdd } = calculateIndexDiff(
    dbIndexes,
    tsIndexes,
    plan.tablesToRebuild,
  )

  const { isDangerous, hasChanges } = evaluateChanges(
    plan,
    indexesToDrop,
    indexesToAdd,
  )

  if (!hasChanges) {
    MESSAGES.PERFECT_SYNC()
    return
  }

  const argv = process.argv
  if (argv.find(a => a.startsWith('--choose='))?.split('=')[1] === 'db') {
    MESSAGES.GEN_TYPES()
    return await genLocal(plan.dbConstraintsForDiff)
  }

  logPlannedChanges(plan, indexesToDrop, indexesToAdd, isDangerous, MESSAGES)

  if (argv.includes('--dry-run')) {
    logger.log('D Dry-run enabled: planned changes shown above, not applying.')
    return
  }

  handleSafetyChecks(isDangerous, argv)
  await executeSyncPipeline(
    adapter,
    plan,
    constraints,
    indexesToDrop,
    indexesToAdd,
    genLocal,
  )
}
