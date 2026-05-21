import '@server/init';

import { connection } from './conn';
import { toSnakeCase, toCamelCase } from '@server/utils/strings';
import { Logger } from '@server/logger';
import { match, tryCatch } from '@server/utils';
import { messageLogger } from '@server/logger';
import { backupDatabase } from './backup';

export type ColumnConstraint = {
  type: 'integer' | 'string' | 'number' | 'boolean' | 'buffer';
  primary?: boolean;
  autoIncrement?: boolean;
  nullable?: boolean;
  default?: any;
};

export type IndexConstraint = {
  type: 'unique' | 'index';
  table: string;
  cols: string[];
};

const logger = new Logger('db-sync');

const syncMsgs = {
  GEN_TYPES: 'I Generating types for version {version}...',
  SYNC_SUCCESS:
    'I schema.ts successfully synced to Database version {version}!',
  INVALID_SCHEMA: 'W schema.ts is invalid or corrupt. Treating as new.',
  NO_DBINFO: 'W DBInfo namespace not found in schema.ts!',
  PERFECT_SYNC:
    'I schema.ts is perfectly synced with Database Version {dbVersion}! Regenerating local file to ensure structural integrity...',
  DB_NEWER:
    'I Database version ({dbVersion}) is newer than TS ({tsVersion}). Generating types...',
  TS_NEWER: 'I schema.ts (v{tsVersion}) is newer! Syncing to the database...',
  BACKUP_CREATED: 'I Created database backup: {file}',
  NO_CONSTRAINTS:
    'E Could not find `DBInfo.constraints` in schema.ts to run the reverse sync!',
  COL_MISMATCH:
    "W Table '{table}' needs rebuild because of column '{column}' mismatch:",
  COL_MISMATCH_TS:
    'W   - TS: type={tsType}, nullable={tsNullable}, default={tsDefault}',
  COL_MISMATCH_DB:
    'W   - DB: type={dbType}, nullable={dbNullable}, default={dbDefault}',
  DANGER_ZONE: 'W DANGER ZONE: Destructive or major changes detected!',
  DROP_TABLES: 'W Tables to drop: {tables}',
  RENAME_TABLES: 'I Tables to rename: {tables}',
  DROP_COLS: 'W Columns to drop: {cols}',
  RENAME_COLS: 'I Columns to rename: {cols}',
  ADD_COLS: 'I Columns to add: {cols}',
  REBUILD_TABLES: 'W Tables to rebuild (schema modified): {tables}',
  UPDATE_VIEWS: 'I Views to update/recreate: {views}',
  DROP_INDEXES: 'I Indexes to drop: {indexes}',
  ADD_INDEXES: 'I Indexes to add: {indexes}',
  REVIEW_WARNING: 'W These changes may affect data. Review carefully.',
  SYNC_ABORTED: 'I Sync aborted. Your data is safe!',
  EXEC_RENAME_TABLE: 'I Renaming table: {oldName} -> {newName}...',
  EXEC_RENAME_COL: 'I Renaming column: {table}.{oldColumn} -> {newColumn}...',
  EXEC_DROP_TABLE: 'I Dropping {type}: {table}...',
  EXEC_DROP_COL: 'I Dropping column: {table}.{column}...',
  EXEC_ADD_COL: 'I Adding column: {table}.{column}...',
  EXEC_DROP_INDEX: 'I Dropping index: {idx}...',
  EXEC_REBUILD: 'I Rebuilding table to apply schema modifications: {table}...',
  EXEC_SYNC_VIEW: 'D Syncing view: {view}...',
  EXEC_SYNC_CONS: 'D Syncing constraints for: {table}...',
  EXEC_ADD_INDEX: 'I Creating {type} index: {name}...',
  CATCH_UP_SUCCESS:
    'I Database successfully caught up to TS version {tsVersion}!',
  FATAL_ERROR:
    'E FATAL ERROR: Sync failed! All changes have been safely rolled back. Detail: {error}',
} as const;

const MESSAGES = messageLogger(logger, syncMsgs);

