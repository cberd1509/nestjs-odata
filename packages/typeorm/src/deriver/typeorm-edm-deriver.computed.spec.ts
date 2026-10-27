import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  Column,
  CreateDateColumn,
  DataSource,
  Entity,
  Generated,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm'
import { TypeOrmEdmDeriver } from './typeorm-edm-deriver.js'

@Entity()
class ComputedThing {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar' })
  name: string

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date

  @VersionColumn()
  version: number

  @Column({ type: 'varchar' })
  @Generated('uuid')
  publicId: string
}

let dataSource: DataSource

beforeAll(async () => {
  dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [ComputedThing],
    synchronize: true,
  })
  await dataSource.initialize()
})

afterAll(async () => {
  await dataSource.destroy()
})

describe('TypeOrmEdmDeriver — computed properties (#75)', () => {
  it('marks create/update date, version and generated non-key columns as computed', () => {
    const [config] = new TypeOrmEdmDeriver('Default', 'skip').deriveEntityTypes(
      [ComputedThing],
      dataSource.entityMetadatas,
    )
    const computed = Object.fromEntries(config.properties.map((p) => [p.name, p.computed === true]))
    expect(computed).toEqual({
      // The key keeps being client-settable on POST; it is not annotated Core.Computed.
      id: false,
      name: false,
      createdAt: true,
      updatedAt: true,
      version: true,
      publicId: true,
    })
  })
})
