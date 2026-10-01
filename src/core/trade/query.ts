// Monta a busca da API oficial de trade a partir de um item lido do jogo.

import type { Affix, ModKind, ParsedItem } from '../item/parser'
import type { MatchedStat } from '../item/statMatcher'
import type { TierOption } from '../item/tiers'
import { smartFilters } from './importance'

export type ListingStatus = 'online' | 'securable' | 'any'

export interface StatFilter {
  statId: string
  /** Texto do stat na trade, ex.: "# to maximum Life". */
  statText: string
  /** Linha como aparece no item, ex.: "+78 to maximum Life". */
  modText: string
  /** "pseudo": linha somada pela trade (ex.: resistência elemental total). */
  kind: ModKind | 'pseudo' | 'property'
  affix: Affix | null
  tier: number | null
  value: number | null
  min: number | null
  max: number | null
  enabled: boolean
  /** Tiers possíveis deste mod nesta base (T1 = melhor), quando os dados estão disponíveis. */
  tiers?: TierOption[]
  /** Tier do valor rolado no item. */
  rolledTier?: number | null
  /** Faz parte de uma linha total (id do pseudo): aparece recolhida embaixo dela. */
  group?: string
}

/** O que a interface pode mudar num filtro antes de buscar de novo. */
export interface FilterOverride {
  statId: string
  enabled: boolean
  min: number | null
  max: number | null
}

const ENABLED_BY_DEFAULT: ReadonlySet<ModKind> = new Set<ModKind>(['explicit', 'fractured', 'desecrated'])

/** Arredonda para baixo mantendo a precisão do valor original (inteiro → inteiro). */
function scaledMin(value: number, ratio: number): number {
  const scaled = value * ratio
  return Number.isInteger(value) ? Math.floor(scaled) : Math.floor(scaled * 10) / 10
}

/**
 * Filtros iniciais: mods explícitos ligados, com mínimo em `minPercent`% do
 * valor rolado. Implícitos, runas e encantamentos começam desligados. Em
 * itens únicos tudo começa desligado, porque a busca já é pelo nome.
 */
export function defaultFilters(item: ParsedItem, matched: readonly MatchedStat[], minPercent: number, smart = true): StatFilter[] {
  const isUnique = item.rarity === 'Unique'
  const ratio = Math.min(Math.max(minPercent, 0), 100) / 100
  const seen = new Set<string>()
  const filters: StatFilter[] = []
  for (const { mod, stat, value } of matched) {
    // A trade não aceita o mesmo stat duas vezes na mesma busca.
    if (seen.has(stat.id)) continue
    seen.add(stat.id)
    let min: number | null = null
    let max: number | null = null
    if (value !== null && value > 0) min = scaledMin(value, ratio)
    else if (value !== null && value < 0) max = value
    filters.push({
      statId: stat.id,
      statText: stat.text,
      modText: mod.text,
      kind: mod.kind,
      affix: mod.affix,
      tier: mod.tier,
      value,
      min,
      max,
      enabled: !isUnique && ENABLED_BY_DEFAULT.has(mod.kind),
    })
  }
  // `smart`: seleção como o Exiled Exchange 2 (mods de peso, resistência total). A busca de item da build usa os mods crus.
  return smart ? smartFilters(filters, ratio, item) : filters
}

export function applyOverrides(filters: readonly StatFilter[], overrides: readonly FilterOverride[]): StatFilter[] {
  const byId = new Map(overrides.map((o) => [o.statId, o]))
  return filters.map((f) => {
    const o = byId.get(f.statId)
    return o ? { ...f, enabled: o.enabled, min: o.min, max: o.max } : f
  })
}

/**
 * Descobre o tipo base. Itens mágicos e normais trazem afixos no nome
 * ("Hale Sapphire Ring of the Prism"), então procuramos o maior tipo base
 * conhecido contido na linha.
 */
export function resolveBaseType(item: ParsedItem, knownBaseTypes: readonly string[]): string | null {
  if (item.name !== null || item.unidentified) return item.baseLine
  const line = item.baseLine
  let best: string | null = null
  for (const base of knownBaseTypes) {
    if (base.length <= (best?.length ?? 0)) continue
    const index = line.indexOf(base)
    if (index === -1) continue
    const before = index === 0 ? ' ' : line[index - 1]
    const after = index + base.length === line.length ? ' ' : line[index + base.length]
    if (before === ' ' && after === ' ') best = base
  }
  return best
}

export interface TradeQuery {
  query: {
    status: { option: ListingStatus }
    name?: string
    type?: string
    stats: Array<{
      type: 'and'
      filters: Array<{ id: string; value: { min?: number; max?: number }; disabled: boolean }>
    }>
    filters?: Record<string, { filters: Record<string, unknown> }>
  }
  sort: { price: 'asc' }
}

export function buildTradeQuery(
  item: ParsedItem,
  baseType: string | null,
  filters: readonly StatFilter[],
  status: ListingStatus,
): TradeQuery {
  const statFilters = filters
    .filter((f) => f.enabled && f.kind !== 'property')
    .map((f) => {
      const value: { min?: number; max?: number } = {}
      if (f.min !== null) value.min = f.min
      if (f.max !== null) value.max = f.max
      return { id: f.statId, value, disabled: false }
    })

  const query: TradeQuery['query'] = {
    status: { option: status },
    stats: [{ type: 'and', filters: statFilters }],
  }
  if (baseType) query.type = baseType

  if (item.rarity === 'Unique' && item.name) {
    query.name = item.name
    query.filters = { type_filters: { filters: { rarity: { option: 'unique' } } } }
  } else if (item.rarity === 'Rare' || item.rarity === 'Magic' || item.rarity === 'Normal') {
    query.filters = { type_filters: { filters: { rarity: { option: 'nonunique' } } } }
  }
  if (item.corrupted) {
    query.filters = {
      ...query.filters,
      misc_filters: { filters: { corrupted: { option: 'true' } } },
    }
  }
  // Defesa/DPS da base vão nos filtros "Equipment" da trade (ar, ev, es, dps).
  const equipment: Record<string, { min?: number; max?: number }> = {}
  for (const f of filters) {
    if (!f.enabled || f.kind !== 'property') continue
    const range: { min?: number; max?: number } = {}
    if (f.min !== null) range.min = f.min
    if (f.max !== null) range.max = f.max
    equipment[f.statId.slice('equip.'.length)] = range
  }
  if (Object.keys(equipment).length > 0) query.filters = { ...query.filters, equipment_filters: { filters: equipment } }
  return { query, sort: { price: 'asc' } }
}
