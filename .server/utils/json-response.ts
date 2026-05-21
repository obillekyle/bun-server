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
