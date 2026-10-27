/**
 * Options of the `$batch` endpoint, set with `ODataTypeOrmModule.forRoot({ batch })`.
 *
 * Every operation of a batch runs through its own route (guards, interceptors, pipes, filters),
 * so the route's authorization applies. These options restrict the endpoint further.
 */
export interface ODataBatchOptions {
  /**
   * Serve `POST {serviceRoot}/$batch`. Default: true. When false, the endpoint answers
   * 404 Not Found.
   */
  readonly enabled?: boolean
  /**
   * Entity sets the operations of a batch may target. When set, an operation on any other
   * entity set (or any other resource, such as `$metadata`) answers 403 Forbidden without
   * reaching its route; inside a changeset that fails the whole changeset. Default: every
   * entity set.
   */
  readonly entitySets?: readonly string[]
  /**
   * Milliseconds one operation may take before it is answered with 504 Gateway Timeout; inside
   * a changeset that fails and rolls back the changeset, so a stuck route (or a query blocked
   * behind the changeset's own row locks) cannot hold the transaction forever. The route itself
   * is not cancelled. Default: 30 000. `0` disables the limit.
   */
  readonly operationTimeout?: number
}

/** DI token of the {@link ODataBatchOptions}, provided by `ODataTypeOrmModule.forRoot()`. */
export const ODATA_BATCH_OPTIONS = Symbol('ODATA_BATCH_OPTIONS')
