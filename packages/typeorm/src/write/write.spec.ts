import { describe, expect, it, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { EdmRegistry, ODataModuleResolvedOptions } from '@nestjs-odata/core'
import { runWithODataRequestContext } from '@nestjs-odata/core'
import { computeETagFromSource, etagMatches, formatWeakETag } from './etag.js'
import { ODataWriteRegistry } from './write-registry.js'
import type { ODataWriteHandlers } from './write.types.js'
import { TypeOrmAutoHandler } from '../translator/typeorm-auto-handler.js'
import { buildBatchResponse } from '../batch/batch-response-builder.js'

describe('ETag helpers', () => {
  it('formats values as weak base64 ETags', () => {
    expect(formatWeakETag(3)).toBe(`W/"${Buffer.from('3').toString('base64')}"`)
    const date = new Date('2026-01-01T00:00:00.000Z')
    expect(formatWeakETag(date)).toBe(formatWeakETag(date.toISOString()))
  })

  it('computes from a property or a function, passing complete ETags through', () => {
    expect(computeETagFromSource('v', { v: 7 })).toBe(formatWeakETag(7))
    expect(computeETagFromSource('v', {})).toBeUndefined()
    expect(computeETagFromSource(() => null, {})).toBeUndefined()
    expect(computeETagFromSource(() => '"abc"', {})).toBe('"abc"')
    expect(computeETagFromSource(() => 'W/"abc"', {})).toBe('W/"abc"')
    expect(computeETagFromSource((e) => `${String(e.a)}-${String(e.b)}`, { a: 1, b: 2 })).toBe(
      formatWeakETag('1-2'),
    )
  })

  it('matches If-Match lists, * and weak/strong forms', () => {
    const etag = formatWeakETag(1)
    expect(etagMatches(etag, etag)).toBe(true)
    expect(etagMatches(etag.slice(2), etag)).toBe(true)
    expect(etagMatches(`"x", ${etag}`, etag)).toBe(true)
    expect(etagMatches('*', undefined)).toBe(true)
    expect(etagMatches(etag, undefined)).toBe(false)
    expect(etagMatches(formatWeakETag(2), etag)).toBe(false)
  })
})

describe('ODataWriteRegistry', () => {
  it('is shared per application and rejects conflicting registrations', () => {
    const key = {}
    const registry = ODataWriteRegistry.for(key)
    expect(ODataWriteRegistry.for(key)).toBe(registry)

    const handlers: ODataWriteHandlers = {}
    registry.registerHandlers('Things', handlers, handlers)
    registry.registerHandlers('Things', handlers, handlers)
    expect(registry.getHandlers('Things')).toBe(handlers)
    expect(() => registry.registerHandlers('Things', {}, 'other')).toThrow(/two different write/)

    registry.registerETag('Things', 'version')
    registry.registerETag('Things', 'version')
    expect(registry.getETag('Things')).toBe('version')
    expect(() => registry.registerETag('Things', 'other')).toThrow(/two different ETag/)
  })
})

describe('TypeOrmAutoHandler with write handlers', () => {
  const entityType = {
    name: 'Thing',
    namespace: 'Default',
    properties: [],
    navigationProperties: [
      { name: 'parts', type: 'Collection(Default.Part)', nullable: false, isCollection: true },
    ],
    keyProperties: ['id'],
    isReadOnly: false,
  }
  const edm = {
    getEntitySet: () => ({ name: 'Things', entityTypeName: 'Thing' }),
    getEntityType: () => entityType,
  } as unknown as EdmRegistry
  const options = { serviceRoot: '/odata', maxTop: 10 } as ODataModuleResolvedOptions
  const repo = { findOne: vi.fn(), preload: vi.fn(), save: vi.fn(), delete: vi.fn() }

  function make(handlers: ODataWriteHandlers<any>) {
    const writes = new ODataWriteRegistry()
    writes.registerHandlers('Things', handlers, handlers)
    writes.registerETag('Things', 'version')
    return new TypeOrmAutoHandler(
      {} as never,
      edm,
      options,
      repo as never,
      undefined,
      undefined,
      undefined,
      writes,
    )
  }

  it('routes every write to the handlers, never to the repository', async () => {
    const handlers: ODataWriteHandlers<any> = {
      create: vi.fn((body: Record<string, unknown>) => ({ id: 1, version: 1, ...body })),
      deepInsert: vi.fn(() => ({ id: 2, version: 1 })),
      update: vi.fn(() => ({ id: 1, version: 2 })),
      replace: vi.fn(() => ({ id: 1, version: 3 })),
      delete: vi.fn(),
    }
    const handler = make(handlers)
    const request = { url: '/x' }

    const created = await runWithODataRequestContext({ request }, () =>
      handler.handleCreate({ name: 'a' }, 'Things'),
    )
    expect(created).toEqual({
      entity: { id: 1, version: 1, name: 'a', __etag: formatWeakETag(1) },
      locationUrl: '/odata/Things(1)',
    })
    expect(handlers.create).toHaveBeenCalledWith(
      { name: 'a' },
      expect.objectContaining({ operation: 'create', request, entitySetName: 'Things' }),
    )

    await handler.handleCreate({ parts: [] }, 'Things')
    expect(handlers.deepInsert).toHaveBeenCalledTimes(1)
    await handler.handleDeepCreate({ parts: [] }, 'Things', {} as never)
    expect(handlers.deepInsert).toHaveBeenLastCalledWith(
      { parts: [] },
      expect.objectContaining({ operation: 'deepInsert', manager: {} }),
    )

    expect(await handler.handleUpdate('1', { a: 1 }, 'Things', 'W/"x"')).toMatchObject({
      __etag: formatWeakETag(2),
    })
    expect(handlers.update).toHaveBeenCalledWith(
      { id: 1 },
      { a: 1 },
      expect.objectContaining({ operation: 'update', rawKey: '1', ifMatch: 'W/"x"' }),
    )
    expect(await handler.handleReplace('1', {}, 'Things')).toMatchObject({ version: 3 })
    await handler.handleDelete('1', 'Things')
    expect(handlers.delete).toHaveBeenCalledWith(
      { id: 1 },
      expect.objectContaining({ rawKey: '1' }),
    )

    expect(repo.save).not.toHaveBeenCalled()
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it('answers 405 for missing handlers', async () => {
    const handler = make({})
    for (const call of [
      () => handler.handleCreate({}, 'Things'),
      () => handler.handleUpdate('1', {}, 'Things'),
      () => handler.handleReplace('1', {}, 'Things'),
      () => handler.handleDelete('1', 'Things'),
    ]) {
      const err = await call().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(HttpException)
      expect((err as HttpException).getStatus()).toBe(405)
    }
  })
})

describe('buildBatchResponse headers', () => {
  it('writes Location and ETag headers of each part', () => {
    const { body } = buildBatchResponse([
      { statusCode: 201, headers: { location: '/odata/Things(1)', etag: 'W/"MQ=="' }, body: '{}' },
    ])
    expect(body).toContain('HTTP/1.1 201 Created\r\nLocation: /odata/Things(1)\r\nETag: W/"MQ=="')
  })
})

describe('write handler helpers', () => {
  it('isDeepInsertBody only counts arrays and objects on navigation properties', async () => {
    const { isDeepInsertBody } = await import('./handlers.js')
    const type = {
      name: 'Order',
      namespace: 'Default',
      properties: [],
      keyProperties: ['id'],
      isReadOnly: false,
      navigationProperties: [
        { name: 'lines', type: 'Collection(Default.Line)', isCollection: true },
        { name: 'customer', type: 'Default.Customer', isCollection: false },
      ],
    } as unknown as Parameters<typeof isDeepInsertBody>[0]
    expect(isDeepInsertBody(type, { lines: [] })).toBe(true)
    expect(isDeepInsertBody(type, { customer: { name: 'x' } })).toBe(true)
    expect(isDeepInsertBody(type, { lines: null, customer: null })).toBe(false)
    expect(isDeepInsertBody(type, { lines: 'x', customer: 3 })).toBe(false)
  })

  it('assertHandlerEntity refuses a missing result with a 500 naming the handler', async () => {
    const { assertHandlerEntity } = await import('./handlers.js')
    expect(assertHandlerEntity({ id: 1 }, 'Orders', 'create')).toEqual({ id: 1 })
    expect(() => assertHandlerEntity(undefined, 'Orders', 'create')).toThrow(
      /'create' of entity set 'Orders' returned no entity/,
    )
    expect(() => assertHandlerEntity(null, 'Orders', 'update')).toThrow(/returned no entity/)
  })

  it('resolveEntityETag prefers the etag option and falls back to the ETag provider', async () => {
    const { resolveEntityETag } = await import('./etag.js')
    const writes = new ODataWriteRegistry()
    writes.registerETag('A', 'version')
    const provider = {
      getETagColumn: vi.fn((set: string) => (set === 'B' ? 'updatedAt' : undefined)),
      computeETag: vi.fn(() => 'W/"col"'),
      validateIfMatch: vi.fn(),
    }
    expect(resolveEntityETag('A', { version: 2 }, writes, provider)).toBe(formatWeakETag(2))
    expect(resolveEntityETag('B', { updatedAt: 1 }, writes, provider)).toBe('W/"col"')
    expect(resolveEntityETag('C', {}, writes, provider)).toBeUndefined()
    expect(resolveEntityETag('C', {}, undefined, undefined)).toBeUndefined()
  })
})
