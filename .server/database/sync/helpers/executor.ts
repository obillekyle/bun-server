import { Case } from '@server/utils/common'
import type { DBAdapter } from '../../adapters/base'
import { type ColumnConstraint, quoteIdentifier } from '../../adapters/base'
import type * as SyncTypes from '../types'
import type { SyncPlan } from './diff'

export function calculateIndexDiff(
  dbIndexes: SyncTypes.DBIndexes,
  tsIndexes: SyncTypes.DBIndexes,
  tablesToRebuild: Set<string>,
) {
  const indexesToDrop = new Set<string>()
  const indexesToAdd = new Map<string, SyncTypes.IndexConstraint>()

  for (const [dbIdxName, dbIdx] of Object.entries(dbIndexes)) {
    const tsIdx = tsIndexes[dbIdxName]
    const isRebuilt = tablesToRebuild.has(Case.snake(dbIdx.table))

    switch (true) {
      case Boolean(!tsIdx):
        indexesToDrop.add(Case.snake(dbIdxName))
        break
      case isRebuilt:
      case tsIdx.type !== dbIdx.type:
      case tsIdx.table !== dbIdx.table:
      case tsIdx.cols.join(',') !== dbIdx.cols.join(','):
        if (!isRebuilt) indexesToDrop.add(Case.snake(dbIdxName))
        indexesToAdd.set(Case.snake(dbIdxName), tsIdx)
        break
    }
  }

  for (const [tsIdxName, tsIdx] of Object.entries(tsIndexes)) {
    if (!dbIndexes[tsIdxName]) indexesToAdd.set(Case.snake(tsIdxName), tsIdx)
  }

  return { indexesToDrop, indexesToAdd }
}

export function logPlannedChanges(
  plan: SyncPlan,
  indexesToDrop: Set<string>,
  indexesToAdd: Map<string, SyncTypes.IndexConstraint>,
  isDangerous: boolean,
  MESSAGES: any,
) {
  if (isDangerous) MESSAGES.DANGER_ZONE()
  if (plan.tablesToDrop.length)
    MESSAGES.DROP_TABLES({ tables: plan.tablesToDrop.join(', ') })
  if (plan.tablesToRename.length)
    MESSAGES.RENAME_TABLES({
      tables: plan.tablesToRename
        .map(t => `${t.oldName} -> ${t.newName}`)
        .join(', '),
    })
  if (plan.columnsToDrop.length)
    MESSAGES.DROP_COLS({
      cols: plan.columnsToDrop.map(c => `${c.table}.${c.column}`).join(', '),
    })
  if (plan.columnsToRename.length)
    MESSAGES.RENAME_COLS({
      cols: plan.columnsToRename
        .map(c => `${c.table}.${c.oldColumn} -> ${c.newColumn}`)
        .join(', '),
    })
  if (plan.columnsToAdd.length)
    MESSAGES.ADD_COLS({
      cols: plan.columnsToAdd.map(c => `${c.table}.${c.column}`).join(', '),
    })
  if (plan.tablesToRebuild.size)
    MESSAGES.REBUILD_TABLES({
      tables: Array.from(plan.tablesToRebuild).join(', '),
    })
  if (plan.viewsToUpdate.length)
    MESSAGES.UPDATE_VIEWS({ views: plan.viewsToUpdate.join(', ') })
  if (indexesToDrop.size)
    MESSAGES.DROP_INDEXES({ indexes: Array.from(indexesToDrop).join(', ') })
  if (indexesToAdd.size > 0)
    MESSAGES.ADD_INDEXES({
      indexes: Array.from(indexesToAdd.keys()).join(', '),
    })
}

