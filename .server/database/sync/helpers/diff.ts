import { Case } from '@server/utils/common'
import type { ColumnConstraint, DBAdapter } from '../../adapters/base'
import type * as SyncTypes from '../types'
import { findBestMatchAndPrompt } from './matching'

export interface SyncPlan {
  tablesToDrop: string[]
  tablesToRename: { oldName: string; newName: string }[]
  columnsToDrop: { table: string; column: string }[]
  columnsToAdd: { table: string; column: string; def: ColumnConstraint }[]
  columnsToRename: { table: string; oldColumn: string; newColumn: string }[]
  tablesToRebuild: Set<string>
  viewsToUpdate: string[]
  unmappedTsTables: Set<string>
  dbConstraintsForDiff: SyncTypes.DBConstraints
}

function initDbTablesMap(dbConstraints: SyncTypes.DBConstraints) {
  const dbTables: Record<
    string,
    { dbName: string; camelName: string; cols: Set<string> }
  > = {}
  for (const [camelTable, tableObj] of Object.entries(dbConstraints)) {
    if (tableObj._view) continue
    dbTables[camelTable] = {
      dbName: Case.snake(camelTable),
      camelName: camelTable,
      cols: new Set(Object.keys(tableObj).filter(k => k !== '_view')),
    }
  }
  return dbTables
}

function tableHasTransform(tsTableObj: any): boolean {
  return (
    !!tsTableObj._transform ||
    Object.values(tsTableObj).some(
      col => col && (col as SyncTypes.ColumnConstraint)._transform,
    )
  )
}

function resolveOldTableMapping(
  plan: SyncPlan,
  dbTables: any,
  unmappedDbTables: Set<string>,
  newCamel: string,
  tsTableObj: any,
  hasTransform: boolean,
) {
  if (!tsTableObj._oldTable || !plan.unmappedTsTables.has(newCamel)) return
  const oldCamel = Case.camel(tsTableObj._oldTable)
  if (!dbTables[oldCamel]) return
  if (!hasTransform) {
    plan.tablesToRename.push({
      oldName: dbTables[oldCamel].dbName,
      newName: Case.snake(newCamel),
    })
  }
  unmappedDbTables.delete(oldCamel)
  plan.unmappedTsTables.delete(newCamel)
  dbTables[newCamel] = { ...dbTables[oldCamel], camelName: newCamel }
  delete dbTables[oldCamel]
}

function handleTableRenames(
  plan: SyncPlan,
  constraints: SyncTypes.DBConstraints,
  dbTables: any,
) {
  const unmappedDbTables = new Set(
    Object.keys(dbTables).filter(camel => !constraints[camel]),
  )
  plan.unmappedTsTables = new Set(
    Object.keys(constraints).filter(camel => !dbTables[camel]),
  )

  for (const [newCamel, tsTableObj] of Object.entries(constraints)) {
    if (!tsTableObj) continue
    const hasTransform = tableHasTransform(tsTableObj)
    if (hasTransform) plan.tablesToRebuild.add(Case.snake(newCamel))
    resolveOldTableMapping(
      plan,
      dbTables,
      unmappedDbTables,
      newCamel,
      tsTableObj,
      hasTransform,
    )
  }
  return unmappedDbTables
}

function promptAndRenameTables(
  plan: SyncPlan,
  dbTables: any,
  unmappedDbTables: Set<string>,
  logger: any,
) {
  for (const oldCamel of [...unmappedDbTables]) {
    const dbName = dbTables[oldCamel]!.dbName
    const bestMatch = findBestMatchAndPrompt(
      dbName,
      plan.unmappedTsTables,
      'table',
      dbName,
      logger,
      0.5,
    )

    if (bestMatch) {
      plan.tablesToRename.push({
        oldName: dbName,
        newName: Case.snake(bestMatch),
      })
      unmappedDbTables.delete(oldCamel)
      plan.unmappedTsTables.delete(bestMatch)
      dbTables[bestMatch] = {
        ...dbTables[oldCamel]!,
        camelName: bestMatch,
      }
      delete dbTables[oldCamel]
    } else {
      plan.tablesToDrop.push(dbName)
    }
  }
}

