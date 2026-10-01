// Casa as linhas de mod de um item com os "stats" da API oficial de trade
// (/api/trade2/data/stats). Ex.: "+78 to maximum Life" → explicit.stat_3299347043.

import { extractNumbers, type ModKind, type ParsedItem, type ParsedMod } from './parser'

export interface StatEntry {
  id: string
  text: string
  /** Grupo da trade: explicit, implicit, rune, enchant, crafted, fractured, desecrated... */
  group: string
}

export interface MatchedStat {
  mod: ParsedMod
  stat: StatEntry
  /** Valor usado na busca: média dos números do mod, já com o sinal ajustado. */
  value: number | null
}

const NUMBER_TOKEN = /[+-]?\d+(?:\.\d+)?/g
const LOCAL_SUFFIX = ' (Local)'

// Classes cujos mods de defesa/ataque são "locais" (valem só para o item).
// "Weapons" é a classe usada para armas da build importada (o PoB não informa a classe).
const LOCAL_ITEM_CLASS =
  /(Body Armours|Helmets|Gloves|Boots|Shields|Bucklers|Foci|Swords|Axes|Maces|Sceptres|Spears|Flails|Bows|Crossbows|Wands|Staves|Quarterstaves|Claws|Daggers|Traps|Talismans|Weapons)/i

function template(text: string): string {
  return text.replace(NUMBER_TOKEN, '#')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

// Variações em que o jogo escreve o oposto do texto da trade: "reduced" em vez
// de "increased" com valor negativo, etc.
const NEGATIONS: ReadonlyArray<[RegExp, string]> = [
  [/\breduced\b/, 'increased'],
  [/\bless\b/, 'more'],
  [/\bslower\b/, 'faster'],
]

function kindToGroups(kind: ModKind): string[] {
  switch (kind) {
    case 'fractured':
      return ['fractured', 'explicit']
    case 'desecrated':
      return ['desecrated', 'explicit']
    default:
      return [kind]
  }
}

export class StatIndex {
  private readonly byKey = new Map<string, StatEntry>()
  private readonly patterns = new Map<string, Array<{ entry: StatEntry; regex: RegExp }>>()

  constructor(readonly entries: readonly StatEntry[]) {
    for (const entry of entries) {
      const key = `${entry.group}|${entry.text}`
      // Textos duplicados no mesmo grupo: fica o primeiro, que é o mais comum.
      if (!this.byKey.has(key)) this.byKey.set(key, entry)
      if (entry.text.includes('#')) {
        const source = '^' + escapeRegExp(entry.text).replace(/#/g, '([+-]?\\d+(?:\\.\\d+)?)') + '$'
        const list = this.patterns.get(entry.group) ?? []
        list.push({ entry, regex: new RegExp(source) })
        this.patterns.set(entry.group, list)
      }
    }
  }

  get size(): number {
    return this.byKey.size
  }

  private lookup(group: string, text: string, preferLocal: boolean): StatEntry | undefined {
    if (preferLocal) {
      const local = this.byKey.get(`${group}|${text}${LOCAL_SUFFIX}`)
      if (local) return local
    }
    return this.byKey.get(`${group}|${text}`)
  }

  /** Encontra o stat da trade para um mod. Retorna null se não houver. */
  match(mod: ParsedMod, preferLocal: boolean): MatchedStat | null {
    const tpl = template(mod.text)
    const baseValue = average(mod.values)

    for (const group of kindToGroups(mod.kind)) {
      const direct = this.lookup(group, tpl, preferLocal)
      if (direct) return { mod, stat: direct, value: baseValue }

      for (const [pattern, replacement] of NEGATIONS) {
        if (!pattern.test(tpl)) continue
        const flipped = this.lookup(group, tpl.replace(pattern, replacement), preferLocal)
        if (flipped) return { mod, stat: flipped, value: baseValue === null ? null : -baseValue }
      }

      // Mods com números fixos no texto (ex.: "lasts 8 seconds") não viram
      // "#" em todos os lugares; aí testamos os padrões um a um.
      for (const { entry, regex } of this.patterns.get(group) ?? []) {
        const m = regex.exec(mod.text)
        if (!m) continue
        const values = m.slice(1).flatMap((v) => extractNumbers(v))
        if (preferLocal) {
          const local = this.byKey.get(`${group}|${entry.text}${LOCAL_SUFFIX}`)
          if (local) return { mod, stat: local, value: average(values) }
        }
        return { mod, stat: entry, value: average(values) }
      }
    }
    return null
  }

  matchItem(item: ParsedItem): { matched: MatchedStat[]; unmatched: ParsedMod[] } {
    const preferLocal = LOCAL_ITEM_CLASS.test(item.itemClass)
    const matched: MatchedStat[] = []
    const unmatched: ParsedMod[] = []
    for (const mod of item.mods) {
      const result = this.match(mod, preferLocal)
      if (result) matched.push(result)
      else unmatched.push(mod)
    }
    return { matched, unmatched }
  }
}
