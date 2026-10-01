// Gerador de regex para a busca do PoE2 (baú/loja): você escolhe mods de
// tablet e ele monta o texto que destaca só os tablets com esses mods.
//
// Dados: mods do domínio "tablet" do RePoE (texto exatamente como aparece no
// item, ex.: "Ritual Favours in Map have (35-70)% increased chance to be Omens").
// Implementação própria (não copiada de outros geradores).
//
// Sintaxe usada (busca do PoE2):
//   "a|b"   → qualquer um destes
//   "a" "b" → todos estes (blocos entre aspas separados por espaço = E; guias da comunidade, 2026)
//   "!a|b"  → esconde itens com algum destes
//   "[6-9]\d.*omen" → número mínimo antes do trecho do mod
//
// Limite: guias da comunidade (meados de 2026) dão ~50 caracteres na caixa de
// busca do PoE2 (o PoE1 aceita 250). Usamos 50 até confirmar no jogo.

export const SEARCH_LIMIT = 50

export interface TabletMod {
  /** Chave estável: o texto normalizado (vários tiers do mesmo mod viram um só). */
  key: string
  /** Texto do item com "#" no lugar do número (ex.: "Ritual Favours in Map have #% increased chance to be Omens"). */
  text: string
  /** Faixa de valores entre todos os tiers (do primeiro número do texto). */
  min: number | null
  max: number | null
  /** Tipos de tablet em que aparece (ex.: "ritual"); vazio = qualquer tablet. */
  types: string[]
  affix: 'prefix' | 'suffix' | null
}

/** "[ContainsRitual|Ritual Altars]" → "Ritual Altars"; "[Omen|Omens]" → "Omens". */
function stripMarkup(text: string): string {
  return text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1')
}

/** Lê os mods de tablet do mods.min.json do RePoE (tolerante: entrada estranha é ignorada). */
export function parseTabletMods(raw: Record<string, unknown>): TabletMod[] {
  const byKey = new Map<string, TabletMod>()
  for (const value of Object.values(raw)) {
    const m = value as { domain?: unknown; text?: unknown; generation_type?: unknown; spawn_weights?: unknown }
    if (m?.domain !== 'tablet' || typeof m.text !== 'string' || !m.text.trim()) continue
    const plain = stripMarkup(m.text).split('\n')[0]!.trim()
    const ranges = [...plain.matchAll(/\((-?\d+)-(-?\d+)\)/g)].map((r) => [Number(r[1]), Number(r[2])].sort((a, b) => a - b) as [number, number])
    const text = plain.replace(/\((-?\d+)-(-?\d+)\)/g, '#').replace(/\s+/g, ' ')
    const tags = Array.isArray(m.spawn_weights)
      ? (m.spawn_weights as Array<{ tag?: unknown; weight?: unknown }>).filter((w) => typeof w.tag === 'string' && Number(w.weight) > 0).map((w) => w.tag as string)
      : []
    const types = tags.map((t) => /^tower_augment_(.+)$/.exec(t)?.[1]).filter((t): t is string => !!t)
    const affix = m.generation_type === 'prefix' || m.generation_type === 'suffix' ? m.generation_type : null
    const key = text.toLowerCase()
    const prev = byKey.get(key)
    const [lo, hi] = ranges[0] ?? [null, null]
    if (prev) {
      if (lo !== null) prev.min = prev.min === null ? lo : Math.min(prev.min, lo)
      if (hi !== null) prev.max = prev.max === null ? hi : Math.max(prev.max, hi)
      for (const t of types) if (!prev.types.includes(t)) prev.types.push(t)
    } else {
      byKey.set(key, { key, text, min: lo, max: hi, types, affix })
    }
  }
  return [...byKey.values()].sort((a, b) => a.text.localeCompare(b.text))
}

/** Linhas de qualquer tablet que não são mods (para o trecho escolhido não bater nelas). */
const BASE_LINES = ['tablet', 'uses remaining', 'item level', 'requires level', 'corrupted', 'unidentified', 'place into an empty slot', 'precursor tablet']

const SPECIAL = /[.*+?^${}()|[\]\\]/g
const escape = (s: string) => s.replace(SPECIAL, '\\$&')

/**
 * Menor trecho do texto do mod que nenhum outro mod de tablet (nem as linhas
 * fixas do tablet) tem, para a busca destacar só ele. O trecho pode atravessar
 * o número ("#" vira dígitos no regex). Prefere trechos que começam numa
 * palavra. Se o texto inteiro aparece dentro de outro mod, usa o início da
 * linha ("^"). `afterNumber`: o trecho fica depois do primeiro número.
 */
