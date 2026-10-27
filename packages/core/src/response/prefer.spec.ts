import { describe, it, expect } from 'vitest'
import { resolveReturnPreference } from './prefer.js'

describe('resolveReturnPreference (OData-Protocol 4.01 §8.2.8.7)', () => {
  it('returns undefined without a Prefer header', () => {
    expect(resolveReturnPreference(undefined, '/odata/Products')).toBeUndefined()
  })

  it('returns minimal for return=minimal', () => {
    expect(resolveReturnPreference('return=minimal', '/odata/Products')).toBe('minimal')
  })

  it('returns representation for return=representation', () => {
    expect(resolveReturnPreference('return=representation', '/odata/Products(1)')).toBe(
      'representation',
    )
  })

  it('finds return among other preferences, case-insensitively and with spaces', () => {
    expect(resolveReturnPreference('odata.track-changes, Return = Minimal', '/x')).toBe('minimal')
  })

  it('reads every value of a repeated header', () => {
    expect(resolveReturnPreference(['odata.maxpagesize=5', 'return=minimal'], '/x')).toBe('minimal')
  })

  it('ignores unknown return values', () => {
    expect(resolveReturnPreference('return=everything', '/x')).toBeUndefined()
  })

  it('$select or $expand on the request imply return=representation (§11.4.1.5)', () => {
    expect(resolveReturnPreference('return=minimal', '/odata/Products?$select=name')).toBe(
      'representation',
    )
    expect(resolveReturnPreference('return=minimal', '/odata/Orders(1)?$expand=items')).toBe(
      'representation',
    )
    expect(resolveReturnPreference('return=minimal', '/odata/Orders(1)?%24expand=items')).toBe(
      'representation',
    )
  })

  it('a $select-like text in another option value does not count', () => {
    expect(resolveReturnPreference('return=minimal', "/odata/P?$filter=name eq '$select='")).toBe(
      'minimal',
    )
  })
})
