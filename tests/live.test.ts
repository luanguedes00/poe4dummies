// Testes contra as APIs reais. Não rodam por padrão (fazem requisições de verdade).
// Para rodar: $env:LIVE='1'; npx vitest run tests/live.test.ts

import { describe, expect, it } from 'vitest'
import { HttpClient } from '../src/core/http/client'
import { parseItemText } from '../src/core/item/parser'
import { StatIndex } from '../src/core/item/statMatcher'
import { priceCheck, searchAndPrice } from '../src/core/pricecheck'
import { buildManualQuery } from '../src/core/trade/manual'
import { fetchMarketSnapshot, NinjaClient } from '../src/core/sources/ninja'
import { pickDefaultLeague, TradeClient } from '../src/core/sources/trade'
import { BODY_ARMOUR, RARE_RING_ADVANCED } from './fixtures/items'

const http = new HttpClient({ userAgent: 'OraculoPoE2/0.1.0 (tests)' })
const trade = new TradeClient(http)
const ninja = new NinjaClient(http)

describe.skipIf(!process.env['LIVE'])('APIs reais', () => {
  it('fluxo completo: liga, mercado, mods e busca na trade', async () => {
    const league = pickDefaultLeague(await trade.leagues())
    const snapshot = await fetchMarketSnapshot(ninja, league)
    expect(snapshot.rates.exaltedPerDivine).toBeGreaterThan(1)
    expect(snapshot.items.length).toBeGreaterThan(100)
    expect(snapshot.items.some((i) => i.iconUrl?.startsWith('https://web.poecdn.com/'))).toBe(true)

    const index = new StatIndex(await trade.stats())
    const armour = index.matchItem(parseItemText(BODY_ARMOUR))
    console.log('armadura sem match:', armour.unmatched.map((m) => m.text))
    console.log('armadura ids:', armour.matched.map((m) => `${m.mod.text} -> ${m.stat.id} (${m.stat.text})`))

    const catalog = await trade.catalog()
    expect(catalog.uniques.length).toBeGreaterThan(50)
    const bases = catalog.bases.map((b) => b.type)
    const result = await priceCheck(
      RARE_RING_ADVANCED,
      { league, status: 'online', minModPercent: 80 },
      {
        snapshot: async () => snapshot,
        statIndex: async () => index,
        baseTypes: async () => bases,
        search: (l, q) => trade.search(l, q),
        fetchListings: (id, ids) => trade.fetchListings(id, ids),
      },
    )
    console.log(JSON.stringify(result, null, 1).slice(0, 2500))
    expect(result.kind).toBe('trade')
    if (result.kind === 'trade') {
      expect(result.unmatched).toEqual([])
      expect(result.filters.filter((f) => f.enabled).length).toBe(4)
    }

    const history = await ninja.history(league, 'Currency', 'chaos-orb')
    expect(history.points.length).toBeGreaterThan(5)

    // Busca manual (tela "Buscar preço"): item + mod "total" (pseudo).
    const pseudoLife = index.entries.find((s) => s.id === 'pseudo.pseudo_total_life')
    console.log('pseudo life existe?', Boolean(pseudoLife), pseudoLife?.text)
    const manual = buildManualQuery(
      { name: null, type: 'Sapphire Ring', stats: pseudoLife ? [{ id: pseudoLife.id, min: 60, max: null }] : [] },
      'online',
    )
    const priced = await searchAndPrice(league, manual, snapshot, {
      search: (l, q) => trade.search(l, q),
      fetchListings: (id, ids) => trade.fetchListings(id, ids),
    })
    console.log('busca manual:', priced.total, 'anúncios; mais barato (div):', priced.cheapestDivine)
    expect(priced.queryId.length).toBeGreaterThan(0)
  }, 60_000)
})
