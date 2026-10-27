import { describe, expect, it } from 'vitest'
import { HttpStatus } from '@nestjs/common'
import { allowedMethods, writeNotAllowed, WriteNotAllowedException } from './handlers.js'

const noop = (): never => {
  throw new Error('not called')
}

describe('allowedMethods', () => {
  it('collection: GET, plus POST when create or deepInsert is implemented', () => {
    expect(allowedMethods({}, 'collection')).toBe('GET')
    expect(allowedMethods({ create: noop }, 'collection')).toBe('GET, POST')
    expect(allowedMethods({ deepInsert: noop }, 'collection')).toBe('GET, POST')
    // Entity-level handlers do not open the collection to POST.
    expect(allowedMethods({ update: noop, delete: noop }, 'collection')).toBe('GET')
  })

  it('entity: GET, plus PATCH / PUT / DELETE for each implemented handler', () => {
    expect(allowedMethods({}, 'entity')).toBe('GET')
    expect(allowedMethods({ update: noop }, 'entity')).toBe('GET, PATCH')
    expect(allowedMethods({ replace: noop }, 'entity')).toBe('GET, PUT')
    expect(allowedMethods({ delete: noop }, 'entity')).toBe('GET, DELETE')
    expect(
      allowedMethods({ update: noop, replace: noop, delete: noop, create: noop }, 'entity'),
    ).toBe('GET, PATCH, PUT, DELETE')
  })
})

describe('writeNotAllowed', () => {
  it('answers 405 MethodNotAllowed with the Allow value of the collection for create/deepInsert', () => {
    for (const op of ['create', 'deepInsert'] as const) {
      const err = writeNotAllowed('Products', op, { create: noop, delete: noop })
      expect(err).toBeInstanceOf(WriteNotAllowedException)
      expect(err.getStatus()).toBe(HttpStatus.METHOD_NOT_ALLOWED)
      expect(err.allow).toBe('GET, POST')
      expect(err.getResponse()).toEqual({
        error: {
          code: 'MethodNotAllowed',
          message: `Entity set 'Products' does not support ${op}`,
        },
      })
    }
  })

  it('uses the Allow value of one entity for update, replace and delete', () => {
    for (const op of ['update', 'replace', 'delete'] as const) {
      expect(writeNotAllowed('Products', op, { create: noop, delete: noop }).allow).toBe(
        'GET, DELETE',
      )
    }
  })
})
