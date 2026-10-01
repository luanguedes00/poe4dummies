import { describe, expect, it } from 'vitest'
import { bestUnit, otherUnits, smartPrice } from '../src/core/money'

describe('moeda escolhida pelo item', () => {
  // 1 Div = 400 Ex = 20 Chaos (Chaos vale mais que Ex no PoE2).
  const rates = { exaltedPerDivine: 400, chaosPerDivine: 20 }
  it('usa a moeda mais valiosa em que o número dá 1 ou mais', () => {
    expect(bestUnit(3, rates)).toBe('divine')
    expect(bestUnit(0.5, rates)).toBe('chaos') // 10 Chaos
    expect(bestUnit(0.01, rates)).toBe('exalted') // 0,2 Chaos → 4 Ex
  })
  it('números redondos', () => {
    expect(smartPrice(0.01, rates)).toBe('4 Ex')
    expect(smartPrice(0.1234, rates)).toBe('2,5 Chaos')
    expect(smartPrice(0.5, rates)).toBe('10 Chaos')
  })
  it('currency não aparece na própria moeda', () => {
    expect(otherUnits(1, rates, 'divine')).toEqual(['20 Chaos', '400 Ex'])
    expect(bestUnit(1, rates, 'divine')).toBe('chaos')
  })
})
