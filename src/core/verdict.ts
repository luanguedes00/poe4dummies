// "Vende, guarda ou lixo?": resposta direta para o iniciante a partir do
// resultado da checagem de preço. Regras simples e explicáveis; os limites
// ficam nas configurações.

import { itemCategory, priceConfidence, scoreItem, type ItemScore, type PriceConfidence } from './item/value'
import type { PriceCheckResult } from './pricecheck'

export type VerdictKind = 'sell' | 'keep' | 'junk' | 'unknown'

export type VerdictReason =
  | 'market-value'
  | 'stack-small'
  | 'listings-value'
  | 'few-listings'
  | 'no-listings'
  | 'good-tiers'
  | 'good-score'
  | 'craft-base'
  | 'uncertain-price'
  | 'low-value'
  | 'price-check-error'

export interface Verdict {
  kind: VerdictKind
  reasons: VerdictReason[]
  /** Valor de referência em Divine (total da pilha ou preço típico do item). */
  valueDivine: number | null
  /** Sugestão de preço para anunciar, em Divine (um pouco abaixo do típico). */
  suggestedDivine: number | null
  /** Quantos mods do item são T1 ou T2 na base. */
  topTierMods: number
  /** Nota 0–100 pelos mods que dão dinheiro naquela peça (só itens da trade). */
  score?: ItemScore
  /** Quanto confiar no preço (quantidade e dispersão dos anúncios). */
  confidence?: PriceConfidence
}

/** A partir desta nota, um item sem comparação no mercado vale a pena guardar e testar o preço. */
export const KEEP_SCORE = 60
/** Nível de item a partir do qual uma base branca/mágica serve para craft (todos os tiers de mod liberados). */
export const CRAFT_ILVL = 82

export interface VerdictOptions {
  /** Abaixo disso (em Divine) não compensa anunciar. */
  minSellDivine: number
  /** Desconto sobre o preço típico na sugestão de anúncio (0,05 = 5%). */
  undercut: number
}

export const DEFAULT_VERDICT_OPTIONS: VerdictOptions = { minSellDivine: 0.02, undercut: 0.05 }

/** Poucos anúncios = preço pouco confiável. */
const FEW_LISTINGS = 3

export function itemVerdict(result: PriceCheckResult, options: VerdictOptions = DEFAULT_VERDICT_OPTIONS): Verdict {
  if (result.kind === 'error') {
    return { kind: 'unknown', reasons: ['price-check-error'], valueDivine: null, suggestedDivine: null, topTierMods: 0 }
  }

  if (result.kind === 'market') {
    const total = result.market.valueDivine * (result.item.stackSize ?? 1)
    // Itens de pilha sempre valem algo; pilha pequena "guarda" até juntar mais.
    const kind: VerdictKind = total >= options.minSellDivine ? 'sell' : 'keep'
    return {
      kind,
      reasons: [kind === 'sell' ? 'market-value' : 'stack-small'],
      valueDivine: total,
      suggestedDivine: null,
      topTierMods: 0,
    }
  }

  const topTierMods = result.filters.filter((f) => f.rolledTier !== undefined && f.rolledTier !== null && f.rolledTier <= 2).length
  // Únicos: o preço é do nome, a nota de mods não se aplica.
  const score = result.item.rarity === 'Unique' ? undefined : scoreItem(result.filters, result.item.itemClass)
  const confidence = priceConfidence(result.listings, result.total)
  const goodScore = (score?.score ?? 0) >= KEEP_SCORE
  const typical = result.medianDivine ?? result.cheapestDivine
  const base = { topTierMods, score, confidence }

  if (result.total === 0 || typical === null) {
    // Sem anúncios parecidos: nota alta = mercado vazio para algo bom (guarda e testa o preço); senão lixo.
    if (goodScore) return { kind: 'keep', reasons: ['no-listings', 'good-score'], valueDivine: null, suggestedDivine: null, ...base }
    if (isCraftBase(result.item)) return { kind: 'keep', reasons: ['craft-base'], valueDivine: null, suggestedDivine: null, ...base }
    return { kind: 'junk', reasons: ['no-listings'], valueDivine: null, suggestedDivine: null, ...base }
  }

  if (typical >= options.minSellDivine) {
    const reasons: VerdictReason[] = ['listings-value']
    if (confidence.level === 'low' || result.total < FEW_LISTINGS) reasons.push('uncertain-price')
    return { kind: 'sell', reasons, valueDivine: typical, suggestedDivine: typical * (1 - options.undercut), ...base }
  }

  if (goodScore) {
    // Barato nos anúncios parecidos, mas com mods de peso: pode valer mais (ou servir de base para craft).
    return { kind: 'keep', reasons: ['low-value', 'good-score'], valueDivine: typical, suggestedDivine: null, ...base }
  }
  if (isCraftBase(result.item)) return { kind: 'keep', reasons: ['craft-base'], valueDivine: typical, suggestedDivine: null, ...base }
  return { kind: 'junk', reasons: ['low-value'], valueDivine: typical, suggestedDivine: null, ...base }
}

/** Branco ou mágico, nível alto, peça de equipamento: base boa para craft. */
function isCraftBase(item: { rarity: string; itemLevel: number | null; itemClass: string }): boolean {
  return (item.rarity === 'Normal' || item.rarity === 'Magic') && (item.itemLevel ?? 0) >= CRAFT_ILVL && itemCategory(item.itemClass) !== 'other'
}
