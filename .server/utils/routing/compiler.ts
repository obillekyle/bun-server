import type { ScannedFile } from './scanner'

export interface CompiledRoute {
  pattern: RegExp
  paramNames: string[]
}

export function compileRoutePattern(routePattern: string): CompiledRoute {
  const paramNames: string[] = []
  const escaped = routePattern
    .split('/')
    .map(segment => {
      if (segment.startsWith('[') && segment.endsWith(']')) {
        const paramName = segment.slice(1, -1)
        paramNames.push(paramName)
        return '([^/]+)'
      }
      return RegExp.escape(segment)
    })
    .join('/')

  return {
    pattern: new RegExp(`^${escaped}(?:\\.(?:html|tsx|ts|js))?$`),
    paramNames,
  }
}

export function cleanParams(params: MapOf<string>): Record<string, string> {
  const cleaned: MapOf<string> = {}
  for (const [key, value] of Object.entries(params)) {
    const extMatch = value.match(/^(.*)\.(html|tsx|ts|js)$/)
    cleaned[key] = extMatch ? extMatch[1] : value
  }
  return cleaned
}

export interface ErrorRouteInfo {
  scope: string
  code: string
  filePath: string
  type: 'html' | 'tsx'
}

export const ErrorRegistry = {
  routes: [] as ErrorRouteInfo[],

  registerErrorRoute(file: ScannedFile) {
    if (file.relativePath.startsWith('api/')) return
    const fileName = file.relativePath.split('/').pop() || ''
    const isErrorPage =
      fileName === 'error.html' ||
      fileName === 'error.tsx' ||
      fileName.startsWith('error-')

    if (!isErrorPage) return

    let errorType = 'Fallback'
    if (fileName.startsWith('error-')) {
      const match = fileName.match(/^error-(\d+)\.(html|tsx|ts|js)$/)
      if (match) {
        errorType = match[1]
      }
    }

    const lastSlash = file.relativePath.lastIndexOf('/')
    const dirPath =
      lastSlash > -1 ? file.relativePath.substring(0, lastSlash) : ''
    const scope = dirPath ? `/${dirPath}` : '/'

    this.routes.push({
      scope,
      code: errorType,
      filePath: file.projectPath,
      type: fileName.endsWith('.tsx') ? 'tsx' : 'html',
    })
  },

  initialize(files: ScannedFile[]) {
    this.routes = []
    for (const file of files) {
      this.registerErrorRoute(file)
    }
  },
}
