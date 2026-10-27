import { AsyncLocalStorage } from 'node:async_hooks'
import { Injectable } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'

/**
 * The request an OData operation runs for.
 *
 * Adapters read it to hand application hooks (for example the TypeORM adapter's row-level
 * scopes) the Nest `ExecutionContext` and the underlying request object, without the hooks
 * having to be request-scoped providers.
 */
export interface ODataRequestContext {
  /** The Nest execution context of the route being handled (the `$batch` route for batch parts). */
  readonly executionContext?: ExecutionContext
  /** The platform request object (Express or Fastify request) when the route is HTTP. */
  readonly request?: unknown
}

const storage = new AsyncLocalStorage<ODataRequestContext>()

/**
 * Returns the request context of the OData operation currently running, or `undefined` when
 * code runs outside a request (a job, a script, a test calling a handler directly).
 */
export function getODataRequestContext(): ODataRequestContext | undefined {
  return storage.getStore()
}

/**
 * Runs `fn` with `context` as the current OData request context.
 *
 * `ODataModule.forRoot()` already does this for every route through
 * {@link ODataRequestContextInterceptor}; call it yourself when invoking OData handlers outside
 * an HTTP request, for example from a queue worker that must apply the same row scopes.
 */
export function runWithODataRequestContext<T>(context: ODataRequestContext, fn: () => T): T {
  return storage.run(context, fn)
}

/**
 * Global interceptor, registered by `ODataModule.forRoot()` / `forRootAsync()`, that makes the
 * current `ExecutionContext` and request available through {@link getODataRequestContext} for
 * the whole handler, including its asynchronous continuations.
 *
 * It runs after guards, so anything a guard attaches to the request (an authenticated user)
 * is visible to the hooks that read the context.
 */
@Injectable()
export class ODataRequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.getType() === 'http' ? context.switchToHttp().getRequest() : undefined
    return new Observable((subscriber) =>
      storage.run({ executionContext: context, request }, () =>
        next.handle().subscribe(subscriber),
      ),
    )
  }
}
