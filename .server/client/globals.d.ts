declare global {
  const matchDefault: unique symbol;
  var match: import('../types').Match<typeof matchDefault>;
  var assert: (condition: any, message?: string) => asserts condition;
  var any: <T = any>(v: any) => T;
  var repeat: typeof import('../utils').repeat;
  var tryCatch: typeof import('../utils').tryCatch;
  var randomId: (length?: number) => string;

  var request: <T = any>(
    url: string,
    init?: RequestJson,
  ) => Promise<JsonResponse<T>>;

  type RequestJson = RequestInit & {
    body: Record<string, any>;
  };

  type JsonResponse<T = any> = {
    /** Respose time in milliseconds */
    time: number;
    /** The http status code */
    status: number;
    /** The success or error message of the request returned by the server */
    message: string;
    /** Data of the request, check the status first for error before accessing */
    data: T;
  };

  type Wrapped<T = any> = T | (() => T);
  type Constructor<T = any> = new (...args: any[]) => T;
  type Constructable<T = any> = Constructor<T>;
  type Callable<T = any> = (...args: any[]) => T;
  type Hybrid<T = any> = Constructor<T> & Callable<T>;
}

export {};
