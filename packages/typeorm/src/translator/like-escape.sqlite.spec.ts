/**
 * `contains` / `startswith` / `endswith` and `$search` escape `%`, `_` and `\` in the value so
 * they match literally. SQLite has no default LIKE escape character, so the escape only works
 * with an explicit `ESCAPE '\'`.
 */
import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Column,
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  type ObjectLiteral,
  type Repository,
} from 'typeorm'
import { EdmRegistry, ODataSearchable, parseFilter, parseSearch } from '@nestjs-odata/core'
import { TypeOrmFilterVisitor } from './filter-visitor.js'
import { TypeOrmSearchProvider } from './search-provider.js'

@Entity({ name: 'le_code' })
class Code {
  @PrimaryGeneratedColumn() id!: number
  @ODataSearchable() @Column({ type: 'varchar' }) value!: string
}

const entityType = {
  name: 'Code',
  namespace: 'Default',
  properties: [],
  navigationProperties: [],
  keyProperties: ['id'],
  isReadOnly: false,
}

describe('LIKE escaping on SQLite', () => {
  let ds: DataSource
  let repo: Repository<ObjectLiteral>

  async function filterIds(filter: string): Promise<number[]> {
    const qb = repo.createQueryBuilder('e')
    new TypeOrmFilterVisitor(qb, 'e', entityType, 10, 'sqlite', repo).visit(parseFilter(filter))
    return (await qb.getMany()).map((r) => r.id as number).sort((a, b) => a - b)
  }

  async function searchIds(search: string): Promise<number[]> {
    const edm = new EdmRegistry()
    edm.register(entityType, {
      name: 'Codes',
      entityTypeName: 'Code',
      namespace: 'Default',
      isReadOnly: false,
    })
    const built = new TypeOrmSearchProvider(ds, edm).buildSearchCondition(
      parseSearch(search),
      'Codes',
      'e',
    )
    const qb = repo.createQueryBuilder('e').where(built!.condition, built!.params)
    return (await qb.getMany()).map((r) => r.id as number).sort((a, b) => a - b)
  }

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Code],
      synchronize: true,
    })
    await ds.initialize()
    repo = ds.getRepository(Code)
    await repo.save([
      { id: 1, value: 'a_b' },
      { id: 2, value: 'axb' },
      { id: 3, value: '100%' },
      { id: 4, value: '1000' },
      { id: 5, value: 'back\\slash' },
    ])
  })

  afterAll(async () => {
    await ds.destroy()
  })

  it('contains/startswith/endswith match % and _ literally', async () => {
    expect(await filterIds("contains(value, '_')")).toEqual([1])
    expect(await filterIds("contains(value, 'a_b')")).toEqual([1])
    expect(await filterIds("endswith(value, '0%')")).toEqual([3])
    expect(await filterIds("startswith(value, '100%')")).toEqual([3])
    expect(await filterIds("contains(value, '\\')")).toEqual([5])
  })

  it('inside not (...) too', async () => {
    expect(await filterIds("not contains(value, '_')")).toEqual([2, 3, 4, 5])
    expect(await filterIds("not (endswith(value, '%') or contains(value, '\\'))")).toEqual([
      1, 2, 4,
    ])
  })

  it('$search terms match % and _ literally', async () => {
    expect(await searchIds('_')).toEqual([1])
    expect(await searchIds('"0%"')).toEqual([3])
  })
})
