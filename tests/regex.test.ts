import { describe, expect, it } from 'vitest'
import { buildRegex, numberAtLeast, parseTabletMods, SEARCH_LIMIT, termFor } from '../src/core/farm/regex'

// Amostra no formato do RePoE (mods.min.json), com tiers repetidos e marcação [a|b].
const RAW = {
  a: { domain: 'tablet', generation_type: 'suffix', text: '[ContainsRitual|Ritual] Favours in Map have (35-50)% increased chance to be [Omen|Omens]', spawn_weights: [{ tag: 'tower_augment_ritual', weight: 1 }] },
  b: { domain: 'tablet', generation_type: 'suffix', text: '[ContainsRitual|Ritual] Favours in Map have (51-70)% increased chance to be [Omen|Omens]', spawn_weights: [{ tag: 'tower_augment_ritual', weight: 1 }] },
  c: { domain: 'tablet', generation_type: 'suffix', text: 'Deferring Favours at [ContainsRitual|Ritual Altars] in Map costs (30-20)% reduced Tribute', spawn_weights: [{ tag: 'tower_augment_ritual', weight: 1 }] },
  d: { domain: 'tablet', generation_type: 'suffix', text: '[ContainsRitual|Ritual Altars] in Map allow rerolling Favours (1-3) additional times', spawn_weights: [{ tag: 'tower_augment_ritual', weight: 1 }] },
  e: { domain: 'tablet', generation_type: 'prefix', text: 'Map has (10-20)% increased Magic Monsters', spawn_weights: [{ tag: 'tower_augment', weight: 1 }] },
  f: { domain: 'tablet', generation_type: 'prefix', text: 'Breaches in Map spawn (10-20)% increased Magic Monsters', spawn_weights: [{ tag: 'tower_augment_breach', weight: 1 }] },
  g: { domain: 'item', text: 'nada a ver' },
}
const mods = parseTabletMods(RAW)
const find = (part: string) => mods.find((m) => m.text.includes(part))!
const match = (term: string, line: string) => new RegExp(term, 'i').test(line)

describe('gerador de regex (tablets)', () => {
  it('lê só mods de tablet, tira a marcação e junta os tiers do mesmo mod', () => {
    expect(mods).toHaveLength(5)
    const omen = find('Omens')
    expect(omen.text).toBe('Ritual Favours in Map have #% increased chance to be Omens')
    expect([omen.min, omen.max]).toEqual([35, 70])
    expect(omen.types).toEqual(['ritual'])
  })

  it('número mínimo: só valores iguais ou maiores', () => {
    const re = new RegExp(`^${numberAtLeast(60)}$`)
    for (const n of [60, 61, 69, 70, 99, 100, 250]) expect(re.test(String(n)), String(n)).toBe(true)
    for (const n of [0, 5, 45, 59]) expect(re.test(String(n)), String(n)).toBe(false)
    const re12 = new RegExp(`^${numberAtLeast(12)}$`)
    expect([11, 12, 19, 20, 120].map((n) => re12.test(String(n)))).toEqual([false, true, true, true, true])
    // Curto quando se sabe o máximo do mod (a busca do PoE2 aceita poucos caracteres).
    expect(numberAtLeast(20, 30)).toBe('[2-9]\\d')
    expect(numberAtLeast(2, 3)).toBe('[2-9]')
    const re65 = new RegExp(`^${numberAtLeast(65, 99)}$`)
    expect([64, 65, 69, 70, 99].map((n) => re65.test(String(n)))).toEqual([false, true, true, true, true])
    // Como o jogo usa: trecho dentro da linha (sem âncora).
    for (let min = 1; min <= 150; min++) {
      const re = new RegExp(numberAtLeast(min))
      for (let n = 0; n <= 400; n++) if (re.test(String(n)) !== n >= min) throw new Error(`min ${min}, n ${n}: ${numberAtLeast(min)}`)
    }
  })

  it('combo Reroll + Defer cabe na busca do PoE2', () => {
    const r = buildRegex(
      [
        { key: find('rerolling').key, mode: 'all', min: 2 },
        { key: find('Deferring').key, mode: 'all', min: 20 },
      ],
      mods,
    )
    expect(r.tooLong).toBe(false)
    expect(match(r.text.split('" "')[0]!.replace(/"/g, ''), 'Ritual Altars in Map allow rerolling Favours 3 additional times')).toBe(true)
    expect(match(r.text.split('" "')[0]!.replace(/"/g, ''), 'Ritual Altars in Map allow rerolling Favours 1 additional times')).toBe(false)
  })

  it('cada mod bate na própria linha e não nas outras (inclusive texto contido em outro mod)', () => {
    const lines: Record<string, string> = {
      Omens: 'Ritual Favours in Map have 62% increased chance to be Omens',
      Deferring: 'Deferring Favours at Ritual Altars in Map costs 26% reduced Tribute',
      rerolling: 'Ritual Altars in Map allow rerolling Favours 3 additional times',
      'Map has': 'Map has 15% increased Magic Monsters',
      Breaches: 'Breaches in Map spawn 15% increased Magic Monsters',
    }
    for (const [part, line] of Object.entries(lines)) {
      const term = termFor(find(part), mods, null)!
      expect(match(term, line), `${term} ~ ${line}`).toBe(true)
      for (const other of Object.values(lines).filter((l) => l !== line)) expect(match(term, other), `${term} !~ ${other}`).toBe(false)
    }
  })

  it('combina: qualquer um (|), todos (termos separados) e esconder (!)', () => {
    const r = buildRegex(
      [
        { key: find('Omens').key, mode: 'any', min: 60 },
        { key: find('Deferring').key, mode: 'any', min: null },
        { key: find('rerolling').key, mode: 'all', min: 2 },
        { key: find('Breaches').key, mode: 'exclude', min: null },
      ],
      mods,
    )
    const parts = r.text.match(/"[^"]*"/g)!
    expect(parts).toHaveLength(3)
    expect(parts[0]).toContain('|')
    expect(parts[2]!.startsWith('"!')).toBe(true)
    expect(r.length).toBe(r.text.length)
    expect(r.tooLong).toBe(r.length > SEARCH_LIMIT)
  })
})
