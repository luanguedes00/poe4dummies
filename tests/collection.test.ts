import { describe, expect, it } from 'vitest'
import {
  acknowledgeChanges,
  addItem,
  applyResult,
  clearCollection,
  collectionTotal,
  collectionView,
  emptyCollection,
  markSearching,
  refreshStackPrices,
  removeEntry,
  textKey,
  type AddContext,
  type CollectionState,
} from '../src/core/collection/collection'
import { PriceCache, uniqueCacheKey } from '../src/core/collection/priceCache'
import type { PriceCheckResult } from '../src/core/pricecheck'
import type { MarketSnapshot } from '../src/core/types'
import { EXALTED_STACK, RARE_RING, UNIQUE_BELT } from './fixtures/items'

const RATES = { exaltedPerDivine: 500, chaosPerDivine: 10 }
const SNAPSHOT: MarketSnapshot = {
  league: 'L',
  fetchedAt: '2026-09-29T00:00:00.000Z',
  rates: RATES,
  items: [
    { id: 'exalted', detailsId: 'exalted-orb', name: 'Exalted Orb', category: 'Currency', iconUrl: 'https://web.poecdn.com/ex.png', valueDivine: 1 / 500, volumeDivine: 1, change7d: 0, sparkline: [] },
  ],
}
const SMALL_EX_STACK = EXALTED_STACK.replace('Stack Size: 1,234/5000', 'Stack Size: 10/5000')

const HOUR = 60 * 60 * 1000

function ctx(overrides: Partial<AddContext> = {}): AddContext {
  return { snapshot: SNAPSHOT, cache: null, league: 'L', now: 1_000_000, ...overrides }
}

function add(state: CollectionState, text: string, context = ctx()) {
  const r = addItem(state, text, context)
  if (!r.ok) throw new Error(r.code)
  return r
}

function uniqueResult(medianDivine: number | null): PriceCheckResult {
  return {
    kind: 'trade',
    item: { name: 'Headhunter', baseLine: 'Heavy Belt', baseType: 'Heavy Belt', rarity: 'Unique', itemClass: 'Belts', itemLevel: 84, corrupted: false, stackSize: null },
    league: 'L',
    filters: [],
    siteFilters: {},
    status: 'online',
    unmatched: [],
    queryId: 'Q',
    total: 3,
    listings: [],
    cheapestDivine: medianDivine === null ? null : medianDivine * 0.8,
    medianDivine,
    rates: RATES,
  }
}

describe('modo lista: pilhas', () => {
  it('currency tem preÃ§o na hora, sem busca, e pilhas iguais somam', () => {
    const first = add(emptyCollection(), EXALTED_STACK)
    expect(first.entry).toMatchObject({ kind: 'stack', status: 'priced', source: 'market', quantity: 1234, name: 'Exalted Orb' })
    expect(first.search).toBeNull()

    const second = add(first.state, SMALL_EX_STACK)
    expect(second.merged).toBe(true)
    expect(second.state.entries).toHaveLength(1)
    expect(second.entry.quantity).toBe(1244)

    const total = collectionTotal(second.state, 'exalted', RATES)
    expect(total.display).toBeCloseTo(1244)
    expect(total.divine).toBeCloseTo(1244 / 500)
    expect(total.quantity).toBe(1244)
    expect(total.approximate).toBe(false)
    expect(collectionTotal(second.state, 'exalted', null).display).toBeNull()
  })

  it('pilha somada vai para o fim (aparece no topo da lista)', () => {
    let s = add(emptyCollection(), EXALTED_STACK).state
    s = add(s, UNIQUE_BELT).state
    s = add(s, SMALL_EX_STACK).state
    expect(s.entries.map((e) => e.name)).toEqual(['Headhunter', 'Exalted Orb'])
  })

  it('atualiza as pilhas quando o poe.ninja atualiza', () => {
    const s = add(emptyCollection(), EXALTED_STACK).state
    const next = refreshStackPrices(s, { ...SNAPSHOT, items: [{ ...SNAPSHOT.items[0]!, valueDivine: 0.004 }] })
    expect(next.entries[0]!.unitDivine).toBe(0.004)
    expect(refreshStackPrices(next, { ...SNAPSHOT, items: [{ ...SNAPSHOT.items[0]!, valueDivine: 0.004 }] })).toBe(next)
  })

  it('texto que nÃ£o Ã© item nÃ£o entra na lista', () => {
    expect(addItem(emptyCollection(), 'oi', ctx())).toEqual({ ok: false, code: 'not-an-item' })
  })
})

