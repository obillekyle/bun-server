import { connectedLoggers } from '@plugins/analytics/core'
import { Bakery } from '@server/core/bakery'
import { Handler } from '@server/handlers'
import { getElapsed, setLogCallback } from '@server/logger'
import { processBody } from '@server/utils'
import { is, Try } from '@server/utils/common'
import {
  assembleHtml,
  injectIfHtml,
  redirect,
  response,
} from '@server/utils/http'
import type { AppRoutes } from '@server/utils/routing'
import { getAppRoutes } from '@server/utils/routing'

let dashboardOptions: { whitelist?: string[] } | undefined
const isDevWorker = import.meta.env.WORKER
let cachedDashboardJsPath: string | null = null
let cachedDashboardRenderer: ((req: any, body: any) => any) | null = null

type CustomRoutes<T extends string> = MapOf<{ file: string; type: T }>

class DashboardHandler extends Handler {
  static canHandle(path: string) {
    return path.startsWith('/_dashboard') || path.startsWith('/api/_dashboard')
  }

  static resolveRoute(path: string): Handler.Route.Resolved | null {
    if (path.startsWith('/_dashboard') || path.startsWith('/api/_dashboard')) {
      return {
        type: 'static',
        params: {},
        info: {
          valid: true,
          file: Bun.file('./.server/plugins/dashboard/setup.tsx'),
          params: [],
          path,
        },
      }
    }
    return null
  }

  static getRegisteredRoutes(): MapOf<Handler.Route.Meta> {
    return {
      '/_dashboard': { type: 'route', isRoot: true, fileName: 'dashboard.tsx' },
      '/_dashboard/style.css': {
        type: 'static',
        isRoot: false,
        fileName: 'style.css',
      },
      '/_dashboard/dashboard.js': {
        type: 'static',
        isRoot: false,
        fileName: 'dashboard.js',
      },
      '/api/_dashboard/sessions': {
        type: 'endpoint',
        isRoot: false,
        fileName: '_virtual',
      },
      '/api/_dashboard/sessions/delete': {
        type: 'endpoint',
        isRoot: false,
        fileName: '_virtual',
      },
      '/api/_dashboard/sessions/update': {
        type: 'endpoint',
        isRoot: false,
        fileName: '_virtual',
      },
      '/api/_dashboard/schema': {
        type: 'endpoint',
        isRoot: false,
        fileName: '_virtual',
      },
      '/api/_dashboard/table-data': {
        type: 'endpoint',
        isRoot: false,
        fileName: '_virtual',
      },
      '/api/_dashboard/query': {
        type: 'endpoint',
        isRoot: false,
        fileName: '_virtual',
      },
      '/api/_dashboard/execute-action': {
        type: 'endpoint',
        isRoot: false,
        fileName: '_virtual',
      },
      '/api/_dashboard/routes': {
        type: 'endpoint',
        isRoot: false,
        fileName: '_virtual',
      },
    }
  }

  static routes() {
    return this.getRegisteredRoutes()
  }

  static async handle(
    _path: string,
    req: Request,
  ): Promise<Response | undefined> {
    const res = await handleDashboardRequest(req)
    return res || undefined
  }
}

export function setupDashboard(options?: { whitelist?: string[] }) {
  dashboardOptions = options

  if ((globalThis as any).Bakery) {
    ;(globalThis as any).Bakery.connectedLoggers = connectedLoggers
  }

  setLogCallback(entry => {
    const message = JSON.stringify({
      type: 'server_log',
      level: entry.level,
      by: entry.by,
      payload: entry.msg,
      timestamp: Date.now(),
    })
    connectedLoggers.forEach(loggerWs => {
      Try.silent(() => loggerWs.send(message))
    })
  })

  Bakery.handlers.fetch.set(DashboardHandler, 120)
}

async function _preBundleDashboard() {
  try {
    const { bundleModule } = await import('@server/compiler')
    const jsPath = './.server/plugins/dashboard/client/dashboard.ts'
    const bundleResult = await bundleModule(jsPath)

    if (bundleResult.success && bundleResult.content) {
      const tmpPath = `${Bakery.cacheDir}/_dashboard.js`
      await Bun.write(tmpPath, bundleResult.content)
      cachedDashboardJsPath = tmpPath
    }
  } catch {}
}

async function loginForm(status = 200, errorMessage?: string) {
  const htmlContent = renderLoginForm(errorMessage)
  const injected = await assembleHtml(htmlContent)
  return response.html(injected, status)
}

