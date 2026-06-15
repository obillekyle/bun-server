import { Bakery } from '@server/core/bakery'
import type { Route } from '@server/handlers'
import type { ErrorRouteInfo } from './compiler'

export type AppRouteEntry = {
  route: string
  fileName: string
  isRoot: boolean
  type: Route.Meta['type']
}

export type AppErrorRoute = {
  scope: string
  code: string
  file: string
}

export type AppRoutes = {
  api: AppRouteEntry[]
  pages: AppRouteEntry[]
  errors: AppErrorRoute[]
  websockets: AppRouteEntry[]
}

interface TreeNode {
  name: string
  fileName?: string
  isRoot?: boolean
  type?: Route.Meta['type']
  children: Map<string, TreeNode>
  errors: Map<string, string>
}

const createNode = (name: string): TreeNode => ({
  name,
  children: new Map(),
  errors: new Map(),
})

let cachedAppRoutes: AppRoutes | null = null

export namespace Routes {
  export function clearCache() {
    cachedAppRoutes = null
  }

  export function get(): AppRoutes {
    if (cachedAppRoutes && !import.meta.env.DEV) {
      return cachedAppRoutes
    }

    const routesMap = buildRoutesMap()
    const uniqueRoutes = getUniqueRoutes(routesMap)

    const api: AppRouteEntry[] = []
    const pages: AppRouteEntry[] = []

    for (const { route, info } of uniqueRoutes) {
      switch (info.type) {
        case 'endpoint':
          api.push({ route, ...info })
          break
        case 'route':
          pages.push({ route, ...info })
          break
      }
    }

    const sortedApi = api.sort((a, b) => a.route.localeCompare(b.route))
    const sortedPages = pages.sort((a, b) => a.route.localeCompare(b.route))
    const sortedErrors = loadErrorRoutes()

    const websockets: AppRouteEntry[] = []
    const wsHandlers = Bakery.handlers.websocket.list()
    for (const HandlerClass of wsHandlers) {
      const handlerRoutes = HandlerClass.routes()
      for (const [path, info] of Object.entries(handlerRoutes as any) as [
        string,
        any,
      ][]) {
        websockets.push({
          route: path,
          fileName: info.fileName.replace(/\\/g, '/'),
          isRoot: info.isRoot,
          type: 'websocket',
        })
      }
    }
    const sortedWebsockets = websockets.sort((a, b) => a.route.localeCompare(b.route))

    const result: AppRoutes = {
      api: sortedApi,
      pages: sortedPages,
      errors: sortedErrors,
      websockets: sortedWebsockets,
    }
    cachedAppRoutes = result
    return result
  }

  function buildRoutesMap(): Map<string, Route.Meta> {
    const routesMap = new Map<string, Route.Meta>()
    const fetchHandlers = Bakery.handlers.fetch.list()
    for (const HandlerClass of fetchHandlers) {
      const handlerRoutes = HandlerClass.routes()
      for (const [path, info] of Object.entries(handlerRoutes as any) as [
        string,
        any,
      ][]) {
        if (!routesMap.has(path)) {
          routesMap.set(path, {
            ...info,
            fileName: info.fileName.replace(/\\/g, '/'),
          })
        }
      }
    }
    return routesMap
  }

  function isErrorPage(route: string, fileName: string): boolean {
    return (
      fileName.endsWith('/error.html') ||
      fileName.endsWith('/error.tsx') ||
      fileName.split('/').pop()?.startsWith('error-') ||
      route.includes('/error')
    )
  }

  function getUniqueRoutes(
    routesMap: Map<string, Route.Meta>,
  ): { route: string; info: Route.Meta }[] {
    const fileGroups = new Map<string, { route: string; info: Route.Meta }[]>()
    const uniqueRoutes: { route: string; info: Route.Meta }[] = []

    for (const [route, info] of routesMap.entries()) {
      if (isErrorPage(route, info.fileName)) continue

      if (info.fileName === '(unknown)' || info.fileName === '_virtual') {
        uniqueRoutes.push({ route, info })
        continue
      }

      const group = fileGroups.get(info.fileName) || []
      group.push({ route, info })
      fileGroups.set(info.fileName, group)
    }

    for (const group of fileGroups.values()) {
      selectBestRoute(group, uniqueRoutes)
    }

    return uniqueRoutes
  }