export function uniqueToken(mod: TabletMod, all: readonly TabletMod[]): { token: string; afterNumber: boolean; anchored: boolean } | null {
  const haystack = [...all.filter((m) => m.key !== mod.key).map((m) => m.key), ...BASE_LINES]
  const key = mod.key
  const firstNumber = key.indexOf('#')
  const ok = (token: string) => token.trim() === token && !token.startsWith('%') && !haystack.some((h) => h.includes(token))
  // Menor trecho em qualquer posição e menor trecho que começa numa palavra.
  const shortest = (wordStart: boolean): { token: string; start: number } | null => {
    for (let len = 3; len <= Math.min(key.length, 40); len++) {
      for (let start = 0; start + len <= key.length; start++) {
        if (wordStart && start > 0 && key[start - 1] !== ' ') continue
        const token = key.slice(start, start + len)
        if (/^[^a-z#]/.test(token) || !ok(token)) continue
        return { token, start }
      }
    }
    return null
  }
  const any = shortest(false)
  const word = shortest(true)
  // Trecho que começa numa palavra é mais seguro ("e s" pode bater em "the s..." de outra linha):
  // aceita até 3 letras a mais por ele.
  const best = word && (!any || word.token.length <= any.token.length + 3) ? word : any
  if (best) return { token: best.token, afterNumber: firstNumber >= 0 && best.start > firstNumber, anchored: false }
  // Texto contido em outro mod: só o começo da linha distingue.
  for (let len = 3; len <= key.length; len++) {
    const token = key.slice(0, len)
    if (token.trim() !== token) continue
    if (!haystack.some((h) => h.startsWith(token))) return { token, afterNumber: false, anchored: true }
  }
  return null
}

/** Trecho em regex: escapa caracteres especiais e troca "#" por dígitos (ou pelo mínimo pedido). */
function tokenRegex(token: string, number: string): string {
  return token.split('#').map(escape).join(number)
}
/**
 * Números inteiros ≥ `min` (ex.: 60 → "[6-9]\d"; 65 → "(6[5-9]|[7-9]\d)").
 * `max`: maior valor que o mod chega; sem ele, inclui números com um dígito a
 * mais. Curto de propósito: a busca do PoE2 aceita poucos caracteres.
 * Seguro como trecho: um número maior que contenha esses dígitos também é ≥ min.
 */
export function numberAtLeast(min: number, max: number | null = null): string {
  if (!Number.isFinite(min) || min <= 0) return '\\d+'
  const digits = String(Math.floor(min))
  const L = digits.length
  const range = (from: number) => (from >= 9 ? '9' : from === 0 ? '\\d' : `[${from}-9]`)
  const top = max === null ? null : Math.floor(Math.abs(max))
  // Cada alternativa com o menor número que ela aceita; as que começam acima do máximo do mod saem.
  const parts: Array<{ re: string; low: number }> = []
  for (let i = 0; i < L; i++) {
    const prefix = digits.slice(0, i)
    const d = Number(digits[i])
    const rest = '\\d'.repeat(L - 1 - i)
    // Daqui para frente só zeros (ex.: 20): "[2-9]\d" já cobre tudo.
    if (/^0*$/.test(digits.slice(i + 1))) {
      parts.push({ re: prefix + range(d) + rest, low: Number(digits) })
      break
    }
    if (d < 9) parts.push({ re: prefix + range(d + 1) + rest, low: Number(prefix + String(d + 1) + '0'.repeat(L - 1 - i)) })
  }
  if (top === null || String(top).length > L) parts.push({ re: '\\d'.repeat(L + 1), low: 10 ** L })
  const kept = parts.filter((p) => top === null || top < min || p.low <= top).map((p) => p.re)
  return kept.length === 1 ? kept[0]! : `(${kept.join('|')})`
}

export type Mode = 'any' | 'all' | 'exclude'

export interface Selection {
  key: string
  mode: Mode
  /** Valor mínimo (opcional). */
  min: number | null
}

export interface RegexResult {
  text: string
  length: number
  tooLong: boolean
  /** Mods que não deram para identificar sozinhos (texto igual a outro). */
  skipped: string[]
}

/** Trecho de busca de um mod (com o número mínimo, se houver). */
export function termFor(mod: TabletMod, all: readonly TabletMod[], min: number | null): string | null {
  const found = uniqueToken(mod, all)
  if (!found) return null
  const anchor = found.anchored ? '^' : ''
  const num = min === null || !mod.key.includes('#') ? null : numberAtLeast(min, mod.max)
  // O trecho já passa pelo número: o mínimo entra direto no lugar do "#".
  if (found.token.includes('#')) return anchor + tokenRegex(found.token, num ?? '\\d+')
  const token = anchor + tokenRegex(found.token, '\\d+')
  if (num === null) return token
  return found.afterNumber ? `${num}.*${token}` : `${token}.*${num}`
}

export function buildRegex(selection: readonly Selection[], all: readonly TabletMod[]): RegexResult {
  const byKey = new Map(all.map((m) => [m.key, m]))
  const any: string[] = []
  const every: string[] = []
  const exclude: string[] = []
  const skipped: string[] = []
  for (const s of selection) {
    const mod = byKey.get(s.key)
    if (!mod) continue
    const term = termFor(mod, all, s.mode === 'exclude' ? null : s.min)
    if (!term) {
      skipped.push(mod.text)
      continue
    }
    ;(s.mode === 'any' ? any : s.mode === 'all' ? every : exclude).push(term)
  }
  const parts: string[] = []
  if (any.length > 0) parts.push(`"${any.join('|')}"`)
  for (const t of every) parts.push(`"${t}"`)
  if (exclude.length > 0) parts.push(`"!${exclude.join('|')}"`)
  const text = parts.join(' ')
  return { text, length: text.length, tooLong: text.length > SEARCH_LIMIT, skipped }
}

export interface RegexPreset {
  id: string
  /** Ex.: "Ritual · Reroll + Defer". */
  label: string
  mechanic: string
  selection: Selection[]
}

/** Texto comparável entre a trade ("#% increased", "in Area") e o item ("#% reduced", "in Map"). */
function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/\+/g, '')
    .replace(/\b(increased|reduced)\b/g, '~')
    .replace(/\bin area\b/g, 'in map')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Atalhos prontos a partir das receitas de tablet de cada mecânica (os mesmos
 * combos da aba "Por mecânica"). `statText` traduz o id da trade no texto do mod.
 */
export function buildPresets(
  mechanics: ReadonlyArray<{ id: string; name: string; recipes: ReadonlyArray<{ id: string; label: string; rarity: string; mods: ReadonlyArray<{ statId: string; min?: number; max?: number }> }> }>,
  mods: readonly TabletMod[],
  statText: (statId: string) => string | null,
): RegexPreset[] {
  const byText = new Map(mods.map((m) => [comparable(m.text), m]))
  // A trade às vezes escreve no singular ("an additional time") e o item no plural com número
  // ("3 additional times"): segunda tentativa por palavras (sem artigos, plurais e números).
  const words = (text: string) =>
    new Set(
      comparable(text)
        .replace(/[#\d%]/g, ' ')
        .split(/\s+/)
        .map((w) => w.replace(/s$/, ''))
        .filter((w) => w.length > 1 && !['an', 'a', 'the'].includes(w)),
    )
  const similar = (text: string): TabletMod | undefined => {
    const target = words(text)
    let best: { mod: TabletMod; score: number } | undefined
    for (const mod of mods) {
      const w = words(mod.text)
      const common = [...target].filter((x) => w.has(x)).length
      const score = common / new Set([...target, ...w]).size
      if (!best || score > best.score) best = { mod, score }
    }
    return best && best.score >= 0.8 ? best.mod : undefined
  }
  const out: RegexPreset[] = []
  for (const mech of mechanics) {
    for (const recipe of mech.recipes) {
      if (recipe.rarity === 'unique' || recipe.mods.length === 0) continue
      const selection: Selection[] = []
      for (const rm of recipe.mods) {
        const text = statText(rm.statId)
        const mod = text ? (byText.get(comparable(text)) ?? similar(text)) : undefined
        if (!mod) continue
        const min = rm.min ?? (rm.max !== undefined ? Math.abs(rm.max) : null)
        selection.push({ key: mod.key, mode: 'all', min })
      }
      // Só vira atalho se todos os mods da receita foram encontrados no texto do item.
      if (selection.length === recipe.mods.length) out.push({ id: `${mech.id}:${recipe.id}`, label: `${mech.name} · ${recipe.label}`, mechanic: mech.id, selection })
    }
  }
  return out
}

/** Nome da mecânica para o filtro de tipo (ex.: "ritual" → "Ritual"). */
export function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ')
}
