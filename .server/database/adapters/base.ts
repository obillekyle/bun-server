import { mkdir, readdir } from 'node:fs/promises'
import { recordDbHit } from '@plugins/analytics/core'
import { Logger } from '@server/logger'
import { Case, Try } from '@server/utils'
import type * as SyncTypes from '../sync/types'

export type DBDriver = 'sqlite' | 'postgres' | 'mysql'
export type RunResult = {
  lastInsertRowid: number | bigint | null
  changes: number
}
export type BackupResult = { file: string; cleanupCount?: number }
export interface TableColumnInfo {
  name: string
  type: string
  notnull: boolean
  pk: boolean
}
export interface TableIndexInfo {
  name: string
  unique: boolean
}
export interface TableDetails {
  name: string
  rowCount: number
  columns: TableColumnInfo[]
  indexes: TableIndexInfo[]
}
export interface TableDataResult {
  rows: any[]
  totalRows: number
  page: number
  pageSize: number
  totalPages: number
}
export type ColumnConstraint = {
  type: 'integer' | 'string' | 'number' | 'boolean' | 'buffer'
  primary?: boolean
  autoIncrement?: boolean
  nullable?: boolean
  default?: unknown
}
export type IndexConstraint = {
  type: 'unique' | 'index'
  table: string
  cols: string[]
}

export interface DBExecutor {
  all(
    sqlText: string,
    params?: unknown[],
  ): Promise<Record<string, unknown>[]> | Record<string, unknown>[]
  run(sqlText: string, params?: unknown[]): Promise<RunResult> | RunResult
  iterate(
    sqlText: string,
    params?: unknown[],
  ): AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>
  get(
    sqlText: string,
    params?: unknown[],
  ): Promise<Record<string, unknown> | undefined>
  values(sqlText: string, params?: unknown[]): Promise<unknown[][]>
}

export function quoteIdentifier(name: string, quoteChar: string): string {
  return `${quoteChar}${name.replace(new RegExp(quoteChar, 'g'), '')}${quoteChar}`
}
// prettier-ignore
export const sqlKeywords = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'ON',
  'AS',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS',
  'IN',
  'GROUP',
  'BY',
  'ORDER',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'ASC',
  'DESC',
  'CREATE',
  'TABLE',
  'VIEW',
  'DROP',
  'ALTER',
  'UPDATE',
  'SET',
  'INSERT',
  'INTO',
  'VALUES',
  'DELETE',
  'PRIMARY',
  'KEY',
  'FOREIGN',
  'REFERENCES',
  'AUTOINCREMENT',
  'DEFAULT',
  'UNIQUE',
  'CHECK',
  'CONSTRAINT',
  'CAST',
  'INTEGER',
  'TEXT',
  'REAL',
  'BLOB',
  'NUMERIC',
  'BOOLEAN',
])

