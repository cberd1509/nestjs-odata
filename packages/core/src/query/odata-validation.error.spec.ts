import { describe, it, expect } from 'vitest'
import { ODataValidationError } from './odata-validation.error.js'

describe('ODataValidationError', () => {
  it('Test 1: extends Error with name ODataValidationError, message, and propertyName field', () => {
    const err = new ODataValidationError(
      "Property 'UnknownField' not found on entity 'Product'",
      'Product',
      'UnknownField',
    )

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ODataValidationError')
    expect(err.message).toBe("Property 'UnknownField' not found on entity 'Product'")
    expect(err.propertyName).toBe('UnknownField')
  })

  it('Test 2: instanceof check works correctly', () => {
    const err = new ODataValidationError('test message', 'MyEntity', 'myProperty')

    expect(err).toBeInstanceOf(ODataValidationError)
    expect(err).toBeInstanceOf(Error)
  })

  it('Test 3: stores entityTypeName and propertyName for diagnostic output', () => {
    const entityTypeName = 'Customer'
    const propertyName = 'NonExistentField'
    const message = `Property '${propertyName}' not found on entity '${entityTypeName}'`

    const err = new ODataValidationError(message, entityTypeName, propertyName)

    expect(err.entityTypeName).toBe(entityTypeName)
    expect(err.propertyName).toBe(propertyName)
    expect(err.message).toBe(message)
  })

  it('Test 4: accepts optional availableProperties array', () => {
    const err = new ODataValidationError(
      "Property 'prce' not found on entity 'Product'",
      'Product',
      'prce',
      ['id', 'name', 'price'],
    )

    expect(err.availableProperties).toEqual(['id', 'name', 'price'])
  })

  it('Test 5: message includes available properties list when provided', () => {
    const err = new ODataValidationError(
      "Property 'prce' not found on entity 'Product'",
      'Product',
      'prce',
      ['id', 'name', 'description', 'price', 'active', 'createdAt', 'updatedAt'],
    )

    expect(err.message).toContain(
      'Available properties: id, name, description, price, active, createdAt, updatedAt',
    )
  })

  it('Test 6: message without availableProperties remains unchanged', () => {
    const err = new ODataValidationError(
      "Property 'prce' not found on entity 'Product'",
      'Product',
      'prce',
    )

    expect(err.message).toBe("Property 'prce' not found on entity 'Product'")
    expect(err.availableProperties).toBeUndefined()
  })

  it('Test 7: no "did you mean" text appears in error messages (D-11)', () => {
    const err = new ODataValidationError(
      "Property 'prce' not found on entity 'Product'",
      'Product',
      'prce',
      ['id', 'name', 'price'],
    )

    expect(err.message.toLowerCase()).not.toContain('did you mean')
    expect(err.message.toLowerCase()).not.toContain('suggest')
    expect(err.message.toLowerCase()).not.toContain('similar')
  })
})
