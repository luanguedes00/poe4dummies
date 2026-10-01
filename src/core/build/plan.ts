// Compara a build do jogador com a do guia e monta um plano do que melhorar,
// na ordem que a comunidade usa (guias de gearing do maxroll/conquestcapped e
// discussões no Reddit/Steam): 1) resistências elementais no cap de 75% e
// caos; 2) requisitos; 3) arma (maior salto de dano); 4) botas com 30%+ de
// velocidade; 5) mods de tier baixo em cada peça (pelo tier real do jogo);
// 6) peças do guia; 7) gemas. Nada de "busque mais vida" genérico.

import { readItemStats, type StatKey } from './compare'
import type { Build, BuildItem } from './model'
import type { ModTier, TierReport } from './tierReport'

const ELEMENTS = [
  ['fireRes', 'FireResist'],
  ['coldRes', 'ColdResist'],
  ['lightningRes', 'LightningResist'],
] as const
const RES_CAP = 75

export type PlanStep =
  /** `slots`: suas peças raras/mágicas sem essa resistência (onde dá para colocar). */
  | { kind: 'resist'; key: 'fireRes' | 'coldRes' | 'lightningRes'; missing: number; slots: string[] }
  | { kind: 'attribute'; key: 'str' | 'dex' | 'int'; missing: number }
  | { kind: 'chaos'; mine: number; guide: number | null }
  | { kind: 'boots'; mine: number }
  | { kind: 'tier'; slot: string; mods: ModTier[] }
  | { kind: 'unique'; slot: string; name: string }
  | { kind: 'item'; slot: string; gaps: Array<{ key: StatKey; mine: number; guide: number }>; missingMods: string[]; empty: boolean }
  | { kind: 'skill'; skill: string; supports: string[] }
  | { kind: 'support'; skill: string; support: string }
  | { kind: 'gem-level'; gem: string; mine: number; guide: number }
  | { kind: 'dps'; mine: number; guide: number }

/** Peso de cada stat na prioridade de troca de peça (resistência e velocidade valem mais). */
const WEIGHT: Partial<Record<StatKey, number>> = {
  life: 1,
  energyShield: 1,
  spirit: 1,
  fireRes: 2,
  coldRes: 2,
  lightningRes: 2,
  chaosRes: 1,
  moveSpeed: 4,
  armour: 0.05,
  evasion: 0.05,
  mana: 0.3,
}
/** Diferença mínima (ponderada) para uma peça entrar no plano. */
const ITEM_THRESHOLD = 25
const MAX_ITEM_STEPS = 6
const MAX_TIER_STEPS = 5
/** Velocidade de movimento mínima nas botas (consenso da comunidade). */
const BOOTS_MOVE_SPEED = 30
/** Arma vem antes das outras peças: é o maior salto de dano. */
const WEAPON_BONUS = 5000

/**
 * Mods com tier baixo numa peça: tier 3 ou pior, e no terço de baixo da escala
 * dessa base (ex.: T4 de 6). Os piores primeiro.
 */
function lowTiers(mods: readonly ModTier[]): ModTier[] {
  return mods.filter((m) => m.tier >= 3 && m.tier > m.tiers / 3).sort((a, b) => b.tier / b.tiers - a.tier / a.tiers)
}

const template = (line: string) => line.replace(/[+-]?\d+(?:\.\d+)?/g, '#').toLowerCase()

/** Slots comparados: equipamento do set de armas em uso de cada build. */
function equippedSlots(build: Build): Map<string, BuildItem> {
  const out = new Map<string, BuildItem>()
  for (const item of build.items) {
    // Armas: só as do set em uso ("Swap" = set II).
    if (item.slot.startsWith('Weapon') && item.slot.endsWith(' Swap') !== (build.activeWeaponSet === 2)) continue
    out.set(item.slot.replace(' Swap', ''), item)
  }
  return out
}

