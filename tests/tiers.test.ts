import { describe, expect, it } from 'vitest'
import { StatIndex } from '../src/core/item/statMatcher'
import { buildTierTable, canSpawn, cleanRepoeText, tierOf, tiersFor } from '../src/core/item/tiers'
import { allTiersForBase } from '../src/core/pricecheck'
import type { RepoeData, RepoeMod } from '../src/core/sources/repoe'

// Faixas reais do RePoE (PoE2), conferidas em 29/09/2026.
const ALL_ARMOUR = ['body_armour', 'shield', 'helmet', 'gloves', 'boots', 'belt', 'amulet', 'ring']
function life(name: string, lvl: number, min: number, max: number, tags: string[]): RepoeMod {
  return {
    domain: 'item', generation_type: 'prefix', is_essence_only: false, name, required_level: lvl, groups: ['IncreasedLife'],
    spawn_weights: [...tags.map((tag) => ({ tag, weight: 1 })), { tag: 'default', weight: 0 }],
    stats: [{ id: 'base_maximum_life', min, max }], text: `+(${min}-${max}) to maximum Life`,
  }
}
function phys(name: string, lvl: number, a: [number, number], b: [number, number], tags: string[]): RepoeMod {
  return {
    domain: 'item', generation_type: 'prefix', is_essence_only: false, name, required_level: lvl, groups: ['LocalPhysicalDamage'],
    spawn_weights: [...tags.map((tag) => ({ tag, weight: 1 })), { tag: 'default', weight: 0 }],
    stats: [{ id: 'local_minimum_added_physical_damage', min: a[0], max: a[1] }, { id: 'local_maximum_added_physical_damage', min: b[0], max: b[1] }],
    text: `Adds (${a[0]}-${a[1]}) to (${b[0]}-${b[1]}) [Physical|Physical] Damage`,
  }
}

const DATA: RepoeData = {
  mods: [
    life('Prime', 80, 200, 214, ['body_armour']),
    life('Rapturous', 75, 190, 199, ['body_armour']),
    life('Vigorous', 70, 175, 189, ['shield', 'body_armour']),
    life('Fecund', 65, 150, 174, ['body_armour', 'shield', 'helmet', 'belt']),
    life("Athlete's", 60, 120, 149, ['body_armour', 'shield', 'helmet', 'gloves', 'boots', 'belt', 'amulet']),
    life('Virile', 54, 100, 119, ALL_ARMOUR),
    life('Rotund', 46, 85, 99, ALL_ARMOUR),
    phys('Flaring', 75, [26, 39], [44, 66], ['bow', 'one_hand_weapon']),
    phys('Tempered', 65, [21, 31], [36, 53], ['bow', 'one_hand_weapon']),
    phys('Razor-sharp', 60, [16, 24], [28, 42], ['bow', 'one_hand_weapon']),
    phys('Flaring', 75, [37, 55], [63, 94], ['two_hand_weapon']),
    // Híbrido e essência ficam de fora da tabela.
    { ...life('Híbrido', 50, 10, 20, ALL_ARMOUR), text: '+(10-20) to maximum Life\n+(5-10) to Strength' },
    { ...life('Essência', 50, 300, 400, ALL_ARMOUR), is_essence_only: true },
  ],
  baseTags: {
    'Sapphire Ring': ['ring', 'default'],
    'Rusted Cuirass': ['str_armour', 'body_armour', 'armour', 'default'],
  },
}

const INDEX = new StatIndex([
  { id: 'explicit.stat_3299347043', text: '# to maximum Life', group: 'explicit' },
  { id: 'explicit.stat_1940865751', text: 'Adds # to # Physical Damage', group: 'explicit' },
  { id: 'explicit.stat_3032590688', text: 'Adds # to # Physical Damage to Attacks', group: 'explicit' },
])
const TABLE = buildTierTable(DATA, INDEX)
const LIFE = 'explicit.stat_3299347043'
const PHYS = 'explicit.stat_1940865751'
const ONE_HAND = ['sword', 'one_hand_weapon', 'weapon', 'default']
const TWO_HAND = ['sword', 'two_hand_weapon', 'weapon', 'default']

