import { is } from '@server/utils/common'
import { fs } from '@server/utils/fs'
import { DynamicHandler, Handler } from './$base'

const DEFAULT_ERROR: Handler.Error.Data = {
  errorCode: 500,
  errorText: 'Internal Server Error',
  errorBody: 'An unexpected error occurred.',
}

export class HandlerError extends Error {
  data: Handler.Error.Data
  request?: Request = undefined

  static getDefaultData() {
    return DEFAULT_ERROR
  }

  constructor(
    message?: string,
    req?: Request,
    data?: Partial<Handler.Error.Data>,
  ) {
    data = {
      ...HandlerError.getDefaultData(),
      ...data,
    }

    super(message || data.errorText || 'Handler Error')
    this.data = data as Handler.Error.Data
    this.request = req
  }
}

export class ErrorHandler extends Handler {
  static get DEFAULT_ERROR() {
    return Object.assign({}, DEFAULT_ERROR)
  }

  static isError(error: any): boolean {
    if (error instanceof Response) return error.status >= 400
    if (error instanceof HandlerError) return true
    if (is.object(error)) {
      if ('errorCode' in error && is.number(error.errorCode)) {
        return error.errorCode >= 400
      }
    }

    return false
  }

  static canHandle(
    path: string,
    req: Request,
    errors?: Handler.Error.Data,
  ): MixedPromise<boolean>
  static canHandle() {
    return true
  }

  static handle(
    path: string,
    req: Request,
    errors?: Handler.Error.Data,
  ): Handler.Response
  static handle() {}

  static extractErrorData(error: any): Handler.Error.Data {
    switch (true) {
      case error instanceof HandlerError:
        return error.data
      case error instanceof Error:
        return {
          ...this.DEFAULT_ERROR,
          errorText: error.message,
          errorBody: error.stack || String(error),
        }
      case error instanceof Response:
        return {
          ...this.DEFAULT_ERROR,

          errorCode: error.status,
          errorText: error.statusText,
          errorBody: `Response with status ${error.status} and text "${error.statusText}"`,
        }

      case is.object(error): {
        const errorData = this.DEFAULT_ERROR

        if (is.number(error.errorCode)) errorData.errorCode = error.errorCode
        if (is.string(error.errorText)) errorData.errorText = error.errorText
        if (is.string(error.errorBody)) errorData.errorBody = error.errorBody
        return errorData
      }

      case is.string(error):
        return {
          ...this.DEFAULT_ERROR,
          errorText: error,
        }

      default:
        return this.DEFAULT_ERROR
    }
  }
}

export class DynamicErrorHandler extends DynamicHandler {
  static DEFAULT_ERROR = DEFAULT_ERROR

  static canHandle(
    path: string,
    req: Request,
    errors?: Handler.Error.Data,
  ): MixedPromise<boolean>
  static async canHandle(path: string, _: any, errors?: Handler.Error.Data) {
    return Boolean(await this.resolveRoute(path, errors))
  }

  static handle(
    path: string,
    req: Request,
    errors?: Handler.Error.Data,
  ): Handler.Response

  static handle(path: string, req: Request, errors?: Handler.Error.Data) {
    return (super.handle as any)(path, req, errors)
  }

  static async resolveRoute(path: string, errors?: Handler.Error.Data) {
    errors ||= this.DEFAULT_ERROR

    const parsed = fs.parse(path)
    const pathArray = parsed.dir.split('/').filter(Boolean)

    for (let i = pathArray.length; i >= 0; i--) {
      const dir = pathArray.slice(0, i).join('/')
      const prefix = dir ? `/${dir}` : ''

      const defsPage = `${prefix}/error`
      const codePage = `${prefix}/error-${errors.errorCode}`
      const routeInfo =
        (await super.resolveRoute(codePage)) ||
        (await super.resolveRoute(defsPage))
      if (routeInfo) return routeInfo
    }

    return null
  }
}
