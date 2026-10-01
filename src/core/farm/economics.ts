// Contas do farm: custo por mapa de um setup e, com o retorno que o usuário
// informa, lucro por mapa e por hora. Retorno por hora NÃO tem fonte confiável
// pública; por isso ele vem do usuário (ou, no futuro, do tracker de mapas).

import type { TabletPrice } from '../sources/ninja'
import type { Strategy, TabletNeed } from './strategies'

/** Acha o preço de um tablet do setup (único pelo nome; comum por tipo + raridade). */
export function priceForNeed(need: TabletNeed, prices: readonly TabletPrice[]): TabletPrice | null {
  if (need.unique) return prices.find((p) => p.unique && p.name === need.unique) ?? null
  return prices.find((p) => !p.unique && p.baseType === need.baseType && p.variant === (need.variant ?? 'Normal')) ?? null
}

export interface SetupInput {
  /** Custo de cada tablet por mapa = preço ÷ usos. */
  tablets: Array<{ priceDivine: number | null; uses: number; count: number }>
  waystoneDivine: number
  extrasDivine: number
  /** Retorno médio por mapa informado pelo usuário (null = não informado). */
  returnDivine: number | null
  mapsPerHour: number | null
}

export interface SetupEconomics {
  tabletsPerMap: number
  costPerMap: number
  /** Tablets sem preço conhecido (a conta fica subestimada). */
  missingPrices: number
  profitPerMap: number | null
  profitPerHour: number | null
}

export function setupEconomics(input: SetupInput): SetupEconomics {
  let tabletsPerMap = 0
  let missingPrices = 0
  for (const t of input.tablets) {
    if (t.priceDivine === null) {
      missingPrices += t.count
      continue
    }
    tabletsPerMap += (t.priceDivine / Math.max(1, t.uses)) * t.count
  }
  const costPerMap = tabletsPerMap + Math.max(0, input.waystoneDivine) + Math.max(0, input.extrasDivine)
  const profitPerMap = input.returnDivine === null ? null : input.returnDivine - costPerMap
  const profitPerHour = profitPerMap === null || input.mapsPerHour === null ? null : profitPerMap * input.mapsPerHour
  return { tabletsPerMap, costPerMap, missingPrices, profitPerMap, profitPerHour }
}

/** Custo dos tablets por mapa de uma estratégia, com os preços atuais. */
export function strategyTabletCost(strategy: Strategy, prices: readonly TabletPrice[]): SetupEconomics {
  return setupEconomics({
    tablets: strategy.tablets.map((need) => ({ priceDivine: priceForNeed(need, prices)?.valueDivine ?? null, uses: need.uses, count: need.count })),
    waystoneDivine: 0,
    extrasDivine: 0,
    returnDivine: null,
    mapsPerHour: null,
  })
}
