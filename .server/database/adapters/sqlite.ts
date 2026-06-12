import { is } from '@server/utils/common'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Case, Try } from '@server/utils'
import { SQL } from 'bun'
import type * as SyncTypes from '../sync/types'
import type {
  BackupResult,
  DBExecutor,
  RunResult,
  TableDataResult,
  TableDetails,
} from './base'
import { cleanSQLQuotes, DBAdapter, quoteIdentifier } from './base'

export class SQLiteAdapter extends DBAdapter {
  protected readonly sql: SQL

  constructor(connectionTarget?: string | null, sql?: SQL) {
    const filename = SQLiteAdapter.resolveFilename(connectionTarget)
    super(
      'sqlite',
      filename,
      typeof connectionTarget === 'string' ? connectionTarget : undefined,
    )
    this.sql =
      sql ??
      (filename === ':memory:'
        ? new SQL('sqlite://:memory:')
        : new SQL(filename, { adapter: 'sqlite' }))
    if (filename !== ':memory:') {
      this.sql
        .unsafe('PRAGMA journal_mode = WAL;')
        .then(() => this.sql.unsafe('PRAGMA synchronous = NORMAL;'))
        .then(() => this.sql.unsafe('PRAGMA temp_store = memory;'))
        .then(() => this.sql.unsafe('PRAGMA cache_size = -10000;'))
        .then(() => this.sql.unsafe('PRAGMA busy_timeout = 5000;'))
        .catch(() => {})
    }
  }

  private static resolveFilename(rawValue?: string | null): string {
    const envVal = process.env.DATABASE_URL || process.env.SQLITE_PATH
    const fallback = path.resolve(process.cwd(), '.server/.data/server.db')
    const value =
      rawValue?.trim() ||
      (typeof envVal === 'string' ? envVal.trim() : undefined)

    if (!value) return fallback
    if (value === ':memory:' || path.isAbsolute(value)) return value

    switch (true) {
      case value.startsWith('sqlite://'):
        return this.resolveFilename(value.slice('sqlite://'.length))
      case value.startsWith('sqlite:'):
        return this.resolveFilename(
          value.slice('sqlite:'.length).replace(/^\/+/, ''),
        )
      case value.startsWith('file://'):
        return Try.return(() => fileURLToPath(new URL(value)), fallback)
      default:
        return path.resolve(process.cwd(), value)
    }
  }

  readonly execute: DBExecutor = {
    all: async (sqlText: string, params: unknown[] = []) =>
      (await this.sql.unsafe(sqlText, params)) as Record<string, unknown>[],
    run: async (
      sqlText: string,
      params: unknown[] = [],
    ): Promise<RunResult> => {
      const result = (await this.sql.unsafe(sqlText, params)) as any
      return {
        lastInsertRowid:
          result?.lastInsertRowid ??
          result?.insertId ??
          result?.lastInsertId ??
          null,
        changes: Number(
          result?.count ?? result?.affectedRows ?? result?.changedRows ?? 0,
        ),
      }
    },
    iterate: (sqlText: string, params: unknown[] = []) =>
      this.sql.unsafe(sqlText, params) as any,
    get: async (sqlText: string, params: unknown[] = []) =>
      (await this.execute.all(sqlText, params))[0],
    values: async (sqlText: string, params: unknown[] = []) =>
      (await this.execute.all(sqlText, params)).map(Object.values),
  }

  async hasCol(table: string, column: string): Promise<boolean> {
    const cols = (await this.query(`PRAGMA table_info('${table}')`).all()) as {
      name: string
    }[]
    return cols.some(c => c.name === column)
  }

  colDef(def: unknown): string {
    const d = def as any
    const typeStr =
      {
        integer: 'INTEGER',
        string: 'TEXT',
        number: 'REAL',
        boolean: 'INTEGER',
        buffer: 'BLOB',
      }[d.type as string] || 'TEXT'
    let out = typeStr
    if (d.primary) out += ' PRIMARY KEY'
    if (d.autoIncrement) out += ' AUTOINCREMENT'
    if (!d.nullable && !d.primary) out += ' NOT NULL'
    return out + this.formatDefault(d.default, '1', '0')
  }

  async addCol(table: string, column: string, def: unknown): Promise<void> {
    await this.query(
      `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${this.colDef(def)}`,
    ).run()
  }

