import { describe, expect, it } from 'vitest'
import { priceForNeed, setupEconomics, strategyTabletCost } from '../src/core/farm/economics'
import { STRATEGIES } from '../src/core/farm/strategies'
import type { TabletPrice } from '../src/core/sources/ninja'

const tablet = (name: string, variant: string | null, value: number, unique = false): TabletPrice => ({
  name, baseType: unique ? 'Abyss Tablet' : name, variant, unique, iconUrl: null, valueDivine: value, change7d: 0, listings: 10,
})

// Preços reais do poe.ninja de 29/09/2026 (Forbidden Rites), em Divine.
const PRICES = [
  tablet('Irradiated Tablet', 'Rare', 0.107),
  tablet('Irradiated Tablet', 'Normal', 0.404),
  tablet('Unforeseen Consequences', null, 0.53, true),
]

describe('farm', () => {
  it('acha o preço do tablet comum por tipo + raridade e do único pelo nome', () => {
    expect(priceForNeed({ baseType: 'Irradiated Tablet', variant: 'Rare', count: 1, uses: 10, targetMods: [] }, PRICES)?.valueDivine).toBe(0.107)
    expect(priceForNeed({ baseType: 'Abyss Tablet', unique: 'Unforeseen Consequences', count: 1, uses: 5, targetMods: [] }, PRICES)?.valueDivine).toBe(0.53)
    expect(priceForNeed({ baseType: 'Breach Tablet', variant: 'Rare', count: 1, uses: 10, targetMods: [] }, PRICES)).toBeNull()
  })

  it('custo por mapa = preço ÷ usos × quantidade + waystone + extras; lucro por hora', () => {
    const e = setupEconomics({
      tablets: [{ priceDivine: 0.1, uses: 10, count: 3 }, { priceDivine: 0.5, uses: 5, count: 1 }, { priceDivine: null, uses: 10, count: 1 }],
      waystoneDivine: 0.05,
      extrasDivine: 0.02,
      returnDivine: 0.5,
      mapsPerHour: 10,
    })
    expect(e.tabletsPerMap).toBeCloseTo(0.13)
    expect(e.costPerMap).toBeCloseTo(0.2)
    expect(e.missingPrices).toBe(1)
    expect(e.profitPerMap).toBeCloseTo(0.3)
    expect(e.profitPerHour).toBeCloseTo(3)
  })

  it('sem retorno informado não inventa lucro', () => {
    const e = setupEconomics({ tablets: [], waystoneDivine: 0, extrasDivine: 0, returnDivine: null, mapsPerHour: 12 })
    expect(e.profitPerMap).toBeNull()
    expect(e.profitPerHour).toBeNull()
  })

  it('custo de tablets da estratégia 200% Deli Abyss com preços reais', () => {
    const deli = STRATEGIES.find((s) => s.id === 'deli-abyss')!
    // 0,53/5 + 3 × 0,107/10 = 0,106 + 0,0321
    expect(strategyTabletCost(deli, PRICES).tabletsPerMap).toBeCloseTo(0.1381, 3)
  })

  it('toda estratégia tem fonte e pelo menos um tablet', () => {
    for (const s of STRATEGIES) {
      expect(s.sources.length).toBeGreaterThan(0)
      expect(s.tablets.length).toBeGreaterThan(0)
      for (const src of s.sources) expect(src.url.startsWith('https://')).toBe(true)
    }
  })
})