export const cleanSQLQuotes = (sql: string) =>
  sql.replace(/`([^`]+)`/g, (match, word) =>
    !sqlKeywords.has(word.toUpperCase()) &&
    /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(word)
      ? word
      : match,
  )

export abstract class DBAdapter {
  protected abstract sql: unknown
  static readonly DATE_NOW = ''
  readonly DATE_NOW = DBAdapter.DATE_NOW
  readonly quoteChar: string = '`'

  constructor(
    public readonly driver: DBDriver,
    public readonly filename?: string,
    public readonly url?: string,
  ) {}

  abstract readonly execute: DBExecutor
  abstract hasCol(table: string, column: string): Promise<boolean>
  abstract addCol(table: string, column: string, def: unknown): Promise<void>
  abstract colDef(def: unknown): string
  abstract backup(keepCount?: number): Promise<BackupResult | null>
  abstract transaction<T>(
    callback: (tx: DBAdapter) => T | Promise<T>,
  ): Promise<T>
  abstract getConstraints(): Promise<SyncTypes.DBConstraints>
  abstract getIndexes(): Promise<SyncTypes.DBIndexes>
  abstract getSchema(): Promise<TableDetails[]>
  abstract getData(
    table: string,
    opts: {
      page: number
      pageSize: number
      sortBy?: string | null
      sortOrder?: string | null
      filters?: Record<string, unknown>
    },
  ): Promise<TableDataResult>
  abstract remove(table: string, rowid: unknown): Promise<RunResult>
  abstract truncate(table: string): Promise<RunResult>
  abstract insert(
    table: string,
    row: Record<string, unknown>,
  ): Promise<RunResult>
  abstract update(
    table: string,
    rowid: unknown,
    row: Record<string, unknown>,
  ): Promise<RunResult>

  async dropIndex(name: string): Promise<RunResult> {
    return await this.query(
      `DROP INDEX IF EXISTS ${quoteIdentifier(name, this.quoteChar)}`,
    ).run()
  }
  async renameTable(oldN: string, newN: string): Promise<RunResult> {
    return await this.query(
      `ALTER TABLE ${quoteIdentifier(oldN, this.quoteChar)} RENAME TO ${quoteIdentifier(newN, this.quoteChar)}`,
    ).run()
  }
  async renameColumn(
    table: string,
    oldC: string,
    newC: string,
  ): Promise<RunResult> {
    return await this.query(
      `ALTER TABLE ${quoteIdentifier(table, this.quoteChar)} RENAME COLUMN ${quoteIdentifier(oldC, this.quoteChar)} TO ${quoteIdentifier(newC, this.quoteChar)}`,
    ).run()
  }
  async dropColumn(table: string, col: string): Promise<RunResult> {
    return await this.query(
      `ALTER TABLE ${quoteIdentifier(table, this.quoteChar)} DROP COLUMN ${quoteIdentifier(col, this.quoteChar)}`,
    ).run()
  }
  async dropTable(table: string): Promise<RunResult> {
    return await this.query(
      `DROP TABLE ${quoteIdentifier(table, this.quoteChar)}`,
    ).run()
  }
  async dropView(view: string): Promise<RunResult> {
    return await this.query(
      `DROP VIEW IF EXISTS ${quoteIdentifier(view, this.quoteChar)}`,
    ).run()
  }
  async createIndex(
    name: string,
    table: string,
    cols: string[],
    unique = false,
  ): Promise<RunResult> {
    return await this.query(
      `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${quoteIdentifier(name, this.quoteChar)} ON ${quoteIdentifier(table, this.quoteChar)} (${cols.map(c => quoteIdentifier(c, this.quoteChar)).join(', ')})`,
    ).run()
  }
  async createView(name: string, sql: string): Promise<RunResult> {
    await this.dropView(name)
    return this.query(
      `CREATE VIEW ${quoteIdentifier(name, this.quoteChar)} AS ${sql}`,
    ).run()
  }
  async createTable(
    table: string,
    defs: string[],
    ifNotExists = false,
  ): Promise<RunResult> {
    return await this.query(
      `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${quoteIdentifier(table, this.quoteChar)} (\n${defs.join(',\n')}\n)`,
    ).run()
  }
  async copyTableData(
    from: string,
    to: string,
    cols: string[],
  ): Promise<RunResult> {
    const cSql = cols.map(c => quoteIdentifier(c, this.quoteChar)).join(', ')
    return await this.query(
      `INSERT INTO ${quoteIdentifier(to, this.quoteChar)} (${cSql}) SELECT ${cSql} FROM ${quoteIdentifier(from, this.quoteChar)}`,
    ).run()
  }

  protected async preSync(_tx: DBAdapter): Promise<void> {}
  protected async postSync(_tx: DBAdapter): Promise<void> {}
  readonly dateNowDefaults: string[] = []

  async syncSchema(
    constraints: SyncTypes.DBConstraints,
    tsIndexes: SyncTypes.DBIndexes,
    schemaPath: string,
  ): Promise<void> {
    const { syncDatabaseSchema } = await import('../sync/engine')
    await syncDatabaseSchema(this, constraints, tsIndexes, schemaPath)
  }

  async executeInsert(
    table: string,
    records: Record<string, unknown>[],
  ): Promise<RunResult> {
    recordDbHit()
    if (!records.length) return { lastInsertRowid: null, changes: 0 }
    const snakeRecords = records.map(r =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [Case.snake(k), v])),
    )
    const columnsList = [...new Set(snakeRecords.flatMap(Object.keys))]
    const columns = columnsList
      .map(k => quoteIdentifier(k, this.quoteChar))
      .join(', ')
    const placeholders = snakeRecords
      .map(() => `(${columnsList.map(() => '?').join(', ')})`)
      .join(', ')
    const params = snakeRecords.flatMap(r => columnsList.map(k => r[k] ?? null))
    return await this.execute.run(
      `INSERT INTO ${quoteIdentifier(table, this.quoteChar)} (${columns}) VALUES ${placeholders}`,
      params,
    )
  }

  async close() {
    await (this.sql as any)?.close()
  }
  async [Symbol.asyncDispose]() {
    await this.close()
  }
  query(sqlText: string) {
    return new DatabaseStatement(this, sqlText)
  }

  protected buildFilterSort(
    options: {
      sortBy?: string | null
      sortOrder?: string | null
      filters?: Record<string, unknown>
    },
    validCols: Set<string>,
  ) {
    const whereParams: unknown[] = []
    const whereClauses = Object.entries(options.filters || {})
      .filter(
        ([col, val]) =>
          validCols.has(col) && val !== undefined && val !== null && val !== '',
      )
      .map(([col, val]) => {
        whereParams.push(`%${val}%`)
        return `${quoteIdentifier(col, this.quoteChar)} LIKE ?`
      })

    const whereSql = whereClauses.length
      ? ` WHERE ${whereClauses.join(' AND ')}`
      : ''
    const orderSql =
      options.sortBy && validCols.has(options.sortBy)
        ? ` ORDER BY ${quoteIdentifier(options.sortBy, this.quoteChar)} ${options.sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`
        : ''

    return { whereSql, orderSql, whereParams }
  }

  protected formatDefault(
    def: unknown,
    boolTrue: string,
    boolFalse: string,
  ): string {
    switch (true) {
      case def === undefined:
        return ''
      case def === null || def === 'NULL':
        return ' DEFAULT NULL'
      case typeof def === 'boolean':
        return ` DEFAULT ${def ? boolTrue : boolFalse}`
      case typeof def === 'number' || typeof def === 'bigint':
        return ` DEFAULT ${def}`
      default:
        return ` DEFAULT '${String(def).replace(/'/g, "''")}'`
    }
  }

  protected async cleanupBackups(
    backupDir: string,
    baseName: string,
    ext: string,
    keepCount: number,
  ): Promise<number> {
    if (keepCount <= 0) return 0
    const files = await readdir(backupDir)
    const old = files
      .filter(f => f.startsWith(`${baseName}.`) && f.endsWith(ext))
      .map(f => ({ name: f, time: Number(f.split('.')[1]) || 0 }))
      .sort((a, b) => b.time - a.time)
      .slice(keepCount)
    await Promise.all(old.map(b => Bun.file(`${backupDir}/${b.name}`).delete()))
    return old.length
  }

  protected async spawnBackup(
    tool: string,
    cmdBuilder: (fullPath: string) => string[],
    ext: string,
    keepCount: number,
    baseName: string,
    envOverride?: Record<string, string>,
  ): Promise<BackupResult | null> {
    const backupDir = `${process.cwd()}/.server/database/.backups`
    const backupName = `${baseName}.${Date.now()}${ext}`
    const fullPath = `${backupDir}/${backupName}`
    await mkdir(backupDir, { recursive: true })

    if (
      !Try.return(
        () =>
          Bun.spawnSync({ cmd: [tool, '--version'], stdout: 'ignore' })
            .exitCode === 0,
        false,
      )
    ) {
      if (
        !new Logger('db-backup').confirm(
          `${tool} utility not found. Continue without backup?`,
        )
      )
        throw new Error(`Aborted: ${tool} missing.`)
      return null
    }

    const dump = Bun.spawnSync({
      cmd: cmdBuilder(fullPath),
      stdout: 'ignore',
      stderr: 'pipe',
      env: { ...process.env, ...(envOverride || {}) },
    })
    if (!dump.success)
      throw new Error(
        dump.stderr.toString().trim() ||
          `${tool} failed (exit ${dump.exitCode})`,
      )

    const cleaned = await this.cleanupBackups(
      backupDir,
      baseName,
      ext,
      keepCount,
    )
    return { file: backupName, cleanupCount: cleaned }
  }

  async importCSV(table: string, csvContent: string): Promise<RunResult> {
    const lines = parseCSVRows(csvContent)
    if (lines.length < 2) throw new Error('No rows found')

    const rawHeaders = lines[0]
    const headers = rawHeaders.map(h => h.trim())

    // Fetch column types to parse them correctly
    const schema = await this.getSchema()
    const tableInfo = schema.find(
      t => t.name === table || Case.camel(t.name) === Case.camel(table),
    )
    const typeMap = new Map<string, string>() // column name -> type
    if (tableInfo) {
      for (const col of tableInfo.columns) {
        typeMap.set(Case.camel(col.name), col.type.toLowerCase())
        typeMap.set(col.name.toLowerCase(), col.type.toLowerCase())
      }
    }

    const records = lines.slice(1).map(cols => {
      return headers.reduce(
        (acc, h, i) => {
          const type =
            typeMap.get(Case.camel(h)) || typeMap.get(h.toLowerCase())
          acc[h] = parseCSVValue(cols[i], type)
          return acc
        },
        {} as Record<string, any>,
      )
    })

    return await this.executeInsert(table, records)
  }
}

