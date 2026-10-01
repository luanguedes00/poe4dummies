import { describe, expect, it } from 'vitest'
import type { PriceCheckResult } from '../src/core/pricecheck'
import type { StatFilter } from '../src/core/trade/query'
import { itemVerdict } from '../src/core/verdict'

const RATES = { exaltedPerDivine: 500, chaosPerDivine: 10 }
const ITEM = { name: null, baseLine: 'Sapphire Ring', baseType: 'Sapphire Ring', rarity: 'Rare', itemClass: 'Rings', itemLevel: 80, corrupted: false, stackSize: null }
const OPTS = { minSellDivine: 0.01, undercut: 0.1 }

const TIERS = Array.from({ length: 8 }, (_, i) => ({ tier: i + 1, affix: 'prefix', itemLevel: 1, ranges: [[1, 1]] as Array<[number, number]>, min: 1, strictMin: 1 }))

function mod(statText: string, tier: number | null, kind: StatFilter['kind'] = 'explicit', value = 1): StatFilter {
  return { statId: statText, statText, modText: statText, kind, affix: null, tier: null, value, min: 1, max: null, enabled: true, rolledTier: tier, tiers: TIERS }
}

/** Anel bom: vida T1, 90% de resistência total, ataque T2. */
const GOOD = [mod('# to maximum Life', 1), mod('+#% total Elemental Resistance', null, 'pseudo', 90), mod('Adds # to # Physical Damage to Attacks', 2)]
/** Anel fraco: mana e accuracy. */
const WEAK = [mod('# to maximum Mana', 5), mod('# to Accuracy Rating', 3)]

function trade(median: number | null, total: number, filters: StatFilter[] = [], listings: number[] = []): PriceCheckResult {
  return {
    kind: 'trade', item: ITEM, league: 'X', filters, siteFilters: {}, status: 'online', unmatched: [],
    queryId: 'q', total,
    listings: listings.map((d, i) => ({ id: `l${i}`, amount: d, currency: 'divine', seller: null, indexedAt: null, iconUrl: null, itemLevel: null, divine: d })),
    cheapestDivine: median, medianDivine: median, rates: RATES,
  }
}

describe('itemVerdict', () => {
  it('vende quando o preço típico passa do mínimo, com sugestão abaixo do típico', () => {
    const v = itemVerdict(trade(0.2, 30), OPTS)
    expect(v.kind).toBe('sell')
    expect(v.suggestedDivine).toBeCloseTo(0.18)
    expect(v.reasons).toEqual(['listings-value'])
  })

  it('avisa quando há poucos anúncios (preço incerto)', () => {
    expect(itemVerdict(trade(0.2, 2), OPTS).reasons).toContain('uncertain-price')
  })

  it('lixo quando barato e sem mods de peso', () => {
    expect(itemVerdict(trade(0.002, 50, WEAK), OPTS).kind).toBe('junk')
  })

  it('guarda quando barato mas com mods de peso (nota alta)', () => {
    const v = itemVerdict(trade(0.002, 50, GOOD), OPTS)
    expect(v.kind).toBe('keep')
    expect(v.score!.score).toBeGreaterThanOrEqual(60)
  })

  it('sem anúncios: guarda se a nota for alta, senão lixo', () => {
    expect(itemVerdict(trade(null, 0, GOOD), OPTS).kind).toBe('keep')
    expect(itemVerdict(trade(null, 0, WEAK), OPTS).kind).toBe('junk')
  })

  it('nota: anel bom bem acima do fraco; mana e accuracy quase não contam', () => {
    const good = itemVerdict(trade(null, 0, GOOD), OPTS).score!
    const weak = itemVerdict(trade(null, 0, WEAK), OPTS).score!
    expect(good.score).toBeGreaterThan(weak.score + 40)
    expect(good.keyMods[0]!.text).toBe('# to maximum Life')
  })

  it('confiança: muitos anúncios com preços parecidos = alta; poucos ou espalhados = baixa', () => {
    const many = itemVerdict(trade(1, 40, GOOD, [1, 1, 1.1, 1.2, 1.2, 1.3, 1.4, 1.5, 1.5, 1.6]), OPTS)
    expect(many.confidence!.level).toBe('high')
    const spread = itemVerdict(trade(1, 40, GOOD, [0.1, 0.2, 2, 5, 9]), OPTS)
    expect(spread.confidence!.level).toBe('low')
    expect(itemVerdict(trade(null, 0, GOOD), OPTS).confidence!.level).toBe('none')
  })

  it('pilha: vende se o total passa do mínimo, senão guarda para juntar', () => {
    const market = (value: number, stack: number): PriceCheckResult => ({
      kind: 'market',
      item: { ...ITEM, rarity: 'Currency', stackSize: stack },
      market: { id: 'x', detailsId: 'x', name: 'X', category: 'Currency', iconUrl: null, valueDivine: value, volumeDivine: 1, change7d: 0, sparkline: [] },
      rates: RATES,
    })
    expect(itemVerdict(market(0.001, 20), OPTS).kind).toBe('sell')
    expect(itemVerdict(market(0.001, 3), OPTS).kind).toBe('keep')
  })

  it('erro de checagem vira "sem veredito"', () => {
    expect(itemVerdict({ kind: 'error', code: 'network', retryAfterSec: null }).kind).toBe('unknown')
  })
})

describe('base para craft', () => {
  it('branco de nível alto vira GUARDA; branco baixo vira LIXO', () => {
    const white = (ilvl: number): PriceCheckResult => ({ ...trade(0.001, 50), item: { ...ITEM, rarity: 'Normal', itemClass: 'Body Armours', itemLevel: ilvl } } as PriceCheckResult)
    expect(itemVerdict(white(84), OPTS)).toMatchObject({ kind: 'keep', reasons: ['craft-base'] })
    expect(itemVerdict(white(60), OPTS).kind).toBe('junk')
  })
})
