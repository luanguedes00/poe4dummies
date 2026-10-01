// Leitura "estilo bolsa" do mercado. Tudo aqui é heurística sobre dados
// públicos do jogo; a interface deve deixar isso claro para o usuário.
// O núcleo não produz texto: devolve códigos + parâmetros e a interface
// traduz (ver src/renderer/src/i18n).

import type { MarketItem } from '../types'
import { changeOver, dailyVolatility, rsi, sma } from './indicators'

/** Abaixo disso (Divine negociados por dia) o item é considerado ilíquido. */
export const LOW_LIQUIDITY_DIVINE = 1

export type QuickSignal = 'rising' | 'falling' | 'recovering' | 'fading' | 'volatile' | 'illiquid'

/**
 * Sinais rápidos a partir do sparkline de 7 dias (usado na tabela).
 * `sparkline` deve estar na moeda de exibição (ver rebaseSparkline).
 */
export function quickSignals(sparkline: readonly number[], volumeDivine: number): QuickSignal[] {
  const out: QuickSignal[] = []
  if (volumeDivine < LOW_LIQUIDITY_DIVINE) out.push('illiquid')
  if (sparkline.length < 3) return out

  const change = sparkline[sparkline.length - 1]!
  const momentum = change - sparkline[sparkline.length - 3]!

  if (change >= 15 && momentum >= 0) out.push('rising')
  else if (change >= 15 && momentum < -5) out.push('fading')
  else if (change <= -15 && momentum > 5) out.push('recovering')
  else if (change <= -15) out.push('falling')

  const swings = sparkline.slice(1).map((v, i) => Math.abs(v - sparkline[i]!))
  const avgSwing = swings.reduce((a, b) => a + b, 0) / swings.length
  if (avgSwing >= 20) out.push('volatile')
  return out
}

/**
 * O poe.ninja mede a variação em Divine. Para ver a variação em outra moeda
 * (ex.: Exalted), divide-se pela variação dessa moeda no mesmo período.
 * Ambos os arrays são variações acumuladas em %, alinhados por dia.
 */
export function rebaseSparkline(item: readonly number[], unit: readonly number[]): number[] {
  if (unit.length !== item.length) return [...item]
  return item.map((v, i) => ((1 + v / 100) / (1 + unit[i]! / 100) - 1) * 100)
}

export interface Movers {
  risers: MarketItem[]
  fallers: MarketItem[]
  mostTraded: MarketItem[]
}

/** `changeOf` permite ordenar pela variação já convertida para a moeda de exibição. */
export function topMovers(
  items: readonly MarketItem[],
  changeOf: (item: MarketItem) => number | null,
  limit = 8,
  minVolume = LOW_LIQUIDITY_DIVINE,
): Movers {
  const liquid = items
    .filter((i) => i.volumeDivine >= minVolume)
    .map((item) => ({ item, change: changeOf(item) }))
    .filter((e): e is { item: MarketItem; change: number } => e.change !== null)
  const byChange = [...liquid].sort((a, b) => b.change - a.change)
  return {
    risers: byChange.filter((e) => e.change > 0).slice(0, limit).map((e) => e.item),
    fallers: byChange.filter((e) => e.change < 0).reverse().slice(0, limit).map((e) => e.item),
    mostTraded: [...items].sort((a, b) => b.volumeDivine - a.volumeDivine).slice(0, limit),
  }
}

export type Trend = 'up' | 'down' | 'sideways'
export type Stance = 'favorable' | 'neutral' | 'unfavorable'

export type ReasonCode =
  | 'trend-up'
  | 'trend-down'
  | 'trend-sideways'
  | 'short-history'
  | 'week-up'
  | 'week-down'
  | 'rsi-high'
  | 'rsi-low'
  | 'volume-confirms-rise'
  | 'volume-on-fall'
  | 'near-high'
  | 'low-liquidity'

export interface Reason {
  code: ReasonCode
  /** Peso com sinal: positivo favorece investir, negativo desfavorece. */
  weight: number
  /** Valor numérico citado no texto (ex.: a variação ou o RSI). */
  value?: number
}

