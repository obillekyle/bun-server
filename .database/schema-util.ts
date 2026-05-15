export type OmitNever<T> = Pick<
  T,
  { [K in keyof T]: T[K] extends never ? never : K }[keyof T]
>;

export type TypeMap = {
  integer: number;
  number: number;
  string: string & {};
  boolean: boolean;
  buffer: Buffer;
};

export type DataTypes = keyof TypeMap;
export type Defs<T extends keyof TypeMap> = `(${string})` | TypeMap[T];

export type TableDef<
  T extends DataTypes,
  D extends Defs<T> | null | undefined,
  N extends boolean,
  A extends boolean,
  P extends boolean,
> = OmitNever<{
  type: T;
  default: D extends undefined ? never : D extends null ? never : D;
  nullable: N extends true ? true : never;
  autoIncrement: A extends true ? true : never;
  primary: P extends true ? true : never;
}>;

export function value<
  T extends DataTypes,
  D extends Defs<T> | null | undefined = undefined,
  N extends boolean = false,
  A extends boolean = false,
  P extends boolean = false,
>(t: T, d?: D, n?: N, a?: A, p?: P): TableDef<T, D, N, A, P> {
  const result: any = { type: t };

  if (d !== undefined) result.default = d;

  const isNullable = n !== undefined ? n : false;
  if (isNullable) result.nullable = true;

  const isAuto = a !== undefined ? a : false;
  if (isAuto) result.autoIncrement = true;

  const isPrimary = p !== undefined ? p : false;
  if (isPrimary) result.primary = true;

  return result;
}

export function primary() {
  return value('integer', undefined, false, true, true);
}

export function unique(t: string, cols: string | string[]) {
  return {
    table: t,
    type: 'unique',
    cols: Array.isArray(cols) ? cols : [cols],
  };
}

export function index(t: string, cols: string | string[]) {
  return {
    table: t,
    type: 'index',
    cols: Array.isArray(cols) ? cols : [cols],
  };
}

export const dateNow = "(CAST(strftime('%s', 'now') AS INTEGER))";

export type ExtractTableTypes<C, K extends keyof C> = {
  [P in keyof C[K] as P extends '_view' ? never : P]: C[K][P] extends {
    type: infer Type;
  }
    ? Type extends keyof TypeMap
      ? TypeMap[Type] | (C[K][P] extends { nullable: true } ? null : never)
      : any
    : any;
};

export type ExtractOptionals<C, T extends keyof C> = {
  [K in keyof C[T]]: K extends '_view'
    ? never
    : C[T][K] extends { nullable: true }
      ? K
      : C[T][K] extends { default: string | number | boolean | null }
        ? K
        : C[T][K] extends { autoIncrement: true }
          ? K
          : never;
}[keyof C[T]];

export type ExtractViews<C> = {
  [K in keyof C]: C[K] extends { _view: string } ? K : never;
}[keyof C];
