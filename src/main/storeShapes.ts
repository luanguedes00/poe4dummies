// Formato de cada dado guardado no disco. Arquivo mexido, corrompido ou de
// uma versão antiga do app não passa: nesse caso o app baixa de novo.

import { z } from 'zod'
import type { StatEntry } from '../core/item/statMatcher'
import type { TopTablets } from '../core/farm/market'
import type { TabletMod } from '../core/farm/regex'
import type { TabletPrice, UniqueInfo } from '../core/sources/ninja'
import type { FilterGroupDef, ItemCatalog } from '../core/sources/trade'
import type { League, MarketSnapshot } from '../core/types'

const num = z.number().refine(Number.isFinite)
const iconUrl = z.string().startsWith('https://').nullable()

const leagues = z.array(z.object({ id: z.string(), label: z.string(), hardcore: z.boolean() })).min(1)
const stats = z.array(z.object({ id: z.string(), text: z.string(), group: z.string() })).min(1)
const catalog = z.object({
  bases: z.array(z.object({ type: z.string(), category: z.string() })).min(1),
  uniques: z.array(z.object({ name: z.string(), type: z.string(), category: z.string() })),
})
const filters = z.array(z.object({ id: z.string(), title: z.string(), hidden: z.boolean(), filters: z.array(z.object({ id: z.string(), text: z.string() }).passthrough()) }))
const uniques = z.array(z.tuple([z.string(), z.object({ iconUrl, valueDivine: num.nullable() })]))
const tablets = z.array(
  z.object({ name: z.string(), baseType: z.string(), variant: z.string().nullable(), unique: z.boolean(), iconUrl, valueDivine: num, change7d: num.nullable(), listings: num.nullable() }),
)
const snapshot = z.object({
  league: z.string(),
  fetchedAt: z.string(),
  rates: z.object({ exaltedPerDivine: num, chaosPerDivine: num }),
  items: z.array(
    z
      .object({ id: z.string(), detailsId: z.string(), name: z.string(), category: z.string(), iconUrl, valueDivine: num, volumeDivine: num, change7d: num.nullable(), sparkline: z.array(num) })
      .passthrough(),
  ),
})

const guard =
  <T>(schema: z.ZodType) =>
  (v: unknown): v is T =>
    schema.safeParse(v).success

export const isLeagues = guard<League[]>(leagues)
export const isStatEntries = guard<StatEntry[]>(stats)
export const isItemCatalog = guard<ItemCatalog>(catalog)
export const isFilterGroups = guard<FilterGroupDef[]>(filters)
export const isUniqueEntries = guard<Array<[string, UniqueInfo]>>(uniques)
export const isTablets = guard<TabletPrice[]>(tablets)
export const isSnapshot =
  (league: string) =>
  (v: unknown): v is MarketSnapshot =>
    snapshot.safeParse(v).success && (v as MarketSnapshot).league === league

const topTablets = z.object({
  baseType: z.string(),
  sample: z.number(),
  lowDivine: num.nullable(),
  highDivine: num.nullable(),
  mods: z.array(z.object({ text: z.string(), count: z.number() })),
})
export const isTopTablets = guard<TopTablets>(topTablets)

const tabletMods = z
  .array(z.object({ key: z.string(), text: z.string(), min: num.nullable(), max: num.nullable(), types: z.array(z.string()), affix: z.enum(['prefix', 'suffix']).nullable() }))
  .min(1)
export const isTabletMods = guard<TabletMod[]>(tabletMods)

/** Nome de liga → pedaço seguro de nome de arquivo. */
export function slug(league: string): string {
  return league.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60) || 'liga'
}
