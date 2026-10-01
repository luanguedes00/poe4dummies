import { describe, expect, it } from 'vitest'
import {
  cacheKeyForItem,
  cacheKeyForResult,
  PriceCache,
  rareCacheKey,
  roundMin,
  uniqueCacheKey,
} from '../src/core/collection/priceCache'
import { parseItemText } from '../src/core/item/parser'
import { StatIndex } from '../src/core/item/statMatcher'
import { priceCheck, type PriceCheckDeps } from '../src/core/pricecheck'
import type { MarketSnapshot } from '../src/core/types'
import { RARE_RING, UNIQUE_BELT } from './fixtures/items'
import { STATS } from './statMatcher.test'

const HOUR = 60 * 60 * 1000

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t }
  return c
}

describe('PriceCache', () => {
  it('guarda e devolve preços', () => {
    const c = clock()
    const cache = new PriceCache({ now: c.now })
    cache.set('a', 1.5)
    expect(cache.get('a')).toEqual({ valueDivine: 1.5, savedAt: c.t })
    expect(cache.get('b')).toBeNull()
  })

  it('ignora valores inválidos', () => {
    const cache = new PriceCache()
    cache.set('a', 0)
    cache.set('b', Number.NaN)
    cache.set('', 1)
    cache.set('x'.repeat(2000), 1)
    expect(cache.size).toBe(0)
  })

  it('expira depois de 24 h', () => {
    const c = clock()
    const cache = new PriceCache({ now: c.now })
    cache.set('a', 1)
    c.t += 23 * HOUR
    expect(cache.get('a')).not.toBeNull()
    c.t += 2 * HOUR
    expect(cache.get('a')).toBeNull()
    expect(cache.size).toBe(0)
  })

  it('descarta o usado há mais tempo ao passar do limite (LRU)', () => {
    const c = clock()
    const cache = new PriceCache({ now: c.now, maxEntries: 3 })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.get('a') // "a" passa a ser o mais recente
    cache.set('d', 4)
    expect(cache.size).toBe(3)
    expect(cache.get('b')).toBeNull()
    expect(cache.get('a')?.valueDivine).toBe(1)
    expect(cache.get('d')?.valueDivine).toBe(4)
  })

  it('limite padrão de 2000 entradas', () => {
    const cache = new PriceCache()
    for (let i = 0; i < 2100; i++) cache.set(`k${i}`, 1)
    expect(cache.size).toBe(2000)
    expect(cache.get('k0')).toBeNull()
    expect(cache.get('k2099')).not.toBeNull()
  })

  it('serializa e restaura mantendo a ordem e descartando vencidas', () => {
    const c = clock()
    const cache = new PriceCache({ now: c.now, maxEntries: 3 })
    cache.set('velha', 9)
    c.t += 20 * HOUR
    cache.set('a', 1)
    cache.set('b', 2)
    const json = JSON.parse(JSON.stringify(cache))
    expect(PriceCache.isValidJSON(json)).toBe(true)

    c.t += 5 * HOUR // "velha" vence; "a" e "b" continuam
    const restored = PriceCache.fromJSON(json, { now: c.now, maxEntries: 3 })
    expect(restored.size).toBe(2)
    expect(restored.get('velha')).toBeNull()
    restored.set('c', 3)
    restored.set('d', 4) // descarta "a", o mais antigo
    expect(restored.get('a')).toBeNull()
    expect(restored.get('b')?.valueDivine).toBe(2)
  })

  it('JSON inválido vira cache vazio', () => {
    for (const raw of [null, 'lixo', { v: 2, entries: [] }, { v: 1, entries: [['a', -1, 0]] }, { v: 1, entries: [['a', 1]] }, { v: 1, entries: [], extra: 1 }]) {
      expect(PriceCache.isValidJSON(raw)).toBe(false)
      expect(PriceCache.fromJSON(raw).size).toBe(0)
    }
  })
})

describe('chaves', () => {
  it('arredonda mínimos para agrupar itens parecidos', () => {
    expect(roundMin(78)).toBe(75)
    expect(roundMin(76)).toBe(75)
    expect(roundMin(70)).toBe(70)
    expect(roundMin(7)).toBe(7)
    expect(roundMin(7.4)).toBe(7)
    expect(roundMin(150)).toBe(150)
    expect(roundMin(0.37)).toBe(0.35)
    expect(roundMin(-12)).toBe(-10)
    expect(roundMin(0)).toBe(0)
  })

  it('raro: só filtros ligados, em qualquer ordem', () => {
    const a = rareCacheKey('L', 'Sapphire Ring', [
      { statId: 'b', enabled: true, min: 78, max: null },
      { statId: 'a', enabled: true, min: 30, max: null },
      { statId: 'z', enabled: false, min: 5, max: null },
    ], false)
    const b = rareCacheKey('L', 'Sapphire Ring', [
      { statId: 'a', enabled: true, min: 31, max: null },
      { statId: 'b', enabled: true, min: 76, max: null },
    ], false)
    expect(a).toBe(b)
    expect(rareCacheKey('L', 'Sapphire Ring', [], true)).not.toBe(rareCacheKey('L', 'Sapphire Ring', [], false))
    expect(uniqueCacheKey('L', 'Headhunter', false)).not.toBe(uniqueCacheKey('Outra', 'Headhunter', false))
  })

  const SNAPSHOT: MarketSnapshot = {
    league: 'L',
    fetchedAt: '2026-09-29T00:00:00.000Z',
    rates: { exaltedPerDivine: 500, chaosPerDivine: 10 },
    items: [{ id: 'exalted', detailsId: 'exalted-orb', name: 'Exalted Orb', category: 'Currency', iconUrl: null, valueDivine: 1 / 500, volumeDivine: 1, change7d: 0, sparkline: [] }],
  }
  const deps: PriceCheckDeps = {
    snapshot: async () => SNAPSHOT,
    statIndex: async () => new StatIndex(STATS),
    baseTypes: async () => ['Sapphire Ring', 'Heavy Belt'],
    search: async () => ({ id: 'Q', total: 1, result: ['aa'] }),
    fetchListings: async () => [{ id: 'aa', amount: 100, currency: 'exalted', seller: 'A', indexedAt: null, whisper: null, iconUrl: null, itemLevel: 80 }],
  }
  const rare = { index: new StatIndex(STATS), baseTypes: ['Sapphire Ring', 'Heavy Belt'], minModPercent: 90 }

  it('a chave calculada antes da busca bate com a do resultado (raro e único)', async () => {
    for (const text of [RARE_RING, UNIQUE_BELT]) {
      const before = cacheKeyForItem(parseItemText(text), 'L', rare)
      const result = await priceCheck(text, { league: 'L', status: 'online', minModPercent: 90 }, deps)
      expect(result.kind).toBe('trade')
      if (result.kind !== 'trade') continue
      expect(before).not.toBeNull()
      expect(cacheKeyForResult(result)).toBe(before)
    }
  })

  it('raro sem índice de stats não tem chave (sem estimativa honesta)', () => {
    expect(cacheKeyForItem(parseItemText(RARE_RING), 'L', null)).toBeNull()
    expect(cacheKeyForItem(parseItemText(UNIQUE_BELT), 'L', null)).toBe(uniqueCacheKey('L', 'Headhunter', false))
  })
})
