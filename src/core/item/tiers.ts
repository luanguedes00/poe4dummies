// Tiers de mods: "T1" = melhor faixa que pode aparecer naquela base.
// A trade oficial não filtra por tier; aqui transformamos o tier escolhido
// no valor mínimo que a trade entende.
//
// Detalhe importante: em mods com dois números ("Adds X to Y"), a trade
// compara a MÉDIA dos dois. As faixas de média de tiers vizinhos podem se
// sobrepor, por isso existem dois mínimos: "T ou melhor" e "só esse tier".

import type { RepoeData, RepoeMod } from '../sources/repoe'
import type { ParsedMod } from './parser'
import type { StatIndex } from './statMatcher'

export interface TierRow {
  affix: string
  itemLevel: number
  /** Faixa [mín, máx] de cada número do mod, na ordem do texto. */
  ranges: Array<[number, number]>
  spawn: Array<{ tag: string; weight: number }>
}

/** statId da trade → todas as linhas de tier que dão esse stat. */
export type TierTable = Map<string, TierRow[]>

export interface TierOption {
  tier: number
  affix: string
  itemLevel: number
  ranges: Array<[number, number]>
  /** Mínimo para "este tier ou melhor". */
  min: number
  /** Mínimo que garante este tier (maior que o máximo do tier de baixo). */
  strictMin: number
}

/** Remove a marcação do RePoE: "[Resistances|Fire Resistance]" → "Fire Resistance". */
export function cleanRepoeText(text: string): string {
  return text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1')
}

const RANGE = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g

/** Troca cada faixa "(10-19)" pelo seu mínimo, gerando uma linha como a do jogo. */
function sampleLine(text: string): string {
  return cleanRepoeText(text).replace(RANGE, '$1')
}

function isAffix(mod: RepoeMod): boolean {
  return (mod.generation_type === 'prefix' || mod.generation_type === 'suffix') && !mod.is_essence_only
}

/**
 * Monta a tabela ligando cada mod do RePoE ao stat da trade, usando o mesmo
 * matcher que lê os itens do jogo. Mods híbridos (duas linhas) ficam de fora.
 */
export function buildTierTable(data: RepoeData, index: StatIndex): TierTable {
  const table: TierTable = new Map()
  for (const mod of data.mods) {
    if (!isAffix(mod) || !mod.text || mod.text.includes('\n') || mod.stats.length === 0) continue
    const line = sampleLine(mod.text)
    const parsed: ParsedMod = { text: line, kind: 'explicit', values: [], affix: null, tier: null, affixName: null }
    const preferLocal = mod.stats.some((s) => s.id.startsWith('local_'))
    const match = index.match(parsed, preferLocal)
    if (!match) continue
    const row: TierRow = {
      affix: mod.name ?? '',
      itemLevel: mod.required_level,
      ranges: mod.stats.map((s) => [s.min, s.max]),
      spawn: mod.spawn_weights ?? [],
    }
    const list = table.get(match.stat.id) ?? []
    list.push(row)
    table.set(match.stat.id, list)
  }
  return table
}

/** Regra do jogo: vale o PRIMEIRO tag da lista que o item tiver. */
export function canSpawn(row: TierRow, baseTags: readonly string[]): boolean {
  const tags = new Set(baseTags)
  for (const w of row.spawn) {
    if (tags.has(w.tag)) return w.weight > 0
  }
  return false
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Tiers possíveis de um stat numa base, do melhor (T1) para o pior. */
export function tiersFor(table: TierTable, statId: string, baseTags: readonly string[]): TierOption[] {
  const rows = (table.get(statId) ?? []).filter((r) => canSpawn(r, baseTags))
  const unique = new Map<string, TierRow>()
  for (const r of rows) unique.set(JSON.stringify(r.ranges), r)
  const sorted = [...unique.values()].sort(
    (a, b) => mean(b.ranges.map((x) => x[1])) - mean(a.ranges.map((x) => x[1])) || b.itemLevel - a.itemLevel,
  )
  return sorted.map((row, i) => {
    const min = mean(row.ranges.map((x) => x[0]))
    const below = sorted[i + 1]
    const belowMax = below ? mean(below.ranges.map((x) => x[1])) : -Infinity
    // Médias de inteiros andam de 0,5 em 0,5; números únicos, de 1 em 1.
    const step = row.ranges.length > 1 ? 0.5 : 1
    const strictMin = Math.max(min, belowMax + step)
    return { tier: i + 1, affix: row.affix, itemLevel: row.itemLevel, ranges: row.ranges, min, strictMin }
  })
}

/**
 * Descobre o tier de um mod pelos números rolados. Com dois números, confere
 * cada um na sua faixa; se nenhum tier bater exatamente, usa a média.
 */
export function tierOf(tiers: readonly TierOption[], values: readonly number[]): number | null {
  if (values.length === 0) return null
  const abs = values.map(Math.abs)
  const exact = tiers.find((t) => t.ranges.length === abs.length && t.ranges.every(([lo, hi], i) => abs[i]! >= lo && abs[i]! <= hi))
  if (exact) return exact.tier
  const avg = mean(abs)
  const byAverage = tiers.find((t) => avg >= t.min && avg <= mean(t.ranges.map((x) => x[1])))
  return byAverage?.tier ?? null
}
