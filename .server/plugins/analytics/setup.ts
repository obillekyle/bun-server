import { Bakery } from '@server/core/bakery'
import { Handler } from '@server/handlers/core/$base'
import { WebSocketHandler } from '@server/handlers/core/$websocket'
import { getElapsed, log } from '@server/logger'
import { Try } from '@server/utils/common'
import { response } from '@server/utils/http'
import * as core from './core'
import * as storageSqlite from './storage-sqlite'

let SessionModule: typeof import('@server/core/session').Session | null = null
async function getSession() {
  if (!SessionModule) {
    SessionModule = (await import('@server/core/session')).Session
  }
  return SessionModule
}

const PAGE_HITS_BOOT_WINDOW_MS = 24 * 3600 * 1000
const PAGE_HITS_BOOT_MAX_ITEMS = 5000
const SAVE_THROTTLE_MS = 60000

export const pageHitsLog = core.pageHitsLog
export const pageHitsMap = core.pageHitsMap
export const history1m = core.history1m
export const history1h = core.history1h
export const history1d = core.history1d
export const history7d = core.history7d
export const history30d = core.history30d

export const recordRouteHit = core.recordRouteHit
export const recordDbHit = core.recordDbHit
export const recordErrorPageHit = core.recordErrorPageHit
export const pushAnalyticsSnapshot = core.pushAnalyticsSnapshot
export const getLatestAnalyticsSnapshot = core.getLatestAnalyticsSnapshot
export const getHistoryLimitForTimescale = core.getHistoryLimitForTimescale
export const getFilledHistoryForTimescale = core.getFilledHistoryForTimescale
export const getHistoryForTimescale = core.getHistoryForTimescale
export const getLatestHistoryPoint = core.getLatestHistoryPoint
export const getChildrenMemoryUsage = core.getChildrenMemoryUsage

async function saveAnalyticsData() {
  const cacheBase = Bakery.cacheDir
  await storageSqlite.saveAnalyticsData(cacheBase)
}

function syncHistoryArrays(data: any) {
  const syncArr = (source: any[], target: any[]) => {
    if (source) {
      target.length = 0
      target.push(...source)
    }
  }
  syncArr(data.history1m, core.history1m)
  syncArr(data.history1h, core.history1h)
  syncArr(data.history1d, core.history1d)
  syncArr(data.history7d, core.history7d)
  syncArr(data.history30d, core.history30d)
}

function processRawPageHits(pageHitsRaw: any) {
  if (!Array.isArray(pageHitsRaw) || pageHitsRaw.length === 0) return

  const minTs = Date.now() - PAGE_HITS_BOOT_WINDOW_MS
  const list = pageHitsRaw
    .map((e: any) => ({
      timestamp: Number(e?.timestamp) || 0,
      path: e?.path,
    }))
    .filter(
      (e: any) =>
        Number.isFinite(e.timestamp) &&
        typeof e.path === 'string' &&
        e.path.length > 0 &&
        e.timestamp >= minTs,
    )
    .slice(-PAGE_HITS_BOOT_MAX_ITEMS)

  pageHitsLog.length = 0
  pageHitsLog.push(...list)
}

async function loadAnalyticsData() {
  const cacheBase = Bakery.cacheDir
  const { coreData, pageHitsRaw } =
    await storageSqlite.loadAnalyticsData(cacheBase)

  const data = coreData || {}
  if (!coreData && !pageHitsRaw) return

  syncHistoryArrays(data)

  if (data.temp1h || data.temp1d || data.temp7d || data.temp30d) {
    core.loadTemps(data)
  }

  if (data.pageHits && Array.isArray(data.pageHits)) {
    for (const [k, v] of data.pageHits) {
      pageHitsMap.set(k, (pageHitsMap.get(k) || 0) + v)
    }
  }

  processRawPageHits(pageHitsRaw)
}

let lastSaveTime = 0
function throttleSave() {
  const now = Date.now()
  if (now - lastSaveTime >= SAVE_THROTTLE_MS) {
    void saveAnalyticsData()
    lastSaveTime = now
  }
}

let analyticsLoopTimer: ReturnType<typeof setInterval> | null = null

