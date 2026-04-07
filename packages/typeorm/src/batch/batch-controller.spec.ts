/**
 * Unit tests for BatchController dispatch logic.
 *
 * Tests verify that the controller correctly dispatches HTTP methods
 * to the appropriate data operations.
 */
import 'reflect-metadata'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import { EdmRegistry, ODATA_MODULE_OPTIONS } from '@nestjs-odata/core'
import { BatchController, type BatchRequest, type BatchResponse } from './batch-controller.js'
import { TYPEORM_ODATA_ENTITIES } from '../odata-typeorm.module.js'

// Minimal mock for a TypeORM entity class
class MockProduct {
  id: number = 0
  name: string = ''
  price: number = 0
}

const mockEdmRegistry = {
  getEntitySet: vi.fn(),
  getEntityType: vi.fn(),
}

const mockManager = {
  findOne: vi.fn(),
  find: vi.fn(),
  delete: vi.fn(),
  merge: vi.fn(),
  save: vi.fn(),
  getRepository: vi.fn(),
}

const mockRepo = {
  create: vi.fn(),
  save: vi.fn(),
  preload: vi.fn(),
}

const mockQueryRunner = {
  connect: vi.fn(),
  startTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  release: vi.fn(),
  manager: mockManager,
}

const mockDataSource = {
  manager: mockManager,
  createQueryRunner: vi.fn().mockReturnValue(mockQueryRunner),
  getMetadata: vi.fn().mockReturnValue({ name: 'Product' }),
}

const mockOptions = {
  serviceRoot: '/odata',
  namespace: 'Default',
  maxTop: 1000,
  maxExpandDepth: 3,
}

