import { describe, it, expect, vi } from 'vitest'
import type { EntityManager, ObjectLiteral, Repository } from 'typeorm'
import type { EdmEntityType, ODataModuleResolvedOptions } from '@nestjs-odata/core'
import { EdmRegistry, runWithODataBatchPart, runWithODataRequestContext } from '@nestjs-odata/core'
import { TypeOrmAutoHandler } from './typeorm-auto-handler.js'
import type { TypeOrmQueryTranslator } from './typeorm-query-translator.js'
import { ODataWriteRegistry } from '../write/write-registry.js'
import { formatWeakETag } from '../write/etag.js'
import type { ODataWriteContext, ODataWriteHandlers } from '../write/write.types.js'

const entityType: EdmEntityType = {
  name: 'Product',
  namespace: 'Default',
  keyProperties: ['id'],
  isReadOnly: false,
  properties: [
    { name: 'id', type: 'Edm.Int32', nullable: false },
    { name: 'name', type: 'Edm.String', nullable: true },
    { name: 'price', type: 'Edm.Decimal', nullable: false },
    { name: 'version', type: 'Edm.Int32', nullable: false },
    { name: 'updatedAt', type: 'Edm.DateTimeOffset', nullable: false, computed: true },
  ],
  navigationProperties: [],
}

const columns = [
  { propertyName: 'id', isPrimary: true },
  { propertyName: 'name', isNullable: true },
  { propertyName: 'price', isNullable: false },
  { propertyName: 'version', isNullable: false },
  { propertyName: 'updatedAt', isUpdateDate: true },
]

const current = { id: 1, name: 'Widget', price: 10, version: 3, updatedAt: 'T' }
const currentETag = formatWeakETag(3)

function setup(
  opts: {
    requireIfMatch?: boolean
    handlers?: ODataWriteHandlers<any>
    options?: Partial<ODataModuleResolvedOptions>
    items?: ObjectLiteral[]
  } = {},
) {
  const edm = new EdmRegistry()
  edm.register(entityType, {
    name: 'Products',
    entityTypeName: 'Product',
    namespace: 'Default',
    isReadOnly: false,
  })
  const writes = new ODataWriteRegistry()
  writes.registerETag('Products', 'version')
  if (opts.requireIfMatch) writes.registerRequireIfMatch('Products')
  if (opts.handlers) writes.registerHandlers('Products', opts.handlers, opts.handlers)

  const repo = {
    findOne: vi.fn().mockResolvedValue({ ...current }),
    create: vi.fn((v: ObjectLiteral) => ({ ...v })),
    save: vi.fn((v: ObjectLiteral) => Promise.resolve({ ...current, ...v })),
    merge: vi.fn((t: ObjectLiteral, p: ObjectLiteral) => ({ ...t, ...p })),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
    metadata: { columns },
  }
  const translator = {
    translate: vi.fn().mockReturnValue({ qb: {}, expandPaginationMap: new Map() }),
    execute: vi.fn().mockResolvedValue({ items: opts.items ?? [] }),
  } as unknown as TypeOrmQueryTranslator
  const options = {
    serviceRoot: '/odata',
    namespace: 'Default',
    maxTop: 100,
    ignoreUnknownProperties: false,
    ...opts.options,
  } as ODataModuleResolvedOptions
  const handler = new TypeOrmAutoHandler(
    translator,
    edm,
    options,
    repo as unknown as Repository<ObjectLiteral>,
    undefined,
    undefined,
    undefined,
    writes,
  )
  return { handler, repo }
}

/** Run `fn` as if inside an HTTP request carrying `headers`. */
function withHeaders<T>(headers: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  return runWithODataRequestContext({ request: { headers } }, fn)
}