export async function processTableRebuild(
  tx: DBAdapter,
  table: string,
  constraints: SyncTypes.DBConstraints,
) {
  const camelTable = Case.camel(table)
  const tsTableObj = constraints[camelTable]
  const sourceDbTable = tsTableObj?._oldTable || table
  const tempName = `${table}_temp_build`

  const validCols = Object.entries(constraints[camelTable]).filter(
    ([n]) => !['_oldTable', '_transform'].includes(n),
  )
  const colDefs = validCols.map(
    ([name, cons]) =>
      `  ${quoteIdentifier(Case.snake(name), tx.quoteChar)} ${tx.colDef(cons)}`,
  )

  await tx.createTable(tempName, colDefs)

  const currentDbCols = new Set(
    (await tx.getSchema())
      .find(t => t.name === sourceDbTable)
      ?.columns.map(c => c.name) || [],
  )
  const sharedColsList = validCols
    .map(([n]) => Case.snake(n))
    .filter(c => currentDbCols.has(c))

  const transformFn = tsTableObj?._transform
  const hasColTransforms = Object.values(constraints[camelTable]).some(
    c => (c as SyncTypes.ColumnConstraint)?._transform,
  )

  switch (true) {
    case !!transformFn || hasColTransforms: {
      const oldRows = (await tx
        .query(`SELECT * FROM ${quoteIdentifier(sourceDbTable, tx.quoteChar)}`)
        .all()) as Record<string, any>[]
      const batch = oldRows.map(oldRow => {
        const camelRow = Object.fromEntries(
          Object.entries(oldRow).map(([k, v]) => [Case.camel(k), v]),
        )
        if (transformFn)
          return Object.fromEntries(
            Object.entries(transformFn(camelRow)!).map(([k, v]) => [
              Case.snake(k),
              v,
            ]),
          )

        const newRecord: Record<string, any> = {}
        for (const [colName, colObj] of validCols.filter(
          ([n]) => n !== '_view',
        )) {
          const cons = colObj as SyncTypes.ColumnConstraint
          const oldColName = cons._oldColumn || colName
          const oldValue =
            camelRow[Case.camel(oldColName)] ?? camelRow[oldColName]
          newRecord[Case.snake(colName)] = cons._transform
            ? cons._transform(oldValue, camelRow)
            : (oldValue ?? cons.default ?? null)
        }
        return newRecord
      })
      if (batch.length > 0) await tx.executeInsert(tempName, batch)
      break
    }
    case sharedColsList.length > 0:
      await tx.copyTableData(sourceDbTable, tempName, sharedColsList)
      break
  }
  await tx.dropTable(sourceDbTable)
  await tx.renameTable(tempName, table)
}

async function dropIndexesPhase(
  tx: DBAdapter,
  indexesToDrop: Set<string>,
  MESSAGES: any,
) {
  for (const idx of indexesToDrop) {
    MESSAGES.EXEC_DROP_INDEX({ idx })
    await tx.dropIndex(idx)
  }
}

function updateTableRefsAfterRename(plan: SyncPlan, oldName: string, newName: string) {
  for (const col of plan.columnsToDrop)
    if (col.table === oldName) col.table = newName
  for (const col of plan.columnsToRename)
    if (col.table === oldName) col.table = newName
  for (const col of plan.columnsToAdd)
    if (col.table === oldName) col.table = newName
}

async function renameTablesPhase(tx: DBAdapter, plan: SyncPlan, MESSAGES: any) {
  for (const { oldName, newName } of plan.tablesToRename) {
    MESSAGES.EXEC_RENAME_TABLE({ oldName, newName })
    await tx.renameTable(oldName, newName)
    updateTableRefsAfterRename(plan, oldName, newName)
  }
}

async function renameColumnsPhase(
  tx: DBAdapter,
  plan: SyncPlan,
  MESSAGES: any,
) {
  for (const { table, oldColumn, newColumn } of plan.columnsToRename) {
    MESSAGES.EXEC_RENAME_COL({ table, oldColumn, newColumn })
    await tx.renameColumn(table, oldColumn, newColumn)
  }
}

