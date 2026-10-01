// Lucro da sessão de farm: junta o valor do loot (modo lista) com o tempo e a
// quantidade de mapas (tracker do log). Sem login: nada disso sai do PC.

export interface SessionInput {
  /** Valor total da lista (loot contado), em Divine. */
  lootDivine: number
  /** Mapas concluídos na sessão (tracker). */
  maps: number
  /** Tempo total da sessão em ms (tracker), incluindo hideout entre mapas. */
  totalMs: number
  /** Custo por mapa do setup (tablets + waystone), em Divine. Opcional. */
  costPerMapDivine?: number | null
}

export interface SessionProfit {
  lootPerMap: number | null
  lootPerHour: number | null
  /** Lucro = loot − custo dos mapas; null sem custo informado. */
  profit: number | null
  profitPerHour: number | null
}

/** Menos que isso de sessão (em ms) não dá uma média confiável por hora. */
const MIN_SESSION_MS = 5 * 60 * 1000

export function sessionProfit(input: SessionInput): SessionProfit {
  const hours = input.totalMs >= MIN_SESSION_MS ? input.totalMs / 3_600_000 : null
  const lootPerMap = input.maps > 0 ? input.lootDivine / input.maps : null
  const lootPerHour = hours ? input.lootDivine / hours : null
  const cost = input.costPerMapDivine
  const profit = cost === null || cost === undefined ? null : input.lootDivine - cost * input.maps
  const profitPerHour = profit !== null && hours ? profit / hours : null
  return { lootPerMap, lootPerHour, profit, profitPerHour }
}
