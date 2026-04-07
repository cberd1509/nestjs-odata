import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinTable,
  ViewEntity,
  DataSource,
} from 'typeorm'
import { EdmType, ODataExclude, ODataEntitySet } from '@nestjs-odata/core'
import { TypeOrmEdmDeriver } from './typeorm-edm-deriver.js'

// ─── Test entity definitions ───────────────────────────────────────────────

@Entity()
class TestCategory {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 100 })
  name: string

  @OneToMany('TestProduct', 'category')
  products: unknown[]
}

@Entity()
class TestProduct {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 255 })
  name: string

  @Column({ type: 'text', nullable: true })
  description: string | null

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number

  @Column({ type: 'boolean', default: true })
  active: boolean

  @Column({ type: 'datetime' })
  createdAt: Date

  @ODataExclude()
  @Column({ type: 'varchar', nullable: true })
  internalSecret: string | null

  @EdmType({ type: 'Edm.Decimal', precision: 18, scale: 4 })
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  overriddenPrice: number

  @ManyToOne(() => TestCategory, (cat: TestCategory) => cat.products)
  category: TestCategory

  @Column({ nullable: true })
  categoryId: number | null

  @OneToMany('TestOrderItem', 'product')
  orderItems: unknown[]

  @ManyToMany(() => TestTag, (tag: TestTag) => tag.products)
  @JoinTable()
  tags: TestTag[]
}

@Entity()
class TestOrderItem {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'int' })
  quantity: number

  @ManyToOne(() => TestProduct, (p: TestProduct) => p.orderItems)
  product: TestProduct
}

@Entity()
class TestTag {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 100 })
  name: string

  @ManyToMany(() => TestProduct, (p: TestProduct) => p.tags)
  products: TestProduct[]
}

@ODataEntitySet('CustomProducts')
@Entity()
class TestProductWithCustomSet {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar' })
  name: string
}

@ViewEntity({ expression: 'SELECT id, name FROM test_product' })
class TestProductView {
  @Column()
  id: number

  @Column()
  name: string
}

// ─── DataSource setup ───────────────────────────────────────────────────────

let dataSource: DataSource

beforeAll(async () => {
  dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [
      TestProduct,
      TestCategory,
      TestOrderItem,
      TestTag,
      TestProductWithCustomSet,
      TestProductView,
    ],
    synchronize: true,
  })
  await dataSource.initialize()
})

