// Guias por mecânica: o que priorizar, único recomendado e receitas de
// tablet (com ids reais da trade) montadas em setups de 3 e 4 tablets,
// completo e "budget". Dados MANUAIS: revisar a cada patch.
// Ids e faixas conferidos em /api/trade2/data/stats e no RePoE (domínio "tablet") em 30/09/2026,
// e validados com buscas reais (tests/live-farm.test.ts). Cuidado: alguns textos têm 2 ids.

export type MechanicId = 'ritual' | 'breach' | 'abyss' | 'delirium' | 'expedition' | 'irradiated'

/** Mod pedido numa receita. Mods de "redução" são "increased" negativos na trade: use `max`. */
export interface RecipeMod {
  statId: string
  label: string
  min?: number
  max?: number
}

/** Receitas pedem 1 ou 2 mods obrigatórios (o resto do tablet é bônus), como a comunidade faz. */
export interface TabletRecipe {
  id: string
  label: string
  baseType: string
  rarity: 'rare' | 'magic' | 'unique'
  /** Nome do único, quando `rarity` = unique. */
  unique?: string
  mods: RecipeMod[]
  /** Usos do tablet (comuns: 10; únicos: 5). */
  uses: number
}

export interface MechanicSetup {
  kind: 'full' | 'budget'
  slots: 3 | 4
  items: Array<{ recipeId: string; count: number }>
}

export interface MechanicGuide {
  id: MechanicId
  name: string
  summary: string
  /** Pré-requisitos: sem isso o farm não funciona. Mostrados em destaque. */
  requirements: string[]
  priorities: string[]
  unique: { name: string; why: string } | null
  tips: string[]
  recipes: TabletRecipe[]
  setups: MechanicSetup[]
  sources: Array<{ label: string; url: string }>
}

// Mods genéricos (prefixos que qualquer tablet pode ter).
const EFFECTIVENESS: RecipeMod = { statId: 'explicit.stat_2065500219', label: 'Effectiveness 12%+', min: 12 }
const RARE_MONSTERS: RecipeMod = { statId: 'explicit.stat_3793155082', label: 'Monstros raros 30%+', min: 30 }
const RANDOM_MODS: RecipeMod = { statId: 'explicit.stat_588512487', label: '+mods aleatórios no mapa', min: 1 }

