/**
 * Internal signal: answer the current OData route with an empty response of `status`.
 *
 * Nest always sends a route's result with the route's static status (`@HttpCode`, else 200/201),
 * so an interceptor cannot change the status of a successful result. The response interceptor
 * throws this signal instead, after setting the response headers, and `ODataExceptionFilter`
 * (applied by every OData route decorator) answers it with `status` and no body:
 *
 *   - 304 Not Modified for a GET whose `If-None-Match` matches (OData-Protocol 4.01 §8.2.5)
 *   - 204 No Content for a write with `Prefer: return=minimal` (§8.2.8.7)
 *
 * It is not an error: the exception filter never logs it nor hands it to the `errorMapper`.
 */
export class ODataEmptyResponse extends Error {
  constructor(readonly status: 204 | 304) {
    super(`OData empty response (${status})`)
    this.name = 'ODataEmptyResponse'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
