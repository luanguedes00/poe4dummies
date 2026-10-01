// Nota do item (0–100) e confiança do preço, para o veredito VENDE/GUARDA/LIXO.
//
// Tabela interna de "mods que dão dinheiro" por tipo de peça, com peso 1–3.
// ESTIMATIVA INICIAL, montada a partir dos guias de gearing da comunidade
// (maxroll, mobalytics, conquestcapped; 30/09/2026). Calibrar com o mercado.

import type { PricedListing } from '../pricecheck'
import type { StatFilter } from '../trade/query'

export type ItemCategory = 'weapon' | 'caster' | 'armour' | 'boots' | 'gloves' | 'ring' | 'amulet' | 'belt' | 'other'

interface ValueRule {
  re: RegExp
  weight: 1 | 2 | 3
  /** Só vale nessas categorias (vazio = todas). */
  only?: readonly ItemCategory[]
}

const DEFENCE: readonly ItemCategory[] = ['armour', 'boots', 'gloves']

export const VALUE_TABLE: readonly ValueRule[] = [
  // Defesa e sobrevivência
  { re: /^\+?# to maximum Life$/i, weight: 3 },
  { re: /total Elemental Resistance$/i, weight: 3 },
  { re: /Chaos Resistance/i, weight: 2 },
  { re: /increased Movement Speed/i, weight: 3, only: ['boots'] },
  { re: /^\+?# to Spirit$/i, weight: 3 },
  { re: /^#% increased (Armour|Evasion Rating|Energy Shield|Armour and Evasion|Armour and Energy Shield|Evasion and Energy Shield)$/i, weight: 2, only: DEFENCE },
  { re: /^\+?# to (maximum Energy Shield|Armour|Evasion Rating)( \(Local\))?$/i, weight: 2, only: DEFENCE },
  // Níveis de gema (os mais caros do jogo)
  { re: /to Level of all .*Skills/i, weight: 3 },
  // Arma de ataque
  { re: /^#% increased Physical Damage$/i, weight: 3, only: ['weapon'] },
  { re: /^Adds # to # Physical Damage/i, weight: 3, only: ['weapon'] },
  { re: /^Adds # to # (Fire|Cold|Lightning) Damage$/i, weight: 2, only: ['weapon'] },
  { re: /increased Attack Speed/i, weight: 3, only: ['weapon'] },
  { re: /increased Attack Speed/i, weight: 2, only: ['gloves', 'ring', 'amulet'] },
  { re: /Critical Hit Chance/i, weight: 2, only: ['weapon', 'caster', 'amulet', 'gloves'] },
  { re: /Critical (Damage Bonus|Strike Multiplier)/i, weight: 2, only: ['weapon', 'caster', 'amulet', 'gloves'] },
  // Conjurador
  { re: /increased Spell Damage/i, weight: 3, only: ['caster', 'amulet'] },
  { re: /increased (Fire|Cold|Lightning|Chaos|Elemental) Damage$/i, weight: 2, only: ['caster', 'amulet', 'ring'] },
  { re: /increased Cast Speed/i, weight: 2, only: ['caster', 'amulet', 'ring'] },
  // Joias
  { re: /^Adds # to # (Physical|Fire|Cold|Lightning) Damage to Attacks$/i, weight: 2, only: ['ring', 'gloves', 'amulet'] },
  { re: /Rarity of Items/i, weight: 2, only: ['ring', 'amulet', 'boots', 'gloves', 'armour'] },
  { re: /to all Attributes$/i, weight: 1, only: ['amulet', 'ring'] },
  { re: /^\+?# to maximum Mana$/i, weight: 1 },
]

/** Categoria pela classe do item (como o jogo escreve em "Item Class"). */
export function itemCategory(itemClass: string): ItemCategory {
  const c = itemClass.toLowerCase()
  if (c === 'boots') return 'boots'
  if (c === 'gloves') return 'gloves'
  if (c === 'rings') return 'ring'
  if (c === 'amulets') return 'amulet'
  if (c === 'belts') return 'belt'
  if (/body armours|helmets|shields|bucklers/.test(c)) return 'armour'
  if (/wands|staves|sceptres|foci/.test(c) && !/quarterstaves/.test(c)) return 'caster'
  if (/bows|crossbows|quarterstaves|maces|swords|axes|spears|flails|claws|daggers|talismans/.test(c)) return 'weapon'
  return 'other'
}

export function ruleFor(statText: string, category: ItemCategory): ValueRule | null {
  return VALUE_TABLE.find((r) => r.re.test(statText) && (!r.only || r.only.includes(category))) ?? null
}

/** Quanto o tier vale: T1 cheio, caindo até 25% nos tiers mais baixos. */
function tierFactor(f: StatFilter): number {
  if (f.kind === 'pseudo') return f.value === null ? 0.5 : Math.min(1, f.value / 100)
  const tiers = f.tiers?.length ?? 0
  if (!f.rolledTier || tiers === 0) return 0.6
  const relative = (f.rolledTier - 1) / Math.max(1, tiers - 1)
  return Math.max(0.25, 1 - relative * 0.75)
}

export interface ItemScore {
  /** 0–100: quão perto o item está de um item "ideal" daquela peça. */
  score: number
  /** Mods que contaram, do mais valioso para o menos. */
  keyMods: Array<{ text: string; weight: number; tier: number | null }>
}

/** Peças ideais têm uns 4 mods de peso máximo. */
const IDEAL_POINTS = 4 * 3

export function scoreItem(filters: readonly StatFilter[], itemClass: string): ItemScore {
  const category = itemCategory(itemClass)
  const keyMods: ItemScore['keyMods'] = []
  let points = 0
  for (const f of filters) {
    // Resistências individuais já contam na linha total; defesa/DPS da base não entram na nota.
    if (f.group || f.kind === 'property' || f.kind === 'implicit' || f.kind === 'rune' || f.kind === 'enchant') continue
    const rule = ruleFor(f.statText, category)
    if (!rule) continue
    points += rule.weight * tierFactor(f)
    keyMods.push({ text: f.modText, weight: rule.weight, tier: f.rolledTier ?? null })
  }
  keyMods.sort((a, b) => b.weight - a.weight || (a.tier ?? 99) - (b.tier ?? 99))
  return { score: Math.round(Math.min(1, points / IDEAL_POINTS) * 100), keyMods }
}

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export interface PriceConfidence {
  level: Confidence
  /** Anúncios com preço usados na conta. */
  sample: number
  /** Total à venda com esses filtros. */
  total: number
}

/**
 * Confiança do preço: quantos anúncios parecidos existem e quão espalhados
 * estão os preços (o mais caro dos baratos dividido pelo mais barato).
 */
export function priceConfidence(listings: readonly PricedListing[], total: number): PriceConfidence {
  const prices = listings.map((l) => l.divine).filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b)
  const sample = prices.length
  if (sample === 0 || total === 0) return { level: 'none', sample, total }
  const q = (p: number) => prices[Math.min(sample - 1, Math.floor(p * (sample - 1)))]!
  const spread = q(0.75) / q(0.25)
  let level: Confidence = 'low'
  if (sample >= 8 && total >= 20 && spread <= 3) level = 'high'
  else if (sample >= 4 && spread <= 6) level = 'medium'
  return { level, sample, total }
}
