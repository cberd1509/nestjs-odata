/**
 * TypeOrmFilterVisitor, end to end on SQLite: functions and operators inside `not (...)` and
 * inside lambda predicates (rendered by the inner expression builder), lambdas over both sides
 * of a many-to-many navigation, and the ANSI/Postgres SQL rendering of the same functions.
 *
 * Filters are parsed with the core parser so every case reads like the `$filter` a client sends.
 */
import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Column,
  DataSource,
  Entity,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type ObjectLiteral,
  type Repository,
} from 'typeorm'
import { parseFilter, type EdmEntityType } from '@nestjs-odata/core'
import { TypeOrmFilterVisitor, type LambdaScopeLookup } from './filter-visitor.js'

@Entity({ name: 'fvf_author' })
class Author {
  @PrimaryGeneratedColumn() id!: number
  @Column({ type: 'varchar' }) name!: string
  @Column({ type: 'varchar', nullable: true }) nick!: string | null
  @Column({ type: 'integer' }) score!: number
  @OneToMany(() => Book, (b) => b.author) books!: Book[]
}

@Entity({ name: 'fvf_book' })
class Book {
  @PrimaryGeneratedColumn() id!: number
  @Column({ type: 'varchar' }) title!: string
  @Column({ type: 'integer' }) pages!: number
  @Column({ type: 'varchar' }) published!: string
  @Column({ type: 'varchar', nullable: true }) subtitle!: string | null
  @Column({ type: 'integer' }) authorId!: number
  @ManyToOne(() => Author, (a) => a.books) author!: Author
  @ManyToMany(() => Genre, (g) => g.books)
  @JoinTable({ name: 'fvf_book_genres' })
  genres!: Genre[]
}

@Entity({ name: 'fvf_genre' })
class Genre {
  @PrimaryGeneratedColumn() id!: number
  @Column({ type: 'varchar' }) name!: string
  @Column({ type: 'varchar' }) owner!: string
  @ManyToMany(() => Book, (b) => b.genres) books!: Book[]
}

const edmType = (name: string): EdmEntityType => ({
  name,
  namespace: 'Default',
  properties: [],
  navigationProperties: [],
  keyProperties: ['id'],
  isReadOnly: false,
})

