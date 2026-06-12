import type { Handler } from '@server/handlers/core/$base'

export type ValidResponses = Handler.Response

export interface ServerPlugin {
  name: string
  setup?(config: ProcessedAppConfig): MixedPromise<void>
  onStart?(server: Bun.Server<any>): MixedPromise<void>
  onRequest?(req: Request): ValidResponses
  onRoute?(req: Request): MixedPromise<void>
  onError?(error: Handler.Error.Data, req?: Request): ValidResponses
  onShutdown?(): MixedPromise<void>
}

export abstract class PluginBase implements ServerPlugin {
  abstract name: string

  setup(_config: ProcessedAppConfig): MixedPromise<void> {
    return
  }

  onStart(_server: Bun.Server<any>): MixedPromise<void> {
    return
  }

  onRequest(_req: Request): ValidResponses {
    return
  }

  onRoute(_req: Request): MixedPromise<void> {
    return
  }

  onError(_error: Handler.Error.Data, _req?: Request): ValidResponses {
    return
  }
}

export function definePlugin<T extends ServerPlugin>(plugin: T): T {
  return plugin
}
