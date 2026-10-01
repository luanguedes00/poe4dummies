import { describe, expect, it } from 'vitest'
import { parseItemText } from '../src/core/item/parser'
import { StatIndex, type StatEntry } from '../src/core/item/statMatcher'
import { BODY_ARMOUR, RARE_RING, UNIQUE_BELT } from './fixtures/items'

// Subconjunto real de /api/trade2/data/stats (ids conferidos na API em 29/09/2026),
// mais alguns ids fictícios (prefixo "test.") para cobrir casos específicos.
export const STATS: StatEntry[] = [
  { id: 'explicit.stat_3299347043', text: '# to maximum Life', group: 'explicit' },
  { id: 'explicit.stat_3372524247', text: '#% to Fire Resistance', group: 'explicit' },
  { id: 'explicit.stat_3484657501', text: '# to Armour (Local)', group: 'explicit' },
  { id: 'explicit.stat_809229260', text: '# to Armour', group: 'explicit' },
  { id: 'explicit.stat_2866361420', text: '#% increased Armour', group: 'explicit' },
  { id: 'explicit.stat_3032590688', text: 'Adds # to # Physical Damage to Attacks', group: 'explicit' },
  { id: 'test.mana', text: '# to maximum Mana', group: 'explicit' },
  { id: 'test.light', text: '#% to Lightning Resistance', group: 'explicit' },
  { id: 'test.dex', text: '# to Dexterity', group: 'explicit' },
  { id: 'test.str', text: '# to Strength', group: 'explicit' },
  { id: 'test.attr', text: '#% increased Attribute Requirements', group: 'explicit' },
  { id: 'test.hh', text: 'When you kill a Rare monster, you gain its Modifiers for # seconds', group: 'explicit' },
  { id: 'test.ignite', text: 'Drop Ignited Ground while moving, which lasts 8 seconds and Ignites as though dealing Fire Damage equal to #% of your maximum Life', group: 'explicit' },
  { id: 'implicit.cold', text: '#% to Cold Resistance', group: 'implicit' },
  { id: 'implicit.stun', text: '#% to Stun Threshold', group: 'implicit' },
  { id: 'rune.fire', text: '#% to Fire Resistance', group: 'rune' },
]

const index = new StatIndex(STATS)

describe('StatIndex', () => {
  it('casa todos os mods de um anel raro', () => {
    const { matched, unmatched } = index.matchItem(parseItemText(RARE_RING))
    expect(unmatched).toEqual([])
    expect(matched.map((m) => [m.stat.id, m.value])).toEqual([
      ['implicit.cold', 23],
      ['explicit.stat_3299347043', 78],
      ['test.mana', 41],
      ['explicit.stat_3372524247', 32],
      ['test.light', 19],
      ['test.dex', 14],
    ])
  })

  it('prefere o mod local em armaduras e inverte "reduced"', () => {
    const { matched, unmatched } = index.matchItem(parseItemText(BODY_ARMOUR))
    expect(unmatched).toEqual([])
    const ids = Object.fromEntries(matched.map((m) => [m.mod.text, [m.stat.id, m.value]]))
    expect(ids['+120 to Armour']).toEqual(['explicit.stat_3484657501', 120])
    expect(ids['+12% to Fire Resistance']).toEqual(['rune.fire', 12])
    expect(ids['10% reduced Attribute Requirements']).toEqual(['test.attr', -10])
  })

  it('não usa o mod local fora de armas e armaduras', () => {
    const ring = parseItemText(RARE_RING.replace('+14 to Dexterity', '+50 to Armour'))
    const { matched } = index.matchItem(ring)
    expect(matched.find((m) => m.mod.text === '+50 to Armour')?.stat.id).toBe('explicit.stat_809229260')
  })

  it('usa a média em mods com dois números', () => {
    const match = index.match({ text: 'Adds 5 to 11 Physical Damage to Attacks', kind: 'explicit', values: [5, 11], affix: null, tier: null, affixName: null }, false)
    expect(match?.value).toBe(8)
  })

  it('casa mods com número fixo no texto', () => {
    const text = 'Drop Ignited Ground while moving, which lasts 8 seconds and Ignites as though dealing Fire Damage equal to 25% of your maximum Life'
    const match = index.match({ text, kind: 'explicit', values: [8, 25], affix: null, tier: null, affixName: null }, false)
    expect(match?.stat.id).toBe('test.ignite')
    expect(match?.value).toBe(25)
  })

  it('descarta o texto de ambientação dos únicos', () => {
    const { matched, unmatched } = index.matchItem(parseItemText(UNIQUE_BELT))
    expect(matched.map((m) => m.stat.id)).toContain('test.hh')
    expect(unmatched.map((m) => m.text).join(' ')).toContain("A man's soul")
  })
})