function parseCSVValueWithType(val: string, type: string): any {
  if (type.includes('int') || type.includes('serial')) {
    const parsed = parseInt(val, 10)
    return Number.isNaN(parsed) ? val : parsed
  }
  if (
    type.includes('real') ||
    type.includes('double') ||
    type.includes('float') ||
    type.includes('number') ||
    type.includes('numeric')
  ) {
    const parsed = parseFloat(val)
    return Number.isNaN(parsed) ? val : parsed
  }
  if (type.includes('bool')) {
    return val === 'true' || val === '1' || val === 't'
  }
  return val
}

function parseCSVValueFallback(val: string): any {
  if (!Number.isNaN(Number(val)) && val !== '') {
    return Number(val)
  }
  const lowerVal = val.toLowerCase()
  if (lowerVal === 'true' || lowerVal === 'false') {
    return lowerVal === 'true'
  }
  if (lowerVal === 'null') {
    return null
  }
  return val
}

function parseCSVValue(val: any, type?: string): any {
  if (val === undefined || val === null) {
    return null
  }
  const trimmed = val.trim()
  if (trimmed === '') {
    return null
  }
  if (type) {
    return parseCSVValueWithType(trimmed, type)
  }
  return parseCSVValueFallback(trimmed)
}

interface CSVParserState {
  result: string[][]
  row: string[]
  field: string
  inQuotes: boolean
}