describe('If-None-Match on data modification requests (#70, Protocol §8.2.5)', () => {
  it('PATCH, PUT and DELETE answer 412 when If-None-Match matches the current ETag, without writing', async () => {
    for (const ifNoneMatch of [currentETag, '*', `W/"x", ${currentETag}`]) {
      const { handler, repo } = setup()
      const headers = { 'if-none-match': ifNoneMatch }
      await expect(
        withHeaders(headers, () => handler.handleUpdate('1', { price: 9 }, 'Products')),
      ).rejects.toMatchObject({ status: 412 })
      await expect(
        withHeaders(headers, () => handler.handleReplace('1', { price: 9 }, 'Products')),
      ).rejects.toMatchObject({ status: 412 })
      await expect(
        withHeaders(headers, () => handler.handleDelete('1', 'Products')),
      ).rejects.toMatchObject({ status: 412 })
      expect(repo.save).not.toHaveBeenCalled()
      expect(repo.delete).not.toHaveBeenCalled()
    }
  })

  it('proceeds when If-None-Match does not match', async () => {
    const { handler, repo } = setup()
    await withHeaders({ 'if-none-match': formatWeakETag(99) }, () =>
      handler.handleUpdate('1', { price: 9 }, 'Products'),
    )
    expect(repo.save).toHaveBeenCalled()
  })

  it('reads If-Match from the request when the controller does not pass it', async () => {
    const { handler, repo } = setup()
    await expect(
      withHeaders({ 'if-match': formatWeakETag(99) }, () =>
        handler.handleUpdate('1', { price: 9 }, 'Products'),
      ),
    ).rejects.toMatchObject({ status: 412 })
    expect(repo.save).not.toHaveBeenCalled()
  })

  it('hands If-None-Match to write handlers', async () => {
    let seen: ODataWriteContext | undefined
    const { handler } = setup({
      handlers: {
        update: (_key, body, ctx) => {
          seen = ctx
          return { id: 1, ...body }
        },
      },
    })
    await withHeaders({ 'if-none-match': '*' }, () =>
      handler.handleUpdate('1', { price: 9 }, 'Products'),
    )
    expect(seen?.ifNoneMatch).toBe('*')
    expect(seen?.requireIfMatch).toBe(false)
  })
})

describe('requireIfMatch (#80, Protocol §8.2.4 / §11.4.1.1)', () => {
  it('answers 428 for PATCH, PUT and DELETE without If-Match, with no change', async () => {
    const { handler, repo } = setup({ requireIfMatch: true })
    await expect(handler.handleUpdate('1', { price: 9 }, 'Products')).rejects.toMatchObject({
      status: 428,
    })
    await expect(handler.handleReplace('1', { price: 9 }, 'Products')).rejects.toMatchObject({
      status: 428,
    })
    await expect(handler.handleDelete('1', 'Products')).rejects.toMatchObject({ status: 428 })
    expect(repo.findOne).not.toHaveBeenCalled()
    expect(repo.save).not.toHaveBeenCalled()
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it('accepts writes with a matching If-Match (argument or request header)', async () => {
    const { handler, repo } = setup({ requireIfMatch: true })
    await handler.handleUpdate('1', { price: 9 }, 'Products', currentETag)
    await withHeaders({ 'if-match': '*' }, () => handler.handleDelete('1', 'Products'))
    expect(repo.save).toHaveBeenCalled()
    expect(repo.delete).toHaveBeenCalled()
  })

  it('applies to write handlers too, and tells them If-Match is required', async () => {
    const update = vi.fn((_k: unknown, body: Record<string, unknown>) => ({ id: 1, ...body }))
    let seen: ODataWriteContext | undefined
    const { handler } = setup({
      requireIfMatch: true,
      handlers: {
        update: (key, body, ctx) => {
          seen = ctx
          return update(key, body)
        },
      },
    })
    await expect(handler.handleUpdate('1', { price: 9 }, 'Products')).rejects.toMatchObject({
      status: 428,
    })
    expect(update).not.toHaveBeenCalled()
    await handler.handleUpdate('1', { price: 9 }, 'Products', '*')
    expect(seen?.requireIfMatch).toBe(true)
  })

  it('does not apply to POST', async () => {
    const { handler, repo } = setup({ requireIfMatch: true })
    await handler.handleCreate({ name: 'n', price: 1, version: 1 }, 'Products')
    expect(repo.save).toHaveBeenCalled()
  })
})

describe('PUT ignores key properties in the body (#76, Protocol §11.4.3)', () => {
  it('replaces the entity at the URL key when the body carries another key', async () => {
    const { handler, repo } = setup()
    await handler.handleReplace('1', { id: 2, name: 'x', price: 5, version: 3 }, 'Products')
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: 'x' }))
  })
})

