// Estratégias de farm curadas a partir de guias da comunidade (ver
// docs/pesquisa-farm.md). Dados MANUAIS: revisar a cada patch/liga.
// Os preços são sempre ao vivo (poe.ninja); aqui ficam só nomes e regras.

export const STRATEGIES_UPDATED = '2026-09-30'
export const STRATEGIES_PATCH = '0.5.5 (Forbidden Rites)'

export type StrategyTier = 'S' | 'A' | 'B'
export type Investment = 'low' | 'medium' | 'high'

/** Tablet que a estratégia usa: tipo + raridade (comum) ou nome (único). */
export interface TabletNeed {
  baseType: string
  variant?: 'Normal' | 'Magic' | 'Rare'
  unique?: string
  count: number
  /** Usos de um tablet (comuns têm 10; únicos, 5 ou 1). */
  uses: number
  /** Mods que o guia pede nesse tablet (descrição do guia, não o texto exato da trade). */
  targetMods: string[]
}

export interface Strategy {
  id: string
  name: string
  tier: StrategyTier
  investment: Investment
  mechanic: string
  tablets: TabletNeed[]
  waystone: string
  atlas: string[]
  /** Nomes de itens do poe.ninja para mostrar o preço do loot principal. */
  loot: string[]
  sources: Array<{ label: string; url: string }>
  /** Fonte considerada fraca (site de venda de currency, sem confirmação). */
  weakSource?: boolean
}

export const STRATEGIES: Strategy[] = [
  {
    id: 'tablet-farming',
    name: 'Tablet Farming',
    tier: 'S',
    investment: 'low',
    mechanic: 'Irradiated',
    tablets: [
      { baseType: 'Irradiated Tablet', variant: 'Rare', count: 3, uses: 10, targetMods: ['Waystones encontradas 30–40%', 'Effectiveness 10–15%', 'Extra: +1–2 mods aleatórios, Monster Rarity'] },
    ],
    waystone: 'Qualquer tier; o foco é dropar e vender tablets.',
    atlas: ['Mountain Mastery (+50% tablets)', 'Cultivate the Sea', 'The Journey Ahead', 'Nemesis Rising'],
    loot: ['Irradiated Tablet', 'Breach Tablet', 'Ritual Tablet', 'Abyss Tablet'],
    sources: [{ label: 'maxroll · Tablet Farming', url: 'https://maxroll.gg/poe2/currency/tablet-farming-strategy' }],
  },
  {
    id: 'deli-abyss',
    name: '200% Delirium Abyss',
    tier: 'S',
    investment: 'high',
    mechanic: 'Abyss + Delirium',
    tablets: [
      { baseType: 'Abyss Tablet', unique: 'Unforeseen Consequences', count: 1, uses: 5, targetMods: [] },
      { baseType: 'Irradiated Tablet', variant: 'Rare', count: 3, uses: 10, targetMods: ['+2 mods aleatórios (obrigatório)', '% de monstros raros (obrigatório)', 'Extra: Effectiveness, Monster Rarity, Rarity, Pack Size'] },
    ],
    waystone: 'T15 com 5 mods; ~103% Monster Rarity; bioma City.',
    atlas: ['Vile Treasures', 'Balance of Power', 'Nós de bioma'],
    loot: ['Divine Orb', 'Chaos Orb', 'Orb of Annulment', 'Omen of Light'],
    sources: [{ label: 'maxroll · 200% Delirium Abyss', url: 'https://maxroll.gg/poe2/currency/200-delirium-abyss-farming-strategy' }],
  },
  {
    id: 'ritual',
    name: 'Ritual (Omens)',
    tier: 'S',
    investment: 'medium',
    mechanic: 'Ritual',
    tablets: [
      { baseType: 'Ritual Tablet', unique: 'Freedom of Faith', count: 1, uses: 5, targetMods: [] },
      { baseType: 'Ritual Tablet', variant: 'Rare', count: 2, uses: 10, targetMods: ['Omens 35–70%', '+1–3 rerolls de favores'] },
    ],
    waystone: '6 mods, pack size 20%+, bioma City.',
    atlas: ['Patient Devotion', 'Royal Lenience', 'Tainted Ritual'],
    loot: ['Omen of Sinistral Annulment', 'Omen of Dextral Annulment', 'Omen of Whittling', 'Omen of Sinistral Erasure'],
    sources: [
      { label: 'maxroll · Ritual', url: 'https://maxroll.gg/poe2/resources/ritual' },
      { label: 'aoeah · Ritual 0.5.5', url: 'https://www.aoeah.com/news/4797--poe-2-055-ritual-farm-atlas-tree-types-tablets--strategy' },
    ],
  },
  {
    id: 'breach-rares',
    name: 'Breach (monstros raros)',
    tier: 'A',
    investment: 'high',
    mechanic: 'Breach',
    tablets: [
      { baseType: 'Breach Tablet', unique: 'Wraeclast Besieged', count: 1, uses: 5, targetMods: [] },
      { baseType: 'Breach Tablet', variant: 'Rare', count: 3, uses: 10, targetMods: ['+2 raros ao estabilizar (obrigatório)', 'Extra: Effectiveness, Rare Breach Effectiveness, Rarity, +mods aleatórios'] },
    ],
    waystone: 'T15 com 60%+ Rarity e Effectiveness; City com Delirium 200%.',
    atlas: ['Shape the Chains'],
    loot: ['Divine Orb', 'Chaos Orb', 'Orb of Annulment'],
    sources: [{ label: 'maxroll · Breach Rare Monster', url: 'https://maxroll.gg/poe2/currency/breach-rare-monster-farming-strategy' }],
  },
  {
    id: 'citadel',
    name: 'Citadel Hunting',
    tier: 'A',
    investment: 'low',
    mechanic: 'Citadels',
    tablets: [{ baseType: 'Irradiated Tablet', variant: 'Magic', count: 3, uses: 10, targetMods: ['Waystones encontradas', 'Mods extras no mapa'] }],
    waystone: 'T15 corrompido com 6 sufixos.',
    atlas: ['Enigmatic Intensification', 'Partial Translation', 'Controlled Climates'],
    loot: ['Divine Orb', 'Exalted Orb'],
    sources: [{ label: 'maxroll · Citadel', url: 'https://maxroll.gg/poe2/resources/citadel-farming' }],
  },
  {
    id: 'expedition',
    name: 'Expedition (início de liga)',
    tier: 'B',
    investment: 'low',
    mechanic: 'Expedition',
    tablets: [
      { baseType: 'Expedition Tablet', unique: 'Forgotten By Time', count: 1, uses: 5, targetMods: [] },
      { baseType: 'Expedition Tablet', variant: 'Rare', count: 2, uses: 10, targetMods: ['Effectiveness', 'Pack Size', 'Rarity'] },
    ],
    waystone: 'Priorize Effectiveness, depois Pack Size e Rarity.',
    atlas: ['Nós de Expedition'],
    loot: ['Exotic Coinage', 'Sun Artifact', 'Broken Circle Artifact'],
    sources: [{ label: 'aoeah · Expedition 0.5.5', url: 'https://www.aoeah.com/news/4804--poe-2-055-expedition-farm-tablets-rumors-logbooks-atlas-map-strategy' }],
    weakSource: true,
  },
]