function handleInQuotes(
  char: string,
  nextChar: string,
  state: CSVParserState,
): { skipNext: boolean } {
  if (char === '"' && nextChar === '"') {
    state.field += '"'
    return { skipNext: true }
  }
  if (char === '"') {
    state.inQuotes = false
  } else {
    state.field += char
  }
  return { skipNext: false }
}

function handleOutsideQuotes(
  char: string,
  nextChar: string,
  state: CSVParserState,
): { skipNext: boolean } {
  if (char === '"') {
    state.inQuotes = true
  } else if (char === ',') {
    state.row.push(state.field)
    state.field = ''
  } else if (char === '\n' || char === '\r') {
    state.row.push(state.field)
    state.field = ''
    if (
      state.row.length > 0 &&
      !(state.row.length === 1 && state.row[0] === '')
    ) {
      state.result.push(state.row)
    }
    state.row = []
    if (char === '\r' && nextChar === '\n') {
      return { skipNext: true }
    }
  } else {
    state.field += char
  }
  return { skipNext: false }
}

function parseCSVRows(csv: string): string[][] {
  const state: CSVParserState = {
    result: [],
    row: [],
    field: '',
    inQuotes: false,
  }

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    const nextChar = csv[i + 1]

    const { skipNext } = state.inQuotes
      ? handleInQuotes(char, nextChar, state)
      : handleOutsideQuotes(char, nextChar, state)

    if (skipNext) {
      i++
    }
  }

  if (state.field !== '' || state.row.length > 0) {
    state.row.push(state.field)
    if (
      state.row.length > 0 &&
      !(state.row.length === 1 && state.row[0] === '')
    ) {
      state.result.push(state.row)
    }
  }

  return state.result
}

export class DatabaseStatement {
  constructor(
    private readonly connection: DBAdapter,
    private readonly sql: string,
  ) {}
  all(...params: unknown[]) {
    recordDbHit()
    return this.connection.execute.all(this.sql, params)
  }
  get(...params: any[]) {
    recordDbHit()
    return this.connection.execute.get(this.sql, params)
  }
  run(...params: any[]): Promise<RunResult> | RunResult {
    recordDbHit()
    return this.connection.execute.run(this.sql, params)
  }
  values(...params: any[]) {
    recordDbHit()
    return this.connection.execute.values(this.sql, params)
  }
  iterate(...params: any[]) {
    recordDbHit()
    return this.connection.execute.iterate(this.sql, params)
  }
}
