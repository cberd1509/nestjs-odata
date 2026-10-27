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
  const root = trimSlashes(serviceRoot)
  if (!root || !url.includes('(')) return undefined
  const q = url.indexOf('?')
  const path = q === -1 ? url : url.slice(0, q)
  const query = q === -1 ? '' : url.slice(q)
  // Plain string scanning (no regular expressions): the URL is untrusted input.
  const marker = `/${root}/`
  for (
    let at = path.lastIndexOf(marker);
    at !== -1;
    at = at === 0 ? -1 : path.lastIndexOf(marker, at - 1)
  ) {
    const prefix = path.slice(0, at + marker.length - 1)
    const tail = path.slice(at + marker.length)
    const slash = tail.indexOf('/')
    const segment = slash === -1 ? tail : tail.slice(0, slash)
    const rest = slash === -1 ? '' : tail.slice(slash)
    const open = segment.indexOf('(')
    if (open <= 0 || !segment.endsWith(')') || segment.length - open < 3) continue
    const entitySet = segment.slice(0, open)
    if (entitySet.includes(')') || !isEntitySet(entitySet)) continue
    return `${prefix}/${entitySet}/${segment.slice(open + 1, -1)}${rest}${query}`
  }
  return undefined
}

/**
 * Split a resource path segment into its name and key predicate: `Products(1)` gives
 * `{ name: 'Products', key: '1' }`, `Products` gives `{ name: 'Products' }`. Plain string
 * scanning (the segment is untrusted input).
 */
export function splitKeyPredicate(segment: string): { name: string; key?: string } {
  const open = segment.indexOf('(')
  if (open === -1) return { name: segment }
  const close = segment.endsWith(')') ? segment.length - 1 : segment.length
  return { name: segment.slice(0, open), key: segment.slice(open + 1, close) }
}

function trimSlashes(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === '/') start++
  while (end > start && value[end - 1] === '/') end--
  return value.slice(start, end)
}