describe('modo lista: Ãºnicos e raros', () => {
  it('sem cache: fica na fila ("buscando")', () => {
    const r = add(emptyCollection(), UNIQUE_BELT, ctx({ cache: new PriceCache() }))
    expect(r.entry).toMatchObject({ status: 'queued', unitDivine: null, cacheKey: uniqueCacheKey('L', 'Headhunter', false) })
    expect(r.search).toEqual({ key: textKey(UNIQUE_BELT), text: UNIQUE_BELT })
  })

  it('raro sem Ã­ndice de stats nÃ£o tem estimativa', () => {
    const r = add(emptyCollection(), RARE_RING, ctx({ cache: new PriceCache() }))
    expect(r.entry).toMatchObject({ status: 'queued', cacheKey: null })
  })

  it('com cache: mostra â‰ˆvalor e confirma em segundo plano', () => {
    let t = 1_000_000
    const cache = new PriceCache({ now: () => t })
    cache.set(uniqueCacheKey('L', 'Headhunter', false), 50)
    t += HOUR
    const r = add(emptyCollection(), UNIQUE_BELT, ctx({ cache, now: t }))
    expect(r.entry).toMatchObject({ status: 'estimated', unitDivine: 50, estimateDivine: 50, source: 'cache' })
    expect(r.search).not.toBeNull()
    expect(collectionTotal(r.state, 'divine', RATES)).toMatchObject({ divine: 50, approximate: true, pending: 1 })
  })

  it('cache recente vale como confirmado (sem nova busca)', () => {
    let t = 1_000_000
    const cache = new PriceCache({ now: () => t })
    cache.set(uniqueCacheKey('L', 'Headhunter', false), 50)
    t += 60_000
    const r = add(emptyCollection(), UNIQUE_BELT, ctx({ cache, now: t }))
    expect(r.entry).toMatchObject({ status: 'priced', unitDivine: 50, source: 'cache' })
    expect(r.search).toBeNull()
  })

  it('confirmaÃ§Ã£o dentro da margem: preÃ§o final, sem aviso; e grava no cache', () => {
    let t = 1_000_000
    const cache = new PriceCache({ now: () => t })
    cache.set(uniqueCacheKey('L', 'Headhunter', false), 50)
    t += HOUR
    const r = add(emptyCollection(), UNIQUE_BELT, ctx({ cache, now: t }))
    const searching = markSearching(r.state, r.search!.key)
    expect(searching.entries[0]!.status).toBe('estimated') // jÃ¡ mostra valor; continua "estimado"
    const out = applyResult(searching, r.search!.key, uniqueResult(55), { cache })
    expect(out.changed).toEqual([])
    expect(out.state.entries[0]).toMatchObject({ status: 'priced', unitDivine: 55, source: 'trade', estimateDivine: null })
    expect(cache.get(uniqueCacheKey('L', 'Headhunter', false))?.valueDivine).toBe(55)
  })

  it('confirmaÃ§Ã£o fora da margem: marca "alterado" para a interface avisar', () => {
    let t = 1_000_000
    const cache = new PriceCache({ now: () => t })
    cache.set(uniqueCacheKey('L', 'Headhunter', false), 50)
    t += HOUR
    const r = add(emptyCollection(), UNIQUE_BELT, ctx({ cache, now: t }))
    const out = applyResult(r.state, r.search!.key, uniqueResult(40), { cache })
    expect(out.changed).toHaveLength(1)
    expect(out.state.entries[0]).toMatchObject({ status: 'changed', unitDivine: 40, estimateDivine: 50 })
    expect(out.state.entries[0]!.changePercent).toBeCloseTo(-20)
    expect(collectionTotal(out.state, 'divine', RATES).changed).toBe(1)

    const seen = acknowledgeChanges(out.state)
    expect(seen.entries[0]).toMatchObject({ status: 'priced', changePercent: null })
    expect(acknowledgeChanges(seen)).toBe(seen)
  })

  it('margem configurÃ¡vel', () => {
    let t = 1_000_000
    const cache = new PriceCache({ now: () => t })
    cache.set(uniqueCacheKey('L', 'Headhunter', false), 50)
    t += HOUR
    const r = add(emptyCollection(), UNIQUE_BELT, ctx({ cache, now: t }))
    expect(applyResult(r.state, r.search!.key, uniqueResult(40), { cache, margin: 0.25 }).changed).toEqual([])
  })

  it('sem cache: queued â†’ searching â†’ priced', () => {
    const cache = new PriceCache()
    const r = add(emptyCollection(), UNIQUE_BELT, ctx({ cache }))
    const s1 = markSearching(r.state, r.search!.key)
    expect(s1.entries[0]!.status).toBe('searching')
    const out = applyResult(s1, r.search!.key, uniqueResult(12), { cache })
    expect(out.state.entries[0]).toMatchObject({ status: 'priced', unitDivine: 12 })
    expect(out.changed).toEqual([])
  })

  it('confirmaÃ§Ã£o de um item dÃ¡ estimativa a outro parecido ainda na fila', () => {
    const cache = new PriceCache()
    const a = add(emptyCollection(), UNIQUE_BELT, ctx({ cache }))
    const notedCopy = UNIQUE_BELT.replace('Heavy Belt\n', 'Heavy Belt\n--------\nNote: x\n')
    const b = add(a.state, notedCopy, ctx({ cache }))
    expect(b.search!.key).not.toBe(a.search!.key)
    const out = applyResult(b.state, a.search!.key, uniqueResult(30), { cache })
    expect(out.state.entries[1]).toMatchObject({ status: 'estimated', unitDivine: 30 })
  })

  it('itens idÃªnticos compartilham a mesma busca', () => {
    const a = add(emptyCollection(), UNIQUE_BELT)
    const b = add(a.state, UNIQUE_BELT.replace(/\n/g, '\r\n'))
    expect(b.search!.key).toBe(a.search!.key)
    const out = applyResult(b.state, a.search!.key, uniqueResult(10), { cache: null })
    expect(out.state.entries.map((e) => e.status)).toEqual(['priced', 'priced'])
    expect(collectionTotal(out.state, 'divine', RATES).divine).toBe(20)
  })

  it('erros: sem anÃºncios e erro da busca', () => {
    const a = add(emptyCollection(), UNIQUE_BELT)
    const none = applyResult(a.state, a.search!.key, uniqueResult(null), { cache: null })
    expect(none.state.entries[0]).toMatchObject({ status: 'error', errorCode: 'no-listings' })
    const failed = applyResult(a.state, a.search!.key, { kind: 'error', code: 'network', retryAfterSec: null }, { cache: null })
    expect(failed.state.entries[0]).toMatchObject({ status: 'error', errorCode: 'network' })
    expect(collectionTotal(failed.state, 'divine', RATES).divine).toBe(0)
  })

  it('resultado de mercado (snapshot chegou depois) vira pilha precificada', () => {
    const r = add(emptyCollection(), EXALTED_STACK, ctx({ snapshot: null }))
    expect(r.entry.status).toBe('queued')
    const market: PriceCheckResult = {
      kind: 'market',
      item: { name: null, baseLine: 'Exalted Orb', baseType: 'Exalted Orb', rarity: 'Currency', itemClass: 'Stackable Currency', itemLevel: null, corrupted: false, stackSize: 1234 },
      market: SNAPSHOT.items[0]!,
      rates: RATES,
    }
    const out = applyResult(r.state, r.search!.key, market, { cache: null })
    expect(out.state.entries[0]).toMatchObject({ kind: 'stack', status: 'priced', marketId: 'exalted', quantity: 1234 })
  })
})

