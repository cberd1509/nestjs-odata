import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  type Repository,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from 'typeorm'
import { TypeOrmFilterVisitor } from './filter-visitor.js'
import type {
  LambdaExprNode,
  BinaryExprNode,
  PropertyAccessNode,
  LiteralNode,
  EdmEntityType,
} from '@nestjs-odata/core'

// ---------------------------------------------------------------------------
// Inline test entities (isolated from test-app)
// ---------------------------------------------------------------------------

@Entity()
class ParentEntity {
  @PrimaryGeneratedColumn()
  id!: number

  @OneToMany(() => ChildEntity, (c) => c.parent)
  children!: ChildEntity[]
}

@Entity()
class ChildEntity {
  @PrimaryGeneratedColumn()
  id!: number

  @Column()
  value!: number

  @Column({ nullable: true })
  name!: string

  @Column({ nullable: true })
  parentId!: number

  @ManyToOne(() => ParentEntity, (p) => p.children)
  parent!: ParentEntity
}

// ---------------------------------------------------------------------------
// Test EDM entity type
// ---------------------------------------------------------------------------

const entityType: EdmEntityType = {
  name: 'ParentEntity',
  namespace: 'Default',
  properties: [{ name: 'id', edmType: 'Edm.Int32', isNullable: false, isCollection: false }],
  navigationProperties: [],
  keyProperties: ['id'],
  isReadOnly: false,
}

// ---------------------------------------------------------------------------
// Helper — build a LambdaExprNode
// ---------------------------------------------------------------------------

function makeLambda(
  operator: 'any' | 'all',
  collection: string,
  variable: string | null,
  predicate: BinaryExprNode | null,
): LambdaExprNode {
  return { kind: 'LambdaExpr', operator, collection, variable, predicate }
}

function makeBinary(
  operator: string,
  prop: string,
  value: number | string | boolean,
): BinaryExprNode {
  const left: PropertyAccessNode = { kind: 'PropertyAccess', path: [prop] }
  const right: LiteralNode = { kind: 'Literal', value }
  return { kind: 'BinaryExpr', operator, left, right }
}

// ---------------------------------------------------------------------------
// Integration suite
// ---------------------------------------------------------------------------

describe('lambda any/all (FILT-01, FILT-02)', () => {
  let dataSource: DataSource

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [ParentEntity, ChildEntity],
      synchronize: true,
    })
    await dataSource.initialize()

    const parentRepo = dataSource.getRepository(ParentEntity)
    const childRepo = dataSource.getRepository(ChildEntity)

    // Insert parents
    await parentRepo.save([{ id: 1 }, { id: 2 }, { id: 3 }])

    // Insert children
    // parent 1: children with value 150 and 50
    // parent 2: child with value 30
    // parent 3: no children
    await childRepo.save([
      { id: 1, value: 150, parentId: 1, name: 'alpha' },
      { id: 2, value: 50, parentId: 1, name: 'beta' },
      { id: 3, value: 30, parentId: 2, name: 'gamma' },
    ])
  })

  afterAll(async () => {
    await dataSource.destroy()
  })

  it('Test 1 — any() with predicate: returns parents with at least one child matching value gt 100', async () => {
    const parentRepo = dataSource.getRepository(ParentEntity) as Repository<ObjectLiteral>
    const qb = parentRepo.createQueryBuilder('entity')

    const node = makeLambda('any', 'children', 'c', makeBinary('gt', 'value', 100))

    const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType, 10, 'sqlite', parentRepo)
    visitor.visit(node)

    const result = await qb.getMany()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('Test 2 — all() with predicate: returns parents where ALL children match value gt 40', async () => {
    const parentRepo = dataSource.getRepository(ParentEntity) as Repository<ObjectLiteral>
    const qb = parentRepo.createQueryBuilder('entity')

    const node = makeLambda('all', 'children', 'c', makeBinary('gt', 'value', 40))

    const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType, 10, 'sqlite', parentRepo)
    visitor.visit(node)

    // parent 1: children 150 and 50 — both > 40 -> qualifies
    // parent 2: child 30 — NOT > 40 -> does not qualify
    // parent 3: no children — NOT EXISTS (...) on empty set is TRUE -> qualifies
    const result = await qb.getMany()

    const ids = result.map((p) => (p as ParentEntity).id).sort()
    expect(ids).toContain(1)
    expect(ids).not.toContain(2)
  })

  it('Test 3 — any() with no predicate: returns only parents with non-empty children collection', async () => {
    const parentRepo = dataSource.getRepository(ParentEntity) as Repository<ObjectLiteral>
    const qb = parentRepo.createQueryBuilder('entity')

    const node = makeLambda('any', 'children', null, null)

    const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType, 10, 'sqlite', parentRepo)
    visitor.visit(node)

    const result = await qb.getMany()

    const ids = result.map((p) => (p as ParentEntity).id).sort()
    expect(ids).toContain(1)
    expect(ids).toContain(2)
    expect(ids).not.toContain(3) // no children
  })

  it('Test 4 — all() with no predicate (vacuous truth): returns all parents with no filtering', async () => {
    const parentRepo = dataSource.getRepository(ParentEntity) as Repository<ObjectLiteral>
    const qb = parentRepo.createQueryBuilder('entity')

    const node = makeLambda('all', 'children', null, null)

    const visitor = new TypeOrmFilterVisitor(qb, 'entity', entityType, 10, 'sqlite', parentRepo)
    visitor.visit(node)

    const result = await qb.getMany()

    // No WHERE condition added — all 3 parents returned
    expect(result).toHaveLength(3)
  })

  it('Test 5 — parameterization security: SQL contains :pN params, not raw values', () => {
    const capturedConditions: string[] = []
    const capturedParams: Array<Record<string, unknown>> = []
    const mockQb = {
      andWhere(
        condition: string,
        params?: Record<string, unknown>,
      ): SelectQueryBuilder<ObjectLiteral> {
        capturedConditions.push(condition)
        if (params) capturedParams.push(params)
        return mockQb
      },
    } as SelectQueryBuilder<ObjectLiteral>

    const parentRepo = dataSource.getRepository(ParentEntity) as Repository<ObjectLiteral>

    const node = makeLambda(
      'any',
      'children',
      'c',
      makeBinary('eq', 'name', "'; DROP TABLE parent_entity; --"),
    )

    const visitor = new TypeOrmFilterVisitor(mockQb, 'entity', entityType, 10, 'sqlite', parentRepo)
    visitor.visit(node)

    expect(capturedConditions.length).toBeGreaterThan(0)
    const sql = capturedConditions.join(' ')
    // Must contain a named param reference
    expect(sql).toMatch(/:p\d+/)
    // Must NOT contain the raw injection string
    expect(sql).not.toContain('DROP TABLE')
  })
})
