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
