// Qualidade de cada peça da build pelo tier dos mods (dados do jogo, RePoE):
// "seu peitoral tem Energy Shield % em T6; nessa base vai até T1". É o que a
// comunidade olha para decidir o próximo upgrade, em vez de "mais vida".

import type { StatIndex } from '../item/statMatcher'
import { tierOf, tiersFor } from '../item/tiers'
import type { TierContext } from '../pricecheck'
import { isLowValue } from '../trade/importance'
import type { Build } from './model'
import { toParsed, tradeBaseType } from './trade'

export interface ModTier {
  /** Linha como está no item, ex.: "+32% to Fire Resistance". */
  text: string
  statId: string
  /** Tier do valor rolado (1 = melhor). */
  tier: number
  /** Quantos tiers existem para esse mod nessa base. */
  tiers: number
  /** Valor mínimo do melhor tier (para mostrar "até X"). */
  bestMin: number
}

/** Mods de cada peça (slot → mods com tier), só raros e mágicos, sem os de pouco peso. */
export type TierReport = Record<string, ModTier[]>

export function buildTierReport(build: Build, index: StatIndex, baseTypes: readonly string[], context: TierContext): TierReport {
  const out: TierReport = {}
  for (const item of build.items) {
    if (item.rarity !== 'Rare' && item.rarity !== 'Magic') continue
    if (item.slot.startsWith('Flask') || item.slot.startsWith('Charm')) continue
    const base = tradeBaseType(item, baseTypes)
    const tags = base ? context.baseTags[base] : undefined
    if (!base || !tags) continue
    const { matched } = index.matchItem(toParsed(item, base))
    const mods: ModTier[] = []
    for (const m of matched) {
      if (m.mod.kind !== 'explicit' || isLowValue(m.stat.text)) continue
      const tiers = tiersFor(context.table, m.stat.id, tags)
      const tier = tierOf(tiers, m.mod.values)
      if (tier === null || tiers.length < 2) continue
      mods.push({ text: m.mod.text, statId: m.stat.id, tier, tiers: tiers.length, bestMin: tiers[0]!.min })
    }
    if (mods.length > 0) out[item.slot] = mods
  }
  return out
}
