// Estado do modo lista (coleta): o usuário copia vários itens e vê o valor
// somado. Funções puras: recebem o estado e devolvem um novo, sem rede.
//
// - Itens de pilha achados no poe.ninja: preço na hora, sem busca ('priced').
//   Pilhas iguais são somadas numa linha só.
// - Únicos/raros: com preço no cache local → '≈valor' ('estimated') e
//   confirmação pela fila; sem cache → 'queued' / 'searching'.
// - Confirmação fora da margem (padrão 15%) → 'changed', para a interface avisar.

import { ItemParseError, parseItemText, type ItemParseErrorCode, type ParsedItem } from '../item/parser'
import { fromDivine } from '../money'
import type { PriceCheckErrorCode, PriceCheckResult } from '../pricecheck'
import type { CurrencyRates, DisplayCurrency, MarketItem, MarketSnapshot } from '../types'
import { cacheKeyForItem, cacheKeyForResult, tradeValueDivine, type PriceCache, type RareKeyContext } from './priceCache'
import type { QueueProgress } from './queue'

/** Limite de linhas da lista (proteção de memória/IPC; pilhas iguais somam na mesma linha). */
export const MAX_COLLECTION_ENTRIES = 1000
/** Diferença relativa entre estimativa e confirmação que dispara o aviso. */
export const DEFAULT_CHANGE_MARGIN = 0.15
/** Preço do cache mais novo que isso é tratado como confirmado (sem nova busca). */
export const DEFAULT_FRESH_MS = 10 * 60 * 1000

export type EntryStatus = 'priced' | 'estimated' | 'queued' | 'searching' | 'changed' | 'error'
export type EntrySource = 'market' | 'cache' | 'trade'
export type EntryErrorCode = PriceCheckErrorCode | 'no-listings'

export interface CollectionEntry {
  id: string
  kind: 'stack' | 'trade'
  /** Chave de agrupamento e da fila: pilhas → "m|<id ninja>"; demais → hash do texto. */
  searchKey: string
  /** Chave do cache de preços (null quando não há como estimar). */
  cacheKey: string | null
  marketId: string | null
  name: string
  baseType: string | null
  rarity: string
  iconUrl: string | null
  corrupted: boolean
  quantity: number
  /** Valor por unidade, em Divine (null = ainda sem preço). */
  unitDivine: number | null
  /** Valor aproximado mostrado antes da confirmação. */
  estimateDivine: number | null
  /** Variação (%) entre estimativa e confirmação, quando 'changed'. */
  changePercent: number | null
  status: EntryStatus
  source: EntrySource | null
  errorCode: EntryErrorCode | null
  addedAt: number
}

export interface CollectionState {
  entries: readonly CollectionEntry[]
  /** Contador para ids estáveis. */
  seq: number
}

export function emptyCollection(): CollectionState {
  return { entries: [], seq: 0 }
}

const PENDING: ReadonlySet<EntryStatus> = new Set<EntryStatus>(['queued', 'searching', 'estimated'])

export function isPending(entry: CollectionEntry): boolean {
  return PENDING.has(entry.status)
}

// ---------------------------------------------------------------------------
// Adicionar
// ---------------------------------------------------------------------------

export interface AddContext {
  snapshot: MarketSnapshot | null
  cache: PriceCache | null
  league: string | null
  now: number
  /** Necessário para estimar raros pelo cache (sem ele, raros ficam 'queued'). */
  rareKey?: RareKeyContext | null
  freshMs?: number
}

export type AddOutcome =
  | { ok: false; code: ItemParseErrorCode | 'list-full' }
  | {
      ok: true
      state: CollectionState
      entry: CollectionEntry
      /** Somou numa pilha que já estava na lista. */
      merged: boolean
      /** O que mandar para a fila (null = já tem preço final). A fila une chaves repetidas. */
      search: { key: string; text: string } | null
    }

// Índice nome → item por snapshot (o snapshot é imutável; WeakMap evita refazer a cada Ctrl+C).
const marketIndexes = new WeakMap<MarketSnapshot, Map<string, MarketItem>>()

