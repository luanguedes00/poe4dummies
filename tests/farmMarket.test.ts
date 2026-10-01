import { describe, expect, it } from 'vitest'
import { topTabletMods } from '../src/core/farm/market'
import type { PricedListing } from '../src/core/pricecheck'

const listing = (divine: number, mods: string[]): PricedListing => ({
  id: String(divine),
  amount: divine,
  currency: 'divine',
  seller: null,
  indexedAt: null,
  iconUrl: null,
  itemLevel: null,
  divine,
  mods: mods.map((text) => ({ text, kind: 'explicit' })),
})

describe('o que o mercado paga caro (tablets)', () => {
  it('conta os mods que se repetem nos caros e ignora preço de troll', () => {
    const reroll = (n: number) => `Ritual Altars in Map allow rerolling Favours ${n} additional times`
    const defer = (n: number) => `Deferring Favours at Ritual Altars in Map costs ${n}% reduced Tribute`
    const top = topTabletMods('Ritual Tablet', [
      listing(20, [reroll(3), defer(26)]),
      listing(18, [reroll(3), defer(29)]),
      listing(15, [reroll(2), defer(21), '+5% increased Pack Size']),
      listing(10, [reroll(2), 'Revived Monsters have 20% increased chance to be Rare']),
      listing(9999, ['troll']),
    ])
    expect(top.sample).toBe(4)
    expect(top.highDivine).toBe(20)
    expect(top.mods[0]).toEqual({ text: 'Ritual Altars in Map allow rerolling Favours # additional times', count: 4 })
    expect(top.mods[1]).toEqual({ text: 'Deferring Favours at Ritual Altars in Map costs #% reduced Tribute', count: 3 })
    // Mod que aparece em só 1 de 4 (25%) fica de fora.
    expect(top.mods.some((m) => /Pack Size/.test(m.text))).toBe(false)
  })
})
