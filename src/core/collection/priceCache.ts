// Cache local de preços de buscas na trade, usado para mostrar um valor
// aproximado na hora (modo lista) enquanto a confirmação roda na fila.
//
// - LRU: ao passar do limite, descarta o que foi usado há mais tempo.
// - Validade: entradas vencidas são ignoradas e removidas.
// - Relógio injetável, para testar sem esperar.
// - Serializável em JSON compacto e validado com zod (o arquivo em disco é
//   entrada não confiável: formato inválido = cache vazio).

import { z } from 'zod'
import type { ParsedItem } from '../item/parser'
import type { StatIndex } from '../item/statMatcher'
import type { PriceCheckResult } from '../pricecheck'
import { defaultFilters, resolveBaseType, type StatFilter } from '../trade/query'

export const PRICE_CACHE_MAX_ENTRIES = 2000
export const PRICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** Tamanho máximo de uma chave (raros com muitos filtros ficam bem abaixo disso). */
const MAX_KEY_LENGTH = 1024

export interface CachedPrice {
  valueDivine: number
  /** Momento (ms) em que o preço foi confirmado. */
  savedAt: number
}

export interface PriceCacheOptions {
  maxEntries?: number
  ttlMs?: number
  now?: () => number
}

const jsonSchema = z
  .object({
    v: z.literal(1),
    // [chave, valor em Divine, salvo em (ms)], do menos para o mais recente.
    entries: z
      .array(z.tuple([z.string().min(1).max(MAX_KEY_LENGTH), z.number().finite().positive(), z.number().int().nonnegative()]))
      .max(PRICE_CACHE_MAX_ENTRIES * 2),
  })
  .strict()

export type PriceCacheJSON = z.infer<typeof jsonSchema>

export class PriceCache {
  private readonly map = new Map<string, CachedPrice>()
  private readonly maxEntries: number
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: PriceCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? PRICE_CACHE_MAX_ENTRIES)
    this.ttlMs = options.ttlMs ?? PRICE_CACHE_TTL_MS
    this.now = options.now ?? (() => Date.now())
  }

  get size(): number {
    return this.map.size
  }

  private expired(entry: CachedPrice, now: number): boolean {
    return now - entry.savedAt > this.ttlMs || entry.savedAt > now + this.ttlMs
  }

  /** Preço válido para a chave (e marca como usado recentemente), ou null. */
  get(key: string): CachedPrice | null {
    const entry = this.map.get(key)
    if (!entry) return null
    if (this.expired(entry, this.now())) {
      this.map.delete(key)
      return null
    }
    // Map mantém a ordem de inserção: reinserir move para o fim (mais recente).
    this.map.delete(key)
    this.map.set(key, entry)
    return entry
  }

  set(key: string, valueDivine: number): void {
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) return
    if (!Number.isFinite(valueDivine) || valueDivine <= 0) return
    this.map.delete(key)
    this.map.set(key, { valueDivine, savedAt: this.now() })
    this.trim()
  }

  delete(key: string): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  private trim(): void {
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      this.map.delete(oldest.value)
    }
  }

  /** Formato compacto para gravar em disco (vencidas ficam de fora). */
  toJSON(): PriceCacheJSON {
    const now = this.now()
    const entries: PriceCacheJSON['entries'] = []
    for (const [key, entry] of this.map) {
      if (!this.expired(entry, now)) entries.push([key, entry.valueDivine, entry.savedAt])
    }
    return { v: 1, entries }
  }

  static isValidJSON(raw: unknown): raw is PriceCacheJSON {
    return jsonSchema.safeParse(raw).success
  }

  /** Reconstrói o cache. Dado inválido vira cache vazio; vencidas são descartadas. */
  static fromJSON(raw: unknown, options: PriceCacheOptions = {}): PriceCache {
    const cache = new PriceCache(options)
    const parsed = jsonSchema.safeParse(raw)
    if (!parsed.success) return cache
    const now = cache.now()
    for (const [key, valueDivine, savedAt] of parsed.data.entries) {
      const entry = { valueDivine, savedAt }
      if (cache.expired(entry, now)) continue
      cache.map.delete(key)
      cache.map.set(key, entry)
    }
    cache.trim()
    return cache
  }
}

// ---------------------------------------------------------------------------
// Chaves do cache
// ---------------------------------------------------------------------------

/**
 * Arredonda um mínimo para baixo numa grade de ~5–10% do valor, para que itens
 * parecidos (ex.: vida 76 e 78) caiam na mesma chave.
 */
export function roundMin(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0
  const abs = Math.abs(value)
  const step = 10 ** Math.floor(Math.log10(abs)) / 2
  const rounded = Math.floor(abs / step) * step
  return Math.sign(value) * Number(rounded.toPrecision(6))
}

export function uniqueCacheKey(league: string, name: string, corrupted: boolean): string {
  return `u|${league}|${name}${corrupted ? '|c' : ''}`
}

type KeyFilter = Pick<StatFilter, 'statId' | 'enabled' | 'min' | 'max'>

/** Raro (ou mágico/normal): base + filtros ligados com mínimos arredondados. */
export function rareCacheKey(league: string, baseType: string, filters: readonly KeyFilter[], corrupted: boolean): string {
  const parts = filters
    .filter((f) => f.enabled)
    .map((f) => {
      if (f.min !== null) return `${f.statId}>${roundMin(f.min)}`
      if (f.max !== null) return `${f.statId}<${roundMin(f.max)}`
      return f.statId
    })
    .sort()
  return `r|${league}|${baseType}${corrupted ? '|c' : ''}|${parts.join(',')}`
}

/** O necessário para calcular a chave de um raro antes da busca (mesma regra do priceCheck). */
export interface RareKeyContext {
  index: StatIndex
  baseTypes: readonly string[]
  minModPercent: number
}

/**
 * Chave de um item lido do jogo, antes da busca. Únicos: pelo nome. Raros:
 * precisa do índice de stats (sem ele, não há estimativa honesta → null).
 */
export function cacheKeyForItem(item: ParsedItem, league: string, rare: RareKeyContext | null | undefined): string | null {
  if (item.rarity === 'Unique') return item.name ? uniqueCacheKey(league, item.name, item.corrupted) : null
  if (!rare || item.unidentified) return null
  const baseType = resolveBaseType(item, rare.baseTypes)
  if (!baseType) return null
  const { matched } = rare.index.matchItem(item)
  return rareCacheKey(league, baseType, defaultFilters(item, matched, rare.minModPercent), item.corrupted)
}

/** Chave de um resultado da trade (bate com `cacheKeyForItem` quando não há ajustes manuais). */
export function cacheKeyForResult(result: Extract<PriceCheckResult, { kind: 'trade' }>): string | null {
  const { item, league } = result
  if (item.rarity === 'Unique') return item.name ? uniqueCacheKey(league, item.name, item.corrupted) : null
  if (!item.baseType) return null
  return rareCacheKey(league, item.baseType, result.filters, item.corrupted)
}

/** Valor usado na lista para um resultado da trade: o típico (mediana), ou o mais barato. */
export function tradeValueDivine(result: Extract<PriceCheckResult, { kind: 'trade' }>): number | null {
  return result.medianDivine ?? result.cheapestDivine
}
