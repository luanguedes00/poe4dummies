import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkUpgrade, gameItemProperties, readItemStats, slotsFor } from '../src/core/build/compare'
import { BuildImportError, isBuild, parseBuildLink, type Build } from '../src/core/build/model'
import { applyRange, decodePobCode, encodePobCode, importPobCode, parsePobItem, parsePobXml } from '../src/core/build/pob'
import { buildItemSearch } from '../src/core/build/trade'
import { parseItemText } from '../src/core/item/parser'
import { StatIndex } from '../src/core/item/statMatcher'
import { isSearchable } from '../src/core/trade/manual'
import { STATS } from './statMatcher.test'

// Formato real do PoB2 (Build.lua / ItemsTab.lua / SkillsTab.lua, branch dev).
const XML = readFileSync(join(__dirname, 'fixtures', 'pob-sample.xml'), 'utf8')

function build(): Build {
  return importPobCode(encodePobCode(XML), { kind: 'code' }, new Date('2026-09-30T12:00:00Z'))
}

describe('código do PoB2', () => {
  it('decodifica o código (base64 com - e _, zlib) de volta no XML', () => {
    expect(decodePobCode(encodePobCode(XML))).toBe(XML)
    // Espaços e quebras de linha no meio do código colado não atrapalham.
    const code = encodePobCode(XML)
    expect(decodePobCode(`  ${code.slice(0, 40)}\n${code.slice(40)}  `)).toBe(XML)
  })

  it('recusa texto que não é código', () => {
    for (const bad of ['', 'oi', 'isto não é um código do path of building!!', 'A'.repeat(100)]) {
      expect(() => decodePobCode(bad)).toThrow(BuildImportError)
    }
  })

  it('lê classe, ascensão, nível, skill principal e stats', () => {
    const b = build()
    expect(b.className).toBe('Witch')
    expect(b.ascendancy).toBe('Infernalist')
    expect(b.level).toBe(87)
    expect(b.mainSkill).toBe('Fireball')
    expect(b.stats.Life).toBe(2150)
    expect(b.stats.FireResistOverCap).toBe(30)
    expect(isBuild(b)).toBe(true)
  })

  it('lê os itens equipados do conjunto ativo, na ordem dos slots', () => {
    const b = build()
    expect(b.items.map((i) => i.slot)).toEqual(['Weapon 1 Swap', 'Helmet', 'Ring 1', 'Ring 2', 'Belt'])
    const ring = b.items.find((i) => i.slot === 'Ring 1')!
    expect(ring).toMatchObject({ rarity: 'Rare', name: 'Doom Loop', baseType: 'Gold Ring' })
    expect(ring.mods).toEqual(['+11% to Cold Resistance', '+80 to maximum Life', '+30% to Fire Resistance', '+20 to Strength', 'Adds 3 to 7 Physical Damage to Attacks'])
    const helmet = b.items.find((i) => i.slot === 'Helmet')!
    expect(helmet.properties.evasion).toBe(250)
    expect(helmet.mods).not.toContain('Corrupted')
    expect(b.items.find((i) => i.slot === 'Belt')).toMatchObject({ rarity: 'Magic', name: null, baseType: 'Hale Leather Belt of the Fox' })
  })

  it('lê skills (ativas antes dos supports), joias da árvore, passivos e notas sem códigos de cor', () => {
    const b = build()
    expect(b.skills).toHaveLength(2)
    expect(b.skills[1]).toMatchObject({ main: true, enabled: true })
    expect(b.skills[1]!.gems.map((g) => [g.name, g.support])).toEqual([
      ['Fireball', false],
      ['Brutality', true],
    ])
    expect(b.skills[0]!.main).toBe(false)
    expect(b.jewels).toEqual([expect.objectContaining({ slot: 'Jewel', name: 'Glyph Eye', baseType: 'Sapphire', mods: ['+10% to Cold Resistance'] })])
    expect(b.passives).toBe(5)
    expect(b.notes).toBe('Level with Fireball.\nSwap to "Raise Zombie" at 60 & farm maps.')
    expect(isBuild(b)).toBe(true)
  })

  it('usa só as linhas da variante escolhida e ignora mods desativados', () => {
    const band = build().items.find((i) => i.slot === 'Ring 2')!
    expect(band.mods).toEqual(['+50 to maximum Life'])
  })

  it('guarda os dois sets de armas e qual está em uso; a comparação usa o set em uso', () => {
    const b = build()
    expect(b.activeWeaponSet).toBe(1)
    expect(b.items.some((i) => i.slot === 'Weapon 1 Swap')).toBe(true)
    expect(slotsFor('Wands', b)?.slots).toEqual(['Weapon 1'])
    const swapped = { ...parsePobXml(XML.replaceAll('useSecondWeaponSet="false"', 'useSecondWeaponSet="true"')), source: { kind: 'code' as const }, importedAt: '' }
    expect(swapped.activeWeaponSet).toBe(2)
    expect(slotsFor('Wands', swapped)?.slots).toEqual(['Weapon 1 Swap'])
    expect(slotsFor('Foci', swapped)?.slots).toEqual(['Weapon 2 Swap'])
  })

  it('build do PoE1 dá erro próprio', () => {
    const poe1 = XML.replaceAll('PathOfBuilding2', 'PathOfBuilding')
    expect(() => parsePobXml(poe1)).toThrow(expect.objectContaining({ code: 'not-poe2' }))
  })

  it('recusa DOCTYPE (entidades do arquivo)', () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "xxxxxxxx">]>${XML.slice(XML.indexOf('<PathOfBuilding2>'))}`
    expect(() => parsePobXml(evil)).toThrow(expect.objectContaining({ code: 'invalid-code' }))
  })

  it('aplica a faixa como o PoB (meio por padrão, casas decimais mantidas)', () => {
    expect(applyRange('+(10-20) to maximum Life', 0.5)).toBe('+15 to maximum Life')
    expect(applyRange('Adds (5-8) to (12-15) Fire Damage', 1)).toBe('Adds 8 to 15 Fire Damage')
    expect(applyRange('(0.5-1.5)% of Damage Leeched', 0.25)).toBe('0.8% of Damage Leeched')
    expect(applyRange('(0.5-1.5)% of Damage Leeched', 0.5)).toBe('1% of Damage Leeched')
    expect(applyRange('-(10-20)% to Cold Resistance', 0)).toBe('-10% to Cold Resistance')
  })

  it('item sem "Rarity:" é ignorado', () => {
    expect(parsePobItem('qualquer coisa')).toBeNull()
  })
})

describe('buscar item da build no mercado', () => {
  const index = new StatIndex(STATS)
  const BASES = { baseTypes: ['Gold Ring', 'Iron Ring', 'Leather Belt', 'Leather Hood'], uniques: ['Old Band'] }
  const item = (slot: string) => build().items.find((i) => i.slot === slot)!

  it('marca quantos mods são implícitos', () => {
    expect(item('Ring 1').implicits).toBe(1)
    expect(item('Helmet').implicits).toBe(0)
  })

  it('raro com muitos mods: mesma base, sem implícito, pede a maioria (COUNT)', () => {
    const built = buildItemSearch(item('Ring 1'), index, BASES, 80)!
    expect(built.search.type).toBe('Gold Ring')
    expect(built.search.filters).toEqual({ type_filters: { rarity: { option: 'nonunique' } } })
    expect(built.search.stats).toEqual([])
    expect(built.mods).toBe(4)
    expect(built.required).toBe(3)
    const group = built.search.statGroups![0]!
    expect(group).toMatchObject({ type: 'count', min: 3 })
    expect(group.filters).toContainEqual({ id: 'explicit.stat_3299347043', min: 64, max: null })
    // O implícito de gelo (+11%) não entra.
    expect(group.filters.some((f) => f.id === 'implicit.cold')).toBe(false)
    expect(isSearchable(built.search)).toBe(true)
  })

  it('poucos mods: exige todos; item mágico acha a base no nome', () => {
    const built = buildItemSearch(item('Belt'), index, BASES, 80)!
    expect(built.search.type).toBe('Leather Belt')
    expect(built.search.stats).toEqual([{ id: 'explicit.stat_3299347043', min: 16, max: null }])
    expect(built.search.statGroups).toBeUndefined()
  })

  it('único: busca pelo nome', () => {
    expect(buildItemSearch(item('Ring 2'), index, BASES, 80)!.search).toEqual({ name: 'Old Band', type: 'Iron Ring', stats: [] })
  })

  it('base ou único fora do catálogo da trade: sem busca (a trade daria erro 400)', () => {
    const none = { baseTypes: ['Gold Ring'], uniques: [] }
    expect(buildItemSearch(item('Belt'), index, none, 80)).toBeNull()
    expect(buildItemSearch(item('Helmet'), index, none, 80)).toBeNull()
    expect(buildItemSearch(item('Ring 2'), index, none, 80)).toBeNull()
  })
})

describe('links de build', () => {
  it('reconhece os sites do PoB2 e monta o endereço do código', () => {
    expect(parseBuildLink('https://pobb.in/AbC-12_x')).toEqual({ site: 'pobbin', id: 'AbC-12_x', rawUrl: 'https://pobb.in/pob/AbC-12_x' })
    expect(parseBuildLink(' https://poe.ninja/poe2/pob/1a2b ')?.rawUrl).toBe('https://poe.ninja/poe2/pob/raw/1a2b')
    expect(parseBuildLink('https://maxroll.gg/poe2/pob/xyz123')?.rawUrl).toBe('https://maxroll.gg/poe2/api/pob/xyz123')
    expect(parseBuildLink('https://poe2db.tw/pob/abc')?.rawUrl).toBe('https://poe2db.tw/pob/abc/raw')
  })

  it('não aceita outros sites nem ids estranhos', () => {
    for (const bad of ['https://evil.com/pobb.in/abc', 'https://pobb.in/abc/../x', 'https://pobb.in/a?b=c', 'https://pobb.in.evil.com/abc', 'pobb.in/abc']) {
      expect(parseBuildLink(bad)).toBeNull()
    }
  })
})

const RING = `Item Class: Rings
Rarity: Rare
Storm Loop
Sapphire Ring
--------
Item Level: 81
--------
+25% to Cold Resistance (implicit)
--------
+95 to maximum Life
+40% to Lightning Resistance
+10 to Strength
`

describe('é upgrade?', () => {
  it('lê defesas do texto do jogo e dos mods', () => {
    const text = 'Item Class: Helmets\nRarity: Rare\nX\nY\n--------\nEvasion Rating: 312 (augmented)\nEnergy Shield: 40\n--------\nItem Level: 80'
    expect(gameItemProperties(text)).toEqual({ armour: 0, evasion: 312, energyShield: 40, spirit: 0 })
    // Em peça com defesa, "+# to Evasion Rating" é local e já está na propriedade.
    const local = readItemStats(['+40 to Evasion Rating', '+10% to all Elemental Resistances'], { armour: 0, evasion: 250, energyShield: 0, spirit: 0 })
    expect(local.stats.evasion).toBe(250)
    expect(local.stats.fireRes).toBe(10)
    expect(local.stats.lightningRes).toBe(10)
    const jewel = readItemStats(['+40 to Evasion Rating', '5% reduced Movement Speed'], { armour: 0, evasion: 0, energyShield: 0, spirit: 0 })
    expect(jewel.stats.evasion).toBe(40)
    expect(jewel.stats.moveSpeed).toBe(-5)
  })

  it('anel: escolhe o anel que vale trocar e desconta resistência acima do cap', () => {
    const b = build()
    const check = checkUpgrade(b, parseItemText(RING), RING)!
    expect(check.kind).toBe('gear')
    // Ring 2 só tem +50 de vida: trocar ele é upgrade claro.
    expect(check.best.slot).toBe('Ring 2')
    expect(check.best.verdict).toBe('upgrade')
    const ring1 = check.alternatives.find((c) => c.slot === 'Ring 1')!
    const fire = ring1.deltas.find((d) => d.key === 'fireRes')!
    // Perde 30% de fogo, mas a build tem 30% acima do cap: não muda nada.
    expect(fire.delta).toBe(-30)
    expect(fire.effective).toBe(0)
    const cold = ring1.deltas.find((d) => d.key === 'coldRes')!
    // Frio está em 60/75: os +14 contam inteiros.
    expect(cold.effective).toBe(14)
    expect(cold.resAfter).toEqual({ value: 74, cap: 75 })
    // Perde o dano físico do anel atual: não dá para dizer que é upgrade puro.
    expect(ring1.lost).toContain('Adds 3 to 7 Physical Damage to Attacks')
    expect(ring1.verdict).toBe('sidegrade')
  })

  it('avisa quando perder atributo quebra requisito', () => {
    const b = build()
    const weak = RING.replace('+10 to Strength', '+1 to Dexterity')
    // Ring 1 dá +20 de força; sem ele a build fica com 100 de 111.
    const check = checkUpgrade(b, parseItemText(weak), weak)!
    const ring1 = [check.best, ...check.alternatives].find((c) => c.slot === 'Ring 1')!
    expect(ring1.warnings).toContainEqual({ kind: 'attribute', key: 'str', missing: 11 })
    expect(ring1.verdict).not.toBe('upgrade')
    // Trocar o Ring 2 (sem força) não quebra nada: continua sendo a melhor opção.
    expect(check.best.slot).toBe('Ring 2')
    expect(check.best.warnings).toEqual([])
  })

  it('slot vazio: qualquer item é upgrade', () => {
    const gloves = 'Item Class: Gloves\nRarity: Rare\nA\nSuede Bracers\n--------\nEvasion Rating: 50\n--------\nItem Level: 50\n--------\n+30 to maximum Life\n'
    const check = checkUpgrade(build(), parseItemText(gloves), gloves)!
    expect(check.best).toMatchObject({ slot: 'Gloves', equipped: null, verdict: 'upgrade' })
  })

  it('só compara o que tem slot: armas avisam, currency não compara', () => {
    const b = build()
    expect(slotsFor('Wands', b)).toEqual({ slots: ['Weapon 1'], kind: 'weapon' })
    expect(slotsFor('Foci', b)?.slots).toEqual(['Weapon 2'])
    expect(slotsFor('Stackable Currency', b)).toBeNull()
    expect(slotsFor('Rings', b)?.slots).toEqual(['Ring 1', 'Ring 2'])
  })
})
