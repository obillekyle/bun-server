import { connection } from './conn';
import { toSnakeCase } from '../.server/strings';
import type { DBSchema, DBOptionals, DBInfo } from './schema';

export namespace Mutation {
  export type Tables = Exclude<keyof DBSchema, DBInfo.Views> | (string & {});

  export type ValidOptionals<T extends keyof DBSchema> =
    T extends keyof DBOptionals
      ? Extract<DBOptionals[T], keyof DBSchema[T]>
      : never;

  export type Prettify<T> = { [K in keyof T]: T[K] } & {};

  export type InsertSchema<T extends Tables> = T extends keyof DBSchema
    ? Prettify<
        Omit<DBSchema[T], ValidOptionals<T>> &
          Partial<Pick<DBSchema[T], ValidOptionals<T>>>
      >
    : Record<string, any>;

  export type UpdateSchema<T extends Tables> = Partial<InsertSchema<T>>;

  export interface RunResult {
    lastInsertRowid: number | bigint;
    changes: number;
  }

  export class MutationExistsExecutable {
    constructor(
      private sql: string,
      private params: any[],
    ) {}
    async run(): Promise<boolean> {
      const result = connection.query(this.sql).get(...this.params);
      return !!result;
    }
    then<TR1 = boolean, TR2 = never>(
      onfulfilled?: ((v: boolean) => TR1 | PromiseLike<TR1>) | null,
      onrejected?: ((r: any) => TR2 | PromiseLike<TR2>) | null,
    ): Promise<TR1 | TR2> {
      return this.run().then(onfulfilled, onrejected);
    }
  }

  export class Insert<T extends Tables> {
    constructor(private _table: string) {}
    static into<T extends Tables>(table: T): Insert<T> {
      return new Insert(table as string);
    }

    values(...records: InsertSchema<T>[]): InsertExecutable {
      return new InsertExecutable(this._table, records);
    }
  }

  export class InsertExecutable {
    constructor(
      private _table: string,
      private _records: Record<string, any>[],
    ) {}
    parse(): { sql: string; params: any[] } {
      if (this._records.length === 0) throw new Error('Empty insert');

      const keySet = new Set<string>();
      for (const record of this._records) {
        for (const key of Object.keys(record)) {
          keySet.add(key);
        }
      }

      const keys = Array.from(keySet);
      const columns = keys.map((k) => `\`${toSnakeCase(k)}\``).join(', ');

      const placeholders = this._records
        .map(() => `(${keys.map(() => '?').join(', ')})`)
        .join(', ');

      const params = this._records.flatMap((record) =>
        keys.map((k) => record[k] ?? null),
      );

      return {
        sql: `INSERT INTO \`${toSnakeCase(this._table)}\` (${columns}) VALUES ${placeholders}`,
        params,
      };
    }
    async run(): Promise<RunResult> {
      const { sql, params } = this.parse();
      return connection.query(sql).run(...params);
    }
    then<TR1 = RunResult, TR2 = never>(
      onf?: ((v: RunResult) => TR1 | PromiseLike<TR1>) | null,
      onr?: ((r: any) => TR2 | PromiseLike<TR2>) | null,
    ): Promise<TR1 | TR2> {
      return this.run().then(onf, onr);
    }
  }

  export class Update<T extends Tables> {
    constructor(private _table: string) {}
    static table<T extends Tables>(table: T): Update<T> {
      return new Update(table as string);
    }
    set(data: UpdateSchema<T>): UpdateWithWhere<T> {
      return new UpdateWithWhere(this._table, data);
    }
  }

  export class UpdateWithWhere<T extends Tables> {
    constructor(
      private _table: string,
      private _data: Record<string, any>,
    ) {}
    where(left: any, operator: string, right: any): UpdateExecutable {
      return new UpdateExecutable(this._table, this._data, {
        left,
        operator,
        right,
      });
    }
  }

  export class UpdateExecutable {
    constructor(
      private _table: string,
      private _data: Record<string, any>,
      private _whereClause: any,
    ) {}

    private evalOperands(where: any, params: any[]): string {
      switch (true) {
        case Array.isArray(where):
          return `(${where.map((v) => this.evalOperands(v, params)).join(', ')})`;
        case where === null:
          return 'NULL';
        case typeof where === 'object': {
          const [key, val] = Object.entries(where)[0]!;
          const sqlFunctions = [
            'UPPER',
            'LOWER',
            'LENGTH',
            'TRIM',
            'CONCAT',
            'SUBSTR',
            'REPLACE',
          ];
          if (sqlFunctions.includes(key))
            return `${key}(${(Array.isArray(val) ? val : [val]).map((arg) => this.evalOperands(arg, params)).join(', ')})`;
          return `\`${toSnakeCase(key)}\`.\`${toSnakeCase(val as string)}\``;
        }
        case typeof where === 'boolean':
          return where ? 'TRUE' : 'FALSE';
        default:
          params.push(where);
          return '?';
      }
    }

