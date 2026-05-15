export type ElementProps<T = HTMLElement> = {
  readonly id?: string;
  readonly class?: string;
  readonly className?: string;
  readonly textContent?: string;
  readonly innerHTML?: string;
  readonly innerText?: string;
  readonly html?: string;
  readonly children?: string | Node | null | (string | Node | null)[];
  readonly style?: Record<string, string> | string;
  readonly attributes?: Record<string, any>;
  readonly events?: Record<string, (this: T, event: Event) => void>;
  readonly [events: `on${string}`]: (this: T, event: Event) => void;
  [key: string]: any;
};

type ResolveMatchReturn<V, R> = R extends any
  ? R extends (v: V) => infer U
    ? U
    : R
  : never;

export type Match<D extends symbol> = {
  /**  The default case value, returned when no other cases match. */
  default: D;
  [Symbol.toPrimitive](hint: string): symbol;

  <V, C extends readonly (readonly [any, any])[]>(
    value: V,
    cases: C,
  ): [Extract<C[number][0], D>] extends [never]
    ? ResolveMatchReturn<V, C[number][1]> | undefined
    : ResolveMatchReturn<V, C[number][1]>;

  <V extends string, K>(
    value: V,
    cases: Record<string | symbol, K | ((v: V) => K)> & { length?: never },
  ): K;

  <V extends string, K>(
    value: V,
    cases: Record<string, K | ((v: V) => K)> & { length?: never },
  ): K | undefined;
} & D;

export type HybridConstructor<T> = T & {
  (attrs?: ElementProps<InstanceType<T>>): InstanceType<T>;
  new (attrs?: ElementProps<InstanceType<T>>): InstanceType<T>;
};

export type ResponseFunction<T = any> = (
  req: Request,
  body: T,
  server: Bun.Server<unknown>,
) => Promise<
  string | number | Response | Bun.FileBlob | JsonResponse<any> | void
>;