afterAll(async () => {
  if (dataSource?.isInitialized) {
    await dataSource.destroy()
  }
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TypeOrmEdmDeriver', () => {
  it('Test 1: Product entity derives correct properties with correct types', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter((m) => m.target === TestProduct)
    const configs = deriver.deriveEntityTypes([TestProduct], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProduct')

    expect(config).toBeDefined()
    // id, name, description, price, active, createdAt, overriddenPrice, categoryId
    // (internalSecret excluded, tags/category/orderItems are navigation)
    const propNames = config!.properties.map((p) => p.name)
    expect(propNames).toContain('name')
    expect(propNames).toContain('description')
    expect(propNames).toContain('price')
    expect(propNames).toContain('active')
    expect(propNames).toContain('createdAt')

    const nameProp = config!.properties.find((p) => p.name === 'name')
    expect(nameProp?.type).toBe('Edm.String')

    const priceProp = config!.properties.find((p) => p.name === 'price')
    expect(priceProp?.type).toBe('Edm.Decimal')

    const activeProp = config!.properties.find((p) => p.name === 'active')
    expect(activeProp?.type).toBe('Edm.Boolean')

    const createdAtProp = config!.properties.find((p) => p.name === 'createdAt')
    expect(createdAtProp?.type).toBe('Edm.DateTimeOffset')

    const descProp = config!.properties.find((p) => p.name === 'description')
    expect(descProp?.nullable).toBe(true)
  })

  it('Test 2: Product entity key property is [id]', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter((m) => m.target === TestProduct)
    const configs = deriver.deriveEntityTypes([TestProduct], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProduct')

    expect(config?.keyProperties).toEqual(['id'])
  })

  it('Test 3: Product ManyToOne(Category) → non-collection NavigationProperty', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter((m) => m.target === TestProduct)
    const configs = deriver.deriveEntityTypes([TestProduct], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProduct')

    const categoryNav = config?.navigationProperties.find((n) => n.name === 'category')
    expect(categoryNav).toBeDefined()
    expect(categoryNav?.isCollection).toBe(false)
    expect(categoryNav?.type).toBe('Default.TestCategory')
  })

  it('Test 4: Product OneToMany(OrderItem) → collection NavigationProperty', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter((m) => m.target === TestProduct)
    const configs = deriver.deriveEntityTypes([TestProduct], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProduct')

    const orderItemsNav = config?.navigationProperties.find((n) => n.name === 'orderItems')
    expect(orderItemsNav).toBeDefined()
    expect(orderItemsNav?.isCollection).toBe(true)
    expect(orderItemsNav?.type).toContain('Collection(Default.')
  })

  it('Test 5: Product ManyToMany(Tag) → collection NavigationProperty', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter((m) => m.target === TestProduct)
    const configs = deriver.deriveEntityTypes([TestProduct], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProduct')

    const tagsNav = config?.navigationProperties.find((n) => n.name === 'tags')
    expect(tagsNav).toBeDefined()
    expect(tagsNav?.isCollection).toBe(true)
    expect(tagsNav?.type).toBe('Collection(Default.TestTag)')
  })

  it('Test 6: EntitySet name is auto-pluralized: TestProduct → TestProducts', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter((m) => m.target === TestProduct)
    const configs = deriver.deriveEntityTypes([TestProduct], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProduct')

    expect(config?.entitySetName).toBe('TestProducts')
  })

  it('Test 7: @ODataEntitySet("CustomProducts") overrides auto-pluralized name', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter(
      (m) => m.target === TestProductWithCustomSet,
    )
    const configs = deriver.deriveEntityTypes([TestProductWithCustomSet], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProductWithCustomSet')

    expect(config?.entitySetName).toBe('CustomProducts')
  })

  it('Test 8: @ODataExclude() on internalSecret excludes it from derived config', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter((m) => m.target === TestProduct)
    const configs = deriver.deriveEntityTypes([TestProduct], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProduct')

    const propNames = config!.properties.map((p) => p.name)
    expect(propNames).not.toContain('internalSecret')
  })

  it('Test 9: @EdmType({ type: Edm.Decimal, precision: 18, scale: 4 }) overrides auto-derived type', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter((m) => m.target === TestProduct)
    const configs = deriver.deriveEntityTypes([TestProduct], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProduct')

    const overriddenProp = config!.properties.find((p) => p.name === 'overriddenPrice')
    expect(overriddenProp?.type).toBe('Edm.Decimal')
    expect(overriddenProp?.precision).toBe(18)
    expect(overriddenProp?.scale).toBe(4)
  })

  it('Test 10: @ViewEntity() detected → isReadOnly = true', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter((m) => m.target === TestProductView)
    const configs = deriver.deriveEntityTypes([TestProductView], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProductView')

    expect(config?.isReadOnly).toBe(true)
  })

  it('Test 11: Regular @Entity() → isReadOnly = false', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter((m) => m.target === TestProduct)
    const configs = deriver.deriveEntityTypes([TestProduct], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProduct')

    expect(config?.isReadOnly).toBe(false)
  })

  it('Test 12: Navigation property types are namespace-qualified', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityMetadatas = dataSource.entityMetadatas.filter((m) => m.target === TestProduct)
    const configs = deriver.deriveEntityTypes([TestProduct], entityMetadatas)
    const config = configs.find((c) => c.entityTypeName === 'TestProduct')

    const categoryNav = config?.navigationProperties.find((n) => n.name === 'category')
    expect(categoryNav?.type).toBe('Default.TestCategory')

    const tagsNav = config?.navigationProperties.find((n) => n.name === 'tags')
    expect(tagsNav?.type).toBe('Collection(Default.TestTag)')
  })

  it('Test 13: Multiple entities derived in one call → all returned', () => {
    const deriver = new TypeOrmEdmDeriver('Default', 'skip')
    const entityClasses = [TestProduct, TestCategory, TestTag]
    const entityMetadatas = dataSource.entityMetadatas.filter((m) =>
      entityClasses.includes(m.target as typeof TestProduct),
    )
    const configs = deriver.deriveEntityTypes(entityClasses, entityMetadatas)

    expect(configs.length).toBe(3)
    const names = configs.map((c) => c.entityTypeName)
    expect(names).toContain('TestProduct')
    expect(names).toContain('TestCategory')
    expect(names).toContain('TestTag')
  })
})