  function selectBestRoute(
    group: { route: string; info: Route.Meta }[],
    uniqueRoutes: { route: string; info: Route.Meta }[],
  ) {
    if (group.length === 1) {
      uniqueRoutes.push(group[0])
      return
    }

    const rootRoute = group.find(item => item.route === '/')
    if (rootRoute) {
      uniqueRoutes.push(rootRoute)
      return
    }

    const noExtRoute = group.find(item => {
      const extIndex = item.info.fileName.lastIndexOf('.')
      const ext = extIndex > -1 ? item.info.fileName.substring(extIndex) : ''
      return !item.route.endsWith(ext)
    })

    if (noExtRoute) {
      uniqueRoutes.push(noExtRoute)
      return
    }

    group.sort((a, b) => a.route.length - b.route.length)
    uniqueRoutes.push(group[0])
  }

  function loadErrorRoutes(): AppErrorRoute[] {
    const errorRoutes = new Map<string, ErrorRouteInfo>()
    const errorHandlers = Bakery.handlers.error.list() || []
    for (const HandlerClass of errorHandlers) {
      const handlerRoutes = HandlerClass.routes() || {}
      for (const [key, route] of Object.entries(handlerRoutes as any) as [
        string,
        any,
      ][]) {
        processErrorHandlerRoute(key, route, errorRoutes)
      }
    }

    return sortErrorRoutes(errorRoutes)
  }

  function processErrorHandlerRoute(
    key: string,
    route: Route.Meta,
    errorRoutes: Map<string, ErrorRouteInfo>,
  ) {
    if (key.includes('.')) return

    const lastSlash = key.lastIndexOf('/')
    const scope = lastSlash > 0 ? key.substring(0, lastSlash) : '/'
    const name = key.substring(lastSlash + 1)
    const code = name.startsWith('error-')
      ? name.substring('error-'.length)
      : 'Fallback'

    const normalizedFileName = route.fileName.replace(/\\/g, '/')
    errorRoutes.set(`${scope}:${code}`, {
      scope,
      code,
      filePath: normalizedFileName,
      type: normalizedFileName.endsWith('.tsx') ? 'tsx' : 'html',
    })
  }

  function sortErrorRoutes(
    errorRoutes: Map<string, ErrorRouteInfo>,
  ): AppErrorRoute[] {
    return Array.from(errorRoutes.entries())
      .sort(([k1], [k2]) => {
        const [s1, t1] = k1.split(':')
        const [s2, t2] = k2.split(':')

        const scopeCompare = s1.localeCompare(s2)
        if (scopeCompare !== 0) return scopeCompare

        if (t1 === 'Fallback') return 1
        if (t2 === 'Fallback') return -1
        return t1.localeCompare(t2)
      })
      .map(([key, file]) => {
        const [scope, code] = key.split(':')
        return { scope, code, file: file.filePath }
      })
  }

  export function printTree() {
    const { api, pages, errors, websockets } = get()

    const pagesRoot = buildPagesTree(pages, errors)
    const apiRoot = buildApiTree(api)
    const wsRoot = buildWsTree(websockets)

    collapseNode(pagesRoot)
    collapseNode(apiRoot)
    collapseNode(wsRoot)

    const apiLines = renderApiRoot(apiRoot, api.length > 0)
    const pageLines = renderPageRoot(pagesRoot)
    const wsLines = renderWsRoot(wsRoot, websockets.length > 0)

    return { apiLines, pageLines, wsLines }
  }
}

export function clearAppRoutesCache() {
  Routes.clearCache()
}

