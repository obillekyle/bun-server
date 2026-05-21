export function repeat(n: number): number[];
export function repeat<T>(n: number, fn: (i: number) => T): T[];
export function repeat<T>(n: number, fn?: (i: number) => T): unknown[] {
  return Array.from({ length: n }, (_, k) => (fn ? fn(k) : k));
}