export function startAnalyticsLoop(server: any) {
  if (analyticsLoopTimer) clearInterval(analyticsLoopTimer)
  analyticsLoopTimer = setInterval(async () => {
    try {
      const activeLoggersCount =
        (globalThis as any).Bakery?.connectedLoggers?.size || 0
      const pingStart = Bun.nanoseconds()
      const pingVal = await Try.return(async function getPing() {
        const res = await server.fetch(`http://localhost/_analytics/ping`)
        return res.status === 200 ? getElapsed(pingStart) : res.status
      }, 0)

      const mem = process.memoryUsage()
      const childrenMem = await getChildrenMemoryUsage()
      pushAnalyticsSnapshot({
        timestamp: Date.now(),
        memoryUsed: Math.round((mem.rss + childrenMem) / 1024 / 1024),
        activeLoggers: activeLoggersCount,
        activeSessions: (await getSession()).count,
        ping: pingVal,
      })

      throttleSave()

      for (const ws of connectedAnalyticsClients) {
        const opts = ws.data?.data
        if (opts) {
          const stats = await computeStats(
            opts.timescale,
            true,
            opts.pagesFilter,
          )
          ws.send(
            JSON.stringify({ status: 200, excludeHistory: true, data: stats }),
          )
        }
      }
    } catch (e) {
      log({
        level: 'trace',
        by: 'analytics',
        msg: `Error in analytics loop: ${String(e)}`,
      })
    }
  }, 1000)
}

class AnalyticsHandler extends Handler {
  static canHandle(path: string) {
    return (
      path === '/_analytics/ping' ||
      path === '/api/_analytics/stats' ||
      path === '/api/_analytics/reset'
    )
  }
  static resolveRoute(path: string) {
    if (
      path === '/_analytics/ping' ||
      path === '/api/_analytics/stats' ||
      path === '/api/_analytics/reset'
    ) {
      return {
        type: 'static',
        info: {
          file: Bun.file(''),
          params: [],
          path,
        },
        params: {},
      } as Handler.Route.Resolved
    }
    return null
  }
  static routes(): MapOf<Handler.Route.Meta> {
    return {
      '/_analytics/ping': {
        type: 'endpoint',
        isRoot: false,
        fileName: '_virtual',
      },
      '/api/_analytics/stats': {
        type: 'endpoint',
        isRoot: false,
        fileName: '_virtual',
      },
      '/api/_analytics/reset': {
        type: 'endpoint',
        isRoot: false,
        fileName: '_virtual',
      },
    }
  }
  static async handle(
    _path: string,
    req: Request,
  ): Promise<Response | undefined> {
    const res = await handleAnalyticsRequest(req)
    return res || undefined
  }
}

function getFilterCutoff(pagesFilter: string): number {
  const now = Date.now()
  switch (pagesFilter) {
    case '1m':
      return now - 60 * 1000
    case '1h':
      return now - 3600 * 1000
    case '1d':
      return now - 24 * 3600 * 1000
    case '7d':
      return now - 7 * 24 * 3600 * 1000
    case '30d':
      return now - 30 * 24 * 3600 * 1000
    default:
      return 0
  }
}

function buildAggregatedHits(filterCutoff: number): Map<string, number> {
  const aggregated = new Map<string, number>()
  const hasCompleteWindow =
    pageHitsLog.length > 0 && pageHitsLog[0].timestamp <= filterCutoff

  if (filterCutoff > 0 && hasCompleteWindow) {
    for (let i = pageHitsLog.length - 1; i >= 0; i--) {
      const hit = pageHitsLog[i]
      if (hit.timestamp < filterCutoff) break
      aggregated.set(hit.path, (aggregated.get(hit.path) || 0) + 1)
    }
    return aggregated
  }

  for (const [k, v] of pageHitsMap.entries()) aggregated.set(k, v)
  return aggregated
}