function getStringSimilarity(str1: string, str2: string) {
  const getBigrams = (str: string) => {
    const bg = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) bg.add(str.slice(i, i + 2));
    return bg;
  };
  const bg1 = getBigrams(str1.toLowerCase());
  const bg2 = getBigrams(str2.toLowerCase());
  let intersection = 0;
  for (const b of bg1) if (bg2.has(b)) intersection++;
  const union = bg1.size + bg2.size - intersection;
  return union === 0 ? (str1 === str2 ? 1 : 0) : intersection / union;
}

const typeMap: Record<string, ColumnConstraint['type']> = {
  INTEGER: 'integer',
  TEXT: 'string',
  REAL: 'number',
  BLOB: 'buffer',
  NUMERIC: 'number',
  BOOLEAN: 'boolean',
};

function mapSqlToTsType(sqlType: string): ColumnConstraint['type'] {
  const upperType = (sqlType || '').toUpperCase();
  for (const [sql, ts] of Object.entries(typeMap)) {
    if (upperType.includes(sql)) return ts;
  }
  return 'string'; // Default fallback
}

function promptForMapping(
  promptText: string,
  bestAutoMatch: string | null,
  bestScore: number,
  unmappedTsItems: string[],
  itemType: 'table' | 'column',
): string | null {
  const options = [
    bestAutoMatch
      ? `Pick automatically (${toSnakeCase(bestAutoMatch)}: ${Math.round(bestScore * 100)}%)`
      : 'Pick automatically (none)',
    ...unmappedTsItems.map((t) => `Use ${itemType}: ${toSnakeCase(t)}`),
    `Drop ${itemType}`,
  ];

  const selectionIndex = logger.selectIndex(promptText, options);

  if (selectionIndex === 0) return bestAutoMatch;
  if (selectionIndex === options.length - 1) return null;
  return unmappedTsItems[selectionIndex - 1];
}

const sqlKeywords = new Set([
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
]);