describe('computed and unknown properties on writes (#75, Protocol §11.4.2)', () => {
  it('POST and PATCH drop computed properties', async () => {
    const { handler, repo } = setup()
    await handler.handleCreate({ name: 'n', price: 1, version: 1, updatedAt: 'client' }, 'Products')
    expect(repo.create).toHaveBeenCalledWith({ name: 'n', price: 1, version: 1 })
    await handler.handleUpdate('1', { price: 2, updatedAt: 'client' }, 'Products')
    expect(repo.merge).toHaveBeenCalledWith(expect.anything(), { price: 2 })
  })

  it('POST, PATCH and PUT answer 400 for a property that is not in the entity type', async () => {
    const { handler, repo } = setup()
    await expect(
      handler.handleCreate({ name: 'n', price: 1, nope: 1 }, 'Products'),
    ).rejects.toMatchObject({ status: 400 })
    await expect(handler.handleUpdate('1', { nope: 1 }, 'Products')).rejects.toMatchObject({
      status: 400,
    })
    await expect(
      handler.handleReplace('1', { price: 1, nope: 1 }, 'Products'),
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.save).not.toHaveBeenCalled()
  })

  it('ignoreUnknownProperties drops them instead', async () => {
    const { handler, repo } = setup({ options: { ignoreUnknownProperties: true } })
    await handler.handleUpdate('1', { price: 2, nope: 1 }, 'Products')
    expect(repo.merge).toHaveBeenCalledWith(expect.anything(), { price: 2 })
  })
})

describe('@odata.etag on collection items (#81)', () => {
  it('handleGet attaches each item ETag for the interceptor', async () => {
    const { handler } = setup({ items: [{ id: 1, version: 3 }, { id: 2 }] })
    const result = await handler.handleGet({ entitySetName: 'Products' }, '/odata/Products')
    expect(result.items[0]).toMatchObject({ __etag: currentETag })
    // No ETag value (e.g. not selected): no ETag rather than a wrong one.
    expect(result.items[1]).not.toHaveProperty('__etag')
  })
})

describe('$batch changesets (#67): operations join the changeset transaction', () => {
  /** A batch operation of a changeset whose transaction runs on `manager`. */
  const inChangeset = (manager: unknown) => ({
    method: 'POST',
    url: 'Products',
    contentId: '4',
    inChangeset: true,
    batchRequest: {},
    changeset: manager as EntityManager,
  })

  it('reads and writes through the changeset entity manager', async () => {
    const { handler, repo } = setup()
    const txRepo = {
      ...repo,
      save: vi.fn((v: ObjectLiteral) => Promise.resolve({ ...current, ...v, tx: true })),
    }
    const manager = { getRepository: vi.fn().mockReturnValue(txRepo) }
    const created = await runWithODataBatchPart(inChangeset(manager), () =>
      handler.handleCreate({ name: 'x', price: 1, version: 1 }, 'Products'),
    )
    expect(manager.getRepository).toHaveBeenCalled()
    expect(txRepo.save).toHaveBeenCalled()
    expect(repo.save).not.toHaveBeenCalled()
    expect(created.entity).toMatchObject({ tx: true })
  })

  it('hands write handlers the changeset manager and the batch operation', async () => {
    const seen: ODataWriteContext[] = []
    const handlers: ODataWriteHandlers<any> = {
      create: (body, ctx) => {
        seen.push(ctx)
        return { id: 9, ...body }
      },
    }
    const { handler } = setup({ handlers })
    const manager = { getRepository: vi.fn() } as unknown as EntityManager
    await runWithODataBatchPart(inChangeset(manager), () =>
      handler.handleCreate({ name: 'x', price: 1, version: 1 }, 'Products'),
    )
    expect(seen[0]?.manager).toBe(manager)
    expect(seen[0]?.batch).toEqual({ contentId: '4', inChangeset: true })

    seen.length = 0
    await handler.handleCreate({ name: 'y', price: 1, version: 1 }, 'Products')
    expect(seen[0]?.manager).toBeUndefined()
    expect(seen[0]?.batch).toBeUndefined()
  })
})