/** Mesma regra do priceCheck: não raro/único/mágico, achado pelo nome da base. */
export function findStackItem(item: ParsedItem, snapshot: MarketSnapshot): MarketItem | null {
  if (item.rarity === 'Rare' || item.rarity === 'Unique' || item.rarity === 'Magic') return null
  let index = marketIndexes.get(snapshot)
  if (!index) {
    index = new Map()
    for (const m of snapshot.items) {
      const key = m.name.toLowerCase()
      if (!index.has(key)) index.set(key, m)
    }
    marketIndexes.set(snapshot, index)
  }
  return index.get(item.baseLine.toLowerCase()) ?? null
}

/** Hash FNV-1a (32 bits) do texto normalizado: itens idênticos têm a mesma chave. */
export function textKey(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  let hash = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `t|${(hash >>> 0).toString(16).padStart(8, '0')}|${normalized.length}`
}

function moveToEnd(entries: readonly CollectionEntry[], updated: CollectionEntry): CollectionEntry[] {
  return [...entries.filter((e) => e.id !== updated.id), updated]
}

export function addItem(state: CollectionState, text: string, ctx: AddContext): AddOutcome {
  let item: ParsedItem
  try {
    item = parseItemText(text)
  } catch (error) {
    return { ok: false, code: error instanceof ItemParseError ? error.code : 'not-an-item' }
  }
  const quantity = item.stackSize !== null && item.stackSize > 0 ? item.stackSize : 1

  const market = ctx.snapshot ? findStackItem(item, ctx.snapshot) : null
  if (market) {
    const searchKey = `m|${market.id}`
    const existing = state.entries.find((e) => e.searchKey === searchKey)
    if (existing) {
      const entry: CollectionEntry = {
        ...existing,
        quantity: existing.quantity + quantity,
        unitDivine: market.valueDivine,
        status: 'priced',
        source: 'market',
        errorCode: null,
      }
      return { ok: true, state: { ...state, entries: moveToEnd(state.entries, entry) }, entry, merged: true, search: null }
    }
    if (state.entries.length >= MAX_COLLECTION_ENTRIES) return { ok: false, code: 'list-full' }
    const entry: CollectionEntry = {
      ...baseEntry(state, item, quantity, ctx.now),
      kind: 'stack',
      searchKey,
      marketId: market.id,
      name: market.name,
      iconUrl: market.iconUrl,
      unitDivine: market.valueDivine,
      status: 'priced',
      source: 'market',
    }
    return { ok: true, state: { entries: [...state.entries, entry], seq: state.seq + 1 }, entry, merged: false, search: null }
  }

  if (state.entries.length >= MAX_COLLECTION_ENTRIES) return { ok: false, code: 'list-full' }
  const cacheKey = ctx.league ? cacheKeyForItem(item, ctx.league, ctx.rareKey) : null
  const hit = cacheKey && ctx.cache ? ctx.cache.get(cacheKey) : null
  const fresh = hit !== null && ctx.now - hit.savedAt <= (ctx.freshMs ?? DEFAULT_FRESH_MS)
  const searchKey = textKey(text)
  const entry: CollectionEntry = {
    ...baseEntry(state, item, quantity, ctx.now),
    searchKey,
    cacheKey,
    unitDivine: hit?.valueDivine ?? null,
    estimateDivine: hit && !fresh ? hit.valueDivine : null,
    status: fresh ? 'priced' : hit ? 'estimated' : 'queued',
    source: hit ? 'cache' : null,
  }
  return {
    ok: true,
    state: { entries: [...state.entries, entry], seq: state.seq + 1 },
    entry,
    merged: false,
    search: fresh ? null : { key: searchKey, text },
  }
}

function baseEntry(state: CollectionState, item: ParsedItem, quantity: number, now: number): CollectionEntry {
  return {
    id: `e${state.seq + 1}`,
    kind: 'trade',
    searchKey: '',
    cacheKey: null,
    marketId: null,
    name: item.name ?? item.baseLine,
    baseType: item.name ? item.baseLine : null,
    rarity: item.rarity,
    iconUrl: null,
    corrupted: item.corrupted,
    quantity,
    unitDivine: null,
    estimateDivine: null,
    changePercent: null,
    status: 'queued',
    source: null,
    errorCode: null,
    addedAt: now,
  }
}