export function getAppRoutes(): AppRoutes {
  return Routes.get()
}

export function printRoutesTree() {
  return Routes.printTree()
}

function buildPagesTree(
  pages: AppRouteEntry[],
  errors: AppErrorRoute[],
): TreeNode {
  const pagesRoot = createNode('/')
  if (pages.length > 0 && pages[0].route === '/') {
    pagesRoot.fileName = pages[0].fileName
    pagesRoot.isRoot = pages[0].isRoot
    pagesRoot.type = pages[0].type
  }

  addPagesToTree(pages, pagesRoot)
  addErrorsToTree(errors, pagesRoot)

  return pagesRoot
}

function addPagesToTree(pages: AppRouteEntry[], pagesRoot: TreeNode) {
  for (const item of pages) {
    if (item.route === '/') continue
    const segments = item.route.split('/').filter(Boolean)
    let current = pagesRoot

    for (const seg of segments) {
      current = current.children.getOrInsertComputed(seg, () => createNode(seg))
    }
    current.fileName = item.fileName
    current.isRoot = item.isRoot
    current.type = item.type
  }
}

function addErrorsToTree(errors: AppErrorRoute[], pagesRoot: TreeNode) {
  for (const item of errors) {
    const segments = item.scope.split('/').filter(Boolean)
    let current = pagesRoot
    for (const seg of segments) {
      current = current.children.getOrInsertComputed(seg, () => createNode(seg))
    }
    current.errors.set(item.code, item.file)
  }
}

function buildApiTree(api: AppRouteEntry[]): TreeNode {
  const apiRoot = createNode('/api')
  for (const item of api) {
    const apiRoute = item.route.replace(/^\/api/, '')
    const segments = apiRoute.split('/').filter(Boolean)
    let current = apiRoot
    for (const seg of segments) {
      current = current.children.getOrInsertComputed(seg, () => createNode(seg))
    }
    current.fileName = item.fileName
    current.isRoot = item.isRoot
    current.type = item.type
  }
  return apiRoot
}

function collapseNode(node: TreeNode) {
  for (const childNode of node.children.values()) {
    collapseNode(childNode)
  }

  const childEntries = Array.from(node.children.entries())
  if (
    childEntries.length === 1 &&
    !node.fileName &&
    node.errors.size === 0 &&
    node.name !== '/'
  ) {
    const [_childName, childNode] = childEntries[0]
    const isFolderNode =
      childNode.children.size > 0 ||
      childNode.errors.size > 0 ||
      childNode.isRoot
    if (isFolderNode) {
      node.name = `${node.name}/${childNode.name}`
      node.fileName = childNode.fileName
      node.isRoot = childNode.isRoot
      node.type = childNode.type
      node.errors = childNode.errors
      node.children = childNode.children
      collapseNode(node)
    }
  }
}

function renderNode(node: TreeNode, prefix = ''): string[] {
  const lines: string[] = []
  interface DisplayItem {
    name: string
    isFolder?: boolean
    isError?: boolean
    render: (pfx: string, isLast: boolean) => string[]
  }
  const items: DisplayItem[] = []

  for (const [_childName, childNode] of node.children.entries()) {
    const isFolder =
      childNode.children.size > 0 ||
      childNode.errors.size > 0 ||
      Boolean(childNode.isRoot)
    items.push({
      name: childNode.name,
      isFolder,
      render: (pfx, last) => renderNodeChild(childNode, pfx, last, isFolder),
    })
  }

  const hasOtherChildren = node.children.size > 0 || node.errors.size > 0
  const shouldShowIndexChild =
    node.fileName && (hasOtherChildren || node.isRoot)
  if (shouldShowIndexChild) {
    items.push({
      name: '/',
      render: (pfx, last) => renderIndexChild(node, pfx, last),
    })
  }

  for (const [code, file] of node.errors.entries()) {
    const label = code === 'Fallback' ? 'error' : `error-${code}`
    const ext = file.substring(file.lastIndexOf('.'))
    items.push({
      name: label,
      isError: true,
      render: (pfx, last) => {
        const branch = last ? '%d└─ %0' : '%d├─ %0'
        return [`${pfx}${branch}%o${label}%d${ext}%0`]
      },
    })
  }

  sortDisplayItems(items)

  for (let i = 0; i < items.length; i++) {
    const isItemLast = i === items.length - 1
    lines.push(...items[i].render(prefix, isItemLast))
  }

  return lines
}