function itemStep(slot: string, guide: BuildItem, mine: BuildItem | undefined): { step: PlanStep; score: number } | null {
  if (guide.rarity === 'Unique' && guide.name) {
    if (mine?.name === guide.name) return null
    return { step: { kind: 'unique', slot, name: guide.name }, score: 1000 + (slot.startsWith('Weapon') ? WEAPON_BONUS : 0) }
  }
  const g = readItemStats(guide.mods, guide.properties)
  const m = mine ? readItemStats(mine.mods, mine.properties) : null
  const gaps: Array<{ key: StatKey; mine: number; guide: number }> = []
  let score = 0
  for (const [key, weight] of Object.entries(WEIGHT) as Array<[StatKey, number]>) {
    const want = g.stats[key]
    const have = m?.stats[key] ?? 0
    if (want > have) {
      score += (want - have) * weight
      if (want - have >= (key === 'moveSpeed' ? 5 : 10)) gaps.push({ key, mine: have, guide: want })
    }
  }
  // Mods fora da conta (ex.: "+3 to Level of all Fire Spell Skills") que a peça do jogador não tem.
  const mineTemplates = new Set((m?.other ?? []).map(template))
  const missingMods = g.other.filter((l) => /\d/.test(l) && !mineTemplates.has(template(l))).slice(0, 4)
  score += missingMods.length * 30
  if (!mine) score += 200
  if (score < ITEM_THRESHOLD) return null
  if (slot.startsWith('Weapon')) score += WEAPON_BONUS
  return { step: { kind: 'item', slot, gaps: gaps.sort((a, b) => b.guide - b.mine - (a.guide - a.mine)).slice(0, 4), missingMods, empty: !mine }, score }
}

/** Peças que podem ter resistência como sufixo. */
const RES_SLOTS = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Belt', 'Amulet', 'Ring 1', 'Ring 2']

export type Impact = 'high' | 'medium' | 'low'

/**
 * Impacto de cada passo: alto = risco de morrer, não conseguir equipar, ou o
 * maior salto de dano (arma, único do guia, skill/support que falta); médio =
 * melhora clara; baixo = ajuste fino.
 */
export function stepImpact(step: PlanStep): Impact {
  switch (step.kind) {
    case 'resist':
      return step.missing >= 10 ? 'high' : 'medium'
    case 'attribute':
      return 'high'
    case 'chaos':
      return step.mine < 0 ? 'high' : 'medium'
    case 'boots':
      return step.mine < 20 ? 'high' : 'medium'
    case 'unique':
      return 'high'
    case 'item':
      return step.slot.startsWith('Weapon 1') || step.empty ? 'high' : 'medium'
    case 'tier':
      return step.slot.startsWith('Weapon') ? 'high' : 'medium'
    case 'skill':
    case 'support':
      return 'high'
    case 'gem-level':
      return step.guide - step.mine >= 4 ? 'high' : 'medium'
    case 'dps':
      return 'low'
  }
}

const IMPACT_ORDER: Record<Impact, number> = { high: 0, medium: 1, low: 2 }

/** O passo que mais vale agora: o primeiro de maior impacto, na ordem do plano. */
export function nextStep(steps: readonly PlanStep[]): PlanStep | null {
  let best: PlanStep | null = null
  for (const s of steps) if (s.kind !== 'dps' && (!best || IMPACT_ORDER[stepImpact(s)] < IMPACT_ORDER[stepImpact(best)])) best = s
  return best
}

