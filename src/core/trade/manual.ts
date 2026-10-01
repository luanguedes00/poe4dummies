// Busca montada pelo usuário na tela "Buscar preço", no mesmo formato do
// site oficial: item, filtros por grupo (Type, Equipment, Requirements...) e
// grupos de mods (AND, NOT, COUNT...).

import type { ListingStatus, TradeQuery } from './query'

export interface ManualStatFilter {
  id: string
  min: number | null
  max: number | null
}

export const STAT_GROUP_TYPES = ['and', 'not', 'if', 'count', 'weight'] as const
export type StatGroupType = (typeof STAT_GROUP_TYPES)[number]

export interface ManualStatGroup {
  type: StatGroupType
  /** Para COUNT e WEIGHT: quantos/quanto precisa bater. */
  min: number | null
  max: number | null
  filters: ManualStatFilter[]
}

/** Valor de um filtro do site: faixa, opção de select e/ou texto livre. */
export interface FilterValue {
  min?: number | null
  max?: number | null
  option?: string | null
  input?: string | null
}

export interface ManualSearch {
  /** Nome de item único (ex.: "Headhunter"). */
  name: string | null
  /** Tipo base (ex.: "Sapphire Ring"). */
  type: string | null
  /** Mods que precisam estar TODOS no item (grupo AND principal). */
  stats: ManualStatFilter[]
  /** Grupos extras de mods (NOT, COUNT, IF, WEIGHT...). */
  statGroups?: ManualStatGroup[]
  /** Filtros por grupo, ex.: { type_filters: { rarity: { option: 'rare' } } }. */
  filters?: Record<string, Record<string, FilterValue>>
  /** Sobrescreve o status padrão das configurações (online, securable...). */
  status?: string | null
}

function statValue(s: { min: number | null; max: number | null }): { min?: number; max?: number } {
  const value: { min?: number; max?: number } = {}
  if (s.min !== null) value.min = s.min
  if (s.max !== null) value.max = s.max
  return value
}

export function hasContent(v: FilterValue): boolean {
  return (
    (v.min !== null && v.min !== undefined) ||
    (v.max !== null && v.max !== undefined) ||
    (v.option !== null && v.option !== undefined) ||
    (typeof v.input === 'string' && v.input.trim() !== '')
  )
}

function filterJson(v: FilterValue): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (v.min !== null && v.min !== undefined) out.min = v.min
  if (v.max !== null && v.max !== undefined) out.max = v.max
  if (v.option !== null && v.option !== undefined) out.option = v.option
  if (typeof v.input === 'string' && v.input.trim() !== '') out.input = v.input.trim()
  return out
}

export function buildManualQuery(search: ManualSearch, defaultStatus: ListingStatus): TradeQuery {
  const status = (search.status ?? defaultStatus) as ListingStatus
  const query: TradeQuery['query'] = {
    status: { option: status },
    stats: [{ type: 'and', filters: search.stats.map((s) => ({ id: s.id, value: statValue(s), disabled: false })) }],
  }
  for (const group of search.statGroups ?? []) {
    if (group.filters.length === 0) continue
    const entry = {
      type: group.type,
      filters: group.filters.map((s) => ({ id: s.id, value: statValue(s), disabled: false })),
      ...(group.type === 'count' || group.type === 'weight' ? { value: statValue(group) } : {}),
    }
    query.stats.push(entry as TradeQuery['query']['stats'][number])
  }
  if (search.name) query.name = search.name
  if (search.type) query.type = search.type

  if (search.name) query.filters = { type_filters: { filters: { rarity: { option: 'unique' } } } }
  mergeFilters(query, search.filters)
  return { query, sort: { price: 'asc' } }
}

/**
 * Aplica filtros do site por cima dos que a query já tem (o valor do usuário
 * vence). Filtros vazios removem o padrão correspondente, como no site.
 */
export function mergeFilters(query: TradeQuery['query'], extra: Record<string, Record<string, FilterValue>> | undefined): void {
  if (!extra) return
  const filters: NonNullable<TradeQuery['query']['filters']> = { ...(query.filters ?? {}) }
  for (const [groupId, values] of Object.entries(extra)) {
    if (groupId === 'status_filters') continue
    const current: Record<string, unknown> = { ...(filters[groupId]?.filters ?? {}) }
    for (const [id, v] of Object.entries(values)) {
      if (hasContent(v)) current[id] = filterJson(v)
      else delete current[id]
    }
    if (Object.keys(current).length > 0) filters[groupId] = { filters: current }
    else delete filters[groupId]
  }
  if (Object.keys(filters).length > 0) query.filters = filters
  else delete query.filters
}

/** Lê os filtros que uma query já tem, no formato editável da interface. */
export function readFilters(query: TradeQuery['query']): Record<string, Record<string, FilterValue>> {
  const out: Record<string, Record<string, FilterValue>> = {}
  for (const [groupId, group] of Object.entries(query.filters ?? {})) {
    for (const [id, raw] of Object.entries(group.filters)) {
      const v = raw as FilterValue
      out[groupId] ??= {}
      out[groupId][id] = { min: v.min ?? null, max: v.max ?? null, option: v.option ?? null, input: v.input ?? null }
    }
  }
  return out
}

/** Uma busca precisa de algum critério, senão traria o mercado inteiro. */
export function isSearchable(search: ManualSearch): boolean {
  const anyFilter = Object.entries(search.filters ?? {}).some(
    ([group, values]) => group !== 'status_filters' && Object.values(values).some(hasContent),
  )
  const anyGroup = (search.statGroups ?? []).some((g) => g.filters.length > 0)
  return Boolean(search.name || search.type || search.stats.length > 0 || anyFilter || anyGroup)
}
