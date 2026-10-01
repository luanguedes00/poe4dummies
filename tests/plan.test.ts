import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Build } from '../src/core/build/model'
import { buildPlan, nextStep, stepImpact, type PlanStep } from '../src/core/build/plan'
import { encodePobCode, importPobCode } from '../src/core/build/pob'

const guide = importPobCode(encodePobCode(readFileSync(join(__dirname, 'fixtures', 'pob-showcase.xml'), 'utf8')), { kind: 'code' })

/** Build do jogador: a do guia com o que costuma faltar no meio da campanha/início dos mapas. */
function mine(): Build {
  const b: Build = structuredClone(guide)
  b.stats = { ...b.stats, FireResist: 60, ColdResist: 75, Str: 50, ReqStr: 64, Life: 2000, EnergyShield: 1400, CombinedDPS: 900_000 }
  b.skills = b.skills
    .filter((g) => !g.gems.some((gem) => gem.name === 'Archmage'))
    .map((g) =>
      g.main
        ? { ...g, gems: g.gems.filter((gem) => gem.name !== 'Magnified Area I').map((gem) => (gem.name === 'Fireball' ? { ...gem, level: 15 } : gem)) }
        : g,
    )
  b.items = b.items
    .filter((i) => i.slot !== 'Boots')
    .map((i) => {
      if (i.slot === 'Helmet') return { ...i, mods: ['+40 to maximum Life'], properties: { ...i.properties, energyShield: 60 } }
      if (i.slot === 'Amulet') return { ...i, rarity: 'Rare', name: 'Plain Choker', mods: ['+20 to maximum Life'], implicits: 0 }
      if (i.slot === 'Weapon 1') return { ...i, mods: ['60% increased Spell Damage'] }
      return i
    })
  return b
}

describe('plano de upgrade (minha build x guia)', () => {
  const plan = buildPlan(mine(), guide)
  const kinds = plan.map((s) => s.kind)

  it('prioriza resistência e requisito antes de peças e gemas; sem "busque vida" genérico', () => {
    expect(plan[0]).toMatchObject({ kind: 'resist', key: 'fireRes', missing: 15 })
    // Onde cabe: capacete e amuleto só com vida, botas vazias.
    const res = plan[0] as Extract<PlanStep, { kind: 'resist' }>
    expect(res.slots).toEqual(expect.arrayContaining(['Helmet', 'Amulet', 'Boots']))
    // Próximo passo: o primeiro de impacto alto (resistência faltando 15%).
    expect(stepImpact(res)).toBe('high')
    expect(nextStep(plan)).toBe(plan[0])
    expect(plan).toContainEqual({ kind: 'attribute', key: 'str', missing: 14 })
    expect(kinds).not.toContain('pool')
    expect(kinds.indexOf('attribute')).toBeLessThan(kinds.indexOf('unique'))
    expect(kinds.indexOf('item')).toBeLessThan(kinds.indexOf('skill'))
  })

  it('arma vem antes das outras peças', () => {
    const gear = plan.filter((s) => s.kind === 'item' || s.kind === 'unique')
    expect(gear[0]).toMatchObject({ slot: 'Weapon 1' })
  })

  it('mods de tier baixo viram passo com a peça e o tier', () => {
    const report = {
      'Body Armour': [
        { text: '+40% increased Energy Shield', statId: 'x.es', tier: 6, tiers: 8, bestMin: 101 },
        { text: '+80 to maximum Life', statId: 'x.life', tier: 1, tiers: 8, bestMin: 80 },
      ],
    }
    const withTiers = buildPlan(mine(), guide, report)
    const step = withTiers.find((s) => s.kind === 'tier')
    expect(step).toMatchObject({ kind: 'tier', slot: 'Body Armour' })
    // T1 não é problema: só o mod fraco entra.
    expect(step?.kind === 'tier' && step.mods.map((m) => m.statId)).toEqual(['x.es'])
  })

  it('peças: único do guia que falta, slot vazio e raro mais fraco', () => {
    expect(plan).toContainEqual({ kind: 'unique', slot: 'Amulet', name: 'Astramentis' })
    const boots = plan.find((s) => s.kind === 'item' && s.slot === 'Boots')
    expect(boots).toMatchObject({ kind: 'item', empty: true })
    const helmet = plan.find((s) => s.kind === 'item' && s.slot === 'Helmet')
    expect(helmet).toMatchObject({ kind: 'item', empty: false })
    expect(helmet?.kind === 'item' && helmet.gaps.map((g) => g.key)).toEqual(expect.arrayContaining(['fireRes', 'lightningRes', 'life']))
    // A varinha do jogador não tem o "+3 to Level of all Fire Spell Skills" do guia.
    const weapon = plan.find((s) => s.kind === 'item' && s.slot === 'Weapon 1')
    expect(weapon?.kind === 'item' && weapon.missingMods).toContain('+3 to Level of all Fire Spell Skills')
    // Peças iguais às do guia não aparecem.
    expect(plan.some((s) => (s.kind === 'item' || s.kind === 'unique') && s.slot === 'Body Armour')).toBe(false)
  })

  it('gemas: skill que falta, support que falta e nível atrasado; grupo desligado do guia é ignorado', () => {
    expect(plan).toContainEqual({ kind: 'skill', skill: 'Archmage', supports: [] })
    expect(plan).toContainEqual({ kind: 'support', skill: 'Fireball', support: 'Magnified Area I' })
    expect(plan).toContainEqual({ kind: 'gem-level', gem: 'Fireball', mine: 15, guide: 20 })
    expect(plan.some((s) => s.kind === 'skill' && s.skill === 'Frost Bomb')).toBe(false)
  })

  it('dano bem abaixo do guia vira um aviso no fim', () => {
    expect(plan[plan.length - 1]).toEqual({ kind: 'dps', mine: 900_000, guide: 1_843_000 })
  })

  it('build igual ao guia: plano vazio', () => {
    expect(buildPlan(guide, guide)).toEqual([])
  })
})
