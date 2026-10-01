// Tipos de domínio compartilhados. Este diretório (src/core) não depende de
// Electron nem do DOM, para poder ser reaproveitado num site ou servidor.

export type DisplayCurrency = 'exalted' | 'divine' | 'chaos'

export interface League {
  id: string
  label: string
  hardcore: boolean
}

/** Quantas unidades de cada moeda valem 1 Divine Orb. */
export interface CurrencyRates {
  exaltedPerDivine: number
  chaosPerDivine: number
}

export interface MarketItem {
  /** Id do poe.ninja; para currency coincide com o id usado nos preços da trade. */
  id: string
  detailsId: string
  name: string
  /** Categoria do poe.ninja (ex.: "Currency", "Runes"). */
  category: string
  iconUrl: string | null
  valueDivine: number
  /** Volume negociado nas últimas 24 h, em Divine. */
  volumeDivine: number
  /** Variação percentual em 7 dias; null quando não há dados. */
  change7d: number | null
  /** Variação acumulada (%) dia a dia na última semana. */
  sparkline: number[]
}

export interface MarketSnapshot {
  league: string
  fetchedAt: string
  rates: CurrencyRates
  items: MarketItem[]
}

export interface PricePoint {
  timestamp: string
  value: number
  volumeDivine: number
}

export interface PriceHistory {
  league: string
  detailsId: string
  /** Moeda em que `value` está expresso (id da trade, ex.: "exalted"). */
  unit: string
  points: PricePoint[]
}