function getNodeNameColor(childNode: TreeNode, isFolder: boolean): string {
  switch (true) {
    case isFolder:
      return '%y'
    case childNode.type === 'endpoint':
      return '%c'
    case childNode.type === 'websocket':
      return '%p'
    case childNode.fileName && /\.(ts|js)$/.test(childNode.fileName):
      return '%b'
    default:
      return '%g'
  }
}

function getNodeDisplayName(childNode: TreeNode, isFolder: boolean): string {
  if (!isFolder && childNode.fileName) {
    if (childNode.fileName === '_virtual') {
      return `${childNode.name}%d (virtual)%0`
    }
    const ext = childNode.fileName.substring(
      childNode.fileName.lastIndexOf('.'),
    )
    return ext && childNode.name.endsWith(ext)
      ? `${childNode.name}%0`
      : `${childNode.name}%d${ext}%0`
  }
  return `${childNode.name}%0`
}

function renderNodeChild(
  childNode: TreeNode,
  pfx: string,
  last: boolean,
  isFolder: boolean,
): string[] {
  const branch = last ? '%d└─ %0' : '%d├─ %0'
  const nameColor = getNodeNameColor(childNode, isFolder)
  const displayName = getNodeDisplayName(childNode, isFolder)
  const selfLine = `${pfx}${branch}${nameColor}${displayName}`
  const nextPfx = pfx + (last ? '    ' : '%d│   %0')
  return [selfLine, ...renderNode(childNode, nextPfx)]
}

function renderIndexChild(
  node: TreeNode,
  pfx: string,
  last: boolean,
): string[] {
  const branch = last ? '%d└─ %0' : '%d├─ %0'
  const slashColor =
    node.type === 'endpoint'
      ? '%c'
      : node.fileName && /\.(ts|js)$/.test(node.fileName)
        ? '%b'
        : '%g'
  return [`${pfx}${branch}${slashColor}/%d${node.fileName}%0`]
}

function sortDisplayItems(
  items: { name: string; isFolder?: boolean; isError?: boolean }[],
) {
  items.sort(compareDisplayItems)
}

function compareDisplayItems(
  a: { name: string; isFolder?: boolean; isError?: boolean },
  b: { name: string; isFolder?: boolean; isError?: boolean },
): number {
  if (a.name === '/') return -1
  if (b.name === '/') return 1

  if (a.isError && !b.isError) return 1
  if (!a.isError && b.isError) return -1

  if (a.isError && b.isError) {
    return compareErrorItems(a.name, b.name)
  }

  if (a.isFolder && !b.isFolder) return -1
  if (!a.isFolder && b.isFolder) return 1

  return a.name.localeCompare(b.name)
}

function compareErrorItems(aName: string, bName: string): number {
  if (aName === 'error') return 1
  if (bName === 'error') return -1
  return aName.localeCompare(bName)
}

function renderApiRoot(apiRoot: TreeNode, hasApi: boolean): string[] {
  const apiLines: string[] = []
  if (!hasApi) return apiLines

  apiLines.push('\x1b[1mEndpoints (/api)%0')
  const items: {
    name: string
    isFolder?: boolean
    render: (pfx: string, last: boolean) => string[]
  }[] = []

  for (const [_childName, childNode] of apiRoot.children.entries()) {
    const isFolder =
      childNode.children.size > 0 ||
      childNode.errors.size > 0 ||
      Boolean(childNode.isRoot)
    items.push({
      name: childNode.name,
      isFolder,
      render: (pfx, last) => renderNodeChild(childNode, pfx, last, isFolder),
    })
  }

  items.sort((a, b) => {
    if (a.isFolder && !b.isFolder) return -1
    if (!a.isFolder && b.isFolder) return 1
    return a.name.localeCompare(b.name)
  })

  for (let i = 0; i < items.length; i++) {
    apiLines.push(...items[i].render('', i === items.length - 1))
  }

  return apiLines
}

