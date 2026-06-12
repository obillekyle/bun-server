export * from './adapters/base'

function looksLikeSQLiteTarget(value: string) {
  return (
    value === ':memory:' ||
    value.startsWith('sqlite:') ||
    value.startsWith('file:') ||
    /(^|[\\/])[^\\/]+\\.db($|[?#])/i.test(value) ||
    value.endsWith('.db') ||
    value.includes('/') ||
    value.includes('\\')
  )
}

function inferDriverFromTarget(
  value?: string | null,
): 'sqlite' | 'postgres' | 'mysql' {
  const target = value?.trim() || ''

  switch (true) {
    case !target:
      return 'sqlite'
    case target.startsWith('mysql://'):
    case target.startsWith('mysqls://'):
    case target.startsWith('mysqli://'):
      return 'mysql'
    case target.startsWith('postgres://'):
    case target.startsWith('postgresql://'):
      return 'postgres'
    case looksLikeSQLiteTarget(target):
      return 'sqlite'
    default:
      return 'postgres'
  }
}

export async function createDBAdapter() {
  const dbTarget = process.env.DB_URL ?? ''
  const driver = inferDriverFromTarget(dbTarget)

  switch (driver) {
    case 'mysql': {
      const { MySQLAdapter } = await import('./adapters/mysql')
      return new MySQLAdapter(dbTarget || undefined)
    }
    case 'postgres': {
      const { PGAdapter } = await import('./adapters/pgsql')
      return new PGAdapter(dbTarget || undefined)
    }
    default: {
      const { SQLiteAdapter } = await import('./adapters/sqlite')
      return new SQLiteAdapter(dbTarget || undefined)
    }
  }
}

export const createDatabaseConnection = createDBAdapter
