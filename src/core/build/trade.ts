// Busca na trade de um item da build (ex.: o item do guia): mesma base e os
// mods explícitos do item, com mínimo em "minModPercent"% do valor. Com muitos
// mods, pede só a maioria (grupo COUNT), porque exigir todos quase nunca acha nada.

import { extractNumbers, type ParsedItem, type ParsedMod } from '../item/parser'
import type { StatIndex } from '../item/statMatcher'
import type { ManualSearch, ManualStatFilter } from '../trade/manual'
import { defaultFilters, resolveBaseType } from '../trade/query'
import type { BuildItem } from './model'

// Classe do item pelo slot: define se mods de defesa/ataque são locais.
const CLASS_BY_SLOT: Record<string, string> = {
  'Weapon 1': 'Weapons',
  'Weapon 2': 'Weapons',
  'Weapon 1 Swap': 'Weapons',
  'Weapon 2 Swap': 'Weapons',
  Helmet: 'Helmets',
  'Body Armour': 'Body Armours',
  Gloves: 'Gloves',
  Boots: 'Boots',
  Amulet: 'Amulets',
  Belt: 'Belts',
}

/** Até este número de mods, a busca exige todos; acima, exige a maioria. */
const REQUIRE_ALL_UP_TO = 3

export interface BuildItemSearch {
  search: ManualSearch
  /** Mods do item que entraram na busca e quantos deles são exigidos. */
  mods: number
  required: number
}

/** Item da build no formato do item copiado do jogo (para casar mods com a trade). */
export function toParsed(item: BuildItem, baseLine: string): ParsedItem {
  const mods: ParsedMod[] = item.mods.map((text, i) => ({
    text,
    kind: i < item.implicits ? 'implicit' : 'explicit',
    values: extractNumbers(text),
    affix: null,
    tier: null,
    affixName: null,
  }))
  return {
    itemClass: CLASS_BY_SLOT[item.slot] ?? (item.slot.startsWith('Ring') ? 'Rings' : ''),
    rarity: item.rarity,
    name: item.name,
    baseLine,
    itemLevel: null,
    quality: null,
    gemLevel: null,
    stackSize: null,
    corrupted: false,
    unidentified: false,
    mirrored: false,
    mods,
  }
}

/** Nomes que a trade conhece. Nome ou base fora do catálogo dá erro 400 na busca. */
export interface TradeNames {
  baseTypes: readonly string[]
  uniques: readonly string[]
}

/** Tipo base do item como a trade conhece (mágicos trazem afixos no nome). null se não existir. */
export function tradeBaseType(item: BuildItem, baseTypes: readonly string[]): string | null {
  const type = resolveBaseType(toParsed(item, item.baseType), baseTypes)
  // Em raros e únicos, resolveBaseType devolve a linha como está: confere no catálogo.
  return type && baseTypes.includes(type) ? type : null
}

export function buildItemSearch(item: BuildItem, index: StatIndex, names: TradeNames, minModPercent: number): BuildItemSearch | null {
  // Único: a busca é pelo nome (os mods são fixos).
  if (item.rarity === 'Unique') {
    if (!item.name || !names.uniques.includes(item.name)) return null
    const type = names.baseTypes.includes(item.baseType) ? item.baseType : null
    return { search: { name: item.name, type, stats: [] }, mods: 0, required: 0 }
  }
  const parsed = toParsed(item, item.baseType)
  const type = tradeBaseType(item, names.baseTypes)
  if (!type) return null

  const { matched } = index.matchItem(parsed)
  const filters: ManualStatFilter[] = defaultFilters(parsed, matched, minModPercent, false)
    .filter((f) => f.enabled)
    .map((f) => ({ id: f.statId, min: f.min, max: f.max }))

  const search: ManualSearch = {
    name: null,
    type,
    stats: [],
    filters: { type_filters: { rarity: { option: 'nonunique' } } },
  }
  let required = filters.length
  if (filters.length <= REQUIRE_ALL_UP_TO) {
    search.stats = filters
  } else {
    required = Math.ceil(filters.length * 0.6)
    search.statGroups = [{ type: 'count', min: required, max: null, filters }]
  }
  return { search, mods: filters.length, required }
}