export function buildPlan(mine: Build, guide: Build, tiers: TierReport | null = null): PlanStep[] {
  const steps: PlanStep[] = []
  const mineSlots = equippedSlots(mine)

  // 1. Resistências elementais abaixo do cap, com as peças onde ainda cabe essa resistência.
  for (const [key, stat] of ELEMENTS) {
    const value = mine.stats[stat]
    if (value === undefined || value >= RES_CAP) continue
    const slots = RES_SLOTS.filter((slot) => {
      const item = mineSlots.get(slot)
      if (!item) return true
      if (item.rarity === 'Unique') return false
      return readItemStats(item.mods, item.properties).stats[key] <= 0
    })
    steps.push({ kind: 'resist', key, missing: Math.round(RES_CAP - value), slots })
  }

  // 2. Atributos abaixo do requisito.
  for (const [key, stat] of [['str', 'Str'], ['dex', 'Dex'], ['int', 'Int']] as const) {
    const have = mine.stats[stat]
    const need = mine.stats[`Req${stat}`]
    if (have !== undefined && need !== undefined && have < need) steps.push({ kind: 'attribute', key, missing: Math.round(need - have) })
  }

  // 1b. Caos negativo, ou bem abaixo do guia (a comunidade trata caos como defesa séria no endgame).
  const chaos = mine.stats.ChaosResist
  const chaosGuide = guide.stats.ChaosResist ?? null
  if (chaos !== undefined && (chaos < 0 || (chaosGuide !== null && chaos < chaosGuide - 20))) {
    steps.push({ kind: 'chaos', mine: Math.round(chaos), guide: chaosGuide === null ? null : Math.round(chaosGuide) })
  }

  // 3. Botas sem 30% de velocidade de movimento.
  const boots = mineSlots.get('Boots')
  if (boots && boots.rarity !== 'Unique') {
    const speed = readItemStats(boots.mods, boots.properties).stats.moveSpeed
    if (speed < BOOTS_MOVE_SPEED) steps.push({ kind: 'boots', mine: speed })
  }

  // 4. Mods de tier baixo nas suas peças (pelo tier real do jogo, quando os dados estão disponíveis).
  if (tiers) {
    const lows = Object.entries(tiers)
      .map(([slot, mods]) => ({ slot, mods: lowTiers(mods) }))
      .filter((x) => x.mods.length > 0 && !(x.slot.startsWith('Weapon') && x.slot.endsWith(' Swap') !== (mine.activeWeaponSet === 2)))
      .map((x) => ({ ...x, score: x.mods.reduce((s, m) => s + m.tier / m.tiers, 0) + (x.slot.startsWith('Weapon') ? 10 : 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_TIER_STEPS)
    for (const low of lows) steps.push({ kind: 'tier', slot: low.slot.replace(' Swap', ''), mods: low.mods.slice(0, 3) })
  }

  // 5. Peças do guia: arma primeiro, depois únicos que faltam e raros com maior diferença.
  const items: Array<{ step: PlanStep; score: number }> = []
  for (const [slot, item] of equippedSlots(guide)) {
    if (slot.startsWith('Flask') || slot.startsWith('Charm')) continue
    const found = itemStep(slot, item, mineSlots.get(slot))
    if (found) items.push(found)
  }
  steps.push(...items.sort((a, b) => b.score - a.score).slice(0, MAX_ITEM_STEPS).map((i) => i.step))

  // 5. Skills e supports do guia que o jogador não usa; níveis de gema atrasados.
  const mineGroups = mine.skills.filter((g) => g.enabled)
  for (const group of guide.skills.filter((g) => g.enabled)) {
    const active = group.gems.find((g) => !g.support)
    if (!active) continue
    const match = mineGroups.find((g) => g.gems.some((gem) => !gem.support && gem.name === active.name))
    const supports = group.gems.filter((g) => g.support && g.enabled).map((g) => g.name)
    if (!match) {
      steps.push({ kind: 'skill', skill: active.name, supports })
      continue
    }
    const have = new Set(match.gems.map((g) => g.name))
    for (const support of supports) if (!have.has(support)) steps.push({ kind: 'support', skill: active.name, support })
    const mineActive = match.gems.find((g) => g.name === active.name)
    if (mineActive && active.level - mineActive.level >= 2) steps.push({ kind: 'gem-level', gem: active.name, mine: mineActive.level, guide: active.level })
  }

  // 6. Dano: só informativo quando fica bem atrás.
  const dpsMine = mine.stats.CombinedDPS ?? mine.stats.TotalDPS
  const dpsGuide = guide.stats.CombinedDPS ?? guide.stats.TotalDPS
  if (dpsMine !== undefined && dpsGuide !== undefined && dpsGuide > 0 && dpsMine < dpsGuide * 0.7) {
    steps.push({ kind: 'dps', mine: dpsMine, guide: dpsGuide })
  }
  return steps
}