function diffColumnMismatch(
  plan: SyncPlan,
  dbName: string,
  camelCol: string,
  tsCol: any,
  dbCol: any,
  MESSAGES: any,
) {
  const tsNullable = tsCol.primary ? false : tsCol.nullable === true
  const dbNullable = dbCol.primary ? false : dbCol.nullable === true
  const tsDefault = tsCol.default === undefined ? null : tsCol.default
  const dbDefault = dbCol.default === undefined ? null : dbCol.default
  const isTypeMatch =
    tsCol.type === dbCol.type ||
    (tsCol.type === 'boolean' && dbCol.type === 'integer')
  const norm = (v: any) =>
    v === null
      ? 'null'
      : String(v)
          .replace(/^\(+|\)+$/g, '')
          .trim()

  if (
    !isTypeMatch ||
    tsNullable !== dbNullable ||
    norm(tsDefault) !== norm(dbDefault)
  ) {
    MESSAGES.COL_MISMATCH({ table: dbName, column: camelCol })
    MESSAGES.COL_MISMATCH_TS({
      tsType: tsCol.type,
      tsNullable: String(tsNullable),
      tsDefault: String(tsDefault),
    })
    MESSAGES.COL_MISMATCH_DB({
      dbType: dbCol.type,
      dbNullable: String(dbNullable),
      dbDefault: String(dbDefault),
    })
    plan.tablesToRebuild.add(dbName)
  }
}

function resolveColumnRenames(
  plan: SyncPlan,
  camelTable: string,
  dbName: string,
  constraints: any,
  unmappedDbCols: Set<string>,
  unmappedTsCols: Set<string>,
  existingDbCamelCols: Set<string>,
) {
  for (const newCamel of [...unmappedTsCols]) {
    const tsColObj = constraints[camelTable][newCamel]
    if (!tsColObj?._oldColumn) continue
    const oldCamel = Case.camel(tsColObj._oldColumn)
    if (!existingDbCamelCols.has(oldCamel)) continue
    plan.columnsToRename.push({
      table: dbName,
      oldColumn: Case.snake(tsColObj._oldColumn),
      newColumn: Case.snake(newCamel),
    })
    unmappedDbCols.delete(Case.snake(tsColObj._oldColumn))
    unmappedTsCols.delete(newCamel)
    if (plan.dbConstraintsForDiff[camelTable]?.[oldCamel]) {
      plan.dbConstraintsForDiff[camelTable][newCamel] =
        plan.dbConstraintsForDiff[camelTable][oldCamel]
      delete plan.dbConstraintsForDiff[camelTable][oldCamel]
    }
    existingDbCamelCols.delete(oldCamel)
    existingDbCamelCols.add(newCamel)
  }
}

function resolveUnmappedDbCols(
  plan: SyncPlan,
  camelTable: string,
  dbName: string,
  logger: any,
  unmappedDbCols: Set<string>,
  unmappedTsCols: Set<string>,
  existingDbCamelCols: Set<string>,
) {
  for (const oldDbCol of [...unmappedDbCols]) {
    const bestMatch = unmappedTsCols.size
      ? findBestMatchAndPrompt(
          oldDbCol,
          unmappedTsCols,
          'column',
          dbName,
          logger,
        )
      : null
    if (bestMatch) {
      plan.columnsToRename.push({
        table: dbName,
        oldColumn: oldDbCol,
        newColumn: Case.snake(bestMatch),
      })
      unmappedDbCols.delete(oldDbCol)
      unmappedTsCols.delete(bestMatch)
      const oldCamel = Case.camel(oldDbCol)
      if (plan.dbConstraintsForDiff[camelTable]?.[oldCamel]) {
        plan.dbConstraintsForDiff[camelTable][bestMatch] =
          plan.dbConstraintsForDiff[camelTable][oldCamel]
        delete plan.dbConstraintsForDiff[camelTable][oldCamel]
      }
      existingDbCamelCols.delete(oldCamel)
      existingDbCamelCols.add(bestMatch)
    } else {
      plan.columnsToDrop.push({ table: dbName, column: oldDbCol })
    }
  }
}

