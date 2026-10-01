// Indicadores técnicos sobre séries diárias de preço. Funções puras.

/** Média móvel simples. Posições sem dados suficientes ficam null. */
export function sma(values: readonly number[], period: number): (number | null)[] {
  if (period < 1) throw new RangeError('period deve ser >= 1')
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!
    if (i >= period) sum -= values[i - period]!
    out.push(i >= period - 1 ? sum / period : null)
  }
  return out
}

/**
 * RSI de Wilder. Retorna null se a série for curta demais.
 * Acima de 70 costuma indicar "sobrecomprado"; abaixo de 30, "sobrevendido".
 */
export function rsi(values: readonly number[], period = 14): number | null {
  if (values.length <= period) return null
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** Variação percentual entre o valor de `daysAgo` dias atrás e o último. */
export function changeOver(values: readonly number[], daysAgo: number): number | null {
  if (values.length <= daysAgo) return null
  const past = values[values.length - 1 - daysAgo]!
  const last = values[values.length - 1]!
  if (past === 0) return null
  return ((last - past) / past) * 100
}

/** Desvio padrão dos retornos diários (%), medida simples de volatilidade. */
export function dailyVolatility(values: readonly number[]): number | null {
  if (values.length < 3) return null
  const returns: number[] = []
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!
    if (prev !== 0) returns.push(((values[i]! - prev) / prev) * 100)
  }
  if (returns.length < 2) return null
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance)
}