async function handleLoginPost(req: Request, session: any, dashpass: string) {
  return await Try.return(
    async () => {
      const body = await processBody(req)
      if (body?.password !== dashpass) {
        return await loginForm(200, 'Incorrect password, try again.')
      }
      session.set('dashpassAuthenticated', true)
      return redirect('/_dashboard')
    },
    async () => await loginForm(200, 'Login error. Please try again.'),
  )
}

async function handleDashboardView(req: Request) {
  if (!cachedDashboardRenderer) {
    const mod = await import('@plugins/dashboard/dashboard.tsx')
    cachedDashboardRenderer = mod.default
  }
  const htmlContent = await cachedDashboardRenderer!(req, {})
  const injected = await injectIfHtml(htmlContent)

  return injected
    ? injected
    : htmlContent instanceof Response
      ? htmlContent
      : response.html(htmlContent)
}

function handleCssAsset() {
  return response.type(
    Bun.file('./.server/plugins/dashboard/client/dashboard.css'),
    'text/css',
  )
}

async function handleJsAsset() {
  if (cachedDashboardJsPath && !isDevWorker) {
    const cachedFile = Bun.file(cachedDashboardJsPath)
    if (cachedFile.size > 0) return response.type(cachedFile, 'text/javascript')
  }

  const { bundleModule } = await import('@server/compiler')
  const bundleResult = await bundleModule(
    './.server/plugins/dashboard/client/dashboard.ts',
  )

  if (!bundleResult.success || !bundleResult.content) {
    console.error('Failed to bundle dashboard.js:', bundleResult.errors)
    return response.error(
      `Failed to bundle dashboard.js: ${bundleResult.errors?.join('\n')}`,
      500,
    )
  }

  if (!isDevWorker) {
    const tmpPath = `${(globalThis as any).Bakery?.cacheDir || '.server/.cache'}/_dashboard.js`
    await Bun.write(tmpPath, bundleResult.content)
    const writtenFile = Bun.file(tmpPath)
    if (writtenFile.size > 0) {
      cachedDashboardJsPath = tmpPath
      return response.type(writtenFile, 'text/javascript')
    }
  }

  return response.type(bundleResult.content, 'text/javascript')
}

async function handleGetSessions(url: URL, Session: any) {
  const search = url.searchParams.get('search')?.trim().toLowerCase() || ''
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pageSize = Math.min(
    500,
    Math.max(1, parseInt(url.searchParams.get('pageSize') || '25', 10)),
  )
  const sortBy = url.searchParams.get('sortBy') || 'accessed'
  const sortOrder = url.searchParams.get('sortOrder') === 'ASC' ? 'ASC' : 'DESC'

  const result = await Session.list({
    search,
    page,
    pageSize,
    sortBy,
    sortOrder,
  })
  return response.json.success('success', result)
}

async function handleDeleteSession(req: Request, Session: any) {
  const body = await processBody(req)
  const deleted = body?.id && Session.delete(body.id)
  return deleted
    ? response.json.success('Session deleted')
    : response.json.error(404, 'Session not found')
}

async function handleUpdateSession(req: Request, Session: any) {
  const body = await processBody(req)
  const { id, key, value, remove } = body || {}

  if (typeof id !== 'string' || typeof key !== 'string')
    return response.json.error(400, 'Invalid payload')

  const session = await Session.get(id)
  if (!session) return response.json.error(404, 'Session not found')

  remove ? session.delete(key) : session.set(key, value)
  return response.json.success('Session updated', { id, key, value, remove })
}

async function handleSchema() {
  const { connection } = await import('@database/connection')
  return await Try.return(
    async () => response.json.success('success', await connection.getSchema()),
    () => response.json.error(500, 'Failed to retrieve schema details'),
  )
}

async function handleTableData(url: URL) {
  const tableName = url.searchParams.get('tableName')
  if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName))
    return response.json.error(400, 'Invalid table name')

  const { connection } = await import('@database/connection')
  return await Try.return(
    async () => {
      const data = await connection.getData(tableName, {
        page: parseInt(url.searchParams.get('page') || '1', 10),
        pageSize: parseInt(url.searchParams.get('pageSize') || '50', 10),
        sortBy: url.searchParams.get('sortBy'),
        sortOrder: url.searchParams.get('sortOrder') || 'ASC',
        filters: JSON.parse(url.searchParams.get('filters') || '{}'),
      })
      return response.json.success('success', data)
    },
    (error: any) => response.json.error(400, error.message),
  )
}

