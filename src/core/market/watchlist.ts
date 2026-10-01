// Lista de acompanhamento: desempenho desde que o item foi adicionado e
// alertas quando a variação passa do limite escolhido.

import { fromDivine } from '../money'
import type { WatchEntry } from '../settings'
import type { CurrencyRates, DisplayCurrency, MarketItem, MarketSnapshot } from '../types'

export function createWatchEntry(item: MarketItem, rates: CurrencyRates, now: Date, alertPercent = 15, league?: string): WatchEntry {
  return {
    ...(league ? { league } : {}),
    itemId: item.id,
    category: item.category as WatchEntry['category'],
    name: item.name,
    addedAt: now.toISOString(),
    baselineDivine: item.valueDivine,
    baselineExaltedPerDivine: rates.exaltedPerDivine,
    baselineChaosPerDivine: rates.chaosPerDivine,
    alertPercent,
    lastAlert: null,
  }
}

export function watchKey(entry: Pick<WatchEntry, 'itemId' | 'category'>): string {
  return `${entry.category}:${entry.itemId}`
}

/**
 * Variação (%) desde que o item entrou na lista, medida na moeda escolhida.
 * Em Exalted, por exemplo, usa a cotação Divine→Exalted de cada momento.
 */
export function performance(entry: WatchEntry, current: MarketItem, unit: DisplayCurrency, rates: CurrencyRates): number {
  const then = fromDivine(entry.baselineDivine, unit, {
    exaltedPerDivine: entry.baselineExaltedPerDivine,
    chaosPerDivine: entry.baselineChaosPerDivine,
  })
  const now = fromDivine(current.valueDivine, unit, rates)
  return ((now - then) / then) * 100
}

export interface WatchAlert {
  entry: WatchEntry
  item: MarketItem
  change: number
  direction: 'up' | 'down'
}

/**
 * Verifica alertas. Um alerta dispara uma vez ao cruzar o limite; só volta a
 * disparar depois que a variação recuar para menos da metade do limite
 * (evita notificação repetida a cada atualização).
 */
export function evaluateWatchlist(
  entries: readonly WatchEntry[],
  snapshot: MarketSnapshot,
  unit: DisplayCurrency,
): { entries: WatchEntry[]; alerts: WatchAlert[] } {
  const byKey = new Map(snapshot.items.map((i) => [`${i.category}:${i.id}`, i]))
  const alerts: WatchAlert[] = []
  const updated = entries.map((entry): WatchEntry => {
    // Preço de referência de outra liga não se compara (trocar de liga dispararia alertas falsos).
    if (entry.league && entry.league !== snapshot.league) return entry
    const item = byKey.get(watchKey(entry))
    if (!item) return entry
    const change = performance(entry, item, unit, snapshot.rates)
    const direction: 'up' | 'down' = change >= 0 ? 'up' : 'down'
    if (Math.abs(change) >= entry.alertPercent) {
      if (entry.lastAlert !== direction) {
        alerts.push({ entry, item, change, direction })
        return { ...entry, lastAlert: direction }
      }
    } else if (Math.abs(change) < entry.alertPercent / 2 && entry.lastAlert !== null) {
      return { ...entry, lastAlert: null }
    }
    return entry
  })
  return { entries: updated, alerts }
}