function renderPageRoot(pagesRoot: TreeNode): string[] {
  const pageLines: string[] = []
  pageLines.push('\x1b[1mPages%0')

  const rootItems: {
    name: string
    isError?: boolean
    isFolder?: boolean
    render: (pfx: string, last: boolean) => string[]
  }[] = []

  if (pagesRoot.fileName) {
    const rootFileName = pagesRoot.fileName
    rootItems.push({
      name: '/',
      render: (pfx, last) => {
        const branch = last ? '%d└─ %0' : '%d├─ %0'
        const slashColor =
          pagesRoot.type === 'endpoint'
            ? '%c'
            : rootFileName && /\.(ts|js)$/.test(rootFileName)
              ? '%b'
              : '%g'
        const baseName = rootFileName.split('/').pop() || ''
        return [`${pfx}${branch}${slashColor}/%d${baseName}%0`]
      },
    })
  }

  for (const [_childName, childNode] of pagesRoot.children.entries()) {
    const isFolder =
      childNode.children.size > 0 ||
      childNode.errors.size > 0 ||
      Boolean(childNode.isRoot)
    rootItems.push({
      name: childNode.name,
      isFolder,
      render: (pfx, last) => renderNodeChild(childNode, pfx, last, isFolder),
    })
  }

  for (const [code, file] of pagesRoot.errors.entries()) {
    const label = code === 'Fallback' ? 'error' : `error-${code}`
    const ext = file.substring(file.lastIndexOf('.'))
    rootItems.push({
      name: label,
      isError: true,
      render: (pfx, last) => {
        const branch = last ? '%d└─ %0' : '%d├─ %0'
        return [`${pfx}${branch}%o${label}%d${ext}%0`]
      },
    })
  }

  sortDisplayItems(rootItems)

  for (let i = 0; i < rootItems.length; i++) {
    pageLines.push(...rootItems[i].render('', i === rootItems.length - 1))
  }

  return pageLines
}

function buildWsTree(websockets: AppRouteEntry[]): TreeNode {
  const wsRoot = createNode('/')
  for (const item of websockets) {
    const segments = item.route.split('/').filter(Boolean)
    let current = wsRoot
    for (const seg of segments) {
      current = current.children.getOrInsertComputed(seg, () => createNode(seg))
    }
    current.fileName = item.fileName
    current.isRoot = item.isRoot
    current.type = item.type
  }
  return wsRoot
}

function renderWsRoot(wsRoot: TreeNode, hasWs: boolean): string[] {
  const wsLines: string[] = []
  if (!hasWs) return wsLines

  wsLines.push('\x1b[1mWebsockets%0')
  const items: {
    name: string
    isFolder?: boolean
    render: (pfx: string, last: boolean) => string[]
  }[] = []

  for (const [_childName, childNode] of wsRoot.children.entries()) {
    const isFolder =
      childNode.children.size > 0 ||
      childNode.errors.size > 0 ||
      Boolean(childNode.isRoot)
    items.push({
      name: childNode.name,
      isFolder,
      render: (pfx, last) => renderNodeChild(childNode, pfx, last, isFolder),
    })
  }

  items.sort((a, b) => {
    if (a.isFolder && !b.isFolder) return -1
    if (!a.isFolder && b.isFolder) return 1
    return a.name.localeCompare(b.name)
  })

  for (let i = 0; i < items.length; i++) {
    wsLines.push(...items[i].render('', i === items.length - 1))
  }

  return wsLines
}
