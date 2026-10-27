import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Test } from '@nestjs/testing'
import { ODataModule, type ODataModuleResolvedOptions } from './odata.module.js'
import { ODATA_MODULE_OPTIONS } from './tokens.js'

describe('ODataModule — protocol options (#71, #75)', () => {
  it('defaults errorLanguage to en and ignoreUnknownProperties to false', async () => {
    const module = await Test.createTestingModule({
      imports: [ODataModule.forRoot({ serviceRoot: '/odata' })],
    }).compile()
    const options = module.get<ODataModuleResolvedOptions>(ODATA_MODULE_OPTIONS)
    expect(options.errorLanguage).toBe('en')
    expect(options.ignoreUnknownProperties).toBe(false)
  })

  it('keeps a configured errorLanguage', async () => {
    const module = await Test.createTestingModule({
      imports: [ODataModule.forRoot({ serviceRoot: '/odata', errorLanguage: 'es-CO' })],
    }).compile()
    expect(module.get<ODataModuleResolvedOptions>(ODATA_MODULE_OPTIONS).errorLanguage).toBe('es-CO')
  })

  it('refuses an errorLanguage that is not a language tag', () => {
    expect(() =>
      ODataModule.forRoot({ serviceRoot: '/odata', errorLanguage: 'en\r\nSet-Cookie: x' }),
    ).toThrow(/errorLanguage/)
  })
})
