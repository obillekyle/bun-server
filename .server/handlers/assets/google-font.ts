import { Bakery } from '@server/core/bakery'
import { FileSystem as fs } from '@server/utils/fs'
import { response } from '@server/utils/http'
import { Handler, type Route } from '../core/$base'

export class GoogleFontHandler extends Handler {
  static get cacheDir() {
    return fs.resolve(Bakery.cacheDir, 'google-fonts')
  }

  static canHandle(path: string): boolean {
    return path === '/_gf' || path.startsWith('/_gf/')
  }

  static routes() {
    return {
      '/_gf/*': {
        type: 'static',
        isRoot: false,
        fileName: '(google-font)',
      },
      '/_gf/css2': {
        type: 'static',
        isRoot: false,
        fileName: '(google-font-css2)',
      },
    } as MapOf<Route.Meta>
  }

  static async handle(path: string, req: Request) {
    const url = new URL(req.url)
    let gfPath = path.slice('/_gf'.length)
    if (gfPath.startsWith('/')) {
      gfPath = gfPath.slice(1)
    }
    if (!gfPath) {
      gfPath = 'css2'
    }
    const searchQuery = url.search

    const cacheKey = `${gfPath}${searchQuery}`
    const cacheName = `${Bun.hash(cacheKey).toString(36)}.css`
    const cachePath = fs.resolve(this.cacheDir, cacheName)
    let cacheFile = Bun.file(cachePath)

    if (!fs.exists(cacheFile)) {
      const gfUrl = `https://fonts.googleapis.com/${gfPath}${searchQuery}`

      const res = await fetch(gfUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      })

      if (!res.ok) {
        return response.error('Google Fonts API Request Failed', res.status)
      }

      const css = await res.text()
      await fs.mkdir(this.cacheDir)
      await Bun.write(cachePath, css)
      cacheFile = Bun.file(cachePath)
    }

    return response.type(cacheFile, 'text/css; charset=utf-8')
  }
}
