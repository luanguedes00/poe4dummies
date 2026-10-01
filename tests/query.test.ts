import { describe, expect, it } from 'vitest'
import { parseItemText } from '../src/core/item/parser'
import { StatIndex } from '../src/core/item/statMatcher'
import { applyOverrides, buildTradeQuery, defaultFilters, resolveBaseType } from '../src/core/trade/query'
import { MAGIC_RING, RARE_RING, UNIDENTIFIED, UNIQUE_BELT } from './fixtures/items'
import { STATS } from './statMatcher.test'

const index = new StatIndex(STATS)
const BASES = ['Ring', 'Sapphire Ring', 'Ruby Ring', 'Heavy Belt']

describe('defaultFilters', () => {
  it('liga explícitos a 90% e deixa implícitos desligados', () => {
    const item = parseItemText(RARE_RING)
    const filters = defaultFilters(item, index.matchItem(item).matched, 90)
    const life = filters.find((f) => f.statId === 'explicit.stat_3299347043')!
    expect(life).toMatchObject({ enabled: true, min: 70, max: null, value: 78 })
    expect(filters.find((f) => f.statId === 'implicit.cold')!.enabled).toBe(false)
  })

  it('em únicos começa tudo desligado', () => {
    const item = parseItemText(UNIQUE_BELT)
    const filters = defaultFilters(item, index.matchItem(item).matched, 90)
    expect(filters.every((f) => !f.enabled)).toBe(true)
  })

  it('aplica os ajustes feitos pelo usuário', () => {
    const item = parseItemText(RARE_RING)
    const filters = defaultFilters(item, index.matchItem(item).matched, 90)
    const changed = applyOverrides(filters, [{ statId: 'test.dex', enabled: false, min: null, max: null }])
    expect(changed.find((f) => f.statId === 'test.dex')!.enabled).toBe(false)
    expect(changed.find((f) => f.statId === 'explicit.stat_3299347043')!.enabled).toBe(true)
  })
})

describe('resolveBaseType', () => {
  it('usa a linha base em raros e não identificados', () => {
    expect(resolveBaseType(parseItemText(RARE_RING), BASES)).toBe('Sapphire Ring')
    expect(resolveBaseType(parseItemText(UNIDENTIFIED), BASES)).toBe('Sapphire Ring')
  })

  it('acha o maior tipo base dentro do nome de um item mágico', () => {
    expect(resolveBaseType(parseItemText(MAGIC_RING), BASES)).toBe('Sapphire Ring')
  })
})

describe('buildTradeQuery', () => {
  it('monta a busca de um raro com os filtros ligados', () => {
    const item = parseItemText(RARE_RING)
    const filters = defaultFilters(item, index.matchItem(item).matched, 90)
    const q = buildTradeQuery(item, 'Sapphire Ring', filters, 'online')
    expect(q.sort).toEqual({ price: 'asc' })
    expect(q.query.type).toBe('Sapphire Ring')
    expect(q.query.name).toBeUndefined()
    expect(q.query.status.option).toBe('online')
    expect(q.query.stats[0]!.filters).toContainEqual({ id: 'explicit.stat_3299347043', value: { min: 70 }, disabled: false })
    expect(q.query.stats[0]!.filters.some((f) => f.id === 'implicit.cold')).toBe(false)
    expect(q.query.filters?.['misc_filters']).toEqual({ filters: { corrupted: { option: 'true' } } })
    expect(q.query.filters?.['type_filters']).toEqual({ filters: { rarity: { option: 'nonunique' } } })
  })

  it('busca únicos pelo nome', () => {
    const item = parseItemText(UNIQUE_BELT)
    const q = buildTradeQuery(item, 'Heavy Belt', [], 'any')
    expect(q.query.name).toBe('Headhunter')
    expect(q.query.type).toBe('Heavy Belt')
    expect(q.query.filters?.['type_filters']).toEqual({ filters: { rarity: { option: 'unique' } } })
  })
})

