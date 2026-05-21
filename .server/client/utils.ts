const matchDefault = Symbol('matchDefault');
const match = (value: any, cases: any) => {
  const isString = typeof value === 'string';
  const isArray = Array.isArray(cases);

  switch (true) {
    case isString && !isArray: {
      switch (true) {
        case value in cases:
          return typeof cases[value] === 'function'
            ? cases[value](value)
            : cases[value];
        case matchDefault in cases:
          return typeof cases[matchDefault] === 'function'
            ? cases[matchDefault](value)
            : cases[matchDefault];
      }
      break;
    }

    case isArray: {
      for (const [predicate, result] of cases) {
        switch (true) {
          case predicate === match:
          case predicate === matchDefault:
          case predicate === value:
          case typeof predicate === 'function' && Boolean(predicate(value)):
            return typeof result === 'function' ? result(value) : result;
        }
      }
    }
  }
  return undefined;
};

match.default = matchDefault;
match[Symbol.toPrimitive] = () => matchDefault;

const tryCatch = async <T = any>(
  promise: Wrapped<Promise<T>>,
): Promise<[Error, null] | [null, T]> => {
  const unwrapped =
    typeof promise === 'function' ? (promise as Function)() : promise;
  let returned = Promise.resolve(unwrapped);

  return returned
    .then((data) => [null, data])
    .catch((error) => [error, null]) as Promise<[any, T]>;
};

const assert = (condition: any, message?: string): asserts condition => {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
};
const any = <T = any>(v: any): T => v;
const repeat = (n: number, fn?: (i: number) => any): any[] =>
  Array.from({ length: n }, (_, k) => (fn ? fn(k) : k));

function processGetBody(
  body: FormData | Record<string, any> | URLSearchParams | string,
) {
  switch (true) {
    case body instanceof URLSearchParams:
      return body.toString();

    case body instanceof FormData:
    case typeof body === 'object' && body !== null:
      const urlSearchParams = new URLSearchParams();
      const entries =
        body instanceof FormData ? body.entries() : Object.entries(body);

      for (const [key, value] of entries) {
        urlSearchParams.append(key, value.toString());
      }
      return urlSearchParams.toString();

    default:
      return String(body);
  }
}

function randomId(length = 8) {
  const arr = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(arr);
  return Array.from(arr, (dec) => dec.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
}

async function request(url: string, init?: RequestJson): Promise<JsonResponse> {
  const method = init?.method?.toUpperCase() || 'GET';
  const body = init?.body || {};
  let initReq: any;

  switch (method) {
    case 'GET':
      const query = processGetBody(body);
      url = query ? `${url}?${query}` : url;
      initReq = { ...init, method, body: undefined };
      break;

    default:
      initReq = {
        ...init,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
        body:
          body instanceof Blob ||
          body instanceof FormData ||
          body instanceof URLSearchParams
            ? body
            : JSON.stringify(body),
      };
      break;
  }

  const response = await fetch(url, initReq);
  const [err, data] = await tryCatch(response.json.bind(response));

  if (err) {
    throw new Error(`Request failed: ${err.message || 'Unknown error'}`);
  }

  if ('status' in data && 'message' in data) {
    if (data.status >= 200 && data.status < 300) return data;
    else throw new Error(data.message);
  }

  return data;
}

Object.assign(globalThis, {
  match,
  matchDefault,
  tryCatch,
  assert,
  any,
  repeat,
  request,
  randomId,
});

export {};
