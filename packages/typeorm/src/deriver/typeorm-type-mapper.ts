import type { EdmPrimitiveType, UnmappedTypeStrategy } from '@nestjs-odata/core'

/**
 * Complete mapping from TypeORM column types to OData v4 EDM primitive types.
 * Note: Edm.DateTime does NOT exist in OData v4 — use Edm.DateTimeOffset.
 * Source: TypeORM ColumnTypes + OData v4 OASIS spec.
 */
const COLUMN_TYPE_MAP: Readonly<Record<string, EdmPrimitiveType>> = {
  // Int32 group
  int: 'Edm.Int32',
  int2: 'Edm.Int32',
  int4: 'Edm.Int32',
  integer: 'Edm.Int32',
  tinyint: 'Edm.Int32',
  smallint: 'Edm.Int32',
  mediumint: 'Edm.Int32',

  // Int64 group
  bigint: 'Edm.Int64',
  int8: 'Edm.Int64',
  int64: 'Edm.Int64',
  'unsigned big int': 'Edm.Int64',

  // Double group
  float: 'Edm.Double',
  float4: 'Edm.Double',
  float8: 'Edm.Double',
  float64: 'Edm.Double',
  double: 'Edm.Double',
  real: 'Edm.Double',
  'double precision': 'Edm.Double',

  // Decimal group
  decimal: 'Edm.Decimal',
  numeric: 'Edm.Decimal',
  money: 'Edm.Decimal',
  smallmoney: 'Edm.Decimal',

  // String group
  varchar: 'Edm.String',
  nvarchar: 'Edm.String',
  char: 'Edm.String',
  nchar: 'Edm.String',
  text: 'Edm.String',
  ntext: 'Edm.String',
  tinytext: 'Edm.String',
  mediumtext: 'Edm.String',
  longtext: 'Edm.String',
  clob: 'Edm.String',
  nclob: 'Edm.String',
  citext: 'Edm.String',
  shorttext: 'Edm.String',
  alphanum: 'Edm.String',
  long: 'Edm.String',

  // Boolean group
  boolean: 'Edm.Boolean',
  bool: 'Edm.Boolean',

  // Date (date-only, not datetime)
  date: 'Edm.Date',

  // DateTimeOffset (NEVER Edm.DateTime — removed in OData v4)
  datetime: 'Edm.DateTimeOffset',
  datetime2: 'Edm.DateTimeOffset',
  datetimeoffset: 'Edm.DateTimeOffset',
  timestamp: 'Edm.DateTimeOffset',
  timestamptz: 'Edm.DateTimeOffset',
  'timestamp with local time zone': 'Edm.DateTimeOffset',
  smalldatetime: 'Edm.DateTimeOffset',

  // TimeOfDay
  time: 'Edm.TimeOfDay',
  timetz: 'Edm.TimeOfDay',

  // Guid
  uuid: 'Edm.Guid',
  uniqueidentifier: 'Edm.Guid',

  // Binary
  blob: 'Edm.Binary',
  tinyblob: 'Edm.Binary',
  mediumblob: 'Edm.Binary',
  longblob: 'Edm.Binary',
  bytea: 'Edm.Binary',
  bytes: 'Edm.Binary',
  binary: 'Edm.Binary',
  varbinary: 'Edm.Binary',
  image: 'Edm.Binary',
  bfile: 'Edm.Binary',
  raw: 'Edm.Binary',
  'long raw': 'Edm.Binary',
}

/**
 * Unmapped column types — require strategy handling rather than direct mapping.
 * These types cannot be automatically represented as an OData v4 primitive type.
 */
const UNMAPPED_COLUMN_TYPES = new Set([
  'json',
  'jsonb',
  'simple-json',
  'simple-array',
  'simple-enum',
  'enum',
  'set',
])

/**
 * Map a TypeORM column type to an OData v4 EDM primitive type.
 *
 * Resolution order:
 * 1. Direct lookup in the column type map
 * 2. Unmapped type — apply unmappedTypeStrategy
 * 3. JS design type fallback (Number, String, Boolean, Date)
 * 4. Unknown type — apply unmappedTypeStrategy
 *
 * CRITICAL: Edm.DateTime does NOT exist in OData v4. All datetime-like
 * types produce Edm.DateTimeOffset per the OASIS OData v4 specification.
 *
 * @param columnType - TypeORM column type string (e.g., 'varchar', 'int', 'datetime')
 * @param designType - JavaScript design-time type constructor (Number, String, Boolean, Date)
 * @param unmappedTypeStrategy - how to handle types not in the mapping table
 */
export function mapColumnTypeToEdm(
  columnType: string,
  designType: (new (...args: unknown[]) => unknown) | undefined,
  unmappedTypeStrategy: UnmappedTypeStrategy,
): EdmPrimitiveType | undefined {
  const normalized = columnType.toLowerCase()

  // 1. Direct lookup
  const mapped = COLUMN_TYPE_MAP[normalized]
  if (mapped !== undefined) {
    return mapped
  }

  // 2. Explicitly unmapped types — apply strategy directly
  if (UNMAPPED_COLUMN_TYPES.has(normalized)) {
    return applyUnmappedStrategy(columnType, unmappedTypeStrategy)
  }

  // 3. JS design type fallback
  if (designType === Number) return 'Edm.Int32'
  if (designType === String) return 'Edm.String'
  if (designType === Boolean) return 'Edm.Boolean'
  if (designType === Date) return 'Edm.DateTimeOffset'

  // 4. Completely unknown type — apply strategy
  return applyUnmappedStrategy(columnType, unmappedTypeStrategy)
}

function applyUnmappedStrategy(
  columnType: string,
  strategy: UnmappedTypeStrategy,
): EdmPrimitiveType | undefined {
  if (strategy === 'skip') {
    return undefined
  }
  if (strategy === 'string-fallback') {
    return 'Edm.String'
  }
  throw new Error(
    `Column type '${columnType}' cannot be mapped to an OData v4 EDM primitive type. ` +
      `Use @EdmType() decorator to specify the type explicitly, or change the unmappedTypeStrategy.`,
  )
}