function cleanSQLQuotes(sql: string) {
  return sql.replace(/`([^`]+)`/g, (match, word) => {
    if (
      !sqlKeywords.has(word.toUpperCase()) &&
      /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(word)
    ) {
      return word;
    }
    return match;
  });
}

function extractConstraintsFromDB() {
  const tables = connection
    .query(
      "SELECT sql,name,type FROM sqlite_master WHERE (type='table' OR type='view') AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { sql: string; name: string; type: string }[];

  const dbConstraints: Record<
    string,
    Record<string, ColumnConstraint> & { _view?: string }
  > = {};

  for (const table of tables) {
    const tName = toCamelCase(table.name);
    dbConstraints[tName] = {} as any;

    if (table.type === 'view') {
      const match = table.sql.match(/AS\s+(.*)/is);
      if (match) {
        dbConstraints[tName]._view = cleanSQLQuotes(match[1].trim());
      }

      const cols = connection
        .query(`PRAGMA table_info('${table.name}')`)
        .all() as any[];

      for (const col of cols) {
        dbConstraints[tName][toCamelCase(col.name)] = {
          type: mapSqlToTsType(col.type),
          nullable: col.notnull === 0n || col.notnull === 0,
        };
      }
      continue;
    }

    const cols = connection
      .query(`PRAGMA table_info('${table.name}')`)
      .all() as any[];

    for (const col of cols) {
      const type = mapSqlToTsType(col.type);
      const primary = col.pk > 0;
      const nullable = col.notnull === 0 && !primary;
      const isAutoInc =
        primary &&
        type === 'integer' &&
        table.sql &&
        table.sql.toUpperCase().includes('AUTOINCREMENT');

      let defaultValue = col.dflt_value;

      if (defaultValue !== null && defaultValue !== undefined) {
        if (typeof defaultValue === 'string') {
          if (defaultValue.startsWith("'") && defaultValue.endsWith("'")) {
            defaultValue = defaultValue.slice(1, -1);
          } else if (
            defaultValue.startsWith('"') &&
            defaultValue.endsWith('"')
          ) {
            defaultValue = defaultValue.slice(1, -1);
          } else if (defaultValue.toUpperCase() === 'NULL') {
            defaultValue = null;
          } else if (!isNaN(Number(defaultValue))) {
            defaultValue = Number(defaultValue);
          }
        }
      } else {
        defaultValue = undefined;
      }

      const cons: ColumnConstraint = { type };
      if (primary) cons.primary = true;
      if (isAutoInc) cons.autoIncrement = true;
      if (nullable) cons.nullable = true;
      if (defaultValue !== undefined) cons.default = defaultValue;

      dbConstraints[tName][toCamelCase(col.name)] = cons;
    }
  }

  return dbConstraints;
}

function extractIndexesFromDB() {
  const indexes = connection
    .query(
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_autoindex_%'",
    )
    .all() as { name: string; tbl_name: string; sql: string }[];

  const dbIndexes: Record<string, IndexConstraint> = {};

  for (const idx of indexes) {
    const isUnique = idx.sql.toUpperCase().includes('UNIQUE');
    const colsQuery = connection
      .query(`PRAGMA index_info('${idx.name}')`)
      .all() as { name: string }[];
    const cols = colsQuery.map((c) => toCamelCase(c.name));

    dbIndexes[toCamelCase(idx.name)] = {
      type: isUnique ? 'unique' : 'index',
      table: toCamelCase(idx.tbl_name),
      cols: cols,
    };
  }

  return dbIndexes;
}

function structToSQLite(struct: ColumnConstraint) {
  let typeStr = match(struct.type, {
    integer: 'INTEGER',
    string: 'TEXT',
    number: 'REAL',
    boolean: 'INTEGER',
    buffer: 'BLOB',
    [match.default]: 'TEXT',
  });

  let def = typeStr;
  if (struct.primary) def += ' PRIMARY KEY';
  if (struct.autoIncrement) def += ' AUTOINCREMENT';
  if (!struct.nullable && !struct.primary) def += ' NOT NULL';

  if (struct.default !== undefined) {
    if (
      typeof struct.default === 'string' &&
      !struct.default.startsWith('(') &&
      !struct.default.toUpperCase().includes('CAST(') &&
      struct.default !== 'NULL'
    ) {
      def += ` DEFAULT '${struct.default}'`;
    } else if (struct.default === null || struct.default === 'NULL') {
      def += ` DEFAULT NULL`;
    } else {
      def += ` DEFAULT ${struct.default}`;
    }
  }
  return def;
}

async function generateSchemaFile(
  version: number,
  schemaPath: string,
  logger: Logger,
  existingConstraints: Record<string, any> = {},
) {
  MESSAGES.GEN_TYPES({ version });
  const constraints = extractConstraintsFromDB();
  const dbIndexes = extractIndexesFromDB();

  for (const [tableName, cols] of Object.entries(constraints)) {
    if (cols._view) {
      for (const [colName, cons] of Object.entries(
        cols as Record<string, ColumnConstraint>,
      )) {
        if (colName === '_view') continue;

        const existingCol = existingConstraints[tableName]?.[colName];
        if (existingCol) {
          cons.nullable = existingCol.nullable === true;
        } else {
          cons.nullable = false;
        }
      }
    }
  }

  let stringifiedConstraints = '{\n';
  for (const [tableName, cols] of Object.entries(constraints)) {
    stringifiedConstraints += `    ${tableName}: {\n`;
    if (cols._view) {
      stringifiedConstraints += `      _view: \`${cols._view.replace(/`/g, '\\`')}\`,\n`;
    }
    for (const [colName, cons] of Object.entries(
      cols as Record<string, ColumnConstraint>,
    )) {
      if (colName === '_view') continue;
      const t = `'${cons.type}'`;
      const p = cons.primary ?? false;
      const a = cons.autoIncrement ?? false;
      const n = p ? false : (cons.nullable ?? false);

      if (p && cons.type === 'integer' && a) {
        stringifiedConstraints += `      ${colName}: primary(),\n`;
        continue;
      }

      let d: string | undefined = undefined;

      if (p) {
        d = undefined;
      } else if (
        cons.default !== undefined &&
        cons.default !== null &&
        cons.default !== 'NULL'
      ) {
        if (
          typeof cons.default === 'string' &&
          cons.default.replace(/[()]/g, '') ===
            "CAST(strftime('%s', 'now') AS INTEGER)".replace(/[()]/g, '')
        ) {
          d = 'dateNow';
        } else {
          d =
            typeof cons.default === 'string'
              ? JSON.stringify(cons.default)
              : String(cons.default);
        }
      } else if (
        cons.default === null ||
        cons.default === 'NULL' ||
        (!cols._view && n)
      ) {
        d = 'null';
      }

      const defaultN = false;

      const args = [
        t,
        d,
        n === defaultN ? undefined : n,
        a === false ? undefined : a,
        p === false ? undefined : p,
      ];

      while (args.length > 1 && args[args.length - 1] === undefined) {
        args.pop();
      }

      const finalArgs = args.map((arg) =>
        arg === undefined ? 'undefined' : arg,
      );
      stringifiedConstraints += `      ${colName}: value(${finalArgs.join(', ')}),\n`;
    }
    stringifiedConstraints += `    },\n`;
  }
  stringifiedConstraints += '  } as const;\n';

  let stringifiedIndexes = '{\n';
  for (const [idxName, idx] of Object.entries(dbIndexes)) {
    const colsStr =
      idx.cols.length === 1
        ? `'${idx.cols[0]}'`
        : `[${idx.cols.map((c) => `'${c}'`).join(', ')}]`;
    stringifiedIndexes += `    ${idxName}: ${idx.type}('${idx.table}', ${colsStr}),\n`;
  }
  stringifiedIndexes += '  } as const;\n';

  const dbInfoBlock = `import {
  value,
  primary,
  dateNow,
  unique,
  index,
  type ExtractOptionals,
  type ExtractTableTypes,
  type ExtractViews,
} from './schema-util';\n\nexport namespace DBInfo {\n  export const version = ${version};\n\n  export const constraints = ${stringifiedConstraints}\n  export const indexes = ${stringifiedIndexes}\n  type C = typeof constraints;\n  export type Table<T extends keyof C> = ExtractTableTypes<C, T>;\n  export type Optionals<T extends keyof C> = ExtractOptionals<C, T>;\n  export type Views = ExtractViews<C>;\n}\n\nexport type DBSchema = {\n  [T in keyof typeof DBInfo.constraints]: DBInfo.Table<T>;\n};\n\nexport type DBOptionals = {\n  [T in keyof typeof DBInfo.constraints]: DBInfo.Optionals<T>;\n};\n`;

  await Bun.write(schemaPath, dbInfoBlock);
  MESSAGES.SYNC_SUCCESS({ version });
}