describe('seleção inteligente (como o Exiled Exchange 2)', () => {
  const item = parseItemText(RARE_RING)
  const filters = defaultFilters(item, index.matchItem(item).matched, 90)

  it('mods de pouco peso começam desmarcados, mas continuam na lista', () => {
    for (const id of ['test.mana', 'test.dex']) {
      const f = filters.find((x) => x.statId === id)
      if (f) expect(f.enabled, id).toBe(false)
    }
    expect(filters.find((f) => f.statId === 'explicit.stat_3299347043')!.enabled).toBe(true)
  })

  it('resistências elementais viram uma linha total; as individuais ficam recolhidas', () => {
    const total = filters.find((f) => f.statId === 'pseudo.pseudo_total_elemental_resistance')
    const singles = filters.filter((f) => f.group === 'pseudo.pseudo_total_elemental_resistance')
    expect(total?.enabled).toBe(true)
    expect(singles.length).toBeGreaterThan(0)
    expect(singles.every((f) => !f.enabled)).toBe(true)
    expect(total!.value).toBe(singles.reduce((s, f) => s + (f.value ?? 0), 0))
  })

  it('a busca de item da build usa os mods crus', () => {
    const raw = defaultFilters(item, index.matchItem(item).matched, 90, false)
    expect(raw.some((f) => f.statId.startsWith('pseudo.'))).toBe(false)
  })
})
const BOW = `Item Class: Bows
Rarity: Rare
Storm Bane
Recurve Bow
--------
Bow
Physical Damage: 40-80 (augmented)
Lightning Damage: 10-50 (augmented)
Critical Hit Chance: 5.00%
Attacks per Second: 1.20
--------
Requires: Level 60
--------
Item Level: 80
--------
+120% increased Physical Damage
Adds 10 to 50 Lightning Damage
+50 to Dexterity
+30% to Fire Resistance
`

const BODY = `Item Class: Body Armours
Rarity: Rare
Grim Shell
Lacquered Vest
--------
Evasion Rating: 812 (augmented)
Energy Shield: 230 (augmented)
--------
Requires: Level 70
--------
Item Level: 81
--------
+90 to maximum Life
+80% increased Evasion and Energy Shield
+35% to Fire Resistance
+30% to Cold Resistance
+40 to Intelligence
+15% to Chaos Resistance
`

describe('busca padrão por tipo de peça (como o Exiled Exchange 2)', () => {
  const STATS2 = [
    ...STATS,
    { id: 'x.physpct', text: '#% increased Physical Damage', group: 'explicit' },
    { id: 'x.lightadd', text: 'Adds # to # Lightning Damage', group: 'explicit' },
    { id: 'x.evaes', text: '#% increased Evasion and Energy Shield', group: 'explicit' },
    { id: 'x.cold', text: '#% to Cold Resistance', group: 'explicit' },
    { id: 'x.int', text: '# to Intelligence', group: 'explicit' },
    { id: 'x.chaos', text: '#% to Chaos Resistance', group: 'explicit' },
  ]
  const idx = new StatIndex(STATS2)
  const run = (text: string) => {
    const item = parseItemText(text)
    return { item, filters: defaultFilters(item, idx.matchItem(item).matched, 90) }
  }

  it('arma: só o DPS vem marcado', () => {
    const { item, filters } = run(BOW)
    const dps = filters.find((f) => f.statId === 'equip.dps')!
    // (60 + 30) × 1,2 = 108 de DPS.
    expect(dps.value).toBe(108)
    expect(dps.min).toBe(97)
    expect(filters.filter((f) => f.enabled).map((f) => f.statId)).toEqual(['equip.dps'])
    const query = buildTradeQuery(item, 'Recurve Bow', filters, 'securable')
    expect(query.query.filters?.['equipment_filters']).toEqual({ filters: { dps: { min: 97 } } })
    expect(query.query.stats[0]!.filters).toEqual([])
  })

  it('armadura: defesa da peça, resistência total, vida e caos; o resto desmarcado', () => {
    const { item, filters } = run(BODY)
    const on = filters.filter((f) => f.enabled).map((f) => f.statId)
    expect(on).toEqual(expect.arrayContaining(['equip.ev', 'equip.es', 'pseudo.pseudo_total_elemental_resistance', 'explicit.stat_3299347043', 'x.chaos']))
    expect(on).not.toContain('x.int')
    expect(on).not.toContain('x.evaes')
    const query = buildTradeQuery(item, 'Lacquered Vest', filters, 'securable')
    expect(query.query.filters?.['equipment_filters']).toEqual({ filters: { ev: { min: 730 }, es: { min: 207 } } })
  })
})
