import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
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

  it('Test 4: forFeature accepts a custom serviceRoot option', async () => {
    const { ODataTypeOrmModule } = await import('./odata-typeorm.module.js')

    const dynamicModule = ODataTypeOrmModule.forFeature([Product], { serviceRoot: '/api/v1' })

    expect(dynamicModule).toBeDefined()
    expect(dynamicModule.module).toBeDefined()
  })

  it('Test 5: forFeature accepts a serviceRoot without leading slash', async () => {
    const { ODataTypeOrmModule } = await import('./odata-typeorm.module.js')

    const dynamicModule = ODataTypeOrmModule.forFeature([Product], { serviceRoot: 'myapi' })

    expect(dynamicModule).toBeDefined()
  })

  it('Test 6: TypeOrmQueryTranslator factory throws when no entities provided', async () => {
    const {
      ODataTypeOrmModule,
      TYPEORM_ODATA_ENTITIES,
      TypeOrmQueryTranslator,
      TypeOrmAutoHandler,
    } = await import('./odata-typeorm.module.js')

    const dynamicModule = ODataTypeOrmModule.forFeature([])
    const providers = dynamicModule.providers ?? []

    // Find factories specifically for TypeOrmQueryTranslator and TypeOrmAutoHandler
    // (these require at least one entity class and should throw when none provided)
    const entityRequiringFactories = providers.filter(
      (p) =>
        typeof p === 'object' &&
        'provide' in p &&
        p.provide !== TYPEORM_ODATA_ENTITIES &&
        (p.provide === TypeOrmQueryTranslator || p.provide === TypeOrmAutoHandler) &&
        'useFactory' in p &&
        typeof (p as { useFactory: unknown }).useFactory === 'function',
    ) as Array<{ useFactory: (...args: unknown[]) => unknown }>

    const mockDs = { getRepository: vi.fn().mockReturnValue({}) }
    const mockReg = {}
    const mockOpts = {
      serviceRoot: '/odata',
      namespace: 'Default',
      maxTop: 1000,
      maxExpandDepth: 3,
    }

    // Both factory functions (translator + autoHandler) should throw with no entities
    for (const factory of entityRequiringFactories) {
      expect(() => factory.useFactory(mockDs, mockReg, mockOpts, mockDs)).toThrow(
        'ODataTypeOrmModule.forFeature() requires at least one entity class',
      )
    }
  })

  it('Test 6b: TypeOrmQueryTranslator factory creates translator with entities', async () => {
    const {
      ODataTypeOrmModule,
      TYPEORM_ODATA_ENTITIES,
      TypeOrmQueryTranslator,
      TypeOrmAutoHandler,
    } = await import('./odata-typeorm.module.js')

    const dynamicModule = ODataTypeOrmModule.forFeature([Product])
    const providers = dynamicModule.providers ?? []

    const factories = providers.filter(
      (p) =>
        typeof p === 'object' &&
        'provide' in p &&
        p.provide !== TYPEORM_ODATA_ENTITIES &&
        'useFactory' in p &&
        typeof (p as { useFactory: unknown }).useFactory === 'function',
    ) as Array<{ provide: unknown; useFactory: (...args: unknown[]) => unknown }>

    const mockQueryBuilder = { select: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis() }
    const mockRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(mockQueryBuilder),
      metadata: { name: 'Product' },
    }
    const mockDs = { getRepository: vi.fn().mockReturnValue(mockRepo) }
    const mockReg = { getEntitySet: vi.fn(), getEntityType: vi.fn() }
    const mockOpts = {
      serviceRoot: '/odata',
      namespace: 'Default',
      maxTop: 1000,
      maxExpandDepth: 3,
    }

    const translatorFactory = factories.find((f) => f.provide === TypeOrmQueryTranslator)
    if (translatorFactory) {
      const translator = translatorFactory.useFactory(mockDs, mockReg, mockOpts)
      expect(translator).toBeInstanceOf(TypeOrmQueryTranslator)
    }

    const autoHandlerFactory = factories.find((f) => f.provide === TypeOrmAutoHandler)
    if (autoHandlerFactory) {
      // We need a TypeOrmQueryTranslator instance first
      const translatorFactory2 = factories.find((f) => f.provide === TypeOrmQueryTranslator)
      const translator = translatorFactory2?.useFactory(mockDs, mockReg, mockOpts)
      const handler = autoHandlerFactory.useFactory(translator, mockReg, mockOpts, mockDs)
      expect(handler).toBeInstanceOf(TypeOrmAutoHandler)
    }
  })

  it('Test 7: TypeOrmEdmInitializer onModuleInit calls deriveEntityTypes and register', async () => {
    const { TypeOrmEdmInitializer } = await import('./odata-typeorm.module.js')

    const mockEdmRegistry = {
      register: vi.fn(),
    }
    const mockOptions = { namespace: 'Default', unmappedTypeStrategy: 'skip' }
    // The deriver requires metadata.target === entityClass to match
    const productMeta = {
      name: 'Product',
      target: Product,
      columns: [{ propertyName: 'id', type: 'int', isNullable: false }],
      relations: [],
      primaryColumns: [{ propertyName: 'id' }],
      tableType: 'regular',
    }
    const mockDataSource = {
      getMetadata: vi.fn().mockReturnValue(productMeta),
    }

    const initializer = new TypeOrmEdmInitializer(
      mockDataSource as never,
      mockEdmRegistry as never,
      mockOptions as never,
      [Product],
    )

    initializer.onModuleInit()

    // register is called once per entity that successfully derives
    expect(mockEdmRegistry.register).toHaveBeenCalledTimes(1)
  })
})