export interface HistoryAnalysis {
  days: number
  last: number
  change1d: number | null
  change7d: number | null
  change30d: number | null
  high: number
  low: number
  /** Distância (%) do último preço para a máxima da série (≤ 0). */
  fromHigh: number
  /** Distância (%) do último preço para a mínima da série (≥ 0). */
  fromLow: number
  sma7: (number | null)[]
  sma20: (number | null)[]
  rsi14: number | null
  volatility: number | null
  /** Volume médio dos últimos 3 dias comparado com os 7 anteriores (%). */
  volumeTrend: number | null
  trend: Trend
  score: number
  stance: Stance
  reasons: Reason[]
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Analisa uma série diária (mais antigo → mais recente).
 * Retorna null se houver menos de 3 pontos ou algum preço inválido.
 */
export function analyzeHistory(prices: readonly number[], volumes: readonly number[]): HistoryAnalysis | null {
  if (prices.length < 3 || prices.some((p) => !(p > 0))) return null
  const last = prices[prices.length - 1]!
  const high = Math.max(...prices)
  const low = Math.min(...prices)
  const sma7 = sma(prices, Math.min(7, prices.length))
  const sma20 = sma(prices, Math.min(20, prices.length))
  const ma7 = sma7[sma7.length - 1] ?? null
  const ma20 = sma20[sma20.length - 1] ?? null
  const rsi14 = rsi(prices, 14)
  const change7d = changeOver(prices, 7)

  let volumeTrend: number | null = null
  if (volumes.length >= 10) {
    const recent = mean(volumes.slice(-3))
    const before = mean(volumes.slice(-10, -3))
    if (before > 0) volumeTrend = ((recent - before) / before) * 100
  }

  const reasons: Reason[] = []
  let trend: Trend = 'sideways'
  if (ma7 !== null && ma20 !== null && prices.length >= 10) {
    if (last > ma7 && ma7 > ma20) {
      trend = 'up'
      reasons.push({ code: 'trend-up', weight: 30 })
    } else if (last < ma7 && ma7 < ma20) {
      trend = 'down'
      reasons.push({ code: 'trend-down', weight: -30 })
    } else {
      reasons.push({ code: 'trend-sideways', weight: 0 })
    }
  } else {
    reasons.push({ code: 'short-history', weight: 0 })
  }

  if (change7d !== null) {
    if (change7d >= 10) reasons.push({ code: 'week-up', weight: 15, value: change7d })
    else if (change7d <= -10) reasons.push({ code: 'week-down', weight: -15, value: change7d })
  }

  if (rsi14 !== null) {
    if (rsi14 >= 70) reasons.push({ code: 'rsi-high', weight: -20, value: rsi14 })
    else if (rsi14 <= 30) reasons.push({ code: 'rsi-low', weight: 20, value: rsi14 })
  }

  if (volumeTrend !== null && change7d !== null && volumeTrend >= 20) {
    if (change7d > 0) reasons.push({ code: 'volume-confirms-rise', weight: 10, value: volumeTrend })
    else if (change7d < 0) reasons.push({ code: 'volume-on-fall', weight: -10, value: volumeTrend })
  }

  const fromHigh = ((last - high) / high) * 100
  const fromLow = ((last - low) / low) * 100
  if (fromHigh > -3 && prices.length >= 10) reasons.push({ code: 'near-high', weight: -5 })

  let score = reasons.reduce((a, r) => a + r.weight, 0)
  const recentVolume = volumes.length > 0 ? mean(volumes.slice(-3)) : 0
  if (recentVolume < LOW_LIQUIDITY_DIVINE) {
    score = Math.round(score / 2)
    reasons.push({ code: 'low-liquidity', weight: 0 })
  }
  score = Math.max(-100, Math.min(100, score))
  const stance: Stance = score >= 25 ? 'favorable' : score <= -25 ? 'unfavorable' : 'neutral'

  return {
    days: prices.length,
    last,
    change1d: changeOver(prices, 1),
    change7d,
    change30d: changeOver(prices, 30),
    high,
    low,
    fromHigh,
    fromLow,
    sma7,
    sma20,
    rsi14,
    volatility: dailyVolatility(prices),
    volumeTrend,
    trend,
    score,
    stance,
    reasons,
  }
}
