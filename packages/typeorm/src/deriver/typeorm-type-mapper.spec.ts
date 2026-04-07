import { describe, it, expect } from 'vitest'
import { mapColumnTypeToEdm } from './typeorm-type-mapper.js'

describe('mapColumnTypeToEdm', () => {
  // Int32 group
  it("maps 'int' → 'Edm.Int32'", () => {
    expect(mapColumnTypeToEdm('int', undefined, 'skip')).toBe('Edm.Int32')
  })

  it("maps 'integer' → 'Edm.Int32'", () => {
    expect(mapColumnTypeToEdm('integer', undefined, 'skip')).toBe('Edm.Int32')
  })

  it("maps 'tinyint' → 'Edm.Int32'", () => {
    expect(mapColumnTypeToEdm('tinyint', undefined, 'skip')).toBe('Edm.Int32')
  })

  it("maps 'smallint' → 'Edm.Int32'", () => {
    expect(mapColumnTypeToEdm('smallint', undefined, 'skip')).toBe('Edm.Int32')
  })

  it("maps 'mediumint' → 'Edm.Int32'", () => {
    expect(mapColumnTypeToEdm('mediumint', undefined, 'skip')).toBe('Edm.Int32')
  })

  // Int64 group
  it("maps 'bigint' → 'Edm.Int64'", () => {
    expect(mapColumnTypeToEdm('bigint', undefined, 'skip')).toBe('Edm.Int64')
  })

  it("maps 'int8' → 'Edm.Int64'", () => {
    expect(mapColumnTypeToEdm('int8', undefined, 'skip')).toBe('Edm.Int64')
  })

  // Double group
  it("maps 'float' → 'Edm.Double'", () => {
    expect(mapColumnTypeToEdm('float', undefined, 'skip')).toBe('Edm.Double')
  })

  it("maps 'double' → 'Edm.Double'", () => {
    expect(mapColumnTypeToEdm('double', undefined, 'skip')).toBe('Edm.Double')
  })

  it("maps 'real' → 'Edm.Double'", () => {
    expect(mapColumnTypeToEdm('real', undefined, 'skip')).toBe('Edm.Double')
  })

  it("maps 'double precision' → 'Edm.Double'", () => {
    expect(mapColumnTypeToEdm('double precision', undefined, 'skip')).toBe('Edm.Double')
  })

  // Decimal group
  it("maps 'decimal' → 'Edm.Decimal'", () => {
    expect(mapColumnTypeToEdm('decimal', undefined, 'skip')).toBe('Edm.Decimal')
  })

  it("maps 'numeric' → 'Edm.Decimal'", () => {
    expect(mapColumnTypeToEdm('numeric', undefined, 'skip')).toBe('Edm.Decimal')
  })

  it("maps 'money' → 'Edm.Decimal'", () => {
    expect(mapColumnTypeToEdm('money', undefined, 'skip')).toBe('Edm.Decimal')
  })

  // String group
  it("maps 'varchar' → 'Edm.String'", () => {
    expect(mapColumnTypeToEdm('varchar', undefined, 'skip')).toBe('Edm.String')
  })

  it("maps 'text' → 'Edm.String'", () => {
    expect(mapColumnTypeToEdm('text', undefined, 'skip')).toBe('Edm.String')
  })

  it("maps 'nvarchar' → 'Edm.String'", () => {
    expect(mapColumnTypeToEdm('nvarchar', undefined, 'skip')).toBe('Edm.String')
  })

  // Boolean group
  it("maps 'boolean' → 'Edm.Boolean'", () => {
    expect(mapColumnTypeToEdm('boolean', undefined, 'skip')).toBe('Edm.Boolean')
  })

  it("maps 'bool' → 'Edm.Boolean'", () => {
    expect(mapColumnTypeToEdm('bool', undefined, 'skip')).toBe('Edm.Boolean')
  })

  // Date types
  it("maps 'date' → 'Edm.Date' (date-only, NOT DateTimeOffset)", () => {
    expect(mapColumnTypeToEdm('date', undefined, 'skip')).toBe('Edm.Date')
  })

  it("maps 'datetime' → 'Edm.DateTimeOffset' (CRITICAL: NEVER Edm.DateTime)", () => {
    expect(mapColumnTypeToEdm('datetime', undefined, 'skip')).toBe('Edm.DateTimeOffset')
  })

  it("maps 'timestamp' → 'Edm.DateTimeOffset'", () => {
    expect(mapColumnTypeToEdm('timestamp', undefined, 'skip')).toBe('Edm.DateTimeOffset')
  })

  it("maps 'timestamptz' → 'Edm.DateTimeOffset'", () => {
    expect(mapColumnTypeToEdm('timestamptz', undefined, 'skip')).toBe('Edm.DateTimeOffset')
  })

  it("maps 'datetime2' → 'Edm.DateTimeOffset'", () => {
    expect(mapColumnTypeToEdm('datetime2', undefined, 'skip')).toBe('Edm.DateTimeOffset')
  })

  // TimeOfDay
  it("maps 'time' → 'Edm.TimeOfDay'", () => {
    expect(mapColumnTypeToEdm('time', undefined, 'skip')).toBe('Edm.TimeOfDay')
  })

  // Guid
  it("maps 'uuid' → 'Edm.Guid'", () => {
    expect(mapColumnTypeToEdm('uuid', undefined, 'skip')).toBe('Edm.Guid')
  })

  it("maps 'uniqueidentifier' → 'Edm.Guid'", () => {
    expect(mapColumnTypeToEdm('uniqueidentifier', undefined, 'skip')).toBe('Edm.Guid')
  })

  // Binary
  it("maps 'blob' → 'Edm.Binary'", () => {
    expect(mapColumnTypeToEdm('blob', undefined, 'skip')).toBe('Edm.Binary')
  })

  it("maps 'bytea' → 'Edm.Binary'", () => {
    expect(mapColumnTypeToEdm('bytea', undefined, 'skip')).toBe('Edm.Binary')
  })

  // Unmapped types: strategy handling
  it("maps 'json' with strategy 'skip' → undefined", () => {
    expect(mapColumnTypeToEdm('json', undefined, 'skip')).toBeUndefined()
  })

  it("maps 'json' with strategy 'string-fallback' → 'Edm.String'", () => {
    expect(mapColumnTypeToEdm('json', undefined, 'string-fallback')).toBe('Edm.String')
  })

  it("maps 'json' with strategy 'error' → throws Error", () => {
    expect(() => {
      mapColumnTypeToEdm('json', undefined, 'error')
    }).toThrow()
  })

  it("maps unknown type 'geometry' with strategy 'skip' → undefined", () => {
    expect(mapColumnTypeToEdm('geometry', undefined, 'skip')).toBeUndefined()
  })

  // JS design type fallbacks
  it('maps JS Number design type fallback → Edm.Int32', () => {
    expect(mapColumnTypeToEdm('custom_number_type', Number, 'skip')).toBe('Edm.Int32')
  })

  it('maps JS String design type fallback → Edm.String', () => {
    expect(mapColumnTypeToEdm('custom_string_type', String, 'skip')).toBe('Edm.String')
  })

  it('maps JS Boolean design type fallback → Edm.Boolean', () => {
    expect(mapColumnTypeToEdm('custom_bool_type', Boolean, 'skip')).toBe('Edm.Boolean')
  })

  it('maps JS Date design type fallback → Edm.DateTimeOffset', () => {
    expect(mapColumnTypeToEdm('custom_date_type', Date, 'skip')).toBe('Edm.DateTimeOffset')
  })

  // Additional coverage tests
  it("maps 'int2' → 'Edm.Int32'", () => {
    expect(mapColumnTypeToEdm('int2', undefined, 'skip')).toBe('Edm.Int32')
  })

  it("maps 'int4' → 'Edm.Int32'", () => {
    expect(mapColumnTypeToEdm('int4', undefined, 'skip')).toBe('Edm.Int32')
  })

  it("maps 'int64' → 'Edm.Int64'", () => {
    expect(mapColumnTypeToEdm('int64', undefined, 'skip')).toBe('Edm.Int64')
  })

  it("maps 'float4' → 'Edm.Double'", () => {
    expect(mapColumnTypeToEdm('float4', undefined, 'skip')).toBe('Edm.Double')
  })

  it("maps 'char' → 'Edm.String'", () => {
    expect(mapColumnTypeToEdm('char', undefined, 'skip')).toBe('Edm.String')
  })

  it("maps 'datetimeoffset' → 'Edm.DateTimeOffset'", () => {
    expect(mapColumnTypeToEdm('datetimeoffset', undefined, 'skip')).toBe('Edm.DateTimeOffset')
  })

  it("maps 'timetz' → 'Edm.TimeOfDay'", () => {
    expect(mapColumnTypeToEdm('timetz', undefined, 'skip')).toBe('Edm.TimeOfDay')
  })

  it("maps 'binary' → 'Edm.Binary'", () => {
    expect(mapColumnTypeToEdm('binary', undefined, 'skip')).toBe('Edm.Binary')
  })

  it("maps 'jsonb' with strategy 'string-fallback' → 'Edm.String'", () => {
    expect(mapColumnTypeToEdm('jsonb', undefined, 'string-fallback')).toBe('Edm.String')
  })

  it("maps 'jsonb' with strategy 'error' → throws", () => {
    expect(() => {
      mapColumnTypeToEdm('jsonb', undefined, 'error')
    }).toThrow()
  })
})
