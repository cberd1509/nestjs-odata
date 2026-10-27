import 'reflect-metadata'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { AppModule } from './app.module.js'
import { Category, Product } from './entities.js'

let app: INestApplication
let base: string

before(async () => {
  app = await NestFactory.create(AppModule, { logger: false })
  await app.listen(0)
  base = (await app.getUrl()).replace('[::1]', 'localhost')
  const ds = app.get(DataSource)
  const tools = await ds.getRepository(Category).save({ name: 'Tools' })
  await ds.getRepository(Product).save([
    { name: 'Hammer', price: 10, categoryId: tools.id },
    { name: 'Saw', price: 25, categoryId: tools.id },
  ])
})

after(async () => {
  await app.close()
})

test('serves $metadata', async () => {
  const res = await fetch(`${base}/odata/$metadata`)
  assert.equal(res.status, 200)
  assert.match(await res.text(), /EntityType Name="Product"/)
})

test('runs $filter, $orderby, $count and $expand', async () => {
  const res = await fetch(
    `${base}/odata/Products?$filter=price gt 5&$orderby=price desc&$count=true&$expand=category`,
  )
  assert.equal(res.status, 200)
  const body = (await res.json()) as { '@odata.count': number; value: Array<Record<string, any>> }
  assert.equal(body['@odata.count'], 2)
  assert.deepEqual(
    body.value.map((p) => p.name),
    ['Saw', 'Hammer'],
  )
  assert.equal(body.value[0].category.name, 'Tools')
})

test('serves /$count, by-key reads and creates', async () => {
  assert.equal(await (await fetch(`${base}/odata/Products/$count?$filter=price lt 20`)).text(), '1')

  const created = await fetch(`${base}/odata/Products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Drill', price: 99 }),
  })
  assert.equal(created.status, 201)
  assert.match(created.headers.get('location') ?? '', /^\/odata\/Products\(\d+\)$/)
  const { id } = (await created.json()) as { id: number }

  const read = await fetch(`${base}/odata/Products/${id}`)
  assert.equal(read.status, 200)
  assert.equal(((await read.json()) as { name: string }).name, 'Drill')
})
