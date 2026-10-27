import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { Controller, Get, Module, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { lastValueFrom, of, type Observable } from 'rxjs'
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import {
  getODataRequestContext,
  ODataRequestContextInterceptor,
  runWithODataRequestContext,
} from './odata-request-context.js'
import { ODataModule } from '../odata.module.js'

describe('ODataRequestContext', () => {
  it('is undefined outside a request and set inside runWithODataRequestContext', async () => {
    expect(getODataRequestContext()).toBeUndefined()
    const request = { user: 'u1' }
    const seen = await runWithODataRequestContext({ request }, async () => {
      await Promise.resolve()
      return getODataRequestContext()?.request
    })
    expect(seen).toBe(request)
    expect(getODataRequestContext()).toBeUndefined()
  })

  it('the interceptor exposes the execution context and request to the handler', async () => {
    const request = { headers: {} }
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext
    const next: CallHandler = {
      handle: (): Observable<unknown> => of(getODataRequestContext()),
    }
    const result = (await lastValueFrom(
      new ODataRequestContextInterceptor().intercept(context, next),
    )) as { executionContext: unknown; request: unknown }
    expect(result.executionContext).toBe(context)
    expect(result.request).toBe(request)
  })

  it('leaves request undefined for non-HTTP contexts', async () => {
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext
    const next: CallHandler = { handle: () => of(getODataRequestContext()) }
    const result = (await lastValueFrom(
      new ODataRequestContextInterceptor().intercept(context, next),
    )) as { request: unknown }
    expect(result.request).toBeUndefined()
  })

  it('ODataModule.forRoot() registers the interceptor globally', async () => {
    @Controller('plain')
    class PlainController {
      @Get()
      async read() {
        await Promise.resolve()
        const req = getODataRequestContext()?.request as { url?: string } | undefined
        return { url: req?.url }
      }
    }
    @Module({ controllers: [PlainController] })
    class PlainModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [ODataModule.forRoot({ serviceRoot: '/odata' }), PlainModule],
    }).compile()
    const app: INestApplication = moduleRef.createNestApplication()
    await app.init()
    const server = app.getHttpServer() as import('http').Server
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const { port } = server.address() as { port: number }
    const body = (await (await fetch(`http://127.0.0.1:${port}/plain`)).json()) as { url: string }
    expect(body.url).toBe('/plain')
    await app.close()
  })
})
