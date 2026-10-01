// Teste real (LIVE=1): o anúncio da trade traz os mods do item (para comparar com Shift).
import { describe, expect, it } from 'vitest'
import { HttpClient } from '../src/core/http/client'
import { TradeClient } from '../src/core/sources/trade'

describe.skipIf(process.env['LIVE'] !== '1')('anúncio com mods', () => {
  it('fetch devolve mods e propriedades', async () => {
    const http = new HttpClient({ userAgent: 'PoE4Dummies/0.1.0 (tests)' })
    const raw = await fetch('https://www.pathofexile.com/api/trade2/search/poe2/Standard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'PoE4Dummies/0.1.0 (tests)' },
      body: JSON.stringify({ query: { status: { option: 'any' }, type: 'Sapphire Ring', stats: [{ type: 'and', filters: [] }], filters: { type_filters: { filters: { rarity: { option: 'rare' } } } } }, sort: { price: 'asc' } }),
    }).then((r) => r.json() as Promise<{ id: string; result: string[] }>)
    const res = await fetch(`https://www.pathofexile.com/api/trade2/fetch/${raw.result[0]}?query=${raw.id}`, { headers: { 'User-Agent': 'PoE4Dummies/0.1.0 (tests)' } }).then((r) => r.json() as Promise<{ result: Array<{ item: Record<string, unknown> }> }>)
    const item = res.result[0]!.item
    console.log('chaves:', Object.keys(item).join(', '))
    console.log('explicitMods:', JSON.stringify(item['explicitMods'])?.slice(0, 300))
    console.log('properties:', JSON.stringify(item['properties'])?.slice(0, 300))
    const listings = await new TradeClient(http).fetchListings(raw.id, raw.result.slice(0, 1))
    console.log('mods no app:', JSON.stringify(listings[0]?.mods))
    expect(listings[0]?.mods?.length ?? 0).toBeGreaterThan(0)
  }, 30_000)
})
