/**
 * The `return` preference to apply to a data modification request (OData-Protocol 4.01
 * §8.2.8.7): `'minimal'` (answer 204 No Content), `'representation'` (answer with the entity),
 * or `undefined` when the client expressed none.
 *
 * `$select` or `$expand` on the request imply `return=representation` (§11.4.1.5), so a
 * `return=minimal` request carrying them gets `'representation'`.
 *
 * Used by `ODataResponseInterceptor` and by the TypeORM adapter's `$batch` for its parts.
 */
export function resolveReturnPreference(
  prefer: string | readonly string[] | undefined,
  url: string | undefined,
): 'minimal' | 'representation' | undefined {
  if (!prefer) return undefined
  const values = typeof prefer === 'string' ? [prefer] : prefer
  let requested: 'minimal' | 'representation' | undefined
  for (const value of values) {
    for (const token of value.split(',')) {
      const [name, val] = token
        .split(';')[0]
        .split('=')
        .map((s) => s.trim().toLowerCase())
      if (name === 'return' && (val === 'minimal' || val === 'representation')) requested = val
    }
  }
  if (requested === 'minimal' && url && selectsOrExpands(url)) return 'representation'
  return requested
}

/** True when the URL's query string has a `$select` or `$expand` system query option. */
function selectsOrExpands(url: string): boolean {
  const q = url.indexOf('?')
  if (q === -1) return false
  return url
    .slice(q + 1)
    .split('&')
    .some((part) => {
      const name = safeDecode(part.split('=')[0] ?? '')
      return name === '$select' || name === '$expand'
    })
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