export const MECHANICS: MechanicGuide[] = [
  {
    id: 'ritual',
    name: 'Ritual',
    requirements: ['Atlas de Ritual maximizado (Patient Devotion, Royal Lenience, Tainted Ritual)', 'Freedom of Faith (único) no mapa'],
    summary: 'Farm de Omens nos altares. O ganho vem de rerolar e adiar favores até aparecer o Omen caro.',
    priorities: ['Chance de Omens (35–70%)', 'Desconto para adiar favores (20–30%)', 'Rerolls extras (+1 a +3)', 'Reroll sem custo (3–6%)', 'Mais Tribute por sacrifício'],
    unique: { name: 'Freedom of Faith', why: 'Dobra a quantidade de rerolls de favores. Base de todo setup de Ritual.' },
    tips: [
      'Adie (defer) favores caros e reroll os ruins: é aqui que o desconto paga o tablet.',
      'Prefira mapas com o Rite of the Nameless (dica da comunidade; confirme no seu atlas).',
      'Waystone com 6 mods e pack size 20%+ aumenta o Tribute por altar.',
    ],
    recipes: [
      {
        id: 'ritual-omen-defer',
        label: 'Omens + defer',
        baseType: 'Ritual Tablet',
        rarity: 'rare',
        uses: 10,
        mods: [
          { statId: 'explicit.stat_4219853180', label: 'Chance de Omens 60%+', min: 60 },
          { statId: 'explicit.stat_1345835998', label: 'Defer 25%+ mais barato', max: -25 },
        ],
      },
      {
        // O tablet mais caro de Ritual (conferido na trade em 30/09/2026: 306 à venda, 7–20 Div).
        id: 'ritual-reroll-defer',
        label: 'Reroll + Defer',
        baseType: 'Ritual Tablet',
        rarity: 'rare',
        uses: 10,
        mods: [
          { statId: 'explicit.stat_120737942', label: '+2 rerolls ou mais', min: 2 },
          { statId: 'explicit.stat_1345835998', label: 'Defer 20%+ mais barato', max: -20 },
        ],
      },
      {
        id: 'ritual-reroll',
        label: 'Rerolls',
        baseType: 'Ritual Tablet',
        rarity: 'rare',
        uses: 10,
        mods: [
          { statId: 'explicit.stat_120737942', label: '+2 rerolls ou mais', min: 2 },
        ],
      },
      {
        id: 'ritual-omen-budget',
        label: 'Omens (budget)',
        baseType: 'Ritual Tablet',
        rarity: 'magic',
        uses: 10,
        mods: [{ statId: 'explicit.stat_4219853180', label: 'Chance de Omens 45%+', min: 45 }],
      },
      { id: 'ritual-unique', label: 'Freedom of Faith', baseType: 'Ritual Tablet', rarity: 'unique', unique: 'Freedom of Faith', uses: 5, mods: [] },
    ],
    setups: [
      { kind: 'full', slots: 3, items: [{ recipeId: 'ritual-unique', count: 1 }, { recipeId: 'ritual-omen-defer', count: 1 }, { recipeId: 'ritual-reroll-defer', count: 1 }] },
      { kind: 'full', slots: 4, items: [{ recipeId: 'ritual-unique', count: 1 }, { recipeId: 'ritual-omen-defer', count: 2 }, { recipeId: 'ritual-reroll-defer', count: 1 }] },
      { kind: 'budget', slots: 3, items: [{ recipeId: 'ritual-unique', count: 1 }, { recipeId: 'ritual-omen-budget', count: 2 }] },
      { kind: 'budget', slots: 4, items: [{ recipeId: 'ritual-unique', count: 1 }, { recipeId: 'ritual-omen-budget', count: 3 }] },
    ],
    sources: [
      { label: 'maxroll · Ritual', url: 'https://maxroll.gg/poe2/resources/ritual' },
      { label: 'aoeah · Ritual 0.5.5', url: 'https://www.aoeah.com/news/4797--poe-2-055-ritual-farm-atlas-tree-types-tablets--strategy' },
    ],
  },
  {
    id: 'breach',
    name: 'Breach',
    requirements: ['Atlas de Breach maximizado (inclui Shape the Chains)', 'Waystone T15 com Rarity e Effectiveness altos'],
    summary: 'Estabilizar Breaches para gerar monstros raros extras: Divine, Chaos, Annulment e catalisadores.',
    priorities: ['+Raros ao estabilizar (1–2)', 'Effectiveness de raros de Breach (5–20%)', 'Pack size das Breaches', 'Effectiveness e Rarity gerais'],
    unique: { name: 'Wraeclast Besieged', why: 'Unstable Breaches geram 2–5 monstros raros extras.' },
    tips: ['Waystone T15 com 60%+ de Rarity e Effectiveness.', 'Bioma City libera o 4º slot de tablet.'],
    recipes: [
      {
        id: 'breach-rares',
        label: 'Raros ao estabilizar',
        baseType: 'Breach Tablet',
        rarity: 'rare',
        uses: 10,
        mods: [
          { statId: 'explicit.stat_3762913035', label: '+2 raros ao estabilizar', min: 2 },
          { statId: 'explicit.stat_2895378479', label: 'Effectiveness de raros 15%+', min: 15 },
        ],
      },
      { id: 'breach-rares-budget', label: 'Raros (budget)', baseType: 'Breach Tablet', rarity: 'magic', uses: 10, mods: [{ statId: 'explicit.stat_3762913035', label: '+1 raro ao estabilizar', min: 1 }] },
      { id: 'breach-unique', label: 'Wraeclast Besieged', baseType: 'Breach Tablet', rarity: 'unique', unique: 'Wraeclast Besieged', uses: 5, mods: [] },
    ],
    setups: [
      { kind: 'full', slots: 3, items: [{ recipeId: 'breach-unique', count: 1 }, { recipeId: 'breach-rares', count: 2 }] },
      { kind: 'full', slots: 4, items: [{ recipeId: 'breach-unique', count: 1 }, { recipeId: 'breach-rares', count: 3 }] },
      { kind: 'budget', slots: 3, items: [{ recipeId: 'breach-unique', count: 1 }, { recipeId: 'breach-rares-budget', count: 2 }] },
      { kind: 'budget', slots: 4, items: [{ recipeId: 'breach-unique', count: 1 }, { recipeId: 'breach-rares-budget', count: 3 }] },
    ],
    sources: [{ label: 'maxroll · Breach Rare Monster', url: 'https://maxroll.gg/poe2/currency/breach-rare-monster-farming-strategy' }],
  },
  {
    id: 'abyss',
    name: 'Abyss',
    requirements: ['Atlas de Abyss maximizado (Vile Treasures, Balance of Power)', 'Para o setup com Delirium: atlas de Abyss E de Delirium maximizados'],
    summary: 'Mais Abysses e raros abissais: desecrated currency, omens de Abyss e Abyssal Depths.',
    priorities: ['+Raros das Abysses (2–3)', 'Chance de 4 Abysses extras (20–40%)', 'Abyss adicional', 'Desecrated currency (20–30%)'],
    unique: { name: 'Unforeseen Consequences', why: 'Peça central do setup "200% Delirium Abyss".' },
    tips: ['Combine com Delirium 200% no bioma City para multiplicar o loot.'],
    recipes: [
      {
        id: 'abyss-rares',
        label: 'Raros + Abysses',
        baseType: 'Abyss Tablet',
        rarity: 'rare',
        uses: 10,
        mods: [
          { statId: 'explicit.stat_243380454', label: '+3 raros das Abysses', min: 3 },
          { statId: 'explicit.stat_2890355696', label: 'Chance de 4 Abysses 30%+', min: 30 },
        ],
      },
      { id: 'abyss-budget', label: 'Abyss extra (budget)', baseType: 'Abyss Tablet', rarity: 'magic', uses: 10, mods: [{ statId: 'explicit.stat_1070816711', label: 'Abyss adicional' }] },
      { id: 'abyss-unique', label: 'Unforeseen Consequences', baseType: 'Abyss Tablet', rarity: 'unique', unique: 'Unforeseen Consequences', uses: 5, mods: [] },
    ],
    setups: [
      { kind: 'full', slots: 3, items: [{ recipeId: 'abyss-unique', count: 1 }, { recipeId: 'abyss-rares', count: 2 }] },
      { kind: 'full', slots: 4, items: [{ recipeId: 'abyss-unique', count: 1 }, { recipeId: 'abyss-rares', count: 3 }] },
      { kind: 'budget', slots: 3, items: [{ recipeId: 'abyss-budget', count: 3 }] },
      { kind: 'budget', slots: 4, items: [{ recipeId: 'abyss-unique', count: 1 }, { recipeId: 'abyss-budget', count: 3 }] },
    ],
    sources: [{ label: 'maxroll · 200% Delirium Abyss', url: 'https://maxroll.gg/poe2/currency/200-delirium-abyss-farming-strategy' }],
  },
  {
    id: 'delirium',
    name: 'Delirium',
    requirements: ['Atlas de Delirium maximizado'],
    summary: 'Splinters de Simulacrum e chefes únicos do Delirium; névoa mais longa = mais recompensas.',
    priorities: ['Splinters por pilha (15–30%)', 'Névoa dura mais (+6–12 s)', 'Chefes únicos (15–30%)', 'Pack size do Delirium'],
    unique: { name: 'Clear Skies', why: 'A névoa do Delirium nunca se dissipa nos seus mapas.' },
    tips: ['Mapas grandes e abertos aproveitam melhor a névoa.'],
    recipes: [
      {
        id: 'deli-splinters',
        label: 'Splinters + névoa',
        baseType: 'Delirium Tablet',
        rarity: 'rare',
        uses: 10,
        mods: [
          { statId: 'explicit.stat_3836551197', label: 'Splinters 20%+', min: 20 },
          { statId: 'explicit.stat_3226351972', label: 'Névoa +8 s', min: 8 },
        ],
      },
      { id: 'deli-budget', label: 'Splinters (budget)', baseType: 'Delirium Tablet', rarity: 'magic', uses: 10, mods: [{ statId: 'explicit.stat_3836551197', label: 'Splinters 15%+', min: 15 }] },
      { id: 'deli-unique', label: 'Clear Skies', baseType: 'Delirium Tablet', rarity: 'unique', unique: 'Clear Skies', uses: 5, mods: [] },
    ],
    setups: [
      { kind: 'full', slots: 3, items: [{ recipeId: 'deli-unique', count: 1 }, { recipeId: 'deli-splinters', count: 2 }] },
      { kind: 'full', slots: 4, items: [{ recipeId: 'deli-unique', count: 1 }, { recipeId: 'deli-splinters', count: 3 }] },
      { kind: 'budget', slots: 3, items: [{ recipeId: 'deli-budget', count: 3 }] },
      { kind: 'budget', slots: 4, items: [{ recipeId: 'deli-unique', count: 1 }, { recipeId: 'deli-budget', count: 3 }] },
    ],
    sources: [{ label: 'maxroll · Endgame Farming Tier List', url: 'https://maxroll.gg/poe2/tierlists/endgame-farming-tier-list' }],
  },
  {
    id: 'expedition',
    name: 'Expedition',
    requirements: ['Atlas de Expedition maximizado'],
    summary: 'Logbooks e Verisium; forte no início da liga.',
    priorities: ['Logbooks (15–25%)', 'Duplicar monstros Rúnicos (30–40%)', 'Mais marcadores Rúnicos', 'Rarity de monstros da Expedition'],
    unique: { name: 'Forgotten By Time', why: 'Duplica os monstros Rúnicos dos seus mapas.' },
    tips: ['Priorize Effectiveness, depois Pack Size e Rarity no waystone.'],
    recipes: [
      {
        id: 'exp-logbooks',
        label: 'Logbooks + rúnicos',
        baseType: 'Expedition Tablet',
        rarity: 'rare',
        uses: 10,
        mods: [
          { statId: 'explicit.stat_1083387327', label: 'Logbooks 20%+', min: 20 },
          { statId: 'explicit.stat_779964546', label: 'Duplicar rúnicos 35%+', min: 35 },
        ],
      },
      { id: 'exp-budget', label: 'Logbooks (budget)', baseType: 'Expedition Tablet', rarity: 'magic', uses: 10, mods: [{ statId: 'explicit.stat_1083387327', label: 'Logbooks 15%+', min: 15 }] },
      { id: 'exp-unique', label: 'Forgotten By Time', baseType: 'Expedition Tablet', rarity: 'unique', unique: 'Forgotten By Time', uses: 5, mods: [] },
    ],
    setups: [
      { kind: 'full', slots: 3, items: [{ recipeId: 'exp-unique', count: 1 }, { recipeId: 'exp-logbooks', count: 2 }] },
      { kind: 'full', slots: 4, items: [{ recipeId: 'exp-unique', count: 1 }, { recipeId: 'exp-logbooks', count: 3 }] },
      { kind: 'budget', slots: 3, items: [{ recipeId: 'exp-budget', count: 3 }] },
      { kind: 'budget', slots: 4, items: [{ recipeId: 'exp-unique', count: 1 }, { recipeId: 'exp-budget', count: 3 }] },
    ],
    sources: [{ label: 'aoeah · Expedition 0.5.5', url: 'https://www.aoeah.com/news/4804--poe-2-055-expedition-farm-tablets-rumors-logbooks-atlas-map-strategy' }],
  },
  {
    id: 'irradiated',
    name: 'Irradiated (Tablet Farming)',
    requirements: ['Mountain Mastery no atlas (+50% de tablets)'],
    summary: 'Tablets genéricos para dropar mais waystones e tablets e vendê-los.',
    priorities: ['Waystones encontradas (30–40%)', 'Effectiveness (10–15%)', '+1–2 mods aleatórios', 'Monster Rarity e monstros raros'],
    unique: null,
    tips: ['Complementos do atlas: Cultivate the Sea, The Journey Ahead, Nemesis Rising.'],
    recipes: [
      {
        id: 'irr-waystones',
        label: 'Waystones + Effectiveness',
        baseType: 'Irradiated Tablet',
        rarity: 'rare',
        uses: 10,
        mods: [{ statId: 'explicit.stat_2777224821', label: 'Waystones 35%+', min: 35 }, EFFECTIVENESS],
      },
      { id: 'irr-rares', label: 'Raros + mods', baseType: 'Irradiated Tablet', rarity: 'rare', uses: 10, mods: [RARE_MONSTERS, RANDOM_MODS] },
      { id: 'irr-budget', label: 'Waystones (budget)', baseType: 'Irradiated Tablet', rarity: 'magic', uses: 10, mods: [{ statId: 'explicit.stat_2777224821', label: 'Waystones 30%+', min: 30 }] },
    ],
    setups: [
      { kind: 'full', slots: 3, items: [{ recipeId: 'irr-waystones', count: 3 }] },
      { kind: 'full', slots: 4, items: [{ recipeId: 'irr-waystones', count: 3 }, { recipeId: 'irr-rares', count: 1 }] },
      { kind: 'budget', slots: 3, items: [{ recipeId: 'irr-budget', count: 3 }] },
      { kind: 'budget', slots: 4, items: [{ recipeId: 'irr-budget', count: 4 }] },
    ],
    sources: [{ label: 'maxroll · Tablet Farming', url: 'https://maxroll.gg/poe2/currency/tablet-farming-strategy' }],
  },
]

export function findRecipe(mechanicId: string, recipeId: string): TabletRecipe | null {
  return MECHANICS.find((m) => m.id === mechanicId)?.recipes.find((r) => r.id === recipeId) ?? null
}
