import type { Match } from './types';

export function success<T>(
  message: string,
  data?: T,
  status = 200,
): JsonResponse<T> {
  return jsonResponse(status, message, data as any);
}

export function error<T>(
  status = 404,
  message = '',
  data?: T,
): JsonResponse<T> {
  return jsonResponse(status, message, data as any);
}

export function jsonResponse<T>(
  status: number,
  message: string,
  data?: Record<string, any> | any[],
): JsonResponse<T> {
  return {
    time: 0,
    status,
    message,
    data: data as any,
  };
}

jsonResponse.object = function <T>(
  status: number,
  message: string,
  data?: T,
): Response {
  return Response.json(jsonResponse(status, message, data as any), {
    status,
  });
};

export function isOk<T>(
  response: JsonResponse<T>,
): response is Required<JsonResponse<T>> {
  return response.status >= 200 && response.status < 300;
}

export async function tryCatch<T = any>(
  promise: Wrapped<Promise<T>>,
): Promise<[Error, null] | [null, T]> {
  let returned = promise instanceof Promise ? promise : promise();

  return returned
    .then((data) => [null, data])
    .catch((error) => [error, null]) as Promise<[any, T]>;
}

export async function processBody(
  req: Request,
): Promise<Record<string, any> | string> {
  switch (req.method) {
    case 'GET':
      const url = new URL(req.url);
      return Object.fromEntries(url.searchParams.entries());

    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      const type = req.headers.get('content-type') || '';

      switch (true) {
        case type.includes('application/json'):
          return (await req.json()) as any;

        case type.includes('application/x-www-form-urlencoded'):
        case type.includes('multipart/form-data'):
          const formData = await req.formData();
          return Object.fromEntries(formData.entries());

        default:
          return await req.text();
      }

    default:
      return {};
  }
}

const matchDefault = Symbol('matchDefault');

export const match: Match<typeof matchDefault> = ((value: any, cases: any) => {
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
}) as any;

export function repeat(n: number): number[];
export function repeat<T>(n: number, fn: (i: number) => T): T[];
export function repeat<T>(n: number, fn?: (i: number) => T): unknown[] {
  return Array.from({ length: n }, (_, k) => (fn ? fn(k) : k));
}

match.default = matchDefault;
match[Symbol.toPrimitive] = () => matchDefault;

export function clamp(value: number, min?: number, max?: number) {
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}