async function handleQuery(req: Request) {
  const body = await processBody(req)
  if (!is.string(body?.sql))
    return response.json.error(400, 'Invalid SQL query')

  const sqlLower = body.sql.trim().toLowerCase()
  const isSelect = /^(select|with|show|describe|pragma|explain)/.test(sqlLower)
  const { connection } = await import('@database/connection')
  const start = Bun.nanoseconds()

  return await Try.return(
    async () => {
      const result = isSelect
        ? { rows: await connection.query(body.sql).all(), isSelect: true }
        : {
            rows: [
              (({ lastInsertRowid, changes }) => ({
                lastInsertRowid,
                changes,
              }))(await connection.query(body.sql).run()),
            ],
            isSelect: false,
          }

      return response.json.success('success', {
        ...result,
        time: getElapsed(start),
      })
    },
    (error: any) =>
      response.json.error(400, error.message, { time: getElapsed(start) }),
  )
}

const executeActionHandlers: Record<
  string,
  (body: any, connection: any) => Promise<any>
> = {
  'delete-row': async (body, connection) => {
    if (body.rowid == null) return response.json.error(400, 'Invalid row ID')
    return await Try.return(
      async () => {
        await connection.remove(body.tableName, body.rowid)
        return response.json.success('Row deleted')
      },
      (e: any) => response.json.error(400, e.message),
    )
  },
  truncate: async (body, connection) => {
    return await Try.return(
      async () => {
        await connection.truncate(body.tableName)
        return response.json.success('Table truncated')
      },
      (e: any) => response.json.error(400, e.message),
    )
  },
  'insert-row': async (body, connection) => {
    if (!body.row || typeof body.row !== 'object')
      return response.json.error(400, 'Invalid row data')
    return await Try.return(
      async () => {
        await connection.insert(body.tableName, body.row)
        return response.json.success('Row inserted')
      },
      (e: any) => response.json.error(400, e.message),
    )
  },
  'update-row': async (body, connection) => {
    if (
      !body.row ||
      !is.object(body.row) ||
      Array.isArray(body.row) ||
      body.rowid == null
    ) {
      return response.json.error(400, 'Invalid data or row ID')
    }
    return await Try.return(
      async () => {
        await connection.update(body.tableName, body.rowid, body.row)
        return response.json.success('Row updated')
      },
      (e: any) => response.json.error(400, e.message),
    )
  },
  'import-csv': async (body, connection) => {
    if (typeof body.csvContent !== 'string')
      return response.json.error(400, 'Invalid CSV')
    return await Try.return(
      async () => {
        const info = await connection.importCSV(body.tableName, body.csvContent)
        return response.json.success(`Imported ${info.changes} rows`, {
          info,
        })
      },
      (e: any) => response.json.error(400, e.message),
    )
  },
}

async function handleExecuteAction(req: Request) {
  const body = await processBody(req)
  const { action, tableName } = body || {}

  if (!is.string(tableName) || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
    return response.json.error(400, 'Invalid table name')
  }

  const { connection } = await import('@database/connection')
  const handler = executeActionHandlers[action]
  if (handler) {
    return await handler(body, connection)
  }
  return response.json.error(400, 'Unknown action')
}

function handleGetRoutes() {
  const { api, pages, errors } = getAppRoutes() as AppRoutes
  const routes: CustomRoutes<'api' | 'page' | 'error'> = {
    ...api.reduce((acc, r) => {
      acc[r.route] = { file: r.fileName, type: 'api' }
      return acc
    }, {} as MapOf<any>),
    ...pages.reduce((acc, r) => {
      acc[r.route] = { file: r.fileName, type: 'page' }
      return acc
    }, {} as MapOf<any>),
    ...errors.reduce((acc, r) => {
      const name = r.file.split('/').pop()?.split('.')[0] || ''
      const path =
        r.scope === '/'
          ? `/${name}`
          : `${r.scope}/${name}`.replace(/\/\/+/g, '/')
      acc[path] = { file: r.file, type: 'error' }
      return acc
    }, {} as MapOf<any>),
  }
  return response.json.success('success', routes)
}

async function checkAuthMiddleware(
  _req: Request,
  path: string,
  dashpass: string | undefined,
  session: any,
) {
  if (!dashpass) return null

  const isAuth = session?.get('dashpassAuthenticated', false) === true
  if (isAuth || /\.(css|js)$/.test(path)) return null

  return path.startsWith('/api/')
    ? response.error('Unauthorized', 401)
    : await loginForm(200, 'Please log in to access the dashboard')
}