describe('TypeOrmFilterVisitor functions and many-to-many lambdas (SQLite)', () => {
  let ds: DataSource

  /** Ids of `entity` rows matching `filter`. */
  async function ids(
    entity: new () => ObjectLiteral,
    filter: string,
    scope?: LambdaScopeLookup,
  ): Promise<number[]> {
    const repo: Repository<ObjectLiteral> = ds.getRepository(entity)
    const qb = repo.createQueryBuilder('e')
    const visitor = new TypeOrmFilterVisitor(
      qb,
      'e',
      edmType(entity.name),
      10,
      'sqlite',
      repo,
      scope,
    )
    visitor.visit(parseFilter(filter))
    const rows = await qb.getMany()
    return rows.map((r) => r.id as number).sort((a, b) => a - b)
  }

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Author, Book, Genre],
      synchronize: true,
    })
    await ds.initialize()
    await ds.getRepository(Author).save([
      { id: 1, name: 'Ursula', nick: 'ukl', score: 9 },
      { id: 2, name: 'Terry', nick: null, score: 7 },
      { id: 3, name: 'Iain_M', nick: '100%', score: 4 },
    ])
    await ds.getRepository(Genre).save([
      { id: 1, name: 'fantasy', owner: 'A' },
      { id: 2, name: 'scifi', owner: 'A' },
      { id: 3, name: 'satire', owner: 'B' },
    ])
    await ds.getRepository(Book).save([
      {
        id: 1,
        title: 'A Wizard of Earthsea',
        pages: 183,
        published: '1968-11-01 00:00:00',
        subtitle: null,
        authorId: 1,
        genres: [{ id: 1 }],
      },
      {
        id: 2,
        title: 'The Dispossessed',
        pages: 387,
        published: '1974-05-01 10:30:15',
        subtitle: 'An Ambiguous Utopia',
        authorId: 1,
        genres: [{ id: 2 }],
      },
      {
        id: 3,
        title: 'Guards! Guards!',
        pages: 288,
        published: '1989-11-01 00:00:00',
        subtitle: null,
        authorId: 2,
        genres: [{ id: 1 }, { id: 3 }],
      },
      {
        id: 4,
        title: 'Excession',
        pages: 451,
        published: '1996-01-01 00:00:00',
        subtitle: null,
        authorId: 3,
        genres: [{ id: 2 }],
      },
    ])
  })

  afterAll(async () => {
    await ds.destroy()
  })

  describe('inside not (...)', () => {
    it('string matching functions', async () => {
      expect(await ids(Book, "not contains(title, 'Guards')")).toEqual([1, 2, 4])
      expect(await ids(Book, "not startswith(title, 'The')")).toEqual([1, 3, 4])
      expect(await ids(Book, "not endswith(title, 'sion')")).toEqual([1, 2, 3])
    })

    it('date functions', async () => {
      expect(await ids(Book, 'not (year(published) lt 1980)')).toEqual([3, 4])
      expect(await ids(Book, 'not (month(published) eq 11)')).toEqual([2, 4])
      expect(await ids(Book, 'not (hour(published) eq 0)')).toEqual([2])
    })

    it('indexof, substring (2 and 3 args), concat and scalar functions', async () => {
      expect(await ids(Book, "not (indexof(title, 'Guards') eq 0)")).toEqual([1, 2, 4])
      expect(await ids(Book, "not (substring(title, 4) eq 'Dispossessed')")).toEqual([1, 3, 4])
      expect(await ids(Book, "not (substring(title, 0, 3) eq 'The')")).toEqual([1, 3, 4])
      expect(await ids(Author, "not (concat(name, 'X') eq 'TerryX')")).toEqual([1, 3])
      expect(await ids(Author, 'not (length(name) eq 5)')).toEqual([1, 3])
      expect(await ids(Author, "not (tolower(name) eq 'terry')")).toEqual([1, 3])
      expect(await ids(Author, "not (toupper(name) eq 'TERRY')")).toEqual([1, 3])
      expect(await ids(Author, "not (trim(name) eq 'Terry')")).toEqual([1, 3])
    })

    it('arithmetic, eq null / ne null, nested not and and/or', async () => {
      expect(await ids(Author, 'not (score add 1 gt 8)')).toEqual([2, 3])
      expect(await ids(Author, 'not (score mul score gt 40)')).toEqual([3])
      expect(await ids(Author, 'not (nick eq null)')).toEqual([1, 3])
      expect(await ids(Author, 'not (nick ne null)')).toEqual([2])
      expect(await ids(Author, 'not (not (score gt 5))')).toEqual([1, 2])
      expect(await ids(Author, 'not (score gt 8 or score lt 5)')).toEqual([2])
      expect(await ids(Author, "not (score gt 5 and name eq 'Terry')")).toEqual([1, 3])
    })
  })

  describe('inside lambda predicates', () => {
    it('functions on the range variable', async () => {
      expect(await ids(Author, "books/any(b: contains(b/title, 'Earth'))")).toEqual([1])
      expect(await ids(Author, "books/any(b: startswith(b/title, 'Ex'))")).toEqual([3])
      expect(await ids(Author, "books/any(b: endswith(b/title, 'Guards!'))")).toEqual([2])
      expect(await ids(Author, 'books/any(b: year(b/published) gt 1985)')).toEqual([2, 3])
      expect(await ids(Author, "books/any(b: indexof(b/title, 'Wizard') eq 2)")).toEqual([1])
      expect(await ids(Author, "books/any(b: substring(b/title, 0, 2) eq 'Ex')")).toEqual([3])
      expect(await ids(Author, "books/any(b: concat(b/title, '!') eq 'Excession!')")).toEqual([3])
      expect(await ids(Author, 'books/all(b: length(b/title) gt 10)')).toEqual([1, 2])
    })

    it('arithmetic, null checks and outer-entity properties', async () => {
      expect(await ids(Author, 'books/all(b: b/pages sub 100 gt 80)')).toEqual([1, 2, 3])
      expect(await ids(Author, 'books/any(b: b/subtitle ne null)')).toEqual([1])
      expect(await ids(Author, 'books/all(b: b/subtitle eq null)')).toEqual([2, 3])
      // `score` has no range variable: it refers to the author the lambda runs on.
      expect(await ids(Author, 'books/any(b: b/pages gt 200 and score gt 5)')).toEqual([1, 2])
      expect(await ids(Author, 'books/any(b: not (b/pages lt 400))')).toEqual([3])
    })
  })

  describe('lambdas over many-to-many navigations', () => {
    it('from the owning side (Book.genres)', async () => {
      expect(await ids(Book, "genres/any(g: g/name eq 'fantasy')")).toEqual([1, 3])
      expect(await ids(Book, "genres/all(g: g/name ne 'satire')")).toEqual([1, 2, 4])
      expect(await ids(Book, 'genres/any()')).toEqual([1, 2, 3, 4])
    })

    it('from the inverse side (Genre.books)', async () => {
      expect(await ids(Genre, 'books/any(b: b/pages gt 400)')).toEqual([2])
      expect(await ids(Genre, 'books/all(b: b/pages lt 300)')).toEqual([1, 3])
    })

    it('applies the target row-level scope', async () => {
      const ownerA: LambdaScopeLookup = (path) =>
        path === 'genres'
          ? {
              sql: 'SELECT g.id FROM fvf_genre g WHERE g.owner = :own',
              params: { own: 'A' },
              primaryColumns: [{ propertyPath: 'id', databaseName: 'id' }],
            }
          : undefined
      // Genre 3 (satire) belongs to B: it does not count for `any`, and not against `all`.
      expect(await ids(Book, "genres/any(g: g/name eq 'satire')", ownerA)).toEqual([])
      expect(await ids(Book, "genres/all(g: g/name eq 'fantasy')", ownerA)).toEqual([1, 3])
    })
  })

  describe('degenerate input', () => {
    it('ignores lambdas on unknown relations and without repository metadata', async () => {
      expect(await ids(Author, 'nothing/any(x: x/id eq 1)')).toEqual([1, 2, 3])
      const qb = ds.getRepository(Author).createQueryBuilder('e')
      new TypeOrmFilterVisitor(qb, 'e', edmType('Author'), 10, 'sqlite').visit(
        parseFilter('books/any(b: b/pages gt 1)'),
      )
      expect(qb.getQuery()).not.toContain('WHERE')
    })

    it('a bare property, literal or non-boolean function adds no condition', async () => {
      expect(await ids(Author, 'name')).toEqual([1, 2, 3])
      expect(await ids(Author, 'true')).toEqual([1, 2, 3])
      expect(await ids(Author, 'tolower(name)')).toEqual([1, 2, 3])
    })

    it('rejects navigation paths when the visitor has no repository metadata', () => {
      const qb = ds.getRepository(Book).createQueryBuilder('e')
      const visitor = new TypeOrmFilterVisitor(qb, 'e', edmType('Book'), 10, 'sqlite')
      expect(() => visitor.visit(parseFilter("author/name eq 'Terry'"))).toThrow(
        /Navigation paths \('author\/name'\) are not supported/,
      )
    })
  })
})

