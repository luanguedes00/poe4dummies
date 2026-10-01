import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/core/http/client'
import { StatIndex } from '../src/core/item/statMatcher'
import { priceCheck, type PriceCheckDeps } from '../src/core/pricecheck'
import type { MarketSnapshot } from '../src/core/types'
import { EXALTED_STACK, RARE_RING } from './fixtures/items'
import { STATS } from './statMatcher.test'

const SNAPSHOT: MarketSnapshot = {
  league: 'Forbidden Rites',
  fetchedAt: '2026-09-29T00:00:00.000Z',
  rates: { exaltedPerDivine: 500, chaosPerDivine: 10 },
  items: [
    { id: 'exalted', detailsId: 'exalted-orb', name: 'Exalted Orb', category: 'Currency', iconUrl: null, valueDivine: 1 / 500, volumeDivine: 3000, change7d: -16, sparkline: [] },
    { id: 'chaos', detailsId: 'chaos-orb', name: 'Chaos Orb', category: 'Currency', iconUrl: null, valueDivine: 0.1, volumeDivine: 3000, change7d: 0, sparkline: [] },
  ],
}

function deps(overrides: Partial<PriceCheckDeps> = {}): PriceCheckDeps {
  return {
    snapshot: async () => SNAPSHOT,
    statIndex: async () => new StatIndex(STATS),
    baseTypes: async () => ['Sapphire Ring'],
    search: vi.fn(async () => ({ id: 'Q1', total: 27, result: ['aa', 'bb', 'cc'] })),
    fetchListings: vi.fn(async () => [
      { id: 'aa', amount: 40, currency: 'exalted', seller: 'A', indexedAt: null, iconUrl: null, itemLevel: 80 },
      { id: 'bb', amount: 1, currency: 'chaos', seller: 'B', indexedAt: null, iconUrl: null, itemLevel: 80 },
      { id: 'cc', amount: 3, currency: 'moeda-rara', seller: 'C', indexedAt: null, iconUrl: null, itemLevel: 80 },
    ]),
    ...overrides,
  }
}

const OPTIONS = { league: 'Forbidden Rites', status: 'online' as const, minModPercent: 90 }

describe('priceCheck', () => {
  it('currency é precificada pelo poe.ninja, sem chamar a trade', async () => {
    const d = deps()
    const r = await priceCheck(EXALTED_STACK, OPTIONS, d)
    expect(r.kind).toBe('market')
    if (r.kind === 'market') {
      expect(r.market.id).toBe('exalted')
      expect(r.item.stackSize).toBe(1234)
    }
    expect(d.search).not.toHaveBeenCalled()
  })

  it('item raro vai para a trade e converte os preços', async () => {
    const d = deps()
    const r = await priceCheck(RARE_RING, OPTIONS, d)
    expect(r.kind).toBe('trade')
    if (r.kind !== 'trade') return
    expect(r.total).toBe(27)
    expect(r.queryId).toBe('Q1')
    expect(r.listings.map((l) => l.divine)).toEqual([0.08, 0.1, null])
    expect(r.cheapestDivine).toBe(0.08)
    expect(r.medianDivine).toBeCloseTo(0.09)
    // Vida e resistência total ligadas; mana/atributos desmarcados (seleção inteligente).
    expect(r.filters.filter((f) => f.enabled).map((f) => f.statId)).toEqual(expect.arrayContaining(['explicit.stat_3299347043', 'pseudo.pseudo_total_elemental_resistance']))
    expect(d.fetchListings).toHaveBeenCalledWith('Q1', ['aa', 'bb', 'cc'])
  })

  it('refaz a busca com os filtros ajustados', async () => {
    const d = deps()
    await priceCheck(RARE_RING, { ...OPTIONS, overrides: [{ statId: 'test.dex', enabled: false, min: null, max: null }] }, d)
    const query = (d.search as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    expect(query.query.stats[0].filters.some((f: { id: string }) => f.id === 'test.dex')).toBe(false)
  })

  it('traduz erros em códigos', async () => {
    expect(await priceCheck('texto qualquer', OPTIONS, deps())).toEqual({ kind: 'error', code: 'not-an-item', retryAfterSec: null })
    const limited = deps({ search: async () => { throw new ApiError('rate-limited', 429, 30) } })
    expect(await priceCheck(RARE_RING, OPTIONS, limited)).toEqual({ kind: 'error', code: 'rate-limited', retryAfterSec: 30 })
    const noBase = deps({ baseTypes: async () => [] })
    const magic = RARE_RING.replace('Rarity: Rare\nGale Coil\nSapphire Ring', 'Rarity: Magic\nHale Amethyst Thing')
    expect((await priceCheck(magic, OPTIONS, noBase)).kind).toBe('error')
  })
})
