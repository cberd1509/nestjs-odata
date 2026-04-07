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
})