describe('tabela de tiers', () => {
  it('limpa a marcação do RePoE', () => {
    expect(cleanRepoeText('#% to [Resistances|Fire Resistance]')).toBe('#% to Fire Resistance')
    expect(cleanRepoeText('# to [Armour]')).toBe('# to Armour')
  })

  it('liga os mods ao stat certo da trade e ignora híbridos e essências', () => {
    expect(TABLE.get(LIFE)).toHaveLength(7)
    expect(TABLE.get(PHYS)).toHaveLength(4)
    expect(TABLE.get('explicit.stat_3032590688')).toBeUndefined()
  })

  it('respeita a regra de "primeiro tag que o item tiver"', () => {
    const row = { affix: 'x', itemLevel: 1, ranges: [[1, 2]] as Array<[number, number]>, spawn: [{ tag: 'ring', weight: 0 }, { tag: 'default', weight: 1 }] }
    expect(canSpawn(row, ['ring', 'default'])).toBe(false)
    expect(canSpawn(row, ['amulet', 'default'])).toBe(true)
  })
})

describe('tiersFor', () => {
  it('T1 de vida muda com a base: anel = Virile, armadura = Prime', () => {
    const ring = tiersFor(TABLE, LIFE, DATA.baseTags['Sapphire Ring']!)
    expect(ring.map((t) => t.affix)).toEqual(['Virile', 'Rotund'])
    expect(ring[0]).toMatchObject({ tier: 1, min: 100, strictMin: 100 })
    const armour = tiersFor(TABLE, LIFE, DATA.baseTags['Rusted Cuirass']!)
    expect(armour[0]).toMatchObject({ tier: 1, affix: 'Prime', min: 200, itemLevel: 80 })
    expect(armour).toHaveLength(7)
  })

  it('dano flat: mínimo pela média e mínimo que garante o tier', () => {
    const tiers = tiersFor(TABLE, PHYS, ONE_HAND)
    expect(tiers.map((t) => t.affix)).toEqual(['Flaring', 'Tempered', 'Razor-sharp'])
    // Flaring 1H: média de (26 + 44) / 2 = 35; o Tempered chega a (31 + 53) / 2 = 42.
    expect(tiers[0]).toMatchObject({ min: 35, strictMin: 42.5 })
    // Pior tier: nada abaixo, então os dois mínimos são iguais.
    expect(tiers[2]!.strictMin).toBe(tiers[2]!.min)
  })

  it('arma de 2 mãos tem a tabela dela', () => {
    const tiers = tiersFor(TABLE, PHYS, TWO_HAND)
    expect(tiers).toHaveLength(1)
    expect(tiers[0]).toMatchObject({ tier: 1, min: 50 })
  })
})

describe('allTiersForBase', () => {
  it('só lista mods possíveis na base (anel não tem dano físico local)', () => {
    const ring = allTiersForBase({ table: TABLE, baseTags: DATA.baseTags }, 'Sapphire Ring')
    expect(Object.keys(ring)).toEqual([LIFE])
    expect(ring[LIFE]!.map((x) => x.affix)).toEqual(['Virile', 'Rotund'])
    expect(allTiersForBase({ table: TABLE, baseTags: DATA.baseTags }, 'Base Inexistente')).toEqual({})
  })
})

describe('tierOf', () => {
  it('descobre o tier pelos números rolados', () => {
    const ring = tiersFor(TABLE, LIFE, ['ring', 'default'])
    expect(tierOf(ring, [110])).toBe(1)
    expect(tierOf(ring, [90])).toBe(2)
    expect(tierOf(ring, [20])).toBeNull()
    const sword = tiersFor(TABLE, PHYS, ONE_HAND)
    expect(tierOf(sword, [30, 50])).toBe(1)
    expect(tierOf(sword, [22, 40])).toBe(2)
  })
})
