import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/index'

describe('@nestjs-odata/core', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBe('0.0.1')
  })
})