export async function computeStats(
  timescale: string,
  excludeHistory: boolean,
  pagesFilter: string,
) {
  const mem = process.memoryUsage()
  const latestHistory = getLatestAnalyticsSnapshot()

  const filterCutoff = getFilterCutoff(pagesFilter)
  const aggregated = buildAggregatedHits(filterCutoff)

  const topPagesFiltered = Array.from(aggregated.entries())
    .map(([page, hits]) => ({ page, hits }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 50)

  return {
    uptime: `${Math.round(process.uptime())}s`,
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    memoryUsed:
      Math.round((mem.rss + (await getChildrenMemoryUsage())) / 1024 / 1024) +
      ' MB',
    memoryExternal: `${Math.round(mem.external / 1024 / 1024)} MB`,
    bunVersion: Bun.version,
    platform: process.platform,
    arch: process.arch,
    activeLoggers: (globalThis as any).Bakery?.connectedLoggers?.size || 0,
    activeSessions: (await getSession()).count,
    routeHits: latestHistory.routeHits,
    apiHits: latestHistory.apiHits || 0,
    pageHits: latestHistory.pageHits || 0,
    uniqueRequests: latestHistory.uniqueRequests,
    dbHits: latestHistory.dbHits,
    errorPageHits: latestHistory.errorPageHits,
    ping: latestHistory.ping,
    topPages: topPagesFiltered,
    history: excludeHistory
      ? undefined
      : getFilledHistoryForTimescale(timescale),
    latestHistoryPoint: getLatestHistoryPoint(timescale),
  }
}

export const connectedAnalyticsClients = new Set<any>()

export class AnalyticsWSHandler extends WebSocketHandler {
  static canHandle(path: string): boolean {
    return path === '/_analytics_ws'
  }

  static open(ws: ServerWebSocket) {
    connectedAnalyticsClients.add(ws)
  }

  static upgrade() {
    return {
      timescale: '1m',
      excludeHistory: true,
      pagesFilter: '1d',
    }
  }

  static async message(ws: ServerWebSocket, message: any, data: any) {
    try {
      const msg = JSON.parse(String(message))
      if (msg.type === 'subscribe') {
        data.timescale = msg.timescale || '1m'
        data.excludeHistory = !!msg.excludeHistory
        data.pagesFilter = msg.pagesFilter || '1d'
        const stats = await computeStats(
          data.timescale,
          data.excludeHistory,
          data.pagesFilter,
        )

        ws.send(
          JSON.stringify({
            status: 200,
            excludeHistory: data.excludeHistory,
            data: stats,
          }),
        )
      }
    } catch {}
  }

  static close(ws: any) {
    connectedAnalyticsClients.delete(ws)
  }
}

function checkDashpassAuth(req: Request): Response | null {
  if (!process.env.DASHPASS) return null
  return req.session.get('dashpassAuthenticated')
    ? null
    : (response.json.error(401, 'Unauthorized') as any)
}

function checkCsrfOrigin(req: Request): boolean {
  const origin = req.headers.get('origin') || req.headers.get('referer') || ''
  const requestedWith = req.headers.get('x-requested-with') || ''

  const host = Bakery.config.host || 'localhost'
  const port = process.env.PORT
    ? String(process.env.PORT)
    : String(Bakery.config.port || '3000')

  const allowedOrigins = [
    `http://${host}:${port}`,
    `https://${host}:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]

  const originOk =
    origin === '' || allowedOrigins.some(o => origin.startsWith(o))
  const xhrOk = requestedWith.toLowerCase() === 'xmlhttprequest'

  return originOk || xhrOk
}

async function handleResetRequest(req: Request): Promise<Response> {
  const authError = checkDashpassAuth(req)
  if (authError) return authError

  if (!checkCsrfOrigin(req)) return response.json.error(403, 'Forbidden') as any

  core.history1m.length = 0
  core.history1h.length = 0
  core.history1d.length = 0
  core.history7d.length = 0
  core.history30d.length = 0
  pageHitsMap.clear()
  pageHitsLog.length = 0

  await saveAnalyticsData()
  return response.json.success('Analytics data reset successfully') as any
}

async function handleStatsRequest(req: Request, url: URL): Promise<Response> {
  const authError = checkDashpassAuth(req)
  if (authError) return authError

  const timescale = url.searchParams.get('timescale') || '1m'
  const excludeHistory = url.searchParams.get('excludeHistory') === 'true'
  const pagesFilter = url.searchParams.get('pagesFilter') || 'all'

  const stats = await computeStats(timescale, excludeHistory, pagesFilter)
  return response.json.success('success', stats) as any
}

export async function handleAnalyticsRequest(
  req: Request,
): Promise<Response | null> {
  const url = new URL(req.url)
  const path = url.pathname

  switch (true) {
    case path === '/_analytics/ping':
      return new Response('pong', { headers: { 'Content-Type': 'text/plain' } })
    case path === '/api/_analytics/reset' && req.method === 'POST':
      return await handleResetRequest(req)
    case path === '/api/_analytics/stats':
      return await handleStatsRequest(req, url)
    default:
      return null
  }
}

export function setupAnalytics() {
  Bakery.handlers.fetch.set(AnalyticsHandler, 110)
  Bakery.handlers.websocket.set(AnalyticsWSHandler)
  void loadAnalyticsData()
  Bakery.onShutdown(async () => {
    if (analyticsLoopTimer) {
      clearInterval(analyticsLoopTimer)
      analyticsLoopTimer = null
    }
    core.stopPageHitsLogPruner()
    await saveAnalyticsData()
  })
}
