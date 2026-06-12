export class JsonResponseData<T = any> implements JsonResponse<T> {
  time: number = 0

  constructor(
    public status: number,
    public message: string,
    public data?: T,
  ) {}

  toJson() {
    return JSON.stringify({
      time: this.time,
      status: this.status,
      message: this.message,
      data: this.data,
    })
  }
}

export function success<T>(
  message: string,
  data?: T,
  status = 200,
): JsonResponse<T> {
  return jsonResponse(status, message, data as any)
}

export function error<T>(
  status = 404,
  message = '',
  data?: T,
): JsonResponse<T> {
  return jsonResponse(status, message, data as any)
}

export function jsonResponse<T>(
  status: number,
  message: string,
  data?: T,
): JsonResponseData<T> {
  return new JsonResponseData(status, message, data)
}

jsonResponse.object = function jsonResponseObj<T>(
  status: number,
  message: string,
  data?: T,
): Response {
  const json = jsonResponse(status, message, data as any).toJson()
  const etag = `W/"${Bun.hash(json).toString(36)}"`

  return new Response(json, {
    status,
    statusText: message,
    headers: {
      'Content-Type': 'application/json',
      ETag: etag,
    },
  })
}

export function isOk<T>(
  response: JsonResponse<T>,
): response is Required<JsonResponse<T>> {
  return response.status >= 200 && response.status < 300
}
