import { Bakery } from '@server/core/bakery'
import { Handler } from './$base'

export class WebSocketHandler extends Handler {
  static WS_UPGRADE = Symbol('WS_UPGRADE')

  static canHandle(path: string, req: Request): MixedPromise<boolean>
  static canHandle() {
    return true
  }

  static handle(path: string, req: Request) {
    let data = this.upgrade(req, path) || ({} as any)
    data = {
      this: this,
      type: 'websocket',
      orig: this.name,
      path,
      data,
    }

    const upgraded = Bakery.server?.upgrade(req, { data })
    return upgraded ? (WebSocketHandler.WS_UPGRADE as any) : null
  }

  static upgrade(req: Request, path: string): MixedPromise<UpgradeData>
  static upgrade() {}

  static open(ws: ServerWebSocket, data: any): MixedPromise<void>
  static open() {}

  static message(ws: ServerWebSocket, msg: any, data: any): MixedPromise<void>
  static message() {}

  static close(
    ws: ServerWebSocket,
    code: number,
    reason: string,
    data: any,
  ): MixedPromise<void>
  static close() {}

  static drain(ws: ServerWebSocket, data: any): MixedPromise<void>
  static drain() {}
}
