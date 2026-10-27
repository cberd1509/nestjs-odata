/**
 * Map the canonical URL of an entity, `{serviceRoot}/{EntitySet}({key})` (OData-URL 4.01
 * §4.3.1), to the key-as-segment form `{serviceRoot}/{EntitySet}/{key}` that the OData route
 * decorators (`@ODataGetByKey`, `@ODataPatch`, `@ODataPut`, `@ODataDelete`) are registered on.
 *
 * Nest joins a controller path and a method path with `/`, so a route cannot be declared as
 * `Products(:key)`; `ODataModule` rewrites the request URL before routing instead. The key text
 * is kept as sent (still percent-encoded), so `@Param('key')` receives the same value for both
 * forms: `1`, `'abc'`, `orderId=1,itemId=2`. Path segments after the key and the query string
 * are kept.
 *
 * Only the segment right after the service root is rewritten, and only when its name is an
 * entity set (`isEntitySet`). Returns `undefined` when the URL is not such a canonical URL.
 */
export function rewriteCanonicalKeyUrl(
  url: string,
  serviceRoot: string,
  isEntitySet: (name: string) => boolean,
): string | undefined {
  const root = serviceRoot.replace(/^\/+|\/+$/g, '')
  if (!root || !url.includes('(')) return undefined
  const q = url.indexOf('?')
  const path = q === -1 ? url : url.slice(0, q)
  const query = q === -1 ? '' : url.slice(q)
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^(.*/${escapedRoot})/([^/()]+)\\(([^/]+)\\)(/.*)?$`).exec(path)
  if (!match) return undefined
  const [, prefix, entitySet, key, rest] = match
  if (!entitySet || !key || !isEntitySet(entitySet)) return undefined
  return `${prefix}/${entitySet}/${key}${rest ?? ''}${query}`
}
