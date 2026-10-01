// "O que o mercado paga caro agora": a partir dos anúncios mais caros de um
// tipo de tablet, conta quais mods se repetem. Mostra combos caros sem
// depender da lista curada (ex.: Ritual com Reroll + Defer).

import type { PricedListing } from '../pricecheck'

export interface TopModCount {
  /** Mod com os números trocados por "#", ex.: "Ritual Altars in Map allow rerolling Favours # additional times". */
  text: string
  /** Em quantos dos anúncios caros ele aparece. */
  count: number
}

export interface TopTablets {
  baseType: string
  /** Anúncios usados (sem preços absurdos). */
  sample: number
  /** Faixa de preço dos anúncios usados, em Divine. */
  lowDivine: number | null
  highDivine: number | null
  /** Mods mais frequentes entre os caros (aparecem em pelo menos 30% deles). */
  mods: TopModCount[]
}

const template = (line: string) => line.replace(/[+-]?\d+(?:\.\d+)?/g, '#')

/** Preço "de troll" (ex.: 9999 Div para ninguém comprar): acima disto × mediana, sai da conta. */
const OUTLIER = 5
const MIN_SHARE = 0.3

export function topTabletMods(baseType: string, listings: readonly PricedListing[]): TopTablets {
  const priced = listings.filter((l) => l.divine !== null && l.divine > 0)
  const sorted = priced.map((l) => l.divine!).sort((a, b) => a - b)
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : 0
  const kept = priced.filter((l) => l.divine! <= median * OUTLIER)
  const counts = new Map<string, number>()
  for (const l of kept) {
    // Cada mod conta uma vez por anúncio.
    for (const text of new Set((l.mods ?? []).filter((m) => m.kind === 'explicit').map((m) => template(m.text)))) {
      counts.set(text, (counts.get(text) ?? 0) + 1)
    }
  }
  const mods = [...counts.entries()]
    .filter(([, count]) => kept.length > 0 && count / kept.length >= MIN_SHARE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([text, count]) => ({ text, count }))
  const prices = kept.map((l) => l.divine!)
  return {
    baseType,
    sample: kept.length,
    lowDivine: prices.length ? Math.min(...prices) : null,
    highDivine: prices.length ? Math.max(...prices) : null,
    mods,
  }
}
