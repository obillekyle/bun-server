export namespace ETag {
  function tag(response: Response): Response {
    ;(response as any).__notModified__ = true
    return response
  }

  export function isNotModified(response: Response): boolean {
    return !!(response as any).__notModified__
  }

  export function fromText(content: string | Uint8Array): string {
    const hash = Bun.hash(content)
    return `W/"${hash.toString(36)}"`
  }

  export function fromFile(file: Bun.BunFile): string {
    const sizePart = file.size.toString(36)
    const mtimePart = (file.lastModified || 0).toString(36)
    return `W/"${sizePart}-${mtimePart}"`
  }

  export function check(req: Request, etag: string): Response | null {
    const ifNoneMatch = req.headers.get('if-none-match')
    if (ifNoneMatch) {
      const clientEtags = ifNoneMatch
        .split(',')
        .map(s => s.trim().replace(/^W\//, ''))
      const cleanEtag = etag.replace(/^W\//, '')

      if (clientEtags.includes(cleanEtag) || clientEtags.includes('*')) {
        return tag(
          new Response(null, {
            status: 304,
            headers: {
              ETag: etag,
              'Cache-Control': 'no-cache',
            },
          }),
        )
      }
    }
    return null
  }

  export function sendResponse(req: Request, response: Response): Response {
    const etag = response.headers.get('ETag')
    if (!etag) return response

    const cookie = response.headers.get('Set-Cookie')
    response = isNotModified(response) ? response : check(req, etag) || response

    response.headers.set('Cache-Control', 'no-cache')
    cookie && response.headers.set('Set-Cookie', cookie)

    return response
  }

  export function sendFile(file: Bun.BunFile, req?: Request): Response {
    const etag = ETag.fromFile(file)

    if (req) {
      const conditionalRes = ETag.check(req, etag)
      if (conditionalRes) return conditionalRes
    }

    return new Response(file, {
      headers: {
        ETag: etag,
        'Cache-Control': 'no-cache',
      },
    })
  }

  export function sendText(text: string, req?: Request, type = ''): Response {
    type ||= 'text/plain; charset=utf-8'
    const etag = ETag.fromText(text)

    if (req) {
      const conditionalRes = ETag.check(req, etag)
      if (conditionalRes) return conditionalRes
    }

    return new Response(text, {
      headers: {
        'Content-Type': type,
        ETag: etag,
      },
    })
  }
}
