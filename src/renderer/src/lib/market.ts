import { quickSignals, rebaseSparkline, type QuickSignal } from '../../../core/market/analysis'
import type { DisplayCurrency, MarketItem, MarketSnapshot } from '../../../core/types'

export interface MarketRow {
  item: MarketItem
  /** Sparkline e variação já convertidos para a moeda de exibição. */
  spark: number[]
  change: number | null
  signals: QuickSignal[]
}

/**
 * O poe.ninja mede tudo em Divine. Para mostrar em Exalted ou Chaos,
 * descontamos a variação da própria moeda de exibição.
 */
export function buildRows(snapshot: MarketSnapshot, unit: DisplayCurrency): MarketRow[] {
  const unitItem = unit === 'divine' ? null : snapshot.items.find((i) => i.category === 'Currency' && i.id === unit)
  return snapshot.items.map((item) => {
    const isUnit = unitItem && item.id === unitItem.id && item.category === 'Currency'
    let spark = item.sparkline
    if (unitItem && !isUnit) spark = rebaseSparkline(item.sparkline, unitItem.sparkline)
    if (isUnit) spark = item.sparkline.map(() => 0)
    const change = spark.length > 0 ? spark[spark.length - 1]! : unitItem ? null : item.change7d
    return { item, spark, change, signals: quickSignals(spark, item.volumeDivine) }
  })
}