export async function syncSQLSchema() {
  const schemaPath = `${import.meta.dir}/schema.ts`;
  const schemaFile = Bun.file(schemaPath);

  const dbVersion = Number(
    (connection.query('PRAGMA user_version').get() as any).user_version,
  );

  let tsVersion = -1;
  let constraints: Record<string, any> = {};
  let tsIndexes: Record<string, IndexConstraint> = {};

  if (await schemaFile.exists()) {
    const [err, schemaModule] = await tryCatch(
      import(`${schemaPath}?t=${Date.now()}`),
    );

    if (err) MESSAGES.INVALID_SCHEMA();

    if (schemaModule?.DBInfo) {
      tsVersion = schemaModule.DBInfo.version ?? -1;
      constraints = schemaModule.DBInfo.constraints ?? {};
      tsIndexes = schemaModule.DBInfo.indexes ?? schemaModule.indexes ?? {};
    } else if (!err) {
      MESSAGES.NO_DBINFO();
    }
  }

  switch (true) {
    case dbVersion >= tsVersion:
    case tsVersion === -1:
      if (dbVersion === tsVersion) {
        MESSAGES.PERFECT_SYNC({ dbVersion });
      } else {
        MESSAGES.DB_NEWER({
          dbVersion,
          tsVersion: tsVersion === -1 ? 'None' : tsVersion,
        });
      }

      await generateSchemaFile(dbVersion, schemaPath, logger, constraints);

      if (process.env.DEV_WATCHER_ACTIVE) process.exit(42);
      break;

    case tsVersion > dbVersion:
      MESSAGES.TS_NEWER({ tsVersion });

      await backupDatabase(dbVersion);

      if (Object.keys(constraints).length === 0) {
        MESSAGES.NO_CONSTRAINTS();
        process.exit(1);
      }

      const tablesToDrop: string[] = [];
      const tablesToRename: { oldName: string; newName: string }[] = [];
      const columnsToDrop: { table: string; column: string }[] = [];

      const columnsToAdd: {
        table: string;
        column: string;
        def: ColumnConstraint;
      }[] = [];
      const tablesToRebuild = new Set<string>();
      const viewsToUpdate: string[] = [];

      const dbConstraintsForDiff = extractConstraintsFromDB();

      const dbTables: Record<
        string,
        { dbName: string; camelName: string; cols: Set<string> }
      > = {};

      for (const [camelTable, tableObj] of Object.entries(
        dbConstraintsForDiff,
      )) {
        if (tableObj._view) continue; // Skip views for table mapping
        dbTables[camelTable] = {
          dbName: toSnakeCase(camelTable),
          camelName: camelTable,
          cols: new Set(Object.keys(tableObj).filter((k) => k !== '_view')),
        };
      }

      const unmappedDbTables = new Set(
        Object.keys(dbTables).filter((camel) => !constraints[camel]),
      );
      const unmappedTsTables = new Set(
        Object.keys(constraints).filter((camel) => !dbTables[camel]),
      );

      for (const oldCamel of [...unmappedDbTables]) {
        const oldCols = dbTables[oldCamel]!.cols;

        let bestAutoMatch: string | null = null;
        let bestScore = 0;
        for (const newCamel of unmappedTsTables) {
          const newCols = Object.keys(constraints[newCamel]).filter(
            (k) => k !== '_view',
          );
          let matchCount = 0;
          for (const col of newCols) {
            if (oldCols.has(col)) matchCount++;
          }

          const score = matchCount / Math.max(oldCols.size, newCols.length);
          if (score > bestScore && score >= 0.5) {
            bestScore = score;
            bestAutoMatch = newCamel;
          }
        }

        const unmappedTsArr = Array.from(unmappedTsTables);
        const promptMsg = `Unmapped database table: '${dbTables[oldCamel]!.dbName}'. What should we do?`;
        const bestMatch = promptForMapping(
          promptMsg,
          bestAutoMatch,
          bestScore,
          unmappedTsArr,
          'table',
        );

        if (bestMatch) {
          tablesToRename.push({
            oldName: dbTables[oldCamel]!.dbName,
            newName: toSnakeCase(bestMatch),
          });
          unmappedDbTables.delete(oldCamel);
          unmappedTsTables.delete(bestMatch);

          dbTables[bestMatch] = dbTables[oldCamel];
          dbTables[bestMatch].camelName = bestMatch;
          delete dbTables[oldCamel];
        } else {
          tablesToDrop.push(dbTables[oldCamel].dbName);
        }
      }

      const columnsToRename: {
        table: string;
        oldColumn: string;
        newColumn: string;
      }[] = [];

      for (const camelTable of Object.keys(dbTables)) {
        if (!constraints[camelTable]) continue;

        const isTsView = !!constraints[camelTable]._view;
        const isDbView = !!dbConstraintsForDiff[camelTable]?._view;

        if (isTsView || isDbView) {
          const tsViewStr = String(constraints[camelTable]._view || '')
            .replace(/\s+/g, ' ')
            .trim();
          const dbViewStr = String(
            dbConstraintsForDiff[camelTable]?._view || '',
          )
            .replace(/\s+/g, ' ')
            .trim();

          if (tsViewStr !== dbViewStr) {
            viewsToUpdate.push(dbTables[camelTable].dbName);
          }

          if (isTsView && !isDbView) {
            tablesToDrop.push(dbTables[camelTable].dbName);
          }

          continue; // Skip column diffing for views!
        }

        const existingDbCamelCols = new Set(
          Object.keys(dbConstraintsForDiff[camelTable] || {}).filter(
            (k) => k !== '_view',
          ),
        );

        const unmappedDbCols = new Set<string>();
        for (const camelCol of existingDbCamelCols) {
          if (!constraints[camelTable][camelCol]) {
            unmappedDbCols.add(toSnakeCase(camelCol));
          }
        }

        const unmappedTsCols = new Set(
          Object.keys(constraints[camelTable]).filter(
            (camel) => !existingDbCamelCols.has(camel) && camel !== '_view',
          ),
        );

        for (const oldDbCol of [...unmappedDbCols]) {
          if (unmappedTsCols.size > 0) {
            let bestAutoMatch: string | null = null;
            let bestScore = 0;

            for (const newCamel of unmappedTsCols) {
              const score = getStringSimilarity(
                oldDbCol,
                toSnakeCase(newCamel),
              );
              if (score > bestScore && score >= 0.3) {
                bestScore = score;
                bestAutoMatch = newCamel;
              }
            }

            const unmappedTsArr = Array.from(unmappedTsCols);
            const promptMsg = `Unmapped column '${oldDbCol}' in table '${dbTables[camelTable].dbName}'. What should we do?`;
            const bestMatch = promptForMapping(
              promptMsg,
              bestAutoMatch,
              bestScore,
              unmappedTsArr,
              'column',
            );

            if (bestMatch) {
              columnsToRename.push({
                table: dbTables[camelTable].dbName,
                oldColumn: oldDbCol,
                newColumn: toSnakeCase(bestMatch),
              });
              unmappedDbCols.delete(oldDbCol);
              unmappedTsCols.delete(bestMatch);

              const oldCamel = toCamelCase(oldDbCol);
              if (
                dbConstraintsForDiff[camelTable] &&
                dbConstraintsForDiff[camelTable][oldCamel]
              ) {
                dbConstraintsForDiff[camelTable][bestMatch] =
                  dbConstraintsForDiff[camelTable][oldCamel];
                delete dbConstraintsForDiff[camelTable][oldCamel];
              }
              existingDbCamelCols.delete(oldCamel);
              existingDbCamelCols.add(bestMatch);
            } else {
              columnsToDrop.push({
                table: dbTables[camelTable].dbName,
                column: oldDbCol,
              });
            }
          } else {
            columnsToDrop.push({
              table: dbTables[camelTable].dbName,
              column: oldDbCol,
            });
          }
        }

        for (const newCamel of unmappedTsCols) {
          columnsToAdd.push({
            table: dbTables[camelTable].dbName,
            column: toSnakeCase(newCamel),
            def: constraints[camelTable][newCamel],
          });
        }

        for (const camelCol of existingDbCamelCols) {
          if (unmappedDbCols.has(toSnakeCase(camelCol))) continue;

          const tsCol = constraints[camelTable][camelCol];
          const dbCol = dbConstraintsForDiff[camelTable]?.[camelCol];

          if (tsCol && dbCol) {
            const tsNullable = tsCol.primary ? false : tsCol.nullable === true;
            const dbNullable = dbCol.primary ? false : dbCol.nullable === true;

            const tsDefault =
              tsCol.default === undefined ? null : tsCol.default;
            const dbDefault =
              dbCol.default === undefined ? null : dbCol.default;

            const isTypeMatch =
              tsCol.type === dbCol.type ||
              (tsCol.type === 'boolean' && dbCol.type === 'integer');

            if (
              tsNullable !== dbNullable ||
              !isTypeMatch ||
              String(tsDefault) !== String(dbDefault)
            ) {
              MESSAGES.COL_MISMATCH({
                table: dbTables[camelTable].dbName,
                column: camelCol,
              });
              MESSAGES.COL_MISMATCH_TS({
                tsType: tsCol.type,
                tsNullable: String(tsNullable),
                tsDefault: String(tsDefault),
              });
              MESSAGES.COL_MISMATCH_DB({
                dbType: dbCol.type,
                dbNullable: String(dbNullable),
                dbDefault: String(dbDefault),
              });
              tablesToRebuild.add(dbTables[camelTable].dbName);
            }
          }
        }
      }

      const dbIndexesForDiff = extractIndexesFromDB();
      const indexesToDrop = new Set<string>();
      const indexesToAdd = new Map<string, IndexConstraint>();

      for (const [dbIdxName, dbIdx] of Object.entries(dbIndexesForDiff)) {
        const tsIdx = tsIndexes[dbIdxName];
        const isTableRebuilt = tablesToRebuild.has(toSnakeCase(dbIdx.table));

        if (!tsIdx) {
          indexesToDrop.add(toSnakeCase(dbIdxName));
        } else {
          const tsCols = tsIdx.cols;
          const dbCols = dbIdx.cols;

          const isModified =
            tsIdx.type !== dbIdx.type ||
            tsIdx.table !== dbIdx.table ||
            tsCols.join(',') !== dbCols.join(',');

          if (isModified || isTableRebuilt) {
            if (!isTableRebuilt) indexesToDrop.add(toSnakeCase(dbIdxName));
            indexesToAdd.set(toSnakeCase(dbIdxName), tsIdx);
          }
        }
      }

      for (const [tsIdxName, tsIdx] of Object.entries(tsIndexes)) {
        if (!dbIndexesForDiff[tsIdxName]) {
          indexesToAdd.set(toSnakeCase(tsIdxName), tsIdx);
        }
      }

      const isDangerous =
        tablesToDrop.length > 0 ||
        tablesToRename.length > 0 ||
        columnsToDrop.length > 0 ||
        columnsToRename.length > 0 ||
        tablesToRebuild.size > 0;
      const hasAnyChanges =
        isDangerous ||
        columnsToAdd.length > 0 ||
        viewsToUpdate.length > 0 ||
        indexesToDrop.size > 0 ||
        indexesToAdd.size > 0;

      if (hasAnyChanges) {
        if (isDangerous) MESSAGES.DANGER_ZONE();

        if (tablesToDrop.length > 0)
          MESSAGES.DROP_TABLES({ tables: tablesToDrop.join(', ') });
        if (tablesToRename.length > 0)
          MESSAGES.RENAME_TABLES({
            tables: tablesToRename
              .map((t) => `${t.oldName} -> ${t.newName}`)
              .join(', '),
          });
        if (columnsToDrop.length > 0)
          MESSAGES.DROP_COLS({
            cols: columnsToDrop.map((c) => `${c.table}.${c.column}`).join(', '),
          });
        if (columnsToRename.length > 0)
          MESSAGES.RENAME_COLS({
            cols: columnsToRename
              .map((c) => `${c.table}.${c.oldColumn} -> ${c.newColumn}`)
              .join(', '),
          });
        if (columnsToAdd.length > 0)
          MESSAGES.ADD_COLS({
            cols: columnsToAdd.map((c) => `${c.table}.${c.column}`).join(', '),
          });
        if (tablesToRebuild.size > 0)
          MESSAGES.REBUILD_TABLES({
            tables: Array.from(tablesToRebuild).join(', '),
          });
        if (viewsToUpdate.length > 0)
          MESSAGES.UPDATE_VIEWS({ views: viewsToUpdate.join(', ') });
        if (indexesToDrop.size > 0)
          MESSAGES.DROP_INDEXES({
            indexes: Array.from(indexesToDrop).join(', '),
          });
        if (indexesToAdd.size > 0)
          MESSAGES.ADD_INDEXES({
            indexes: Array.from(indexesToAdd.keys()).join(', '),
          });

        if (isDangerous) {
          MESSAGES.REVIEW_WARNING();
          if (!logger.confirm('Proceed with sync?')) {
            MESSAGES.SYNC_ABORTED();
            process.exit(0);
          }
        }
      }

      connection.query('PRAGMA foreign_keys=OFF').run();
      connection.query('BEGIN TRANSACTION').run();

      try {
        for (const idx of indexesToDrop) {
          MESSAGES.EXEC_DROP_INDEX({ idx });
          connection.query(`DROP INDEX IF EXISTS \`${idx}\``).run();
        }

        for (const { oldName, newName } of tablesToRename) {
          MESSAGES.EXEC_RENAME_TABLE({ oldName, newName });
          connection
            .query(`ALTER TABLE \`${oldName}\` RENAME TO \`${newName}\``)
            .run();
          for (const col of columnsToDrop)
            if (col.table === oldName) col.table = newName;
          for (const col of columnsToRename)
            if (col.table === oldName) col.table = newName;
        }

        for (const { table, oldColumn, newColumn } of columnsToRename) {
          MESSAGES.EXEC_RENAME_COL({ table, oldColumn, newColumn });
          connection
            .query(
              `ALTER TABLE \`${table}\` RENAME COLUMN \`${oldColumn}\` TO \`${newColumn}\``,
            )
            .run();
        }

        for (const table of tablesToDrop) {
          const tType = dbConstraintsForDiff[toCamelCase(table)]?._view
            ? 'view'
            : 'table';
          MESSAGES.EXEC_DROP_TABLE({ type: tType, table });
          connection.query(`DROP ${tType.toUpperCase()} \`${table}\``).run();
        }

        for (const { table, column } of columnsToDrop) {
          MESSAGES.EXEC_DROP_COL({ table, column });
          connection
            .query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``)
            .run();
        }

        for (const { table, column, def } of columnsToAdd) {
          MESSAGES.EXEC_ADD_COL({ table, column });
          connection
            .query(
              `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${structToSQLite(def)}`,
            )
            .run();
        }

        const existingViews = connection
          .query("SELECT name FROM sqlite_master WHERE type='view'")
          .all() as { name: string }[];
        for (const view of existingViews) {
          connection.query(`DROP VIEW IF EXISTS \`${view.name}\``).run();
        }

        for (const table of tablesToRebuild) {
          MESSAGES.EXEC_REBUILD({ table });
          const camelTable = toCamelCase(table);
          const tempName = `${table}_temp_build`;

          const colDefs = Object.entries(
            constraints[camelTable] as Record<string, ColumnConstraint>,
          ).map(
            ([name, cons]) =>
              `  \`${toSnakeCase(name)}\` ${structToSQLite(cons)}`,
          );

          const sql = `CREATE TABLE \`${tempName}\` (\n${colDefs.join(',\n')}\n);`;
          connection.query(sql).run();

          const currentDbColsQuery = connection
            .query(`PRAGMA table_info(\`${table}\`)`)
            .all() as { name: string }[];
          const currentDbCols = new Set(currentDbColsQuery.map((c) => c.name));

          const sharedCols = Object.keys(constraints[camelTable])
            .map(toSnakeCase)
            .filter((c) => currentDbCols.has(c))
            .map((c) => `\`${c}\``)
            .join(', ');

          if (sharedCols) {
            connection
              .query(
                `INSERT INTO \`${tempName}\` (${sharedCols}) SELECT ${sharedCols} FROM \`${table}\``,
              )
              .run();
          }
          connection.query(`DROP TABLE \`${table}\``).run();
          connection
            .query(`ALTER TABLE \`${tempName}\` RENAME TO \`${table}\``)
            .run();
        }

        for (const [tableName, cols] of Object.entries(constraints)) {
          if (cols._view) {
            MESSAGES.EXEC_SYNC_VIEW({ view: toSnakeCase(tableName) });
            connection
              .query(
                `CREATE VIEW \`${toSnakeCase(tableName)}\` AS ${cols._view}`,
              )
              .run();
          } else {
            const colDefs = Object.entries(
              cols as Record<string, ColumnConstraint>,
            ).map(
              ([name, cons]) =>
                `  \`${toSnakeCase(name)}\` ${structToSQLite(cons)}`,
            );

            const sql = `CREATE TABLE IF NOT EXISTS \`${toSnakeCase(tableName)}\` (\n${colDefs.join(',\n')}\n);`;
            MESSAGES.EXEC_SYNC_CONS({ table: toSnakeCase(tableName) });
            connection.query(sql).run();
          }
        }

        for (const [idxName, def] of indexesToAdd.entries()) {
          MESSAGES.EXEC_ADD_INDEX({ type: def.type, name: idxName });
          const cols = def.cols;
          const colsSql = cols.map((c) => `\`${toSnakeCase(c)}\``).join(', ');
          const uniqueStr = def.type === 'unique' ? 'UNIQUE ' : '';
          connection
            .query(
              `CREATE ${uniqueStr}INDEX \`${idxName}\` ON \`${toSnakeCase(def.table)}\` (${colsSql})`,
            )
            .run();
        }

        connection.query(`PRAGMA user_version = ${tsVersion}`).run();
        connection.query('COMMIT').run();
        MESSAGES.CATCH_UP_SUCCESS({ tsVersion });
      } catch (err) {
        connection.query('ROLLBACK').run();
        MESSAGES.FATAL_ERROR({ error: String(err) });
        process.exit(1);
      } finally {
        connection.query('PRAGMA foreign_keys=ON').run();
      }

      await generateSchemaFile(tsVersion, schemaPath, logger, constraints);

      if (process.env.DEV_WATCHER_ACTIVE) process.exit(42);
  }
}

if (import.meta.main) await syncSQLSchema();