// ---------------------------------------------------------------------------
// Resultados da fila
// ---------------------------------------------------------------------------

/** A fila começou a buscar esta chave. */
export function markSearching(state: CollectionState, searchKey: string): CollectionState {
  if (!state.entries.some((e) => e.searchKey === searchKey && e.status === 'queued')) return state
  return {
    ...state,
    entries: state.entries.map((e) => (e.searchKey === searchKey && e.status === 'queued' ? { ...e, status: 'searching' } : e)),
  }
}

export interface ApplyContext {
  cache: PriceCache | null
  /** Margem relativa (0.15 = 15%). */
  margin?: number
}

export interface ApplyOutcome {
  state: CollectionState
  /** Linhas cujo valor confirmado ficou fora da margem (para notificar). */
  changed: CollectionEntry[]
}

/** Aplica o resultado da fila a todas as linhas pendentes com a mesma chave. */
export function applyResult(state: CollectionState, searchKey: string, result: PriceCheckResult, ctx: ApplyContext): ApplyOutcome {
  const margin = ctx.margin ?? DEFAULT_CHANGE_MARGIN
  const changed: CollectionEntry[] = []
  const target = (e: CollectionEntry) => e.searchKey === searchKey && isPending(e)
  if (!state.entries.some(target)) return { state, changed }

  let confirmedKey: string | null = null
  let confirmedValue: number | null = null
  if (result.kind === 'trade') {
    confirmedKey = cacheKeyForResult(result)
    confirmedValue = tradeValueDivine(result)
    if (confirmedKey && confirmedValue !== null) ctx.cache?.set(confirmedKey, confirmedValue)
  }

  const entries = state.entries.map((e): CollectionEntry => {
    if (!target(e)) {
      // Outro item parecido ainda sem estimativa ganha o valor recém-confirmado.
      if (confirmedKey && confirmedValue !== null && e.status === 'queued' && e.cacheKey === confirmedKey) {
        return { ...e, status: 'estimated', unitDivine: confirmedValue, estimateDivine: confirmedValue, source: 'cache' }
      }
      return e
    }
    if (result.kind === 'error') {
      return { ...e, status: 'error', errorCode: result.code }
    }
    if (result.kind === 'market') {
      return {
        ...e,
        kind: 'stack',
        marketId: result.market.id,
        name: result.market.name,
        iconUrl: result.market.iconUrl,
        unitDivine: result.market.valueDivine,
        estimateDivine: null,
        status: 'priced',
        source: 'market',
        errorCode: null,
      }
    }
    const base = { ...e, cacheKey: confirmedKey ?? e.cacheKey, source: 'trade' as const, errorCode: null }
    if (confirmedValue === null) {
      return { ...base, unitDivine: null, estimateDivine: null, status: 'error', errorCode: 'no-listings' }
    }
    const estimate = e.estimateDivine
    if (estimate !== null && estimate > 0 && Math.abs(confirmedValue - estimate) / estimate > margin) {
      const next: CollectionEntry = {
        ...base,
        unitDivine: confirmedValue,
        status: 'changed',
        changePercent: ((confirmedValue - estimate) / estimate) * 100,
      }
      changed.push(next)
      return next
    }
    return { ...base, unitDivine: confirmedValue, estimateDivine: null, changePercent: null, status: 'priced' }
  })
  return { state: { ...state, entries }, changed }
}

/** O usuário viu o aviso: 'changed' vira 'priced' (uma linha ou todas). */
export function acknowledgeChanges(state: CollectionState, id?: string): CollectionState {
  if (!state.entries.some((e) => e.status === 'changed' && (id === undefined || e.id === id))) return state
  return {
    ...state,
    entries: state.entries.map((e) =>
      e.status === 'changed' && (id === undefined || e.id === id) ? { ...e, status: 'priced', estimateDivine: null, changePercent: null } : e,
    ),
  }
}