function diffTableColumns(
  plan: SyncPlan,
  camelTable: string,
  dbName: string,
  constraints: any,
  logger: any,
  MESSAGES: any,
) {
  const existingDbCamelCols = new Set(
    Object.keys(plan.dbConstraintsForDiff[camelTable] || {}).filter(
      k => k !== '_view',
    ),
  )
  const unmappedDbCols = new Set(
    [...existingDbCamelCols]
      .filter(c => !constraints[camelTable][c])
      .map(Case.snake),
  )
  const unmappedTsCols = new Set(
    Object.keys(constraints[camelTable]).filter(
      c =>
        !existingDbCamelCols.has(c) &&
        !['_view', '_oldTable', '_transform'].includes(c),
    ),
  )

  resolveColumnRenames(
    plan,
    camelTable,
    dbName,
    constraints,
    unmappedDbCols,
    unmappedTsCols,
    existingDbCamelCols,
  )
  resolveUnmappedDbCols(
    plan,
    camelTable,
    dbName,
    logger,
    unmappedDbCols,
    unmappedTsCols,
    existingDbCamelCols,
  )

  plan.columnsToAdd.push(
    ...[...unmappedTsCols].map(newCamel => ({
      table: dbName,
      column: Case.snake(newCamel),
      def: constraints[camelTable][newCamel],
    })),
  )

  for (const camelCol of existingDbCamelCols) {
    if (unmappedDbCols.has(Case.snake(camelCol))) continue
    const tsCol = constraints[camelTable][camelCol]
    const dbCol = plan.dbConstraintsForDiff[camelTable]?.[camelCol]
    if (tsCol && dbCol) {
      diffColumnMismatch(plan, dbName, camelCol, tsCol, dbCol, MESSAGES)
    }
  }
}

function diffViewStrings(
  plan: SyncPlan,
  camelTable: string,
  dbName: string,
  constraints: any,
): boolean {
  const tsViewStr = String(constraints[camelTable]._view || '')
    .replace(/\s+/g, ' ')
    .trim()
  const dbViewStr = String(plan.dbConstraintsForDiff[camelTable]?._view || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (tsViewStr || dbViewStr) {
    if (tsViewStr !== dbViewStr) plan.viewsToUpdate.push(dbName)
    if (tsViewStr && !dbViewStr) plan.tablesToDrop.push(dbName)
    return true
  }
  return false
}

function diffTableViewsAndColumns(
  plan: SyncPlan,
  dbTables: any,
  constraints: any,
  logger: any,
  MESSAGES: any,
) {
  for (const camelTable of Object.keys(dbTables)) {
    if (!constraints[camelTable]) continue
    const dbName = dbTables[camelTable]!.dbName
    if (
      plan.tablesToRebuild.has(dbName) ||
      plan.tablesToRebuild.has(Case.snake(camelTable))
    )
      continue
    if (diffViewStrings(plan, camelTable, dbName, constraints)) continue
    diffTableColumns(plan, camelTable, dbName, constraints, logger, MESSAGES)
  }
}

export async function buildSyncPlan(
  adapter: DBAdapter,
  constraints: SyncTypes.DBConstraints,
  logger: any,
  MESSAGES: any,
): Promise<SyncPlan> {
  const plan: SyncPlan = {
    tablesToDrop: [],
    tablesToRename: [],
    columnsToDrop: [],
    columnsToAdd: [],
    columnsToRename: [],
    tablesToRebuild: new Set(),
    viewsToUpdate: [],
    unmappedTsTables: new Set(),
    dbConstraintsForDiff: {},
  }

  plan.dbConstraintsForDiff = await adapter.getConstraints()
  const dbTables = initDbTablesMap(plan.dbConstraintsForDiff)
  const unmappedDbTables = handleTableRenames(plan, constraints, dbTables)

  promptAndRenameTables(plan, dbTables, unmappedDbTables, logger)
  diffTableViewsAndColumns(plan, dbTables, constraints, logger, MESSAGES)

  plan.tablesToRename = plan.tablesToRename.filter(
    t =>
      !plan.tablesToRebuild.has(t.newName) &&
      !plan.tablesToRebuild.has(t.oldName),
  )
  return plan
}
