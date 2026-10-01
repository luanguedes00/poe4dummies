import type { CurrencyRates, DisplayCurrency, MarketItem } from './types'

export const CURRENCY_SHORT: Record<DisplayCurrency, string> = {
  exalted: 'Ex',
  divine: 'Div',
  chaos: 'Chaos',
}

export function fromDivine(valueDivine: number, unit: DisplayCurrency, rates: CurrencyRates): number {
  switch (unit) {
    case 'divine':
      return valueDivine
    case 'exalted':
      return valueDivine * rates.exaltedPerDivine
    case 'chaos':
      return valueDivine * rates.chaosPerDivine
  }
}

const UNITS: readonly DisplayCurrency[] = ['divine', 'exalted', 'chaos']

/** Moedas da mais valiosa para a mais barata (pela cotação atual). */
function byValue(rates: CurrencyRates): DisplayCurrency[] {
  return [...UNITS].sort((a, b) => fromDivine(1, a, rates) - fromDivine(1, b, rates))
}

/**
 * Moeda mais fácil de ler para um valor: a mais valiosa em que ele dá 1 ou mais
 * (ex.: 0,12 Chaos vira Exalted). `exclude` tira uma moeda (a própria currency).
 */
export function bestUnit(valueDivine: number, rates: CurrencyRates, exclude?: DisplayCurrency): DisplayCurrency {
  const units = byValue(rates).filter((u) => u !== exclude)
  return units.find((u) => fromDivine(valueDivine, u, rates) >= 1) ?? units[units.length - 1]!
}

/** Número redondo para bater o olho: 10+ inteiro, 1–10 uma casa, abaixo de 1 duas casas. */
export function formatFriendly(value: number, locale = 'pt-BR'): string {
  if (!Number.isFinite(value)) return '–'
  const abs = Math.abs(value)
  const digits = abs >= 10 ? 0 : abs >= 1 ? 1 : 2
  return value.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

/** Valor na moeda mais legível, ex.: "3 Div", "45 Ex". */
export function smartPrice(valueDivine: number, rates: CurrencyRates, locale = 'pt-BR', exclude?: DisplayCurrency): string {
  const unit = bestUnit(valueDivine, rates, exclude)
  return `${formatFriendly(fromDivine(valueDivine, unit, rates), locale)} ${CURRENCY_SHORT[unit]}`
}

/** Valor nas outras moedas (para currency: uma Divine aparece em Ex e Chaos, não em Div). */
export function otherUnits(valueDivine: number, rates: CurrencyRates, self: DisplayCurrency | null, locale = 'pt-BR'): string[] {
  return byValue(rates)
    .filter((u) => u !== self)
    .map((u) => `${formatFriendly(fromDivine(valueDivine, u, rates), locale)} ${CURRENCY_SHORT[u]}`)
}

/** Formata com casas decimais proporcionais ao tamanho do número. */
export function formatAmount(value: number, locale = 'pt-BR'): string {
  if (!Number.isFinite(value)) return '–'
  const abs = Math.abs(value)
  let digits: number
  if (abs >= 100) digits = 0
  else if (abs >= 10) digits = 1
  else if (abs >= 1) digits = 2
  else if (abs >= 0.01) digits = 3
  else digits = 5
  return value.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

export function formatPercent(value: number | null, locale = 'pt-BR'): string {
  if (value === null || !Number.isFinite(value)) return '–'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`
}

/**
 * Índice "id da currency na trade → valor em Divine", usado para converter os
 * preços pedidos nas listagens. Os ids do poe.ninja coincidem com os da trade.
 */
export function buildPriceIndex(items: readonly MarketItem[]): Map<string, number> {
  const index = new Map<string, number>([['divine', 1]])
  for (const item of items) {
    if (item.category === 'Currency' && item.valueDivine > 0) index.set(item.id, item.valueDivine)
  }
  return index
}

export function toDivine(amount: number, currencyId: string, priceIndex: ReadonlyMap<string, number>): number | null {
  const rate = priceIndex.get(currencyId)
  return rate === undefined ? null : amount * rate
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
