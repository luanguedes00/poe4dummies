import { describe, expect, it } from 'vitest'
import { ItemParseError, looksLikeItemText, parseItemText } from '../src/core/item/parser'
import { BODY_ARMOUR, EXALTED_STACK, MAGIC_RING, RARE_RING, RARE_RING_ADVANCED, UNIDENTIFIED, UNIQUE_BELT } from './fixtures/items'

describe('parseItemText', () => {
  it('lê um anel raro (Ctrl+C)', () => {
    const item = parseItemText(RARE_RING)
    expect(item.itemClass).toBe('Rings')
    expect(item.rarity).toBe('Rare')
    expect(item.name).toBe('Gale Coil')
    expect(item.baseLine).toBe('Sapphire Ring')
    expect(item.itemLevel).toBe(81)
    expect(item.corrupted).toBe(true)
    expect(item.mods.map((m) => [m.kind, m.text])).toEqual([
      ['implicit', '+23% to Cold Resistance'],
      ['explicit', '+78 to maximum Life'],
      ['explicit', '+41 to maximum Mana'],
      ['explicit', '+32% to Fire Resistance'],
      ['explicit', '+19% to Lightning Resistance'],
      ['explicit', '+14 to Dexterity'],
    ])
    expect(item.mods[1]!.values).toEqual([78])
    expect(item.mods[1]!.affix).toBeNull()
  })

  it('lê prefixo, sufixo e tier no modo avançado (Ctrl+Alt+C)', () => {
    const item = parseItemText(RARE_RING_ADVANCED)
    expect(item.mods).toHaveLength(5)
    expect(item.mods[0]).toMatchObject({ kind: 'implicit', text: '+23% to Cold Resistance', affix: null })
    expect(item.mods[1]).toMatchObject({
      kind: 'explicit',
      text: '+78 to maximum Life',
      values: [78],
      affix: 'prefix',
      tier: 3,
      affixName: 'Virile',
    })
    expect(item.mods[3]).toMatchObject({ text: '+32% to Fire Resistance', affix: 'suffix', tier: 2, affixName: 'of the Furnace' })
    expect(item.corrupted).toBe(false)
  })

  it('separa propriedades, runas e requisitos numa armadura', () => {
    const item = parseItemText(BODY_ARMOUR)
    expect(item.quality).toBe(20)
    expect(item.itemLevel).toBe(79)
    expect(item.gemLevel).toBeNull()
    expect(item.mods.map((m) => m.kind)).toEqual(['rune', 'explicit', 'explicit', 'explicit', 'explicit'])
    expect(item.mods[0]!.text).toBe('+12% to Fire Resistance')
    expect(item.mods[4]!.values).toEqual([10])
  })

  it('lê pilha de currency com separador de milhar', () => {
    const item = parseItemText(EXALTED_STACK)
    expect(item.rarity).toBe('Currency')
    expect(item.baseLine).toBe('Exalted Orb')
    expect(item.name).toBeNull()
    expect(item.stackSize).toBe(1234)
    expect(item.mods).toEqual([])
  })

  it('lê item único e mantém o texto de ambientação como candidato (o matcher descarta)', () => {
    const item = parseItemText(UNIQUE_BELT)
    expect(item.name).toBe('Headhunter')
    expect(item.baseLine).toBe('Heavy Belt')
    expect(item.mods.some((m) => m.text === '+40 to Strength')).toBe(true)
  })

  it('lê item mágico com afixos no nome', () => {
    const item = parseItemText(MAGIC_RING)
    expect(item.name).toBeNull()
    expect(item.baseLine).toBe('Hale Sapphire Ring of the Furnace')
    expect(item.mods).toHaveLength(3)
  })

  it('marca item não identificado', () => {
    const item = parseItemText(UNIDENTIFIED)
    expect(item.unidentified).toBe(true)
    expect(item.name).toBeNull()
    expect(item.baseLine).toBe('Sapphire Ring')
  })

  it('aceita quebras de linha do Windows', () => {
    const item = parseItemText(RARE_RING.replace(/\n/g, '\r\n'))
    expect(item.mods).toHaveLength(6)
  })

  it('recusa texto que não é item', () => {
    expect(() => parseItemText('olá mundo')).toThrow(ItemParseError)
    try {
      parseItemText('Rarity: Rare')
    } catch (e) {
      expect((e as ItemParseError).code).toBe('not-an-item')
    }
  })

  it('recusa texto gigante', () => {
    expect(looksLikeItemText('Item Class: Rings\nRarity: Rare\n' + 'x'.repeat(30_000))).toBe(false)
  })
})
