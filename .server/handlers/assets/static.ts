import { Bakery, getConfig } from '@server/core'
import { fs } from '@server/utils/fs'
import { ETag, response } from '@server/utils/http'
import { Handler } from '../core/$base'
import { ErrorHandler } from '../core/$error'

export class StaticHandler extends Handler {
  static canHandle(): boolean {
    return true
  }

  static handle(path: string) {
    const config = getConfig()
    if (config.blocked.match(path)) {
      return response.error('Forbidden', 403)
    }

    const dir = fs.resolve(Bakery.serveRoot + path)
    const file = Bun.file(dir)

    if (!fs.exists(file)) return response.error('Not Found', 404)

    return ETag.sendFile(file)
  }
}

export class DefaultErrorHandler extends ErrorHandler {
  static handle(_path: string, req: Request, error?: Handler.Error.Data) {
    const ip = Bakery.server?.requestIP(req)?.address || 'Unknown'
    const date = new Date().toDateString()

    error ||= this.DEFAULT_ERROR

    const errorPage = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Error ${error.errorCode} | Bakery 🚀</title>
        </head>
        <body>
          <h1>${error.errorCode} - ${error.errorText}</h1>
          <pre>${error.errorBody}</pre>
          <hr />
          <small>${date} - ${ip}</small>
        </body>
      </html>
    `

    return response.html(errorPage, error.errorCode)
  }
}
