import { describe, expect, it } from 'vitest'
import { analyzeHistory, quickSignals, rebaseSparkline, topMovers } from '../src/core/market/analysis'
import { changeOver, dailyVolatility, rsi, sma } from '../src/core/market/indicators'
import type { MarketItem } from '../src/core/types'

// Histórico real do Chaos Orb em Exalted (Forbidden Rites, 04/09 a 29/09/2026).
const CHAOS = [1.54, 2.68, 4.82, 7.2, 14.22, 21.7, 24.55, 26.94, 35.15, 39.57, 45.43, 48.42, 50.63, 53.73, 57.91, 57.82, 57.48, 60.15, 67.58, 66.72, 69.31, 66.25, 66.34, 69.35, 65.05, 66.77]
const CHAOS_VOL = [12, 200, 672, 719, 1662, 1663, 1670, 1655, 2024, 1950, 1806, 1497, 1577, 1291, 1328, 1307, 1320, 1047, 1042, 952, 990, 919, 1030, 850, 834, 742]

describe('indicadores', () => {
  it('sma', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5])
  })

  it('rsi: só alta = 100, só queda = 0, curto = null', () => {
    expect(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])).toBe(100)
    expect(rsi([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toBe(0)
    expect(rsi([1, 2, 3])).toBeNull()
  })

  it('variação e volatilidade', () => {
    expect(changeOver([100, 110], 1)).toBeCloseTo(10)
    expect(changeOver([100], 1)).toBeNull()
    expect(dailyVolatility([100, 100, 100])).toBe(0)
  })
})

describe('analyzeHistory', () => {
  it('lê o Chaos Orb real como mercado lateral', () => {
    const a = analyzeHistory(CHAOS, CHAOS_VOL)!
    expect(a.days).toBe(26)
    expect(a.high).toBe(69.35)
    expect(a.trend).toBe('sideways')
    expect(a.stance).toBe('neutral')
    expect(a.change7d).toBeCloseTo(-1.2, 1)
    expect(a.reasons.map((r) => r.code)).toContain('trend-sideways')
  })

  it('detecta tendência de alta', () => {
    const up = Array.from({ length: 25 }, (_, i) => 10 + i * 0.5 + (i % 3 === 0 ? -0.3 : 0))
    const a = analyzeHistory(up, up.map(() => 50))!
    expect(a.trend).toBe('up')
    expect(a.reasons.map((r) => r.code)).toContain('trend-up')
  })

  it('reduz a confiança com pouca liquidez', () => {
    const down = Array.from({ length: 25 }, (_, i) => 100 - i * 2)
    const liquid = analyzeHistory(down, down.map(() => 50))!
    const illiquid = analyzeHistory(down, down.map(() => 0.1))!
    expect(Math.abs(illiquid.score)).toBeLessThan(Math.abs(liquid.score))
    expect(illiquid.reasons.map((r) => r.code)).toContain('low-liquidity')
  })

  it('rejeita séries inválidas', () => {
    expect(analyzeHistory([1, 2], [1, 1])).toBeNull()
    expect(analyzeHistory([1, 0, 2], [1, 1, 1])).toBeNull()
  })
})

describe('sparkline e sinais', () => {
  it('converte a variação de Divine para Exalted (dados reais)', () => {
    const chaosInDivine = [2.68, 3.25, 3.77, 1.33, 0.1, -1.52, -15.33]
    const exaltedInDivine = [-1.2, -2.93, -1.87, -0.96, -2.98, -5.91, -16.5]
    const inExalted = rebaseSparkline(chaosInDivine, exaltedInDivine)
    expect(inExalted[6]).toBeCloseTo(1.4, 1)
  })

  it('sinais rápidos', () => {
    expect(quickSignals([1, 5, 10, 12, 15, 18, 22], 100)).toEqual(['rising'])
    expect(quickSignals([-2, -5, -10, -15, -20, -25, -30], 100)).toEqual(['falling'])
    expect(quickSignals([-2, -5, -10, -30, -40, -35, -20], 100)).toEqual(['recovering'])
    expect(quickSignals([0, 1], 0.2)).toEqual(['illiquid'])
  })

  it('topMovers ignora itens ilíquidos', () => {
    const mk = (id: string, change: number, vol: number): MarketItem => ({
      id, detailsId: id, name: id, category: 'Currency', iconUrl: null, valueDivine: 1, volumeDivine: vol, change7d: change, sparkline: [],
    })
    const items = [mk('a', 50, 0.1), mk('b', 20, 10), mk('c', -30, 10), mk('d', 5, 10)]
    const movers = topMovers(items, (i) => i.change7d)
    expect(movers.risers.map((i) => i.id)).toEqual(['b', 'd'])
    expect(movers.fallers.map((i) => i.id)).toEqual(['c'])
    expect(movers.mostTraded[0]!.id).not.toBe('a')
  })
})
