export async function tryCatch<T = any>(
  promise: Wrapped<Promise<T> | T>,
): Promise<[Error, null] | [null, T]> {
  const unwrapped =
    typeof promise === 'function' ? (promise as Function)() : promise;
  let returned = Promise.resolve(unwrapped);

  return returned
    .then((data) => [null, data])
    .catch((error) => [error, null]) as Promise<[any, T]>;
}
