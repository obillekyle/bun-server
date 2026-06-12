type ResolveMatchReturn<V, R> = R extends any
  ? R extends (v: V) => infer U
    ? U
    : R
  : never

export type Match<D extends symbol> = {
  default: D
  [Symbol.toPrimitive](hint: string): symbol

  <V, C extends readonly (readonly [any, any])[]>(
    value: V,
    cases: C,
  ): [Extract<C[number][0], D>] extends [never]
    ? ResolveMatchReturn<V, C[number][1]> | undefined
    : ResolveMatchReturn<V, C[number][1]>

  <V extends string, K>(
    value: V,
    cases: Record<string | symbol, K | ((v: V) => K)> & { length?: never },
  ): K

  <V extends string, K>(
    value: V,
    cases: Record<string, K | ((v: V) => K)> & { length?: never },
  ): K | undefined
} & D

export type ResponseFunction<T = any> = (
  req: Request,
  body: T,
  server: Bun.Server<unknown>,
) => Promise<
  string | number | Response | Bun.FileBlob | JsonResponse<any> | void
>
