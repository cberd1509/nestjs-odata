import { describe, it, expect } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { EdmEntityType } from '@nestjs-odata/core'
import { prepareWriteBody } from './body.js'

const type: EdmEntityType = {
  name: 'Product',
  namespace: 'Default',
  keyProperties: ['id'],
  isReadOnly: false,
  properties: [
    { name: 'id', type: 'Edm.Int32', nullable: false },
    { name: 'name', type: 'Edm.String', nullable: false },
    { name: 'updatedAt', type: 'Edm.DateTimeOffset', nullable: false, computed: true },
    { name: 'version', type: 'Edm.Int32', nullable: false, computed: true },
  ],
  navigationProperties: [
    { name: 'category', type: 'Default.Category', nullable: true, isCollection: false },
  ],
}

function errorOf(fn: () => unknown): HttpException {
  try {
    fn()
  } catch (err) {
    return err as HttpException
  }
  throw new Error('expected a throw')
}

describe('prepareWriteBody (OData-Protocol 4.01 §11.4.2, §11.4.3)', () => {
  it('removes computed properties (#75)', () => {
    expect(
      prepareWriteBody(type, { name: 'x', updatedAt: '2020-01-01', version: 9 }, 'create'),
    ).toEqual({ name: 'x' })
  })

  it('keeps key properties on create, removes them on update and replace (#76)', () => {
    expect(prepareWriteBody(type, { id: 7, name: 'x' }, 'create')).toEqual({ id: 7, name: 'x' })
    expect(prepareWriteBody(type, { id: 7, name: 'x' }, 'update')).toEqual({ name: 'x' })
    expect(prepareWriteBody(type, { id: 7, name: 'x' }, 'replace')).toEqual({ name: 'x' })
  })

  it('keeps navigation properties and drops instance annotations / control information', () => {
    expect(
      prepareWriteBody(
        type,
        {
          name: 'x',
          category: { id: 1 },
          '@odata.type': '#Default.Product',
          'category@odata.bind': 'Categories(1)',
        },
        'create',
      ),
    ).toEqual({ name: 'x', category: { id: 1 } })
  })

  it('answers 400 listing every property that is not in the entity type', () => {
    const err = errorOf(() => prepareWriteBody(type, { name: 'x', nope: 1, other: 2 }, 'update'))
    expect(err).toBeInstanceOf(HttpException)
    expect(err.getStatus()).toBe(400)
    const body = err.getResponse() as {
      error: { message: string; details: { code: string; target: string }[] }
    }
    expect(body.error.message).toContain("'nope'")
    expect(body.error.details.map((d) => d.target)).toEqual(['nope', 'other'])
  })

  it('drops unknown properties instead when ignoreUnknown is set', () => {
    expect(
      prepareWriteBody(type, { name: 'x', nope: 1 }, 'create', { ignoreUnknown: true }),
    ).toEqual({ name: 'x' })
  })

  it('does not treat inherited object keys as known properties', () => {
    const err = errorOf(() => prepareWriteBody(type, { constructor: 1 }, 'create'))
    expect(err.getStatus()).toBe(400)
  })

  it('never mutates the input body', () => {
    const body = { id: 1, name: 'x', updatedAt: 'y' }
    prepareWriteBody(type, body, 'update')
    expect(body).toEqual({ id: 1, name: 'x', updatedAt: 'y' })
  })
})
