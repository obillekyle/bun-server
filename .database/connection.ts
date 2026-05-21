import type { DBSchema } from './schema';
import { toSnakeCase } from '@server/utils/strings';
import { Mutation } from './mutation';
import { connection } from './conn';

export namespace DB {
  export function safeColumn(col: string): string {
    const parts = col.split('.');
    return parts
      .map((part) => {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part)) {
          throw new Error(`Invalid or unsafe column/table name: ${part}`);
        }
        return `\`${toSnakeCase(part)}\``;
      })
      .join('.');
  }

  export type Tables = keyof DBSchema | (string & {});

  export type TableSchemas = DBSchema & {
    [key: string]: any;
  };

  export type ValidAlias<A> = A extends string
    ? A extends ''
      ? never
      : A
    : never;

  export type NewTable<
    S extends TableSchemas,
    A extends string | undefined,
    T extends string,
  > =
    ValidAlias<A> extends never ? S : S & Record<ValidAlias<A>, S[T & keyof S]>;

  export type ExactlyOne<T> = {
    [K in keyof T]: { [P in K]: T[P] } & { [P in Exclude<keyof T, K>]?: never };
  }[keyof T];

  export type AnyString = {
    charAt(onlyToAllowStringsDontUse: number): string;
  };

  export type FilteredGroups<S, J extends string, G> = {
    [Table in keyof S]: Table extends J
      ? Table extends keyof G
        ? Pick<
            S[Table],
            Extract<
              G[Table] extends readonly any[] ? G[Table][number] : G[Table],
              keyof S[Table]
            >
          >
        : S[Table]
      : S[Table];
  };

  export type TakeSelectValues<S, C> = {
    [A in keyof C]: {
      [K in keyof S]: C[A] extends { [P in K]: infer ColName }
        ? ColName extends keyof S[K]
          ? S[K][ColName]
          : never
        : never;
    }[keyof S];
  };

  export type TakeSelectMathValues<C> = {
    [K in keyof C]: number;
  };

  export type SQLOperators = '=' | '>' | '<' | '>=' | '<=' | '<>';
  export type ValuesOperators = 'IN' | 'NOT IN';

  export type ColumnRef<S, J extends string> = ExactlyOne<{
    [K in Extract<J, keyof S>]: keyof S[K];
  }>;

  export type SQLFuncArg<S, J extends string> =
    | AnyString
    | number
    | ColumnRef<S, J>;

  export type SQLStringFunctions<S, J extends string> = ExactlyOne<{
    UPPER: SQLFuncArg<S, J>;
    LOWER: SQLFuncArg<S, J>;
    LENGTH: SQLFuncArg<S, J>;
    TRIM: SQLFuncArg<S, J>;
    CONCAT: SQLFuncArg<S, J>[];
    SUBSTR: [SQLFuncArg<S, J>, number, number?] | [SQLFuncArg<S, J>, number];
    REPLACE: [SQLFuncArg<S, J>, string, string];
  }>;

  export type WhereValue<S, J extends string> =
    | AnyString
    | null
    | number
    | boolean
    | ColumnRef<S, J>
    | SQLStringFunctions<S, J>;

  export type WhereClause<
    S extends TableSchemas,
    J extends string,
    K = WhereValue<S, J>,
    R = QBWhere<S, J>,
  > = {
    (left: K, operator: SQLOperators, right: K): R;
    (left: K, operator: ValuesOperators, right: K[]): R;
    (left: K, operator: 'IS' | 'IS NOT', right: K | 'NULL'): R;
    (left: K, operator: 'LIKE', right: string | number): R;
    (left: K, operator: AnyString, right: K): R;
  };

  export type HavingClause<
    F extends FilteredGroups<TableSchemas, any, any>,
    J extends string,
    P,
    R = QBHaving<any, any, F, P>,
    K =
      | ColumnRef<F, J>
      | SQLStringFunctions<F, J>
      | keyof P
      | number
      | boolean
      | null
      | AnyString,
  > = {
    (left: K, operator: SQLOperators, right: K): R;
    (left: K, operator: ValuesOperators, right: K[]): R;
    (left: K, operator: 'IS' | 'IS NOT', right: K | 'NULL'): R;
    (left: K, operator: 'LIKE', right: string | number): R;
    (left: K, operator: AnyString, right: K): R;
  };

  export type SelectMathArgs<F, J extends string, P> = {
    [alias: string]: ExactlyOne<{
      [Op in 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT']:
        | ColumnRef<F, J>
        | keyof P
        | '*';
    }>;
  };

  export type SelectColumns<S, J extends string> = {
    [alias: string]: ColumnRef<S, J>;
  };

  export type CTEAllowed<
    S extends TableSchemas,
    J extends string,
    F extends FilteredGroups<S, J, any>,
    P,
  > =
    | QBSelectAll<S, J, F, P>
    | QBSelect<S, J, F, P>
    | QBHaving<S, J, F, P>
    | QBOrderBy<S, J, F, P>
    | QBLimit<S, J, F, P>;

  export function buildSQL(node: any): { sql: string; params: any[] } {
    let qLimit = '';
    let qOrder = '';
    let qHaving = '';
    let qSelect = '*';
    let qGroup = '';
    let qWhere = '';
    let qFrom = '';
    let qJoin = '';
    let qWith = '';
    let root: any = null;
    let cteParams: any[] = [];
    let isExistsCheck = false;

    let selectParts: string[] = [];

    let curr = node;
    while (curr) {
      switch (true) {
        case curr._isExistsNode:
          isExistsCheck = true;
          qLimit = ' LIMIT 1';
          break;
        case curr._limit !== undefined:
          if (!isExistsCheck)
            qLimit = ` LIMIT ${curr._limit}${curr._offset !== undefined ? ` OFFSET ${curr._offset}` : ''}`;
          break;
        case curr._orderBy !== undefined && curr._orderBy !== '':
          qOrder = ` ORDER BY ${curr._orderBy}`;
          break;
        case curr._having !== undefined &&
          Array.isArray(curr._having) &&
          curr._having.length > 0:
          qHaving = ` HAVING ${curr._having.join('')}`;
          break;
        case curr._isSelectNode: {
          const localParts: string[] = [];
          if (curr._selectAllAlias)
            localParts.push(`\`${curr._selectAllAlias}\`.*`);
          if (curr._select && Object.keys(curr._select).length > 0) {
            for (const [alias, colObj] of Object.entries(curr._select)) {
              const tbl = Object.keys(colObj as any)[0]!;
              const col = Object.values(colObj as any)[0];
              localParts.push(
                `\`${toSnakeCase(tbl)}\`.\`${toSnakeCase(col as string)}\` AS \`${alias}\``,
              );
            }
          }
          if (
            curr._selectFunctions &&
            Object.keys(curr._selectFunctions).length > 0
          ) {
            for (const [alias, funcObj] of Object.entries(
              curr._selectFunctions,
            )) {
              const funcName = Object.keys(funcObj as any)[0];
              const arg = Object.values(funcObj as any)[0];
              if (arg === '*')
                localParts.push(`${funcName}(*) AS \`${alias}\``);
              else if (typeof arg === 'object') {
                const tbl = Object.keys(arg as any)[0]!;
                const col = Object.values(arg as any)[0];
                localParts.push(
                  `${funcName}(\`${toSnakeCase(tbl)}\`.\`${toSnakeCase(col as string)}\`) AS \`${alias}\``,
                );
              } else
                localParts.push(
                  `${funcName}(\`${arg as string}\`) AS \`${alias}\``,
                );
            }
          }
          selectParts.unshift(...localParts);
          break;
        }
        case curr._groupBy !== undefined && curr._groupBy !== '':
          qGroup = ` GROUP BY ${curr._groupBy}`;
          break;
        case curr._where !== undefined &&
          Array.isArray(curr._where) &&
          curr._where.length > 0:
          qWhere = curr._where.join('');
          break;
        case curr._table !== undefined && curr._table !== '':
          root = curr;

          qFrom = `FROM \`${toSnakeCase(curr._table)}\`${curr._alias && curr._alias !== curr._table ? ` AS \`${curr._alias}\`` : ''}`;

          if (curr._join && Object.keys(curr._join).length > 0) {
            const joinParts: string[] = [];
            for (const [tbl, jd] of Object.entries(curr._join) as any) {
              const onKeys = Object.keys(jd.on) as [string, string];
              if (onKeys.length >= 2) {
                joinParts.push(
                  `INNER JOIN \`${toSnakeCase(tbl)}\` AS \`${jd.alias}\` ON \`${onKeys[0]}\`.\`${toSnakeCase(jd.on[onKeys[0]] as string)}\` = \`${onKeys[1]}\`.\`${toSnakeCase(jd.on[onKeys[1]] as string)}\``,
                );
              }
            }
            if (joinParts.length > 0) qJoin = ' ' + joinParts.join(' ');
          }

          if (curr._with && Object.keys(curr._with).length > 0) {
            const withParts: string[] = [];
            for (const [cteAlias, qb] of Object.entries(curr._with) as any) {
              const parsedCTE = buildSQL(qb);
              withParts.push(`\`${cteAlias}\` AS (${parsedCTE.sql})`);
              cteParams.push(...parsedCTE.params);
            }
            if (withParts.length > 0) qWith = `WITH ${withParts.join(', ')} `;
          }
          break;
      }
      curr = curr._previous;
    }

    if (isExistsCheck) qSelect = '1';
    else if (selectParts.length > 0) qSelect = selectParts.join(', ');

    const sql = `${qWith}SELECT ${qSelect} ${qFrom}${qJoin}${qWhere}${qGroup}${qHaving}${qOrder}${qLimit}`;
    return { sql, params: [...cteParams, ...(root ? root._param : [])] };
  }

  export abstract class QBExecutable<P> {
    abstract parse(): { sql: string; params: any[] };

    private mapRowsOptimized(rows: any[]): P[] {
      switch (true) {
        case !rows || rows.length === 0:
          return rows as any;
        case typeof rows[0] !== 'object':
          return rows as any;
        default: {
          const keyMap: Record<string, string> = {};
          for (const key in rows[0]) {
            keyMap[key] = key.replace(/_([a-z0-9])/gi, (_, letter) =>
              letter.toUpperCase(),
            );
          }
          return rows.map((row) => {
            const mapped: any = {};
            for (const key in keyMap) {
              mapped[keyMap[key]!] = row[key];
            }
            return mapped;
          }) as P[];
        }
      }
    }

    async *iterable(): AsyncIterable<P> {
      const { sql, params } = this.parse();
      let keyMap: Record<string, string> | null = null;
      for (const row of connection.query(sql).iterate(...params)) {
        switch (true) {
          case typeof row !== 'object':
            yield row as P;
            break;
          default:
            if (!keyMap) {
              keyMap = {};
              for (const key in row as any) {
                keyMap[key] = key.replace(/_([a-z0-9])/gi, (_, letter) =>
                  letter.toUpperCase(),
                );
              }
            }
            const mapped: any = {};
            for (const key in keyMap) {
              mapped[keyMap[key]!] = (row as any)[key];
            }
            yield mapped as P;
        }
      }
    }

    async array(): Promise<P[]> {
      const { sql, params } = this.parse();
      const results = connection.query(sql).all(...params) as any[];
      return this.mapRowsOptimized(results);
    }

    async column<C = unknown>(): Promise<C[]> {
      const { sql, params } = this.parse();
      return connection
        .query(sql)
        .values(...params)
        .map((row: any) => row[0]) as C[];
    }

    async fetch(): Promise<P | undefined> {
      const { sql, params } = this.parse();
      const result = connection.query(sql).get(...params);
      if (!result) return undefined;
      return this.mapRowsOptimized([result])[0];
    }

    then<TR1 = P[], TR2 = never>(
      onfulfilled?: ((v: P[]) => TR1 | PromiseLike<TR1>) | null,
      onrejected?: ((r: any) => TR2 | PromiseLike<TR2>) | null,
    ): Promise<TR1 | TR2> {
      return this.array().then(onfulfilled, onrejected);
    }
  }

  export class QBRaw<T = any> extends QBExecutable<T> {
    private _sql: string;
    private _params: any[];

    constructor(sql: string, params: any[] = []) {
      super();
      this._sql = sql;
      this._params = params;
    }

    parse(): { sql: string; params: any[] } {
      return { sql: this._sql, params: this._params };
    }
  }

  export class QB<
    S extends TableSchemas = TableSchemas,
    J extends string = never,
  > {
    private _with: Partial<Record<Tables, QB>> = {};
    private _join: Partial<Record<Tables, { alias: string; on: string }>> = {};
    private _table: string = '';
    private _alias: string = '';
    public _param: any[] = [];

    private constructor(table: string) {
      this._table = table;
    }

    static with<P, N extends string>(
      qb: CTEAllowed<any, any, any, P>,
      name: N,
    ): WithQB<TableSchemas & Record<N, P>, N> {
      const withQB = new (WithQB as any)();
      return withQB.with(qb, name);
    }

    static table<T extends Tables, A extends string | undefined = undefined>(
      name: T,
      as?: A,
    ): QB<
      NewTable<TableSchemas, A, Extract<T, string>>,
      Extract<T, string> | ValidAlias<A>
    > {
      const qb = new QB(name as string);
      qb._alias = as || (name as string);
      return qb as any;
    }

    static from = QB.table;

    join<
      T extends Extract<keyof S, string>,
      A extends string | undefined = undefined,
    >(
      table: T,
      on: { [K in J]?: keyof S[K] } & {
        [K2 in ValidAlias<A> extends never ? T : ValidAlias<A>]?: keyof S[T];
      },
      as?: A,
    ): QB<NewTable<S, A, T> & S, J | T | ValidAlias<A>> {
      this._join[table as any] = { alias: as || table, on } as any;
      return this as any;
    }
    JOIN<
      T extends Extract<keyof S, string>,
      A extends string | undefined = undefined,
    >(
      table: T,
      on: { [K in J]?: keyof S[K] } & {
        [K2 in ValidAlias<A> extends never ? T : ValidAlias<A>]?: keyof S[T];
      },
      as?: A,
    ): QB<NewTable<S, A, T> & S, J | T | ValidAlias<A>> {
      return this.join(table, on, as);
    }

    where: WhereClause<S, J> = (left: any, operator: any, right: any) => {
      const [str, params] = QBWhere.evalClause(left, operator, right);
      this._param.push(...params);
      return new (QBWhere as any)(this, ' WHERE ' + str);
    };
    WHERE: WhereClause<S, J> = (left: any, operator: any, right: any) => {
      return (this.where as any)(left, operator, right);
    };

    select<
      C extends SelectColumns<S, J>,
      P extends TakeSelectValues<FilteredGroups<S, J, {}>, C>,
    >(columns: C): QBSelect<S, J, FilteredGroups<S, J, {}>, P> {
      return new (QBSelect as any)(this, columns);
    }
    SELECT<
      C extends SelectColumns<S, J>,
      P extends TakeSelectValues<FilteredGroups<S, J, {}>, C>,
    >(columns: C): QBSelect<S, J, FilteredGroups<S, J, {}>, P> {
      return this.select(columns);
    }

    selectAll<A extends Extract<J, string>>(
      alias: A,
    ): QBSelectAll<
      S,
      J,
      FilteredGroups<S, J, {}>,
      FilteredGroups<S, J, {}>[A]
    > {
      return new (QBSelectAll as any)(this, alias);
    }
    SELECT_ALL<A extends Extract<J, string>>(
      alias: A,
    ): QBSelectAll<
      S,
      J,
      FilteredGroups<S, J, {}>,
      FilteredGroups<S, J, {}>[A]
    > {
      return this.selectAll(alias);
    }
  }

  export class WithQB<S extends TableSchemas, J extends string> {
    private _with: Partial<Record<Tables, QB>> = {};
    private constructor() {}

    with<P, A extends string>(
      qb: CTEAllowed<any, any, any, P>,
      alias: A,
    ): WithQB<S & Record<A, P>, J | A> {
      if (!alias) throw new Error('Name is required');
      (this._with as any)[alias] = qb;
      return this as any;
    }
    WITH<P, A extends string>(
      qb: CTEAllowed<any, any, any, P>,
      alias: A,
    ): WithQB<S & Record<A, P>, J | A> {
      return this.with(qb, alias);
    }

    table<
      T extends Tables | Extract<keyof S, string>,
      A extends string | undefined = undefined,
    >(
      name: T,
      as?: A,
    ): QB<
      NewTable<S, A, Extract<T, string>>,
      J | Extract<T, string> | ValidAlias<A>
    > {
      const qb = new (QB as any)(name);
      qb._alias = as || name;
      qb._with = this._with;
      return qb;
    }
    TABLE<
      T extends Tables | Extract<keyof S, string>,
      A extends string | undefined = undefined,
    >(
      name: T,
      as?: A,
    ): QB<
      NewTable<S, A, Extract<T, string>>,
      J | Extract<T, string> | ValidAlias<A>
    > {
      return this.table(name, as);
    }

    from = this.table;
    FROM = this.table;
  }

  export class QBWhere<S extends TableSchemas, J extends string> {
    private _where: string[] = [];
    private _previous: any;
    private constructor(query: QB, where: string) {
      this._previous = query;
      this._where.push(where);
    }

    and: WhereClause<S, J> = (left: any, operator: any, right: any) => {
      const [str, params] = QBWhere.evalClause(left, operator, right);
      let root = this._previous;
      while (root && !root._param) root = root._previous;
      if (root && root._param) root._param.push(...params);
      this._where.push(' AND ' + str);
      return this;
    };
    AND: WhereClause<S, J> = (left: any, operator: any, right: any) => {
      return (this.and as any)(left, operator, right);
    };

    or: WhereClause<S, J> = (left: any, operator: any, right: any) => {
      const [str, params] = QBWhere.evalClause(left, operator, right);
      let root = this._previous;
      while (root && !root._param) root = root._previous;
      if (root && root._param) root._param.push(...params);
      this._where.push(' OR ' + str);
      return this;
    };
    OR: WhereClause<S, J> = (left: any, operator: any, right: any) => {
      return (this.or as any)(left, operator, right);
    };

    static evalOperands(where: any): [string, params: any[]] {
      const params: any[] = [];
      switch (true) {
        case Array.isArray(where): {
          const placeholders = where.map((value) => {
            const [placeholder, p] = this.evalOperands(value);
            params.push(...p);
            return placeholder;
          });
          return [`(${placeholders.join(', ')})`, params];
        }
        case where === null:
          return ['NULL', []];
        case typeof where === 'object': {
          const entries = Object.entries(where);
          if (entries.length === 0) throw new Error('Empty where object');
          const [key, val] = entries[0]!;
          const sqlFunctions = [
            'UPPER',
            'LOWER',
            'LENGTH',
            'TRIM',
            'CONCAT',
            'SUBSTR',
            'REPLACE',
          ];
          if (sqlFunctions.includes(key)) {
            const args = Array.isArray(val) ? val : [val];
            const placeholders = args.map((arg) => {
              const [ph, p] = this.evalOperands(arg);
              params.push(...p);
              return ph;
            });
            return [`${key}(${placeholders.join(', ')})`, params];
          }
          return [
            `\`${toSnakeCase(key)}\`.\`${toSnakeCase(val as string)}\``,
            params,
          ];
        }
        case typeof where === 'boolean':
          return [where ? 'TRUE' : 'FALSE', []];
        default:
          return ['?', [where]];
      }
    }

    static evalClause(
      LHS: any,
      OPE: string,
      RHS: any,
    ): [string, params: any[]] {
      const [left, params] = this.evalOperands(LHS);
      const [right, params2] = this.evalOperands(RHS);
      return [`${left} ${OPE} ${right}`, [...params, ...params2]];
    }

    async exists(): Promise<boolean> {
      return new QBExists(this).run();
    }
    async EXISTS(): Promise<boolean> {
      return this.exists();
    }

    then<TResult1 = boolean, TResult2 = never>(
      onfulfilled?:
        | ((value: boolean) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return this.exists().then(onfulfilled, onrejected);
    }

    groupBy<
      G extends ColumnRef<S, J>,
      F extends FilteredGroups<S, J, G> = FilteredGroups<S, J, G>,
    >(groups: G): QBGroupBy<S, J, F> {
      const qbGroupBy = new (QBGroupBy as any)(this, '');
      qbGroupBy._groupBy = Object.entries(groups)
        .filter(([_, val]) => val !== undefined)
        .map(
          ([table, column]) =>
            `\`${toSnakeCase(table)}\`.\`${toSnakeCase(column as string)}\``,
        )
        .join(', ');
      return qbGroupBy;
    }
    GROUP_BY<
      G extends ColumnRef<S, J>,
      F extends FilteredGroups<S, J, G> = FilteredGroups<S, J, G>,
    >(groups: G): QBGroupBy<S, J, F> {
      return this.groupBy(groups);
    }

    select<
      C extends SelectColumns<S, J>,
      P extends TakeSelectValues<FilteredGroups<S, J, {}>, C>,
    >(columns: C): QBSelect<S, J, FilteredGroups<S, J, {}>, P> {
      return new (QBSelect as any)(this, columns);
    }
    SELECT<
      C extends SelectColumns<S, J>,
      P extends TakeSelectValues<FilteredGroups<S, J, {}>, C>,
    >(columns: C): QBSelect<S, J, FilteredGroups<S, J, {}>, P> {
      return this.select(columns);
    }

    selectAll<A extends Extract<J, string>>(
      alias: A,
    ): QBSelectAll<
      S,
      J,
      FilteredGroups<S, J, {}>,
      FilteredGroups<S, J, {}>[A]
    > {
      return new (QBSelectAll as any)(this, alias);
    }
    SELECT_ALL<A extends Extract<J, string>>(
      alias: A,
    ): QBSelectAll<
      S,
      J,
      FilteredGroups<S, J, {}>,
      FilteredGroups<S, J, {}>[A]
    > {
      return this.selectAll(alias);
    }
  }

  export class QBExists {
    private _previous: any;
    private _isExistsNode = true;
    constructor(previous: any) {
      this._previous = previous;
    }

    parse(): { sql: string; params: any[] } {
      return buildSQL(this);
    }

    async run(): Promise<boolean> {
      const { sql, params } = this.parse();
      const result = connection.query(sql).get(...params);
      return !!result;
    }
  }

  export class QBGroupBy<
    S extends TableSchemas,
    J extends string,
    F extends FilteredGroups<S, J, any> = FilteredGroups<S, J, {}>,
  > {
    private _groupBy: string = '';
    private _previous: any;
    private constructor(where: QBWhere<S, J> | QB<S, J>, groupBy: string) {
      this._groupBy = groupBy;
      this._previous = where;
    }

    select<
      C extends SelectColumns<F, J>,
      P extends TakeSelectValues<F, C> = TakeSelectValues<F, C>,
    >(columns: C): QBSelect<S, J, F, P> {
      return new (QBSelect as any)(this, columns);
    }
    SELECT<
      C extends SelectColumns<F, J>,
      P extends TakeSelectValues<F, C> = TakeSelectValues<F, C>,
    >(columns: C): QBSelect<S, J, F, P> {
      return this.select(columns);
    }

    selectAll<A extends Extract<J, string>>(
      alias: A,
    ): QBSelectAll<S, J, F, F[A]> {
      return new (QBSelectAll as any)(this, alias);
    }
    SELECT_ALL<A extends Extract<J, string>>(
      alias: A,
    ): QBSelectAll<S, J, F, F[A]> {
      return this.selectAll(alias);
    }
  }

  export class QBSelectAll<
    S extends TableSchemas,
    J extends string,
    F extends FilteredGroups<S, J, any> = FilteredGroups<S, J, {}>,
    P = TakeSelectValues<F, {}>,
  > extends QBExecutable<P> {
    public _isSelectNode = true;
    public _selectAllAlias?: string;
    private _previous: any;
    private constructor(previous: any, alias: string) {
      super();
      this._previous = previous;
      this._selectAllAlias = alias;
    }

    select<
      C extends SelectColumns<F, J>,
      P2 extends TakeSelectValues<F, C> = TakeSelectValues<F, C>,
    >(columns: C): QBSelect<S, J, F, P & P2> {
      return new (QBSelect as any)(this, columns);
    }
    SELECT<
      C extends SelectColumns<F, J>,
      P2 extends TakeSelectValues<F, C> = TakeSelectValues<F, C>,
    >(columns: C): QBSelect<S, J, F, P & P2> {
      return this.select(columns);
    }

    selectMath<
      C extends SelectMathArgs<S, J, P>,
      M extends TakeSelectMathValues<C> = TakeSelectMathValues<C>,
    >(
      columns: C,
    ): Omit<QBSelect<S, J, F, P & M>, 'selectMath' | 'SELECT_MATH'> {
      const qb = new (QBSelect as any)(this, {});
      qb._selectFunctions = columns;
      return qb as any;
    }
    SELECT_MATH<
      C extends SelectMathArgs<S, J, P>,
      M extends TakeSelectMathValues<C> = TakeSelectMathValues<C>,
    >(
      columns: C,
    ): Omit<QBSelect<S, J, F, P & M>, 'selectMath' | 'SELECT_MATH'> {
      return this.selectMath(columns);
    }

    having: HavingClause<F, J, P, QBHaving<S, J, F, P>> = (
      left: any,
      operator: any,
      right: any,
    ) => {
      const [str, params] = QBWhere.evalClause(left, operator, right);
      let root = this._previous;
      while (root && !root._param) root = root._previous;
      if (root && root._param) root._param.push(...params);
      return new (QBHaving as any)(this, str);
    };
    HAVING: HavingClause<F, J, P, QBHaving<S, J, F, P>> = (
      left: any,
      operator: any,
      right: any,
    ) => {
      return (this.having as any)(left, operator, right);
    };

    orderBy(
      column: keyof P | ColumnRef<F, J> | AnyString,
      direction: 'ASC' | 'DESC' = 'ASC',
    ): QBOrderBy<S, J, F, P> {
      const orderStr =
        typeof column === 'object'
          ? // @ts-expect-error
            `${safeColumn(Object.keys(column)[0]!)}.${safeColumn(Object.values(column)[0]!)}`
          : safeColumn(String(column));
      return new (QBOrderBy as any)(this, `${orderStr} ${direction}`);
    }
    ORDER_BY(
      column: keyof P | ColumnRef<F, J> | AnyString,
      direction: 'ASC' | 'DESC' = 'ASC',
    ): QBOrderBy<S, J, F, P> {
      return this.orderBy(column, direction);
    }

    limit(limit: number, offset?: number): QBLimit<S, J, F, P> {
      return new (QBLimit as any)(this, limit, offset);
    }
    LIMIT(limit: number, offset?: number): QBLimit<S, J, F, P> {
      return this.limit(limit, offset);
    }

    parse(): { sql: string; params: any[] } {
      return buildSQL(this);
    }
  }

  export class QBSelect<
    S extends TableSchemas,
    J extends string,
    F extends FilteredGroups<S, J, any> = FilteredGroups<S, J, {}>,
    P = TakeSelectValues<F, {}>,
  > extends QBExecutable<P> {
    public _isSelectNode = true;
    public _select: SelectColumns<S, J> = {} as any;
    public _selectFunctions: SelectMathArgs<S, J, P> = {} as any;
    private _previous: any;
    private constructor(previous: any, select: any) {
      super();
      this._previous = previous;
      this._select = select;
    }

    selectMath<
      C extends SelectMathArgs<S, J, P>,
      M extends TakeSelectMathValues<C> = TakeSelectMathValues<C>,
    >(
      columns: C,
    ): Omit<QBSelect<S, J, F, P & M>, 'selectMath' | 'SELECT_MATH'> {
      Object.assign(this._selectFunctions, columns);
      return this as any;
    }
    SELECT_MATH<
      C extends SelectMathArgs<S, J, P>,
      M extends TakeSelectMathValues<C> = TakeSelectMathValues<C>,
    >(
      columns: C,
    ): Omit<QBSelect<S, J, F, P & M>, 'selectMath' | 'SELECT_MATH'> {
      return this.selectMath(columns);
    }

    having: HavingClause<F, J, P, QBHaving<S, J, F, P>> = (
      left: any,
      operator: any,
      right: any,
    ) => {
      const [str, params] = QBWhere.evalClause(left, operator, right);
      let root = this._previous;
      while (root && !root._param) root = root._previous;
      if (root && root._param) root._param.push(...params);
      return new (QBHaving as any)(this, str);
    };
    HAVING: HavingClause<F, J, P, QBHaving<S, J, F, P>> = (
      left: any,
      operator: any,
      right: any,
    ) => {
      return (this.having as any)(left, operator, right);
    };

    orderBy(
      column: keyof P | ColumnRef<F, J> | AnyString,
      direction: 'ASC' | 'DESC' = 'ASC',
    ): QBOrderBy<S, J, F, P> {
      const orderStr =
        typeof column === 'object'
          ? // @ts-expect-error
            `${safeColumn(Object.keys(column)[0]!)}.${safeColumn(Object.values(column)[0]!)}`
          : safeColumn(String(column));
      return new (QBOrderBy as any)(this, `${orderStr} ${direction}`);
    }
    ORDER_BY(
      column: keyof P | ColumnRef<F, J> | AnyString,
      direction: 'ASC' | 'DESC' = 'ASC',
    ): QBOrderBy<S, J, F, P> {
      return this.orderBy(column, direction);
    }

    limit(limit: number, offset?: number): QBLimit<S, J, F, P> {
      return new (QBLimit as any)(this, limit, offset);
    }
    LIMIT(limit: number, offset?: number): QBLimit<S, J, F, P> {
      return this.limit(limit, offset);
    }

    parse(): { sql: string; params: any[] } {
      return buildSQL(this);
    }
  }

  export class QBHaving<
    S extends TableSchemas,
    J extends string,
    F extends FilteredGroups<S, J, any> = FilteredGroups<S, J, {}>,
    P = TakeSelectValues<F, {}>,
  > extends QBExecutable<P> {
    private _having: string[] = [];
    private _previous: any;
    private constructor(select: any, having: string) {
      super();
      this._having.push(having);
      this._previous = select;
    }

    and: HavingClause<F, J, P, QBHaving<S, J, F, P>> = (
      left: any,
      operator: any,
      right: any,
    ) => {
      const [str, params] = QBWhere.evalClause(left, operator, right);
      let root = this._previous;
      while (root && !root._param) root = root._previous;
      if (root && root._param) root._param.push(...params);
      this._having.push(' AND ' + str);
      return this as any;
    };
    AND: HavingClause<F, J, P, QBHaving<S, J, F, P>> = (
      left: any,
      operator: any,
      right: any,
    ) => {
      return (this.and as any)(left, operator, right);
    };

    or: HavingClause<F, J, P, QBHaving<S, J, F, P>> = (
      left: any,
      operator: any,
      right: any,
    ) => {
      const [str, params] = QBWhere.evalClause(left, operator, right);
      let root = this._previous;
      while (root && !root._param) root = root._previous;
      if (root && root._param) root._param.push(...params);
      this._having.push(' OR ' + str);
      return this as any;
    };
    OR: HavingClause<F, J, P, QBHaving<S, J, F, P>> = (
      left: any,
      operator: any,
      right: any,
    ) => {
      return (this.or as any)(left, operator, right);
    };

    orderBy(
      column: keyof P | ColumnRef<F, J> | AnyString,
      direction: 'ASC' | 'DESC' = 'ASC',
    ): QBOrderBy<S, J, F, P> {
      const orderStr =
        typeof column === 'object'
          ? // @ts-expect-error
            `${safeColumn(Object.keys(column)[0]!)}.${safeColumn(Object.values(column)[0]!)}`
          : safeColumn(String(column));
      return new (QBOrderBy as any)(this, `${orderStr} ${direction}`);
    }
    ORDER_BY(
      column: keyof P | ColumnRef<F, J> | AnyString,
      direction: 'ASC' | 'DESC' = 'ASC',
    ): QBOrderBy<S, J, F, P> {
      return this.orderBy(column, direction);
    }

    limit(limit: number, offset?: number): QBLimit<S, J, F, P> {
      return new (QBLimit as any)(this, limit, offset);
    }
    LIMIT(limit: number, offset?: number): QBLimit<S, J, F, P> {
      return this.limit(limit, offset);
    }

    parse(): { sql: string; params: any[] } {
      return buildSQL(this);
    }
  }

  export class QBOrderBy<
    S extends TableSchemas,
    J extends string,
    F extends FilteredGroups<S, J, any>,
    P,
  > extends QBExecutable<P> {
    private _orderBy: string = '';
    private _previous: any;
    constructor(having: any, order = 'string') {
      super();
      this._previous = having;
      this._orderBy = order;
    }

    limit(limit: number, offset?: number): QBLimit<S, J, F, P> {
      return new (QBLimit as any)(this, limit, offset);
    }
    LIMIT(limit: number, offset?: number): QBLimit<S, J, F, P> {
      return this.limit(limit, offset);
    }

    parse(): { sql: string; params: any[] } {
      return buildSQL(this);
    }
  }

  export class QBLimit<
    S extends TableSchemas,
    J extends string,
    F extends FilteredGroups<S, J, any>,
    P,
  > extends QBExecutable<P> {
    private _limit: number;
    private _offset?: number;
    private _previous: any;
    constructor(previous: any, limit: number, offset?: number) {
      super();
      this._previous = previous;
      this._limit = limit;
      this._offset = offset;
    }
    parse(): { sql: string; params: any[] } {
      return buildSQL(this);
    }
  }

  export const table = QB.table;
  export const from = QB.from;
  export const include = QB.with;

  export const raw = <T = any>(sql: string, params: any[] = []) =>
    new QBRaw<T>(sql, params);

  export const TABLE = QB.table;
  export const FROM = QB.from;
  export const WITH = QB.with;

  export const RAW = raw;

  export const Insert = Mutation.Insert;
  export const Update = Mutation.Update;
  export const Delete = Mutation.Delete;
  export const INSERT = Mutation.Insert;
  export const UPDATE = Mutation.Update;
  export const DELETE = Mutation.Delete;
}
