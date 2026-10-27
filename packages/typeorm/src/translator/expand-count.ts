import { Brackets, type ObjectLiteral, type SelectQueryBuilder } from 'typeorm'
import { entitiesAt } from './expand-pagination.js'

/**
 * The count query of a `$count=true` or `nav/$count` expand item (OData 4.01 P1 §11.2.6.5).
 * Built by `TypeOrmExpandVisitor`; run by {@link applyExpandCounts} after the main query.
 */
export interface ExpandCountQuery {
  /** Expand path of the counted navigation property (`items`, `stores/items`). */
  readonly path: readonly string[]
  /** Alias of the parent entity in {@link qb}. */
  readonly alias: string
  /** Primary-key properties of the parent entity, selected as `odata_key0`, `odata_key1`, ... */
  readonly keyProperties: readonly string[]
  /**
   * `SELECT <parent key>, COUNT(*) AS odata_count FROM <parent> INNER JOIN <related rows>
   * GROUP BY <parent key>`, the related rows restricted by scope, nested $filter and $search.
   */
  readonly qb: SelectQueryBuilder<ObjectLiteral>
}

const keyOf = (values: readonly unknown[]): string => JSON.stringify(values.map((v) => String(v)))

/**
 * Run the expand count queries and annotate each parent entity with `<nav>@odata.count`
 * (0 when it has no related rows). Mutates the entities in place.
 */
export async function applyExpandCounts(
  items: readonly ObjectLiteral[],
  counts: readonly ExpandCountQuery[],
): Promise<void> {
  for (const count of counts) {
    const navigation = count.path[count.path.length - 1]
    const parents = entitiesAt(items, count.path.slice(0, -1))
    if (parents.length === 0) continue

    const { qb, alias, keyProperties } = count
    if (keyProperties.length === 1) {
      const [key] = keyProperties
      qb.andWhere(`${alias}.${key} IN (:...odata_count_keys)`, {
        odata_count_keys: parents.map((p) => p[key] as unknown),
      })
    } else {
      qb.andWhere(
        new Brackets((where) => {
          parents.forEach((parent, i) => {
            const params: Record<string, unknown> = {}
            const sql = keyProperties
              .map((key, k) => {
                params[`odata_count_k${i}_${k}`] = parent[key]
                return `${alias}.${key} = :odata_count_k${i}_${k}`
              })
              .join(' AND ')
            where.orWhere(`(${sql})`, params)
          })
        }),
      )
    }

    const rows = await qb.getRawMany<Record<string, unknown>>()
    const byKey = new Map<string, number>()
    for (const row of rows) {
      byKey.set(keyOf(keyProperties.map((_, k) => row[`odata_key${k}`])), Number(row.odata_count))
    }
    for (const parent of parents) {
      parent[`${navigation}@odata.count`] =
        byKey.get(keyOf(keyProperties.map((key): unknown => parent[key]))) ?? 0
    }
  }
}
