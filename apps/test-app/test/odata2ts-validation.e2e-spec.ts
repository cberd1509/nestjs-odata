import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import supertest from 'supertest'
import { execSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppModule } from '../src/app.module.js'

describe('odata2ts CSDL validation', () => {
  let app: INestApplication
  let request: ReturnType<typeof supertest>
  const tmpXmlFile = join(tmpdir(), `odata-metadata-${Date.now()}.xml`)
  const tmpOutputDir = join(tmpdir(), `odata2ts-output-${Date.now()}`)

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    request = supertest(app.getHttpServer() as Parameters<typeof supertest>[0])
  })

  afterAll(async () => {
    await app.close()
    rmSync(tmpXmlFile, { force: true })
    rmSync(tmpOutputDir, { recursive: true, force: true })
  })

  it('odata2ts validates $metadata CSDL XML without errors', async () => {
    const res = await request.get('/odata/$metadata')
    expect(res.status).toBe(200)

    const xmlContent = res.text
    expect(xmlContent).toBeTruthy()

    // Write XML to temp file
    writeFileSync(tmpXmlFile, xmlContent, 'utf-8')

    // Run odata2ts against the temp file — throws on non-zero exit code
    execSync(`npx odata2ts -s ${tmpXmlFile} -o ${tmpOutputDir}`, {
      cwd: process.cwd(),
      timeout: 30000,
      encoding: 'utf-8',
    })

    // If execSync didn't throw, odata2ts exited 0 — validation passed
    expect(true).toBe(true)
  }, 60000)
})