    parse(): { sql: string; params: any[] } {
      const params: any[] = [];
      const setClauses = Object.keys(this._data)
        .map((key) => {
          const value = this._data[key];
          params.push(value);
          return `\`${toSnakeCase(key)}\` = ?`;
        })
        .join(', ');

      const left = this.evalOperands(this._whereClause.left, params);
      const right = this.evalOperands(this._whereClause.right, params);
      return {
        sql: `UPDATE \`${toSnakeCase(this._table)}\` SET ${setClauses} WHERE ${left} ${this._whereClause.operator} ${right}`,
        params,
      };
    }

    exists(): MutationExistsExecutable {
      const params: any[] = [];
      const left = this.evalOperands(this._whereClause.left, params);
      const right = this.evalOperands(this._whereClause.right, params);
      return new MutationExistsExecutable(
        `SELECT 1 FROM \`${toSnakeCase(this._table)}\` WHERE ${left} ${this._whereClause.operator} ${right} LIMIT 1`,
        params,
      );
    }

    async run(): Promise<RunResult> {
      const { sql, params } = this.parse();
      return connection.query(sql).run(...params);
    }
    then<TR1 = RunResult, TR2 = never>(
      onf?: ((v: RunResult) => TR1 | PromiseLike<TR1>) | null,
      onr?: ((r: any) => TR2 | PromiseLike<TR2>) | null,
    ): Promise<TR1 | TR2> {
      return this.run().then(onf, onr);
    }
  }

  export class Delete<T extends Tables> {
    constructor(private _table: string) {}
    static from<T extends Tables>(table: T): Delete<T> {
      return new Delete(table as string);
    }
    where(left: any, operator: string, right: any): DeleteExecutable {
      return new DeleteExecutable(this._table, { left, operator, right });
    }
  }

  export class DeleteExecutable {
    constructor(
      private _table: string,
      private _whereClause: any,
    ) {}

    private evalOperands(where: any, params: any[]): string {
      switch (true) {
        case Array.isArray(where):
          return `(${where.map((v) => this.evalOperands(v, params)).join(', ')})`;
        case where === null:
          return 'NULL';
        case typeof where === 'object': {
          const [key, val] = Object.entries(where)[0]!;
          const sqlFunctions = [
            'UPPER',
            'LOWER',
            'LENGTH',
            'TRIM',
            'CONCAT',
            'SUBSTR',
            'REPLACE',
          ];
          if (sqlFunctions.includes(key))
            return `${key}(${(Array.isArray(val) ? val : [val]).map((arg) => this.evalOperands(arg, params)).join(', ')})`;
          return `\`${toSnakeCase(key)}\`.\`${toSnakeCase(val as string)}\``;
        }
        case typeof where === 'boolean':
          return where ? 'TRUE' : 'FALSE';
        default:
          params.push(where);
          return '?';
      }
    }

    parse(): { sql: string; params: any[] } {
      const params: any[] = [];
      const left = this.evalOperands(this._whereClause.left, params);
      const right = this.evalOperands(this._whereClause.right, params);
      return {
        sql: `DELETE FROM \`${toSnakeCase(this._table)}\` WHERE ${left} ${this._whereClause.operator} ${right}`,
        params,
      };
    }

    exists(): MutationExistsExecutable {
      const params: any[] = [];
      const left = this.evalOperands(this._whereClause.left, params);
      const right = this.evalOperands(this._whereClause.right, params);
      return new MutationExistsExecutable(
        `SELECT 1 FROM \`${toSnakeCase(this._table)}\` WHERE ${left} ${this._whereClause.operator} ${right} LIMIT 1`,
        params,
      );
    }

    async run(): Promise<RunResult> {
      const { sql, params } = this.parse();
      return connection.query(sql).run(...params);
    }
    then<TR1 = RunResult, TR2 = never>(
      onf?: ((v: RunResult) => TR1 | PromiseLike<TR1>) | null,
      onr?: ((r: any) => TR2 | PromiseLike<TR2>) | null,
    ): Promise<TR1 | TR2> {
      return this.run().then(onf, onr);
    }
  }
}

let hoverME;
