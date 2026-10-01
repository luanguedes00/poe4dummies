import { describe, expect, it } from 'vitest'
import { findRecipe, MECHANICS } from '../src/core/farm/mechanics'
import { recipeQuery, recipeReferencePrice, setupCost } from '../src/core/farm/recipes'
import type { TabletPrice } from '../src/core/sources/ninja'

const p = (name: string, baseType: string, variant: string | null, value: number, unique = false): TabletPrice => ({
  name, baseType, variant, unique, iconUrl: null, valueDivine: value, change7d: 0, listings: 1,
})
const PRICES = [p('Ritual Tablet', 'Ritual Tablet', 'Rare', 0.06), p('Ritual Tablet', 'Ritual Tablet', 'Magic', 0.26), p('Freedom of Faith', 'Ritual Tablet', null, 0.18, true)]

describe('guias por mecânica', () => {
  it('dados consistentes: receitas dos setups existem, ids da trade válidos, setups de 3 e 4', () => {
    for (const g of MECHANICS) {
      expect(g.requirements.length).toBeGreaterThan(0)
      for (const s of g.setups) {
        expect(s.items.reduce((n, i) => n + i.count, 0)).toBe(s.slots)
        for (const i of s.items) expect(g.recipes.some((r) => r.id === i.recipeId)).toBe(true)
      }
      for (const r of g.recipes) {
        expect(r.mods.length).toBeLessThanOrEqual(2)
        for (const m of r.mods) expect(m.statId).toMatch(/^explicit\.stat_\d+$/)
      }
      expect(new Set(g.setups.map((s) => `${s.kind}-${s.slots}`)).size).toBe(4)
    }
  })

  it('busca da receita "Omens + defer": raro, omen mín. 60 e defer como máximo negativo', () => {
    const q = recipeQuery(findRecipe('ritual', 'ritual-omen-defer')!, 'online')
    expect(q.query.type).toBe('Ritual Tablet')
    expect(q.query.filters?.['type_filters']).toEqual({ filters: { rarity: { option: 'rare' } } })
    expect(q.query.stats[0]!.filters).toEqual([
      { id: 'explicit.stat_4219853180', value: { min: 60 }, disabled: false },
      { id: 'explicit.stat_1345835998', value: { max: -25 }, disabled: false },
      // Tablet comum: sempre com os 10 usos.
      { id: 'pseudo.pseudo_number_of_uses_remaining', value: { min: 10 }, disabled: false },
    ])
  })

  it('busca de único usa o nome e não exige 10 usos (únicos têm menos)', () => {
    const q = recipeQuery(findRecipe('ritual', 'ritual-unique')!, 'online')
    expect(q.query.name).toBe('Freedom of Faith')
    expect(q.query.stats[0]!.filters.some((f) => f.id === 'pseudo.pseudo_number_of_uses_remaining')).toBe(false)
  })

  it('o filtro de 10 usos não aparece na descrição do tablet', () => {
    expect(findRecipe('ritual', 'ritual-omen-defer')!.mods.some((m) => /uso/i.test(m.label))).toBe(false)
  })

  it('custo do setup budget de 3 do Ritual com preços do poe.ninja', () => {
    const ritual = MECHANICS.find((m) => m.id === 'ritual')!
    expect(recipeReferencePrice(findRecipe('ritual', 'ritual-omen-budget')!, PRICES)).toBe(0.26)
    const budget3 = ritual.setups.find((s) => s.kind === 'budget' && s.slots === 3)!
    const cost = setupCost(ritual, budget3, PRICES)
    // Freedom of Faith 0,18/5 + 2 × 0,26/10
    expect(cost.perMap).toBeCloseTo(0.088)
    expect(cost.total).toBeCloseTo(0.7)
    expect(cost.missing).toBe(0)
  })
})