function checkCsrfMiddleware(req: Request, path: string) {
  if (!path.startsWith('/api/_dashboard') || req.method !== 'POST') return null

  const origin = req.headers.get('origin') || req.headers.get('referer') || ''
  const requestedWith = req.headers.get('x-requested-with') || ''
  const host = Bakery.config.host || 'localhost'
  const port = String(process.env.PORT || Bakery.config.port || '3000')
  const allowedOrigins = [
    `http://${host}:${port}`,
    `https://${host}:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]

  const originOk =
    origin === '' || allowedOrigins.some(o => origin.startsWith(o))
  const xhrOk = requestedWith.toLowerCase() === 'xmlhttprequest'

  return !originOk && !xhrOk
    ? (response.json.error(403, 'Forbidden') as unknown as Response)
    : null
}

function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return (
    (globalThis as any).Bakery?.server?.requestIP(req)?.address || '127.0.0.1'
  )
}

function isAllowedIp(ip: string, whitelist: string[] = []): boolean {
  const normalized = ip.startsWith('::ffff:') ? ip.substring(7) : ip
  if (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'localhost'
  ) {
    return true
  }
  return whitelist.includes(normalized)
}

const dashboardRoutes: Record<
  string,
  (req: Request, url: URL, Session: any) => Promise<any> | any
> = {
  '/_dashboard': req => handleDashboardView(req),
  '/_dashboard/style.css': () => handleCssAsset(),
  '/_dashboard/dashboard.js': () => handleJsAsset(),
  '/api/_dashboard/sessions': (_req, url, Session) =>
    handleGetSessions(url, Session),
  '/api/_dashboard/sessions/delete': (req, _url, Session) =>
    handleDeleteSession(req, Session),
  '/api/_dashboard/sessions/update': (req, _url, Session) =>
    handleUpdateSession(req, Session),
  '/api/_dashboard/schema': () => handleSchema(),
  '/api/_dashboard/table-data': (_req, url) => handleTableData(url),
  '/api/_dashboard/query': req => handleQuery(req),
  '/api/_dashboard/execute-action': req => handleExecuteAction(req),
  '/api/_dashboard/routes': () => handleGetRoutes(),
}

export async function handleDashboardRequest(
  req: Request,
): Promise<Response | null> {
  const url = new URL(req.url)
  const path = url.pathname

  if (!path.startsWith('/_dashboard') && !path.startsWith('/api/_dashboard'))
    return null

  const clientIp = getClientIp(req)
  if (!isAllowedIp(clientIp, dashboardOptions?.whitelist)) {
    return new Response('Forbidden', { status: 403 })
  }

  const { Session } = await import('@server/core/session')
  const dashpass = process.env.DASHPASS
  const session = req.session

  if (dashpass && path === '/_dashboard/logout') {
    session.set('dashpassAuthenticated', false)
    return redirect('/_dashboard/login')
  }

  if (dashpass && path === '/_dashboard/login' && req.method === 'POST') {
    return handleLoginPost(req, session, dashpass)
  }

  const authBlock = await checkAuthMiddleware(req, path, dashpass, session)
  if (authBlock) return authBlock

  const csrfBlock = checkCsrfMiddleware(req, path)
  if (csrfBlock) return csrfBlock

  const routeHandler = dashboardRoutes[path]
  if (routeHandler) {
    return await routeHandler(req, url, Session)
  }
  return null
}

function renderLoginForm(errorMessage?: string) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Bakery Console - Login</title>
        <link rel="stylesheet" href="/_dashboard/style.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script src="https://code.iconify.design/iconify-icon/3.0.0/iconify-icon.min.js"></script>
      </head>
      <body class="dashboard-login">
        <div class="login-container">
          <div class="login-card glass-effect">
            <div class="logo-area">
              <div class="logo-badge">
                <iconify-icon icon="material-symbols:bolt-outline"></iconify-icon>
              </div>
              <h1 class="title">Bakery</h1>
              <p class="subtitle">Console Login</p>
            </div>
            <form method="POST" action="/_dashboard/login">
              {errorMessage ? (
                <div class="error-box">
                  <iconify-icon icon="lucide:alert-circle"></iconify-icon>
                  <span>{errorMessage}</span>
                </div>
              ) : (
                ''
              )}
              <div class="form-group">
                <div class="label-row">
                  <label class="label" for="password">
                    Password
                  </label>
                </div>
                <input
                  class="input-field"
                  type="password"
                  id="password"
                  name="password"
                  autocomplete="current-password"
                  placeholder="Enter DASHPASS password"
                  required
                  autofocus
                />
              </div>
              <button type="submit" class="login-btn">
                <span>Sign In</span>
                <iconify-icon icon="lucide:arrow-right"></iconify-icon>
              </button>
            </form>
          </div>
        </div>
        <script src="/_dashboard/dashboard.js"></script>
      </body>
    </html>
  )
}
