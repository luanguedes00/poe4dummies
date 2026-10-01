// Troca de liga: resposta imediata na tela, resposta atrasada da liga antiga descartada
// e nenhuma consulta à trade. Rede falsa (nenhuma requisição de verdade).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWatchEntry, evaluateWatchlist } from '../src/core/market/watchlist'
import type { RepoeData } from '../src/core/sources/repoe'
import type { MarketItem, MarketSnapshot } from '../src/core/types'
import { DataStore } from '../src/main/dataStore'
import type { DiskCache } from '../src/main/diskCache'
import { MarketService } from '../src/main/marketService'
import { SettingsStore } from '../src/main/settingsStore'

const dirs: string[] = []
const newDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'liga-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** poe.ninja falso: Currency de cada liga pode ficar "presa" até `release`. Qualquer outro host conta como erro. */
function fakeNet() {
  const gates = new Map<string, { promise: Promise<void>; open: () => void }>()
  const net = {
    currencyCalls: new Map<string, number>(),
    otherCalls: [] as string[],
    /** Ligas que o poe.ninja não tem (404). */
    missing: new Set<string>(),
    hold(league: string) {
      let open = () => undefined as void
      const promise = new Promise<void>((resolve) => (open = resolve))
      gates.set(league, { promise, open })
    },
    release(league: string) {
      gates.get(league)?.open()
    },
    fetch: async (url: string): Promise<Response> => {
      const u = new URL(url)
      if (u.hostname !== 'poe.ninja' || !u.pathname.endsWith('/exchange/current/overview')) {
        net.otherCalls.push(url)
        throw new Error(`rede inesperada: ${url}`)
      }
      const league = u.searchParams.get('league') ?? ''
      if (net.missing.has(league)) return new Response('', { status: 404 })
      const type = u.searchParams.get('type')
      if (type !== 'Currency') return json({ core: { rates: {}, primary: 'divine' }, lines: [], items: [] })
      net.currencyCalls.set(league, (net.currencyCalls.get(league) ?? 0) + 1)
      await gates.get(league)?.promise
      // Cada liga tem sua cotação, para conferir de onde veio o preço.
      const exalted = league === 'A' ? 100 : 300
      return json({
        core: { rates: { exalted, chaos: 10 }, primary: 'divine' },
        lines: [{ id: 'chaos', primaryValue: 0.1 }],
        items: [{ id: 'chaos', name: 'Chaos Orb', image: '/gen/image/chaos.png', detailsId: 'chaos-orb' }],
      })
    },
  }
  return net
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function fakeDisk<T>(value: T | null): DiskCache<T> {
  return { read: async () => value, write: async () => undefined, remove: async () => undefined } as unknown as DiskCache<T>
}

async function setup(league: string, net: ReturnType<typeof fakeNet>, dataDir = newDir()) {
  const settings = await SettingsStore.open(newDir())
  await settings.update({ league })
  const market = new MarketService(
    settings,
    'teste',
    () => undefined,
    fakeDisk<RepoeData>(null),
    fakeDisk({}),
    fakeDisk({}),
    fakeDisk({}),
    new DataStore(dataDir),
    (url) => net.fetch(url),
  )
  return { settings, market }
}

describe('troca de liga', () => {
  it('a liga nova aparece na hora e a resposta atrasada da antiga é descartada', async () => {
    const net = fakeNet()
    net.hold('A')
    net.hold('B')
    const { settings, market } = await setup('A', net)
    const first = market.refresh()
    await vi.waitFor(() => expect(net.currencyCalls.get('A')).toBe(1))

    await settings.update({ league: 'B' })
    const second = market.refresh()
    // Antes: devolvia a atualização da liga A e a B nunca começava.
    expect(market.getState()).toMatchObject({ league: 'B', snapshot: null, loading: true })
    await vi.waitFor(() => expect(net.currencyCalls.get('B')).toBe(1))

    net.release('B')
    const done = await second
    expect(done).toMatchObject({ league: 'B', loading: false, error: null })
    expect(done.snapshot?.rates.exaltedPerDivine).toBe(300)

    net.release('A')
    const late = await first
    // Quem esperava pela liga antiga recebe o estado da nova; a tela não volta para A.
    expect(late.snapshot?.league).toBe('B')
    expect(market.getState().snapshot?.league).toBe('B')
    expect(market.getState().snapshot?.rates.exaltedPerDivine).toBe(300)
    expect(net.otherCalls).toEqual([])
  })

  it('pedidos ao mesmo tempo para a mesma liga usam uma atualização só', async () => {
    const net = fakeNet()
    const { market } = await setup('A', net)
    const [a, b] = await Promise.all([market.refresh(), market.refresh()])
    expect(a).toBe(b)
    expect(net.currencyCalls.get('A')).toBe(1)
  })

  it('liga com preços guardados: mostra os guardados na hora enquanto atualiza', async () => {
    const dataDir = newDir()
    const net = fakeNet()
    const before = await setup('B', net, dataDir)
    await before.market.refresh()

    // App reaberto na liga A; depois o usuário volta para a B (rede lenta).
    const { settings, market } = await setup('A', net, dataDir)
    await market.refresh()
    net.hold('B')
    await settings.update({ league: 'B' })
    const pending = market.refresh()
    await vi.waitFor(() => expect(market.getState().snapshot?.league).toBe('B'))
    expect(market.getState().loading).toBe(true)
    net.release('B')
    expect((await pending).loading).toBe(false)
    expect(net.otherCalls).toEqual([])
  })

  it('liga sem dados no poe.ninja: mostra a liga escolhida com o erro, sem os preços da anterior', async () => {
    const net = fakeNet()
    const { settings, market } = await setup('A', net)
    await market.refresh()
    net.missing.add('Hardcore')
    await settings.update({ league: 'Hardcore' })
    const state = await market.refresh()
    expect(state).toMatchObject({ league: 'Hardcore', snapshot: null, loading: false, error: 'http' })
  })
})

describe('acompanhamento e liga', () => {
  const item: MarketItem = { id: 'chaos', detailsId: 'chaos', name: 'Chaos Orb', category: 'Currency', iconUrl: null, valueDivine: 0.1, volumeDivine: 1, change7d: null, sparkline: [] }
  const rates = { exaltedPerDivine: 100, chaosPerDivine: 10 }
  const snap = (league: string, valueDivine: number): MarketSnapshot => ({ league, fetchedAt: '2026-10-01T00:00:00Z', rates, items: [{ ...item, valueDivine }] })

  it('preço de referência de outra liga não dispara alerta', () => {
    const entry = createWatchEntry(item, rates, new Date('2026-10-01T00:00:00Z'), 10, 'A')
    expect(entry.league).toBe('A')
    expect(evaluateWatchlist([entry], snap('Standard', 0.5), 'divine').alerts).toHaveLength(0)
    expect(evaluateWatchlist([entry], snap('A', 0.5), 'divine').alerts).toHaveLength(1)
  })

  it('entrada antiga (sem liga) continua funcionando como antes', () => {
    const legacy = createWatchEntry(item, rates, new Date('2026-10-01T00:00:00Z'), 10)
    expect(legacy.league).toBeUndefined()
    expect(evaluateWatchlist([legacy], snap('Standard', 0.5), 'divine').alerts).toHaveLength(1)
  })
})
