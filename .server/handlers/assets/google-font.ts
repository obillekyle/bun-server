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
      '/_gf/gstatic/*': {
        type: 'static',
        isRoot: false,
        fileName: '(google-font-binary)',
      },
    } as MapOf<Route.Meta>
  }

  static async handle(path: string, req: Request) {
    const url = new URL(req.url)

    if (path.startsWith('/_gf/gstatic/')) {
      const gstaticPath = path.slice('/_gf/gstatic/'.length)
      const cachePath = fs.resolve(this.cacheDir, 'gstatic', gstaticPath)
      let cacheFile = Bun.file(cachePath)

      if (!fs.exists(cacheFile)) {
        const gfUrl = `https://fonts.gstatic.com/${gstaticPath}${url.search}`
        const res = await fetch(gfUrl)

        if (!res.ok) {
          return response.error(
            'Google Fonts Binary Request Failed',
            res.status,
          )
        }

        const buffer = await res.arrayBuffer()
        const dir = fs.parse(cachePath).dir
        await fs.mkdir(dir)
        await Bun.write(cachePath, buffer)
        cacheFile = Bun.file(cachePath)
      }

      return cacheFile
    }

    // Handle CSS stylesheet requests
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

      let css = await res.text()
      css = css.replace(/https?:\/\/fonts\.gstatic\.com/g, '/_gf/gstatic')

      await fs.mkdir(this.cacheDir)
      await Bun.write(cachePath, css)
      cacheFile = Bun.file(cachePath)
    }

    return cacheFile
  }
}