  async backup(keepCount = 10): Promise<BackupResult | null> {
    if (
      this.filename === ':memory:' ||
      !this.filename ||
      !(await Bun.file(this.filename).exists())
    )
      return null
    const ext = path.extname(this.filename),
      base = path.basename(this.filename, ext)
    const backupDir = `${path.dirname(this.filename)}/.backups`,
      backupName = `${base}.${Date.now()}${ext}`
    await mkdir(backupDir, { recursive: true })
    await copyFile(this.filename, `${backupDir}/${backupName}`)
    return {
      file: backupName,
      cleanupCount: await this.cleanupBackups(backupDir, base, ext, keepCount),
    }
  }

  transaction<T>(callback: (tx: DBAdapter) => T | Promise<T>): Promise<T> {
    return this.sql.transaction(async txSql =>
      callback(new SQLiteAdapter(this.filename, txSql)),
    )
  }

  async getSchema(): Promise<TableDetails[]> {
    const res = (await this.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    ).all()) as { name: string }[]
    const tablesWithDetails: TableDetails[] = []
    for (const t of res) {
      const countRes = (await this.query(
        `SELECT COUNT(*) as count FROM ${quoteIdentifier(t.name, this.quoteChar)}`,
      ).get()) as { count: number }
      const cols = (await this.query(
        `PRAGMA table_info(${quoteIdentifier(t.name, this.quoteChar)})`,
      ).all()) as any[]
      const idxs = (await this.query(
        `PRAGMA index_list(${quoteIdentifier(t.name, this.quoteChar)})`,
      ).all()) as any[]
      tablesWithDetails.push({
        name: t.name,
        rowCount: countRes?.count || 0,
        columns: cols.map(c => ({
          name: c.name,
          type: c.type,
          notnull: c.notnull === 1,
          pk: c.pk === 1,
        })),
        indexes: idxs.map(i => ({ name: i.name, unique: i.unique === 1 })),
      })
    }
    return tablesWithDetails
  }

  async getData(
    tableName: string,
    options: {
      page: number
      pageSize: number
      sortBy?: string | null
      sortOrder?: string | null
      filters?: Record<string, unknown>
    },
  ): Promise<TableDataResult> {
    const cols = (await this.query(
      `PRAGMA table_info(${quoteIdentifier(tableName, this.quoteChar)})`,
    ).all()) as { name: string }[]
    const { whereSql, orderSql, whereParams } = this.buildFilterSort(
      options,
      new Set(cols.map(c => c.name)),
    )
    const countRes = (await this.query(
      `SELECT COUNT(*) as count FROM ${quoteIdentifier(tableName, this.quoteChar)}${whereSql}`,
    ).get(...whereParams)) as { count: number }
    const totalRows = countRes?.count || 0
    const rows = await this.query(
      `SELECT rowid AS rowid, * FROM ${quoteIdentifier(tableName, this.quoteChar)}${whereSql}${orderSql} LIMIT ? OFFSET ?`,
    ).all(
      ...whereParams,
      options.pageSize,
      (options.page - 1) * options.pageSize,
    )
    return {
      rows,
      totalRows,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(totalRows / options.pageSize),
    }
  }

  async remove(tableName: string, rowid: unknown): Promise<RunResult> {
    return await this.query(
      `DELETE FROM ${quoteIdentifier(tableName, this.quoteChar)} WHERE rowid = ?`,
    ).run(rowid)
  }
  async truncate(tableName: string): Promise<RunResult> {
    await this.query(
      `DELETE FROM ${quoteIdentifier(tableName, this.quoteChar)}`,
    ).run()
    return this.query(`VACUUM`).run()
  }
  async insert(
    tableName: string,
    row: Record<string, unknown>,
  ): Promise<RunResult> {
    const keys = Object.keys(row),
      values = Object.values(row)
    return await this.query(
      `INSERT INTO ${quoteIdentifier(tableName, this.quoteChar)} (${keys.map(k => quoteIdentifier(k, this.quoteChar)).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    ).run(...values)
  }
  async update(
    tableName: string,
    rowid: unknown,
    row: Record<string, unknown>,
  ): Promise<RunResult> {
    const keys = Object.keys(row).filter(k => k !== 'rowid')
    return await this.query(
      `UPDATE ${quoteIdentifier(tableName, this.quoteChar)} SET ${keys.map(k => `${quoteIdentifier(k, this.quoteChar)} = ?`).join(', ')} WHERE rowid = ?`,
    ).run(...keys.map(k => row[k]), rowid)
  }

  async getConstraints(): Promise<SyncTypes.DBConstraints> {
    const tables = (await this.query(
      "SELECT sql,name,type FROM sqlite_master WHERE (type='table' OR type='view') AND name NOT LIKE 'sqlite_%'",
    ).all()) as any[]

    const dbConstraints: SyncTypes.DBConstraints = {}

    for (const table of tables) {
      const tName = Case.camel(table.name)
      dbConstraints[tName] = {} as SyncTypes.TableConstraints

      const cols = (await this.query(
        `PRAGMA table_info('${table.name}')`,
      ).all()) as any[]

      if (table.type === 'view') {
        const match = table.sql.match(/AS\s+(.*)/is)
        if (match) dbConstraints[tName]._view = cleanSQLQuotes(match[1].trim())

        for (const col of cols) {
          dbConstraints[tName][Case.camel(col.name)] = {
            type: mapSqlToTsType(col.type),
            nullable: col.notnull === 0n || col.notnull === 0,
          }
        }
        continue
      }

      for (const col of cols) {
        dbConstraints[tName][Case.camel(col.name)] = buildColumnConstraint(
          col,
          table.sql,
        )
      }
    }

    return dbConstraints
  }

  async getIndexes(): Promise<SyncTypes.DBIndexes> {
    const indexes = (await this.query(
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_autoindex_%'",
    ).all()) as any[]
    return Object.fromEntries(
      await Promise.all(
        indexes.map(async idx => [
          Case.camel(idx.name),
          {
            type: idx.sql.toUpperCase().includes('UNIQUE') ? 'unique' : 'index',
            table: Case.camel(idx.tbl_name),
            cols: (
              (await this.query(
                `PRAGMA index_info('${idx.name}')`,
              ).all()) as any[]
            ).map(c => Case.camel(c.name)),
          },
        ]),
      ),
    )
  }

  protected override async preSync(tx: DBAdapter): Promise<void> {
    await tx.query('PRAGMA foreign_keys=OFF').run()
  }
  protected override async postSync(tx: DBAdapter): Promise<void> {
    await tx.query('PRAGMA foreign_keys=ON').run()
  }
  override readonly dateNowDefaults: string[] = [
    "CAST(strftime('%s', 'now') AS INTEGER)",
  ]
  override async dropTable(tableName: string): Promise<RunResult> {
    return await this.query(
      `DROP TABLE IF EXISTS ${quoteIdentifier(tableName, this.quoteChar)}`,
    ).run()
  }
}

function mapSqlToTsType(sqlType: string): SyncTypes.ColumnConstraint['type'] {
  const upperType = (sqlType || '').toUpperCase()
  for (const [sql, ts] of Object.entries({
    INTEGER: 'integer',
    TEXT: 'string',
    REAL: 'number',
    BLOB: 'buffer',
    NUMERIC: 'number',
    BOOLEAN: 'boolean',
  })) {
    if (upperType.includes(sql)) return ts as any
  }
  return 'string'
}

function parseSqliteDefault(def: any): any {
  switch (true) {
    case def === null:
      return null
    case def === undefined:
      return undefined
    case typeof def === 'string' &&
      (def.startsWith("'") || def.startsWith('"')):
      return def.slice(1, -1)
    case typeof def === 'string' && def.toUpperCase() === 'NULL':
      return null
    case typeof def === 'string' && !Number.isNaN(Number(def)):
      return Number(def)
    default:
      return def
  }
}

function buildColumnConstraint(
  col: any,
  tableSql: string,
): SyncTypes.ColumnConstraint {
  const primary = col.pk > 0
  const cons: SyncTypes.ColumnConstraint = {
    type: mapSqlToTsType(col.type),
  }

  if (primary) cons.primary = true
  if (
    primary &&
    cons.type === 'integer' &&
    tableSql?.toUpperCase().includes('AUTOINCREMENT')
  ) {
    cons.autoIncrement = true
  }

  if (col.notnull === 0 && !primary) cons.nullable = true

  const parsedDef = parseSqliteDefault(col.dflt_value)
  if (parsedDef !== undefined) cons.default = parsedDef

  return cons
}
