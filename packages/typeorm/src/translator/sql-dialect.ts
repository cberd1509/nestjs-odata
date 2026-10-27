/** The SQL dialect a filter needs, from the TypeORM driver type. */
export type SqlDialect = 'sqlite' | 'postgres' | 'ansi'

/** Drivers built on SQLite (TypeORM's `AbstractSqliteDriver` family). */
const SQLITE_DRIVER_TYPES: ReadonlySet<string> = new Set([
  'sqlite',
  'better-sqlite3',
  'capacitor',
  'cordova',
  'expo',
  'nativescript',
  'react-native',
  'sqljs',
])

/**
 * Map a TypeORM `DataSourceOptions['type']` to the dialect used for date and string functions:
 * every SQLite-based driver (`sqlite`, `better-sqlite3`, `sqljs`, …) is `sqlite` (strftime,
 * INSTR), `postgres` is `postgres`, everything else ANSI.
 */
export function sqlDialectOf(type: string): SqlDialect {
  if (SQLITE_DRIVER_TYPES.has(type)) return 'sqlite'
  return type === 'postgres' ? 'postgres' : 'ansi'
}

/**
 * Drivers whose databases support window functions (`ROW_NUMBER() OVER (...)`) in every
 * version TypeORM supports. MySQL and MariaDB are left out: window functions need MySQL 8 /
 * MariaDB 10.2, and older servers are still found.
 */
const WINDOW_FUNCTION_DRIVER_TYPES: ReadonlySet<string> = new Set([
  ...SQLITE_DRIVER_TYPES,
  'postgres',
  'aurora-postgres',
  'cockroachdb',
  'mssql',
  'oracle',
])

/**
 * True when nested `$expand` `$top`/`$skip` can be paged in SQL with `ROW_NUMBER()` on this
 * TypeORM driver type; otherwise they are applied in memory after the query.
 */
export function supportsWindowFunctions(type: string): boolean {
  return WINDOW_FUNCTION_DRIVER_TYPES.has(type)
}