describe('TypeOrmFilterVisitor ANSI (Postgres) rendering', () => {
  let ds: DataSource

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Author, Book, Genre],
      synchronize: true,
    })
    await ds.initialize()
  })

  afterAll(async () => {
    await ds.destroy()
  })

  function render(filter: string): { sql: string; params: Record<string, unknown> } {
    const repo = ds.getRepository(Author) as Repository<ObjectLiteral>
    const qb = repo.createQueryBuilder('e')
    new TypeOrmFilterVisitor(qb, 'e', edmType('Author'), 10, 'ansi', repo).visit(
      parseFilter(filter),
    )
    // TypeORM quotes aliases and columns; strip the quotes to keep expectations readable.
    return { sql: qb.getQuery().replace(/"/g, ''), params: qb.getParameters() }
  }

  it('uses EXTRACT and STRPOS outside and inside not/lambdas, with bound parameters', () => {
    expect(render('year(name) eq 2000').sql).toContain('EXTRACT(YEAR FROM e.name) = :p1')
    expect(render('not (day(name) eq 1)').sql).toContain('NOT (EXTRACT(DAY FROM e.name) = :p1)')
    const idx = render("not (indexof(name, 'x') eq 0)")
    expect(idx.sql).toContain('STRPOS(e.name, :p1) - 1 = :p2')
    expect(idx.params).toEqual({ p1: 'x', p2: 0 })
    expect(render("indexof(name, 'x') eq 0").sql).toContain('STRPOS(e.name, :p1) - 1')
    expect(render('books/any(b: minute(b/published) eq 30)').sql).toContain(
      'EXTRACT(MINUTE FROM b_lambda_1.published)',
    )
    expect(render("books/any(b: indexof(b/title, 'W') eq 0)").sql).toContain(
      'STRPOS(b_lambda_1.title, :p2) - 1',
    )
    expect(render('second(name) eq 1').params).toEqual({ p1: 1 })
  })
})
