import type { ColumnConstraint, DBAdapter } from '../adapters/base'
import type * as SyncTypes from './types'

function syncNullableConstraints(
  constraints: Record<string, any>,
  existingConstraints: SyncTypes.DBConstraints,
): void {
  for (const [tableName, cols] of Object.entries(constraints)) {
    if (!cols._view) continue

    for (const [colName, cons] of Object.entries<any>(cols)) {
      if (colName === '_view') continue
      const existingCol = existingConstraints[tableName]?.[colName]
      cons.nullable = existingCol ? existingCol.nullable === true : false
    }
  }
}

function getDefaultValue(
  cons: any,
  isView: boolean,
  adapter: DBAdapter,
): string | undefined {
  if (cons.primary) return undefined

  const hasDefault =
    cons.default !== undefined &&
    cons.default !== null &&
    cons.default !== 'NULL'
  const isExplicitNull =
    cons.default === null ||
    cons.default === 'NULL' ||
    (!isView && cons.nullable)

  switch (true) {
    case hasDefault: {
      const isStr = typeof cons.default === 'string'
      const norm = isStr
        ? (cons.default as string).replace(/[()]/g, '').trim()
        : ''
      const isDateNow = adapter.dateNowDefaults.some(dVal => {
        const normD = dVal.replace(/[()]/g, '').trim().toUpperCase()
        return norm === normD || norm.includes(normD)
      })

      return isStr && isDateNow
        ? 'dateNow'
        : isStr
          ? JSON.stringify(cons.default)
          : String(cons.default)
    }

    case isExplicitNull:
      return 'null'

    default:
      return undefined
  }
}

function formatColumnConstraint(
  colName: string,
  cons: any,
  adapter: DBAdapter,
  isView: boolean,
): string {
  if (colName === '_view') return ''

  const t = `'${cons.type}'`
  const p = cons.primary ?? false
  const a = cons.autoIncrement ?? false
  const n = p ? false : (cons.nullable ?? false)

  if (p && cons.type === 'integer' && a) {
    return `      ${colName}: primary(),\n`
  }

  const d = getDefaultValue(cons, isView, adapter)

  const args = [
    t,
    d,
    n === false ? undefined : n,
    a === false ? undefined : a,
    p === false ? undefined : p,
  ]

  while (args.length > 1 && args[args.length - 1] === undefined) {
    args.pop()
  }

  const finalArgs = args.map(arg => (arg === undefined ? 'undefined' : arg))
  return `      ${colName}: value(${finalArgs.join(', ')}),\n`
}

function buildConstraintsString(
  constraints: Record<string, any>,
  adapter: DBAdapter,
): string {
  let result = '{\n'
  for (const [tableName, cols] of Object.entries(constraints)) {
    result += `    ${tableName}: {\n`

    if (cols._view) {
      result += `      _view: \`${cols._view.replace(/`/g, '\\`')}\`,\n`
    }

    for (const [colName, cons] of Object.entries(
      cols as Record<string, ColumnConstraint>,
    )) {
      result += formatColumnConstraint(colName, cons, adapter, !!cols._view)
    }
    result += `    },\n`
  }
  return `${result}  } as const;\n`
}

function buildIndexesString(dbIndexes: Record<string, any>): string {
  let result = '{\n'
  for (const [idxName, idx] of Object.entries(dbIndexes)) {
    const colsStr =
      idx.cols.length === 1
        ? `'${idx.cols[0]}'`
        : `[${idx.cols.map((c: string) => `'${c}'`).join(', ')}]`

    result += `    ${idxName}: ${idx.type}('${idx.table}', ${colsStr}),\n`
  }
  return `${result}  } as const;\n`
}

function buildDbInfoBlock(
  stringifiedConstraints: string,
  stringifiedIndexes: string,
): string {
  return `import {
  value,
  primary,
  dateNow,
  unique,
  index,
  type ExtractOptionals,
  type ExtractTableTypes,
  type ExtractViews,
} from './schema-util';\n
export namespace DBInfo {
  export const constraints = ${stringifiedConstraints}
  export const indexes = ${stringifiedIndexes}
  type C = typeof constraints;
  export type Table<T extends keyof C> = ExtractTableTypes<C, T>;
  export type Optionals<T extends keyof C> = ExtractOptionals<C, T>;
  export type Views = ExtractViews<C>;
}

export type DBSchema = {
  [T in keyof typeof DBInfo.constraints]: DBInfo.Table<T>;
};

export type DBOptionals = {
  [T in keyof typeof DBInfo.constraints]: DBInfo.Optionals<T>;
};\n`
}

export async function generateSchemaFile(
  adapter: DBAdapter,
  schemaPath: string,
  messages: any,
  existingConstraints: SyncTypes.DBConstraints = {},
): Promise<void> {
  messages.GEN_TYPES()

  const constraints = await adapter.getConstraints()
  const dbIndexes = await adapter.getIndexes()

  syncNullableConstraints(constraints, existingConstraints)

  const stringifiedConstraints = buildConstraintsString(constraints, adapter)
  const stringifiedIndexes = buildIndexesString(dbIndexes)
  const dbInfoBlock = buildDbInfoBlock(
    stringifiedConstraints,
    stringifiedIndexes,
  )

  await Bun.write(schemaPath, dbInfoBlock)
  messages.SYNC_SUCCESS()
}
