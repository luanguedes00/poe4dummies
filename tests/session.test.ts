import { describe, expect, it } from 'vitest'
import { sessionProfit } from '../src/core/farm/session'

describe('sessionProfit', () => {
  it('loot por mapa e por hora, e lucro descontando o custo dos mapas', () => {
    const r = sessionProfit({ lootDivine: 3, maps: 10, totalMs: 60 * 60 * 1000, costPerMapDivine: 0.1 })
    expect(r.lootPerMap).toBeCloseTo(0.3)
    expect(r.lootPerHour).toBeCloseTo(3)
    expect(r.profit).toBeCloseTo(2)
    expect(r.profitPerHour).toBeCloseTo(2)
  })

  it('sessão curta demais não inventa média por hora; sem custo não inventa lucro', () => {
    const r = sessionProfit({ lootDivine: 1, maps: 1, totalMs: 60 * 1000 })
    expect(r.lootPerHour).toBeNull()
    expect(r.profit).toBeNull()
    expect(r.lootPerMap).toBe(1)
  })

  it('sem mapas não divide por zero', () => {
    expect(sessionProfit({ lootDivine: 1, maps: 0, totalMs: 0 }).lootPerMap).toBeNull()
  })
})
