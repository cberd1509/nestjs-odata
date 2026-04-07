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
})
