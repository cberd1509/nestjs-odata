import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity()
class Product {
  @PrimaryGeneratedColumn()
  id!: number

  @Column()
  name!: string
}

@Entity()
class Category {
  @PrimaryGeneratedColumn()
  id!: number

  @Column()
  label!: string
}

describe('ODataTypeOrmModule', () => {
  it('Test 1: ODataTypeOrmModule.forFeature([Product]) creates a DynamicModule', async () => {
    const { ODataTypeOrmModule } = await import('./odata-typeorm.module.js')

    const dynamicModule = ODataTypeOrmModule.forFeature([Product])

    expect(dynamicModule).toBeDefined()
    expect(dynamicModule.module).toBe(ODataTypeOrmModule)
    expect(dynamicModule.imports).toBeDefined()
    expect(dynamicModule.providers).toBeDefined()
  })

  it('Test 2: ODataTypeOrmModule.forFeature([Product, Category]) stores the entity classes via injection token', async () => {
    const { ODataTypeOrmModule, TYPEORM_ODATA_ENTITIES } = await import('./odata-typeorm.module.js')

    const dynamicModule = ODataTypeOrmModule.forFeature([Product, Category])

    const entitiesProvider = dynamicModule.providers?.find(
      (p) => typeof p === 'object' && 'provide' in p && p.provide === TYPEORM_ODATA_ENTITIES,
    )

    expect(entitiesProvider).toBeDefined()
    // Type guard to access useValue safely
    if (
      entitiesProvider &&
      typeof entitiesProvider === 'object' &&
      'useValue' in entitiesProvider
    ) {
      expect(entitiesProvider.useValue).toEqual([Product, Category])
    } else {
      throw new Error('Expected useValue provider for TYPEORM_ODATA_ENTITIES')
    }
  })

  it('Test 3: the module exports are accessible (TYPEORM_ODATA_ENTITIES is exported)', async () => {
    const { ODataTypeOrmModule, TYPEORM_ODATA_ENTITIES } = await import('./odata-typeorm.module.js')

    const dynamicModule = ODataTypeOrmModule.forFeature([Product])

    expect(dynamicModule.exports).toContain(TYPEORM_ODATA_ENTITIES)
  })
})
