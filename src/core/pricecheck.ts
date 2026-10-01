// Fluxo completo da checagem de preço. Recebe as dependências por parâmetro
// (injeção), então funciona no Electron hoje e num servidor amanhã, e pode
// ser testado sem internet.

import { ApiError, type ApiErrorCode } from './http/client'
import { ItemParseError, parseItemText, type ItemParseErrorCode, type ParsedItem } from './item/parser'
import type { MatchedStat, StatIndex } from './item/statMatcher'
import { tierOf, tiersFor, type TierOption, type TierTable } from './item/tiers'
import { buildPriceIndex, median, toDivine } from './money'
import type { Listing, SearchResult } from './sources/trade'
import {
  applyOverrides,
  buildTradeQuery,
  defaultFilters,
  resolveBaseType,
  type FilterOverride,
  type ListingStatus,
  type StatFilter,
  type TradeQuery,
} from './trade/query'
import { mergeFilters, readFilters, type FilterValue } from './trade/manual'
import type { CurrencyRates, MarketItem, MarketSnapshot } from './types'

/** Quantas listagens buscar para calcular preços (a API entrega 10 por chamada). */
export const LISTINGS_TO_FETCH = 10

export interface ItemSummary {
  name: string | null
  baseLine: string
  baseType: string | null
  rarity: string
  itemClass: string
  itemLevel: number | null
  corrupted: boolean
  stackSize: number | null
}

export interface PricedListing extends Listing {
  divine: number | null
}

export type PriceCheckErrorCode = ItemParseErrorCode | ApiErrorCode | 'unknown-base-type' | 'unexpected'

export type PriceCheckResult =
  | {
      kind: 'market'
      item: ItemSummary
      market: MarketItem
      rates: CurrencyRates
    }
  | {
      kind: 'trade'
      item: ItemSummary
      league: string
      filters: StatFilter[]
      /** Filtros do site aplicados na busca (Type, Misc...), para a interface mostrar e editar. */
      siteFilters: Record<string, Record<string, FilterValue>>
      /** Status usado na busca (online, securable...). */
      status: string
      /** Linhas do item que não correspondem a nenhum filtro da trade. */
      unmatched: string[]
      queryId: string
      total: number
      listings: PricedListing[]
      cheapestDivine: number | null
      medianDivine: number | null
      rates: CurrencyRates
    }
  | {
      kind: 'error'
      code: PriceCheckErrorCode
      retryAfterSec: number | null
    }

export interface TierContext {
  table: TierTable
  baseTags: Readonly<Record<string, readonly string[]>>
}

export interface PriceCheckDeps {
  snapshot(): Promise<MarketSnapshot>
  statIndex(): Promise<StatIndex>
  baseTypes(): Promise<readonly string[]>
  search(league: string, query: TradeQuery): Promise<SearchResult>
  fetchListings(queryId: string, ids: readonly string[]): Promise<Listing[]>
  /** Opcional: dados de tier. Se falhar, a checagem segue sem tiers. */
  tiers?(): Promise<TierContext | null>
}

async function attachTiers(
  filters: StatFilter[],
  matched: readonly MatchedStat[],
  baseType: string,
  load: () => Promise<TierContext | null>,
): Promise<StatFilter[]> {
  let context: TierContext | null = null
  try {
    context = await load()
  } catch {
    return filters
  }
  const tags = context?.baseTags[baseType]
  if (!context || !tags) return filters
  const valuesById = new Map(matched.map((m) => [m.stat.id, m.mod.values]))
  return filters.map((f) => {
    const tiers = tiersFor(context.table, f.statId, tags)
    if (tiers.length === 0) return f
    return { ...f, tiers, rolledTier: tierOf(tiers, valuesById.get(f.statId) ?? []) }
  })
}

/**
 * Todos os mods que podem aparecer numa base, com os tiers de cada um.
 * A tela de busca usa isso para só oferecer mods possíveis naquela base.
 */
export function allTiersForBase(context: TierContext, baseType: string): Record<string, TierOption[]> {
  const tags = context.baseTags[baseType]
  const out: Record<string, TierOption[]> = {}
  if (!tags) return out
  for (const statId of context.table.keys()) {
    const tiers = tiersFor(context.table, statId, tags)
    if (tiers.length > 0) out[statId] = tiers
  }
  return out
}

/** Tiers de vários stats para um tipo base (usado na tela "Buscar preço"). */
export function tiersForBase(context: TierContext, baseType: string, statIds: readonly string[]): Record<string, TierOption[]> {
  const tags = context.baseTags[baseType]
  const out: Record<string, TierOption[]> = {}
  if (!tags) return out
  for (const id of statIds) {
    const tiers = tiersFor(context.table, id, tags)
    if (tiers.length > 0) out[id] = tiers
  }
  return out
}