describe('modo lista: remover, limpar e visÃ£o', () => {
  it('remover cancela a busca sÃ³ quando ninguÃ©m mais espera por ela', () => {
    const a = add(emptyCollection(), UNIQUE_BELT)
    const b = add(a.state, UNIQUE_BELT)
    const r1 = removeEntry(b.state, a.entry.id)
    expect(r1.cancelKey).toBeNull()
    const r2 = removeEntry(r1.state, b.entry.id)
    expect(r2.cancelKey).toBe(a.search!.key)
    expect(r2.state.entries).toHaveLength(0)
    expect(removeEntry(r2.state, 'nada').cancelKey).toBeNull()

    const stack = add(emptyCollection(), EXALTED_STACK)
    expect(removeEntry(stack.state, stack.entry.id).cancelKey).toBeNull()
  })

  it('limpar devolve as chaves pendentes e mantÃ©m ids Ãºnicos', () => {
    let s = add(emptyCollection(), EXALTED_STACK).state
    s = add(s, UNIQUE_BELT).state
    s = add(s, UNIQUE_BELT).state
    const cleared = clearCollection(s)
    expect(cleared.state.entries).toEqual([])
    expect(cleared.cancelKeys).toEqual([textKey(UNIQUE_BELT)])
    const again = add(cleared.state, UNIQUE_BELT)
    expect(s.entries.map((e) => e.id)).not.toContain(again.entry.id)
  })

  it('visÃ£o para a interface com posiÃ§Ãµes sÃ³ das linhas pendentes', () => {
    let s = add(emptyCollection(), EXALTED_STACK).state
    const u = add(s, UNIQUE_BELT)
    s = u.state
    const view = collectionView(s, {
      enabled: true,
      unit: 'exalted',
      rates: RATES,
      progress: { pending: 1, etaSeconds: 2, blockedSeconds: 0 },
      positions: new Map([[u.search!.key, 1], ['outra', 2]]),
    })
    expect(view.positions).toEqual({ [u.search!.key]: 1 })
    expect(view.total.lines).toBe(2)
    expect(view.total.approximate).toBe(true)
    // Precisa atravessar o IPC: sÃ³ dados simples.
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  })
})
