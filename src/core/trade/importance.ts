// Quais mods começam marcados na checagem de preço, como o Exiled Exchange 2:
// os que definem o valor do item ficam ligados; os de pouco peso aparecem
// desligados (o usuário liga se quiser). Resistências elementais viram uma
// linha "total" (pseudo da trade), com as individuais guardadas embaixo.

import { weaponDps, type ParsedItem } from '../item/parser'
import { itemCategory, ruleFor } from '../item/value'
import type { StatFilter } from './query'

/** Mods que quase nunca definem o preço de um raro. Continuam na lista, só desmarcados. */
const LOW_VALUE: readonly RegExp[] = [
  /^\+?# to (Strength|Dexterity|Intelligence)( and (Strength|Dexterity|Intelligence))?$/i,
  /^\+?# to all Attributes$/i,
  /^\+?# to maximum Mana$/i,
  /Mana Regeneration Rate$/i,
  /Life Regeneration (Rate|per second)/i,
  /Light Radius/i,
  /Stun (Threshold|Recovery)/i,
  /Thorns/i,
  /Accuracy Rating$/i,
  /reduced Attribute Requirements|Attribute Requirements/i,
  /Knockback/i,
  /(Life|Mana) gained on Kill|(Life|Mana) per Enemy Killed|on Kill$/i,
  /Charm|Flask Charges|Flask Effect Duration/i,
  /Item Rarity|Rarity of Items/i,
  /Mana Cost/i,
  /Stun Buildup|Freeze Buildup|Ignite Magnitude|Shock (Chance|Duration)/i,
]

export function isLowValue(statText: string): boolean {
  return LOW_VALUE.some((r) => r.test(statText))
}

export const PSEUDO_ELE_RES = 'pseudo.pseudo_total_elemental_resistance'
// Textos da trade (sem "+"): "#% to Fire Resistance", "#% to Fire and Cold Resistances", "#% to all Elemental Resistances".
const ONE_ELEMENT = /^\+?#% to (Fire|Cold|Lightning) Resistance$/
const TWO_ELEMENTS = /^\+?#% to (Fire|Cold|Lightning) and (Fire|Cold|Lightning) Resistances$/
const ALL_ELEMENTS = /^\+?#% to all Elemental Resistances$/

/**
 * Quanto um filtro soma na resistência elemental total (null se não for só elemental).
 * Mistas com caos ("Fire and Chaos") ficam de fora: a parte de caos se perderia.
 */
export function elementalWeight(statText: string): number | null {
  if (ONE_ELEMENT.test(statText)) return 1
  if (TWO_ELEMENTS.test(statText)) return 2
  if (ALL_ELEMENTS.test(statText)) return 3
  return null
}

const JEWELLERY = /^(Rings|Amulets|Belts)$/i

