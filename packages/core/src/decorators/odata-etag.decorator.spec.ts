import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { ODataETag, getETagProperty } from './odata-etag.decorator.js'

describe('@ODataETag decorator', () => {
  it('Test 1: @ODataETag() on a property stores ODATA_ETAG_KEY metadata', () => {
    class MyEntity {
      @ODataETag()
      updatedAt: Date = new Date()
    }

    expect(getETagProperty(MyEntity)).toBe('updatedAt')
  })

  it('Test 2: getETagProperty on entity without @ODataETag returns undefined', () => {
    class NoETagEntity {
      id: number = 0
      name: string = ''
    }

    expect(getETagProperty(NoETagEntity)).toBeUndefined()
  })
})