describe('BatchController dispatch', () => {
  let controller: BatchController
  let mockReq: Record<string, unknown>
  let mockRes: {
    status: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    json: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    mockManager.getRepository.mockReturnValue(mockRepo)
    mockRepo.create.mockReturnValue({ id: 1, name: 'Test', price: 9.99 })
    mockRepo.save.mockResolvedValue({ id: 1, name: 'Test', price: 9.99 })

    mockEdmRegistry.getEntitySet.mockReturnValue({
      name: 'Products',
      entityTypeName: 'Product',
      namespace: 'Default',
      isReadOnly: false,
    })
    mockEdmRegistry.getEntityType.mockReturnValue({
      name: 'Product',
      namespace: 'Default',
      properties: [],
      navigationProperties: [],
      keyProperties: ['id'],
      isReadOnly: false,
    })

    const module = await Test.createTestingModule({
      controllers: [BatchController],
      providers: [
        { provide: DataSource, useValue: mockDataSource },
        { provide: EdmRegistry, useValue: mockEdmRegistry },
        { provide: ODATA_MODULE_OPTIONS, useValue: mockOptions },
        { provide: TYPEORM_ODATA_ENTITIES, useValue: [MockProduct] },
      ],
    }).compile()

    controller = module.get(BatchController)

    mockRes = {
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
  })

  function buildBatchBody(boundary: string, parts: string[]): string {
    const lines: string[] = []
    for (const part of parts) {
      lines.push(`--${boundary}`)
      lines.push(part)
    }
    lines.push(`--${boundary}--`)
    return lines.join('\r\n')
  }

  // Test 3: GET dispatch
  it('Test 3: dispatches GET /Products to collection get (returns 200)', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'GET /odata/Products HTTP/1.1',
        '',
      ].join('\r\n'),
    ])

    mockManager.find.mockResolvedValue([{ id: 1, name: 'Widget' }])

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    expect(mockManager.find).toHaveBeenCalled()
    expect(mockRes.status).toHaveBeenCalledWith(200)
    expect(mockRes.send).toHaveBeenCalled()
    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 200 OK')
  })

  // Test 4: POST dispatch
  it('Test 4: dispatches POST /Products to handleCreate (returns 201)', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'POST /odata/Products HTTP/1.1',
        'Content-Type: application/json',
        '',
        '{"name":"Widget","price":9.99}',
      ].join('\r\n'),
    ])

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    expect(mockRepo.create).toHaveBeenCalled()
    expect(mockRepo.save).toHaveBeenCalled()
    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 201 Created')
  })

  // Test 5: PATCH dispatch
  it('Test 5: dispatches PATCH /Products(1) to handleUpdate (returns 200)', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'PATCH /odata/Products(1) HTTP/1.1',
        'Content-Type: application/json',
        '',
        '{"name":"Updated Widget"}',
      ].join('\r\n'),
    ])

    const existingEntity = { id: 1, name: 'Widget', price: 9.99 }
    const mergedEntity = { id: 1, name: 'Updated Widget', price: 9.99 }
    mockManager.findOne.mockResolvedValue(existingEntity)
    mockManager.merge.mockReturnValue(mergedEntity)
    mockManager.save.mockResolvedValue(mergedEntity)

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    expect(mockManager.findOne).toHaveBeenCalled()
    expect(mockManager.merge).toHaveBeenCalled()
    expect(mockManager.save).toHaveBeenCalled()
    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 200 OK')
  })

  // Test 6: DELETE dispatch
  it('Test 6: dispatches DELETE /Products(1) to handleDelete (returns 204)', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'DELETE /odata/Products(1) HTTP/1.1',
        '',
      ].join('\r\n'),
    ])

    mockManager.delete.mockResolvedValue({ affected: 1 })

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    expect(mockManager.delete).toHaveBeenCalled()
    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 204 No Content')
  })

  it('Test 7: returns 400 when content-type boundary is missing', async () => {
    mockReq = {
      body: '--test--',
      headers: { 'content-type': 'multipart/mixed' },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    expect(mockRes.status).toHaveBeenCalledWith(400)
    expect(mockRes.json).toHaveBeenCalled()
  })

  it('Test 8: returns 400 in batch part when entity URL has no alpha segment', async () => {
    const boundary = 'batch_test'
    // URL ending with "/" or only slashes — parseEntityUrl returns null
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'GET /123/456 HTTP/1.1',
        '',
      ].join('\r\n'),
    ])

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    // Controller returns 200 for the batch envelope, individual part has 400
    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 400')
  })

  it('Test 9: dispatches GET /Products(1) by key (returns 200)', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'GET /odata/Products(1) HTTP/1.1',
        '',
      ].join('\r\n'),
    ])

    mockManager.findOne.mockResolvedValue({ id: 1, name: 'Widget', price: 9.99 })

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    expect(mockManager.findOne).toHaveBeenCalled()
    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 200 OK')
  })

  it('Test 10: GET by key returns 404 when entity not found', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'GET /odata/Products(999) HTTP/1.1',
        '',
      ].join('\r\n'),
    ])

    mockManager.findOne.mockResolvedValue(null)

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 404')
  })

  it('Test 11: DELETE returns 404 when entity not found (affected: 0)', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'DELETE /odata/Products(999) HTTP/1.1',
        '',
      ].join('\r\n'),
    ])

    mockManager.delete.mockResolvedValue({ affected: 0 })

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 404')
  })

  it('Test 12: PATCH without key returns 400', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'PATCH /odata/Products HTTP/1.1',
        'Content-Type: application/json',
        '',
        '{"name":"Updated"}',
      ].join('\r\n'),
    ])

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 400')
  })

  it('Test 13: DELETE without key returns 400', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'DELETE /odata/Products HTTP/1.1',
        '',
      ].join('\r\n'),
    ])

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 400')
  })

  it('Test 14: unsupported method returns 405', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'HEAD /odata/Products HTTP/1.1',
        '',
      ].join('\r\n'),
    ])

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 405')
  })

  it('Test 15: unknown entity set returns 404', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'GET /odata/UnknownEntity HTTP/1.1',
        '',
      ].join('\r\n'),
    ])

    mockEdmRegistry.getEntitySet.mockReturnValue(null)

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 404')
  })

  it('Test 16: executes a changeset with rollback on failure', async () => {
    const boundary = 'batch_changeset'
    const changesetBoundary = 'changeset_inner'
    const body = [
      `--${boundary}`,
      `Content-Type: multipart/mixed; boundary=${changesetBoundary}`,
      '',
      `--${changesetBoundary}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      'POST /odata/Products HTTP/1.1',
      'Content-Type: application/json',
      '',
      '{"name":"Widget","price":9.99}',
      `--${changesetBoundary}--`,
      `--${boundary}--`,
    ].join('\r\n')

    mockRepo.save.mockRejectedValue(new Error('DB error'))

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled()
    expect(mockRes.status).toHaveBeenCalledWith(200)
  })

  it('Test 17: reads body from stream when req.body is empty', async () => {
    const boundary = 'batch_test'
    const batchBody = [
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      'GET /odata/Products HTTP/1.1',
      '',
    ].join('\r\n')

    const fullBody = [`--${boundary}`, batchBody, `--${boundary}--`].join('\r\n')

    mockManager.find.mockResolvedValue([{ id: 1, name: 'Widget' }])

    // Simulate streaming request — use Node IncomingMessage-compatible EventEmitter
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EventEmitter } = require('events') as typeof import('events')
    const emitter = new EventEmitter()
    const streamReq = emitter as unknown as BatchRequest & { headers: Record<string, string> }
    streamReq.headers = { 'content-type': `multipart/mixed; boundary=${boundary}` }
    // no body property — triggers stream path

    setImmediate(() => {
      emitter.emit('data', Buffer.from(fullBody))
      emitter.emit('end')
    })

    await controller.handleBatch(streamReq, mockRes as unknown as BatchResponse)

    expect(mockRes.status).toHaveBeenCalledWith(200)
  })

  it('Test 18b: when getMetadata throws for entity class, resolveEntityClass returns 500', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'GET /odata/Products HTTP/1.1',
        '',
      ].join('\r\n'),
    ])

    // Make getMetadata throw so resolveEntityClass catches and skips — returns undefined
    mockDataSource.getMetadata.mockImplementationOnce(() => {
      throw new Error('Entity not found in DataSource')
    })

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    const sentBody = mockRes.send.mock.calls[0][0] as string
    // entity class not found -> 500 InternalServerError
    expect(sentBody).toContain('HTTP/1.1 500')
  })

  it('Test 18: PATCH with not-found entity returns 404', async () => {
    const boundary = 'batch_test'
    const body = buildBatchBody(boundary, [
      [
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        'PATCH /odata/Products(999) HTTP/1.1',
        'Content-Type: application/json',
        '',
        '{"name":"Updated"}',
      ].join('\r\n'),
    ])

    mockManager.findOne.mockResolvedValue(null)

    mockReq = {
      body,
      headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
    }

    await controller.handleBatch(
      mockReq as unknown as BatchRequest,
      mockRes as unknown as BatchResponse,
    )

    const sentBody = mockRes.send.mock.calls[0][0] as string
    expect(sentBody).toContain('HTTP/1.1 404')
  })
})
