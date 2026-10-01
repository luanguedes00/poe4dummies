import { describe, expect, it } from 'vitest'
import { ApiError, HttpClient, type FetchLike } from '../src/core/http/client'
import { NinjaClient, pickHistoryPair } from '../src/core/sources/ninja'
import { pickDefaultLeague, TradeClient } from '../src/core/sources/trade'

function fakeFetch(routes: Record<string, unknown>, status = 200): FetchLike {
  return async (url) => {
    const key = Object.keys(routes).find((k) => url.includes(k))
    return new Response(key ? JSON.stringify(routes[key]) : 'not found', { status: key ? status : 404 })
  }
}

describe('TradeClient', () => {
  it('usa o id do bloco como grupo (runas vêm com type "augment")', async () => {
    const http = new HttpClient({
      userAgent: 't',
      fetch: fakeFetch({
        '/data/stats': {
          result: [
            { id: 'rune', label: 'Augment', entries: [{ id: 'rune.stat_3372524247', text: '#% to Fire Resistance', type: 'augment' }] },
            { id: 'explicit', label: 'Explicit', entries: [{ id: 'explicit.stat_1', text: '# to maximum Life', type: 'explicit' }] },
          ],
        },
      }),
    })
    const stats = await new TradeClient(http).stats()
    expect(stats.map((s) => s.group)).toEqual(['rune', 'explicit'])
  })

  it('escolhe a liga temporária mais recente de softcore', async () => {
    const http = new HttpClient({
      userAgent: 't',
      fetch: fakeFetch({
        '/data/leagues': {
          result: [
            { id: 'Forbidden Rites', realm: 'poe2', text: 'Forbidden Rites' },
            { id: 'HC Forbidden Rites', realm: 'poe2', text: 'HC Forbidden Rites' },
            { id: 'Standard', realm: 'poe2', text: 'Standard' },
            { id: 'Hardcore', realm: 'poe2', text: 'Hardcore' },
          ],
        },
      }),
    })
    const leagues = await new TradeClient(http).leagues()
    expect(leagues.filter((l) => l.hardcore).map((l) => l.id)).toEqual(['HC Forbidden Rites', 'Hardcore'])
    expect(pickDefaultLeague(leagues)).toBe('Forbidden Rites')
    expect(pickDefaultLeague(leagues.filter((l) => l.id !== 'Forbidden Rites'))).toBe('Standard')
  })

  it('transforma 429 em erro de limite com tempo de espera', async () => {
    const http = new HttpClient({
      userAgent: 't',
      fetch: async () => new Response('{}', { status: 429, headers: { 'Retry-After': '42' } }),
    })
    const error = await new TradeClient(http).leagues().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('rate-limited')
    expect((error as ApiError).retryAfterSec).toBe(42)
  })

  it('recusa resposta em formato inesperado', async () => {
    const http = new HttpClient({ userAgent: 't', fetch: fakeFetch({ '/data/leagues': { outra: 'coisa' } }) })
    await expect(new TradeClient(http).leagues()).rejects.toMatchObject({ code: 'invalid-response' })
  })
})

describe('pickHistoryPair', () => {
  const h = (n: number) => Array.from({ length: n }, () => ({ rate: 1 }))
  it('ignora par vazio (caso real do Mirror: Exalted vazio, Divine com 25 dias)', () => {
    expect(pickHistoryPair([{ id: 'divine', history: h(25) }, { id: 'exalted', history: [] }, { id: 'chaos', history: h(4) }])?.id).toBe('divine')
  })
  it('no empate prefere Exalted', () => {
    expect(pickHistoryPair([{ id: 'divine', history: h(26) }, { id: 'exalted', history: h(26) }])?.id).toBe('exalted')
  })
  it('sem dados retorna undefined', () => {
    expect(pickHistoryPair([{ id: 'exalted', history: [] }])).toBeUndefined()
  })
})

describe('NinjaClient', () => {
  it('monta itens com ícone do CDN oficial e taxas de câmbio', async () => {
    const http = new HttpClient({
      userAgent: 't',
      fetch: fakeFetch({
        '/overview': {
          core: { items: [], rates: { exalted: 585.8, chaos: 9.43 }, primary: 'divine', secondary: 'chaos' },
          lines: [
            { id: 'chaos', primaryValue: 0.106, volumePrimaryValue: 125375, sparkline: { totalChange: -15.33, data: [2.68, null, -15.33] } },
            { id: 'sem-meta', primaryValue: 1 },
          ],
          items: [{ id: 'chaos', name: 'Chaos Orb', image: '/gen/image/abc/CurrencyRerollRare.png', category: 'Currency', detailsId: 'chaos-orb' }],
        },
      }),
    })
    const { rates, items } = await new NinjaClient(http).overview('Forbidden Rites', 'Currency')
    expect(rates).toEqual({ exaltedPerDivine: 585.8, chaosPerDivine: 9.43 })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      name: 'Chaos Orb',
      iconUrl: 'https://web.poecdn.com/gen/image/abc/CurrencyRerollRare.png',
      change7d: -15.33,
      sparkline: [2.68, -15.33],
    })
  })
})
