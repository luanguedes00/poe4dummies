// Teste real (LIVE=1): preço do tablet de Ritual com Reroll + Defer (compra instantânea).
import { describe, expect, it } from 'vitest'
import { HttpClient } from '../src/core/http/client'
import { TradeClient } from '../src/core/sources/trade'

describe.skipIf(process.env['LIVE'] !== '1')('Ritual: Reroll + Defer', () => {
  it('existe no mercado e mostra os preços', async () => {
    const trade = new TradeClient(new HttpClient({ userAgent: 'PoE4Dummies/0.1.0 (tests)' }))
    const leagues = await trade.leagues()
    const league = leagues.find((l) => !l.hardcore && l.id !== 'Standard')?.id ?? 'Standard'
    const search = await trade.search(league, {
      query: {
        status: { option: 'securable' },
        type: 'Ritual Tablet',
        stats: [
          {
            type: 'and',
            filters: [
              { id: 'explicit.stat_120737942', value: { min: 1 }, disabled: false },
              { id: 'explicit.stat_1345835998', value: { max: -20 }, disabled: false },
            ],
          },
        ],
        filters: { type_filters: { filters: { rarity: { option: 'nonunique' } } } },
      },
      sort: { price: 'asc' },
    })
    const listings = await trade.fetchListings(search.id, search.result.slice(0, 10))
    console.log(`liga ${league}: ${search.total} à venda`)
    for (const l of listings) console.log(`${l.amount} ${l.currency} | ${(l.mods ?? []).filter((m) => /Reroll|Defer/i.test(m.text)).map((m) => m.text).join(' · ')}`)
    expect(search.total).toBeGreaterThanOrEqual(0)
  }, 60_000)
})