async function dropTablesPhase(tx: DBAdapter, plan: SyncPlan, MESSAGES: any) {
  for (const table of plan.tablesToDrop) {
    const tType = plan.dbConstraintsForDiff[Case.camel(table)]?._view
      ? 'view'
      : 'table'
    MESSAGES.EXEC_DROP_TABLE({ type: tType, table })
    tType === 'view' ? await tx.dropView(table) : await tx.dropTable(table)
  }
}

async function dropColumnsPhase(tx: DBAdapter, plan: SyncPlan, MESSAGES: any) {
  for (const { table, column } of plan.columnsToDrop) {
    MESSAGES.EXEC_DROP_COL({ table, column })
    await tx.dropColumn(table, column)
  }
}

async function addColumnsPhase(tx: DBAdapter, plan: SyncPlan, MESSAGES: any) {
  for (const { table, column, def } of plan.columnsToAdd) {
    if (!(await tx.hasCol(table, column))) {
      MESSAGES.EXEC_ADD_COL({ table, column })
      await tx.addCol(table, column, def)
    }
  }
}

async function rebuildTablesPhase(
  tx: DBAdapter,
  plan: SyncPlan,
  constraints: SyncTypes.DBConstraints,
  MESSAGES: any,
) {
  for (const table of plan.tablesToRebuild) {
    MESSAGES.EXEC_REBUILD({ table })
    await processTableRebuild(tx, table, constraints)
  }
}

async function syncViewsAndTablesPhase(
  tx: DBAdapter,
  constraints: SyncTypes.DBConstraints,
  MESSAGES: any,
) {
  for (const [tableName, cols] of Object.entries(constraints)) {
    if ((cols as SyncTypes.TableConstraints)._view) {
      MESSAGES.EXEC_SYNC_VIEW({ view: Case.snake(tableName) })
      await tx.createView(
        Case.snake(tableName),
        (cols as SyncTypes.TableConstraints)._view!,
      )
    } else {
      const colDefs = Object.entries(cols as Record<string, ColumnConstraint>)
        .filter(([name]) => !['_oldTable', '_transform'].includes(name))
        .map(
          ([name, cons]) =>
            `  ${quoteIdentifier(Case.snake(name), tx.quoteChar)} ${tx.colDef(cons)}`,
        )
      MESSAGES.EXEC_SYNC_CONS({ table: Case.snake(tableName) })
      await tx.createTable(tableName, colDefs, true)
    }
  }
}

async function addIndexesPhase(
  tx: DBAdapter,
  indexesToAdd: Map<string, SyncTypes.IndexConstraint>,
  MESSAGES: any,
) {
  for (const [idxName, def] of indexesToAdd.entries()) {
    MESSAGES.EXEC_ADD_INDEX({ type: def.type, name: idxName })
    await tx.createIndex(
      idxName,
      Case.snake(def.table),
      def.cols.map(Case.snake),
      def.type === 'unique',
    )
  }
}

export async function executeSyncPlan(
  tx: DBAdapter,
  plan: SyncPlan,
  constraints: SyncTypes.DBConstraints,
  indexesToDrop: Set<string>,
  indexesToAdd: Map<string, SyncTypes.IndexConstraint>,
  MESSAGES: any,
) {
  await dropIndexesPhase(tx, indexesToDrop, MESSAGES)
  await renameTablesPhase(tx, plan, MESSAGES)
  await renameColumnsPhase(tx, plan, MESSAGES)
  await dropTablesPhase(tx, plan, MESSAGES)
  await dropColumnsPhase(tx, plan, MESSAGES)
  await addColumnsPhase(tx, plan, MESSAGES)
  await rebuildTablesPhase(tx, plan, constraints, MESSAGES)
  await syncViewsAndTablesPhase(tx, constraints, MESSAGES)
  await addIndexesPhase(tx, indexesToAdd, MESSAGES)
}

export function hasOldWrappers(constraints: SyncTypes.DBConstraints) {
  return Object.values(constraints).some(
    tObj =>
      tObj?._oldTable ||
      tObj?._transform ||
      Object.values(tObj as object).some(
        c => (c as any)?._oldColumn || (c as any)?._transform,
      ),
  )
}