export interface PriceCheckOptions {
  league: string
  status: ListingStatus
  minModPercent: number
  /** Ajustes feitos pelo usuário na sobreposição ("Buscar de novo"). */
  overrides?: readonly FilterOverride[]
  /** Filtros do site editados na sobreposição (valem por cima dos padrões). */
  siteFilters?: Record<string, Record<string, FilterValue>>
  statusOverride?: string | null
}

function summarize(item: ParsedItem, baseType: string | null): ItemSummary {
  return {
    name: item.name,
    baseLine: item.baseLine,
    baseType,
    rarity: item.rarity,
    itemClass: item.itemClass,
    itemLevel: item.itemLevel,
    corrupted: item.corrupted,
    stackSize: item.stackSize,
  }
}

/** Itens que o poe.ninja precifica (currency, runas, essências...) são achados pelo nome. */
function findMarketItem(item: ParsedItem, snapshot: MarketSnapshot): MarketItem | null {
  if (item.rarity === 'Rare' || item.rarity === 'Unique' || item.rarity === 'Magic') return null
  const wanted = item.baseLine.toLowerCase()
  return snapshot.items.find((m) => m.name.toLowerCase() === wanted) ?? null
}

function errorResult(error: unknown): PriceCheckResult {
  if (error instanceof ItemParseError) return { kind: 'error', code: error.code, retryAfterSec: null }
  if (error instanceof ApiError) return { kind: 'error', code: error.code, retryAfterSec: error.retryAfterSec }
  return { kind: 'error', code: 'unexpected', retryAfterSec: null }
}

export async function priceCheck(text: string, options: PriceCheckOptions, deps: PriceCheckDeps): Promise<PriceCheckResult> {
  try {
    const item = parseItemText(text)
    const snapshot = await deps.snapshot()

    const market = findMarketItem(item, snapshot)
    if (market) {
      return { kind: 'market', item: summarize(item, item.baseLine), market, rates: snapshot.rates }
    }

    const [index, baseTypes] = await Promise.all([deps.statIndex(), deps.baseTypes()])
    const baseType = resolveBaseType(item, baseTypes)
    if (!baseType && item.rarity !== 'Unique') {
      return { kind: 'error', code: 'unknown-base-type', retryAfterSec: null }
    }

    const { matched, unmatched } = index.matchItem(item)
    let filters = defaultFilters(item, matched, options.minModPercent)
    if (options.overrides) filters = applyOverrides(filters, options.overrides)
    if (deps.tiers && baseType && item.rarity !== 'Unique') {
      filters = await attachTiers(filters, matched, baseType, deps.tiers)
    }

    const status = (options.statusOverride ?? options.status) as ListingStatus
    const query = buildTradeQuery(item, baseType, filters, status)
    mergeFilters(query.query, options.siteFilters)
    const priced = await searchAndPrice(options.league, query, snapshot, deps)

    return {
      kind: 'trade',
      item: summarize(item, baseType),
      league: options.league,
      filters,
      siteFilters: readFilters(query.query),
      status,
      // Em únicos, o que sobra é texto de ambientação, não mod.
      unmatched:
        item.rarity === 'Unique'
          ? []
          : unmatched.filter((m) => m.kind === 'explicit' || m.kind === 'implicit').map((m) => m.text),
      ...priced,
    }
  } catch (error) {
    return errorResult(error)
  }
}

export interface PricedSearch {
  queryId: string
  total: number
  listings: PricedListing[]
  cheapestDivine: number | null
  medianDivine: number | null
  rates: CurrencyRates
}

/** Executa a busca, pega os primeiros anúncios e converte os preços para Divine. */
export async function searchAndPrice(
  league: string,
  query: TradeQuery,
  snapshot: MarketSnapshot,
  deps: Pick<PriceCheckDeps, 'search' | 'fetchListings'>,
): Promise<PricedSearch> {
  const search = await deps.search(league, query)
  const listings = search.result.length > 0 ? await deps.fetchListings(search.id, search.result.slice(0, LISTINGS_TO_FETCH)) : []
  const priceIndex = buildPriceIndex(snapshot.items)
  const priced: PricedListing[] = listings.map((l) => ({
    ...l,
    divine: l.amount !== null && l.currency !== null ? toDivine(l.amount, l.currency, priceIndex) : null,
  }))
  const values = priced.map((l) => l.divine).filter((v): v is number => v !== null)
  return {
    queryId: search.id,
    total: search.total,
    listings: priced,
    cheapestDivine: values.length > 0 ? Math.min(...values) : null,
    medianDivine: median(values),
    rates: snapshot.rates,
  }
}

export { errorResult as toPriceCheckError }
