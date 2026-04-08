import 'reflect-metadata'
import { describe, it, beforeAll, afterAll } from 'vitest'
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import { DataSource } from 'typeorm'
import { AppModule } from '../src/app.module.js'
import { Customer } from '../src/entities/index.js'

const BOUNDARY = 'batch_cid_dbg'

function buildBatch(parts: string[]): string {
  const lines: string[] = []
  for (const part of parts) {
    lines.push(`--${BOUNDARY}`)
    lines.push(part)
  }
  lines.push(`--${BOUNDARY}--`)
  return lines.join('\r\n')
}

describe('Debug Content-ID', () => {
  let app: INestApplication
  let req: ReturnType<typeof supertest>
  let customerId: number

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = m.createNestApplication()
    /* eslint-disable @typescript-eslint/no-require-imports */
    app.use(
      (require('express') as { text: (o: { type: string; limit: string }) => unknown }).text({
        type: 'multipart/mixed',
        limit: '10mb',
      }),
    )
    /* eslint-enable @typescript-eslint/no-require-imports */
    await app.init()
    req = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])
    const ds = m.get<DataSource>(DataSource)
    const repo = ds.getRepository(Customer)
    const c = await repo.save(
      repo.create({ firstName: 'D', lastName: 'E', email: 'dbgcid@test.com' }),
    )
    customerId = c.id
  })

  afterAll(async () => {
    await app.close()
  })

  it('debug: batch with content-id', async () => {
    const csBoundary = 'cs_dbg'
    const orderDate = new Date().toISOString()
    const orderBody = JSON.stringify({ orderDate, totalAmount: 100, status: 'new', customerId })
    const patchBody = JSON.stringify({ status: 'confirmed' })

    const body = buildBatch([
      [
        `Content-Type: multipart/mixed; boundary=${csBoundary}`,
        '',
        `--${csBoundary}`,
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        'Content-ID: 1',
        '',
        `POST /odata/Orders HTTP/1.1\r\nContent-Type: application/json\r\n\r\n${orderBody}`,
        `--${csBoundary}`,
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        '',
        `PATCH $1 HTTP/1.1\r\nContent-Type: application/json\r\n\r\n${patchBody}`,
        `--${csBoundary}--`,
      ].join('\r\n'),
    ])

    const res = await req
      .post('/odata/$batch')
      .set('Content-Type', `multipart/mixed; boundary=${BOUNDARY}`)
      .send(body)
      .buffer(true)
      .parse((r: import('http').IncomingMessage, fn: (e: Error | null, d: unknown) => void) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => fn(null, Buffer.concat(chunks).toString('utf-8')))
      })

    console.log('Status:', res.status)
    const responseText = typeof res.body === 'string' ? res.body : JSON.stringify(res.body)
    console.log('Response (first 2000):', responseText.slice(0, 2000))
  })
})