/** Mods que continuam marcados numa armadura (o resto o usuário marca se quiser). */
const ARMOUR_KEEP: readonly RegExp[] = [/^\+?# to maximum Life$/i, /Chaos Resistance/i, /Movement Speed/i, /^\+?# to Spirit$/i, /to Level of all/i]

/** Tipo de peça para a busca padrão, como o Exiled Exchange 2: arma → DPS; armadura → defesa + resistência. */
export function itemKind(item: ParsedItem): 'weapon' | 'armour' | 'other' {
  const props = item.properties
  if (props && weaponDps(props)) return 'weapon'
  if (props && !JEWELLERY.test(item.itemClass) && ((props.armour ?? 0) > 0 || (props.evasion ?? 0) > 0 || (props.energyShield ?? 0) > 0)) return 'armour'
  return 'other'
}

/** Linhas de defesa/DPS da base (filtros "Equipment" da trade), com mínimo em `ratio` do valor do item. */
export function propertyFilters(item: ParsedItem, ratio: number): StatFilter[] {
  const props = item.properties
  if (!props) return []
  const row = (id: string, label: string, value: number): StatFilter => ({
    statId: `equip.${id}`,
    statText: label,
    modText: `${Math.round(value)} ${label}`,
    kind: 'property',
    affix: null,
    tier: null,
    value: Math.round(value),
    min: Math.floor(value * ratio),
    max: null,
    enabled: true,
  })
  const kind = itemKind(item)
  if (kind === 'weapon') {
    const dps = weaponDps(props)!
    return [row('dps', 'DPS', dps.total)]
  }
  if (kind === 'armour') {
    const out: StatFilter[] = []
    if (props.armour) out.push(row('ar', 'Armour', props.armour))
    if (props.evasion) out.push(row('ev', 'Evasion', props.evasion))
    if (props.energyShield) out.push(row('es', 'Energy Shield', props.energyShield))
    return out
  }
  return []
}

/** Quantos mods a busca exige em joias/cinto: os de maior peso. */
const MAX_KEY_MODS = 4

/** Mantém marcados só os mods de maior peso (a resistência total, se houver, conta como um). */
function keepTopValue(filters: StatFilter[], item: ParsedItem, resTotal: number): StatFilter[] {
  const category = itemCategory(item.itemClass)
  const weightOf = (f: StatFilter) => ruleFor(f.statText, category)?.weight ?? 0
  const slots = MAX_KEY_MODS - (resTotal > 0 ? 1 : 0)
  const ranked = filters
    .filter((f) => f.enabled && elementalWeight(f.statText) === null && f.kind !== 'property')
    .sort((a, b) => weightOf(b) - weightOf(a))
  const keep = new Set(ranked.filter((f) => weightOf(f) > 0).slice(0, slots).map((f) => f.statId))
  return filters.map((f) => (f.enabled && elementalWeight(f.statText) === null && f.kind !== 'property' && !keep.has(f.statId) ? { ...f, enabled: false } : f))
}

/**
 * Ajusta os filtros iniciais pelo tipo de peça: arma busca pelo DPS; armadura
 * pela defesa, resistência total, vida (e velocidade nas botas); o resto pela
 * seleção de mods de peso. Resistências elementais viram uma linha total.
 * Não mexe em itens únicos (a busca deles já é pelo nome).
 */
export function smartFilters(filters: readonly StatFilter[], ratio: number, item: ParsedItem): StatFilter[] {
  if (item.rarity === 'Unique') return [...filters]
  const kind = itemKind(item)
  const keep = (f: StatFilter) => {
    if (!f.enabled) return false
    if (kind === 'weapon') return false
    if (kind === 'armour') return ARMOUR_KEEP.some((r) => r.test(f.statText))
    return !isLowValue(f.statText)
  }
  let out = [...propertyFilters(item, ratio), ...filters.map((f) => (f.enabled && !keep(f) ? { ...f, enabled: false } : f))]

  let total = 0
  let count = 0
  for (const f of out) {
    const weight = elementalWeight(f.statText)
    if (weight !== null && f.value !== null && f.value > 0) {
      total += f.value * weight
      count++
    }
  }
  // Anéis, amuletos, cintos e afins: a busca usa só os mods que mais pesam no preço
  // (tabela de valor), para achar itens comparáveis em vez de exigir todos os mods.
  if (kind === 'other') out = keepTopValue(out, item, count > 0 ? total : 0)
  // Uma resistência só também vira total: acha itens com a mesma soma em qualquer elemento.
  if (count === 0) return out
  const grouped = out.map((f) => (elementalWeight(f.statText) !== null ? { ...f, enabled: false, group: PSEUDO_ELE_RES } : f))
  const pseudo: StatFilter = {
    statId: PSEUDO_ELE_RES,
    statText: '+#% total Elemental Resistance',
    modText: `+${total}% total Elemental Resistance`,
    kind: 'pseudo',
    affix: null,
    tier: null,
    value: total,
    min: Math.floor(total * ratio),
    max: null,
    // Arma: só o DPS vem marcado; a resistência fica disponível para marcar.
    enabled: kind !== 'weapon',
  }
  // A linha total entra no lugar da primeira resistência, com as individuais logo abaixo dela.
  const first = grouped.findIndex((f) => f.group === PSEUDO_ELE_RES)
  const children = grouped.filter((f) => f.group === PSEUDO_ELE_RES)
  const rest = grouped.filter((f) => f.group !== PSEUDO_ELE_RES)
  const at = grouped.slice(0, first).filter((f) => f.group !== PSEUDO_ELE_RES).length
  return [...rest.slice(0, at), pseudo, ...children, ...rest.slice(at)]
}
