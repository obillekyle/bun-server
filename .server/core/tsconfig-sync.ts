import { Bakery } from '@server/core/bakery'
import { fs } from '@server/utils/fs'
import { errorMsg, serveLog } from '../logger'

const isRootRelative = (val: string) =>
  val.startsWith('.server/') ||
  val.startsWith('./.server/') ||
  val.startsWith('api/') ||
  val.startsWith('./api/') ||
  val.startsWith('node_modules/') ||
  val.startsWith('./node_modules/')

const isHttp = (val: string) =>
  val.startsWith('http://') || val.startsWith('https://')

function buildTSConfigPaths(
  userImportMap: MapOf<string>,
  _rootDir?: string,
): MapOf<string[]> {
  const newPaths: MapOf<string[]> = {}

  for (const [key, val] of Object.entries(userImportMap)) {
    const isDir = key.endsWith('/')
    const tsKey = isDir ? `${key.slice(0, -1)}/*` : key
    let tsVal = val

    if (isHttp(tsVal)) continue

    let absolutePath: string
    if (isRootRelative(tsVal)) {
      absolutePath = fs.resolve(Bakery.root, tsVal)
    } else {
      const cleanVal = tsVal.replace(/^\.\//, '').replace(/^\//, '')
      absolutePath = fs.resolve(Bakery.serveRoot, cleanVal)
    }

    const relativePath = fs.relative(Bakery.root, absolutePath)
    tsVal =
      relativePath.startsWith('./') || relativePath.startsWith('../')
        ? relativePath
        : `./${relativePath}`

    if (isDir) {
      tsVal = tsVal.endsWith('/') ? `${tsVal.slice(0, -1)}/*` : tsVal
      if (!tsVal.endsWith('/*')) tsVal += '/*'
    }

    newPaths[tsKey] = [tsVal]
  }

  return newPaths
}

async function syncAppConfig(newPaths: MapOf<string[]>): Promise<boolean> {
  const appPath = './tsconfig.app.json'
  let appConfig: any = { compilerOptions: { paths: {} } }
  if (await Bun.file(appPath).exists()) {
    appConfig = await Bun.file(appPath)
      .json()
      .catch(() => appConfig)
  }
  appConfig.compilerOptions = appConfig.compilerOptions || {}
  delete appConfig.compilerOptions.baseUrl

  if (
    JSON.stringify(appConfig.compilerOptions.paths || {}) !==
    JSON.stringify(newPaths)
  ) {
    appConfig.compilerOptions.paths = newPaths
    await Bun.write(appPath, JSON.stringify(appConfig, null, 2))
    return true
  }
  return false
}

export async function syncTSConfigPaths(
  userImportMap: MapOf<string>,
): Promise<void> {
  try {
    const rootDir = Bakery.serveRoot
    const newPaths = buildTSConfigPaths(userImportMap, rootDir)

    const appChanged = await syncAppConfig(newPaths)

    if (appChanged) {
      serveLog.TSCONFIG_SYNCED()
    }
  } catch (err: any) {
    serveLog.UNHANDLED_ERR({ error: `TSConfig sync error: ${errorMsg(err)}` })
  }
}