/** Atualiza as pilhas com um snapshot novo do poe.ninja. */
export function refreshStackPrices(state: CollectionState, snapshot: MarketSnapshot): CollectionState {
  const byId = new Map(snapshot.items.map((m) => [m.id, m]))
  let touched = false
  const entries = state.entries.map((e) => {
    const market = e.kind === 'stack' && e.marketId ? byId.get(e.marketId) : undefined
    if (!market || market.valueDivine === e.unitDivine) return e
    touched = true
    return { ...e, unitDivine: market.valueDivine }
  })
  return touched ? { ...state, entries } : state
}

// ---------------------------------------------------------------------------
// Remover / limpar
// ---------------------------------------------------------------------------

/** Remove uma linha. `cancelKey`: chave a cancelar na fila (ninguém mais espera por ela). */
export function removeEntry(state: CollectionState, id: string): { state: CollectionState; cancelKey: string | null } {
  const entry = state.entries.find((e) => e.id === id)
  if (!entry) return { state, cancelKey: null }
  const entries = state.entries.filter((e) => e.id !== id)
  const stillWaiting = entries.some((e) => e.searchKey === entry.searchKey && isPending(e))
  const cancelKey = isPending(entry) && !stillWaiting ? entry.searchKey : null
  return { state: { ...state, entries }, cancelKey }
}

/** Esvazia a lista. `cancelKeys`: chaves pendentes a cancelar na fila. */
export function clearCollection(state: CollectionState): { state: CollectionState; cancelKeys: string[] } {
  const cancelKeys = [...new Set(state.entries.filter(isPending).map((e) => e.searchKey))]
  return { state: { entries: [], seq: state.seq }, cancelKeys }
}

// ---------------------------------------------------------------------------
// Total
// ---------------------------------------------------------------------------

export interface CollectionTotal {
  /** Soma em Divine das linhas com preço (estimativas incluídas). */
  divine: number
  /** Mesma soma na moeda de exibição (null sem cotação). */
  display: number | null
  unit: DisplayCurrency
  /** Quantidade de itens (pilhas contam cada unidade). */
  quantity: number
  lines: number
  /** Linhas ainda sem confirmação (fila ou estimativa). */
  pending: number
  /** Há estimativas ou itens sem preço: o total é aproximado. */
  approximate: boolean
  changed: number
}

export function collectionTotal(state: CollectionState, unit: DisplayCurrency, rates: CurrencyRates | null): CollectionTotal {
  let divine = 0
  let quantity = 0
  let pending = 0
  let changed = 0
  for (const e of state.entries) {
    quantity += e.quantity
    if (isPending(e)) pending++
    if (e.status === 'changed') changed++
    if (e.status !== 'error' && e.unitDivine !== null) divine += e.unitDivine * e.quantity
  }
  return {
    divine,
    display: rates ? fromDivine(divine, unit, rates) : null,
    unit,
    quantity,
    lines: state.entries.length,
    pending,
    approximate: pending > 0,
    changed,
  }
}

/** Tudo que a interface precisa para desenhar o painel (enviado por IPC). */
export interface CollectionView {
  enabled: boolean
  entries: readonly CollectionEntry[]
  total: CollectionTotal
  progress: QueueProgress
  /** searchKey → posição na fila (0 = em andamento). */
  positions: Readonly<Record<string, number>>
}

export function collectionView(
  state: CollectionState,
  options: { enabled: boolean; unit: DisplayCurrency; rates: CurrencyRates | null; progress: QueueProgress; positions: ReadonlyMap<string, number> },
): CollectionView {
  const wanted = new Set(state.entries.filter(isPending).map((e) => e.searchKey))
  const positions: Record<string, number> = {}
  for (const [key, pos] of options.positions) if (wanted.has(key)) positions[key] = pos
  return {
    enabled: options.enabled,
    entries: state.entries,
    total: collectionTotal(state, options.unit, options.rates),
    progress: options.progress,
    positions,
  }
}
