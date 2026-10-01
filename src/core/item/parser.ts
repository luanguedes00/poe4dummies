// Lê o texto que o PoE2 coloca na área de transferência (Ctrl+C ou
// Ctrl+Alt+C sobre um item). O texto vem de fora do app: é tratado como
// entrada não confiável e nunca é interpretado como código ou HTML.

export const MAX_ITEM_TEXT_LENGTH = 20_000

export type ModKind = 'explicit' | 'implicit' | 'rune' | 'enchant' | 'crafted' | 'fractured' | 'desecrated'
export type Affix = 'prefix' | 'suffix'

export interface ParsedMod {
  /** Texto limpo do mod, sem marcadores como "(implicit)" ou faixas de rolagem. */
  text: string
  kind: ModKind
  values: number[]
  /** Só disponível no modo avançado (Ctrl+Alt+C). */
  affix: Affix | null
  tier: number | null
  affixName: string | null
}

/** Defesa e dano da base (já com qualidade e mods locais, como o jogo mostra). */
export interface ItemProperties {
  armour: number | null
  evasion: number | null
  energyShield: number | null
  spirit: number | null
  /** Faixas de dano: físico, elemental (fogo/frio/raio) e caos. */
  physical: Array<[number, number]>
  elemental: Array<[number, number]>
  chaos: Array<[number, number]>
  attacksPerSecond: number | null
}

export interface ParsedItem {
  itemClass: string
  rarity: string
  /** Nome próprio de itens raros e únicos. */
  name: string | null
  /** Tipo base; para itens mágicos pode conter os afixos no nome. */
  baseLine: string
  itemLevel: number | null
  quality: number | null
  gemLevel: number | null
  stackSize: number | null
  corrupted: boolean
  unidentified: boolean
  mirrored: boolean
  mods: ParsedMod[]
  /** Defesa/dano da base. Ausente em itens montados fora do texto do jogo (ex.: build). */
  properties?: ItemProperties
}

const RANGE = /(\d+)-(\d+)/g

function ranges(value: string): Array<[number, number]> {
  return [...value.matchAll(RANGE)].map((m) => [Number(m[1]), Number(m[2])] as [number, number])
}

function firstNumber(value: string): number | null {
  const m = /\d+(?:\.\d+)?/.exec(value.replace(/,/g, ''))
  return m ? Number(m[0]) : null
}

/** Lê uma linha de propriedade ("Armour: 512 (augmented)") para dentro de `props`. */
function readProperty(line: string, props: ItemProperties): void {
  const colon = line.indexOf(':')
  if (colon <= 0) return
  const key = line.slice(0, colon).trim()
  const value = line.slice(colon + 1)
  switch (key) {
    case 'Armour':
      props.armour = firstNumber(value)
      break
    case 'Evasion Rating':
      props.evasion = firstNumber(value)
      break
    case 'Energy Shield':
      props.energyShield = firstNumber(value)
      break
    case 'Spirit':
      props.spirit = firstNumber(value)
      break
    case 'Physical Damage':
      props.physical.push(...ranges(value))
      break
    case 'Elemental Damage':
    case 'Fire Damage':
    case 'Cold Damage':
    case 'Lightning Damage':
      props.elemental.push(...ranges(value))
      break
    case 'Chaos Damage':
      props.chaos.push(...ranges(value))
      break
    case 'Attacks per Second':
      props.attacksPerSecond = firstNumber(value)
      break
  }
}

/** DPS da arma (como a trade calcula: média do dano × ataques por segundo). */
export function weaponDps(props: ItemProperties): { total: number; physical: number; elemental: number } | null {
  if (!props.attacksPerSecond) return null
  const avg = (list: Array<[number, number]>) => list.reduce((s, [a, b]) => s + (a + b) / 2, 0)
  const physical = avg(props.physical) * props.attacksPerSecond
  const elemental = avg(props.elemental) * props.attacksPerSecond
  const chaos = avg(props.chaos) * props.attacksPerSecond
  const total = physical + elemental + chaos
  return total > 0 ? { total, physical, elemental } : null
}

export type ItemParseErrorCode = 'not-an-item' | 'missing-name'

export class ItemParseError extends Error {
  override name = 'ItemParseError'
  constructor(readonly code: ItemParseErrorCode) {
    super(code)
  }
}

const SEPARATOR = /^-{8,}$/
const KIND_SUFFIX = /\s+\((implicit|rune|enchant|crafted|fractured|desecrated)\)$/i
const PROPERTY_LINE = /^[A-Z][A-Za-z' ]{1,40}:(\s|$)/
const FLAG_LINES = new Set(['Corrupted', 'Unidentified', 'Mirrored', 'Split', 'Sanctified', 'Unmodifiable'])
const ADVANCED_HEADER = /^\{\s*(.+?)\s*\}$/
// Faixas do modo avançado, ex.: "+80(70-89)" ou "-5(-10--5)".
const ROLL_RANGE = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g
const NUMBER = /[+-]?\d+(?:\.\d+)?/g

export function looksLikeItemText(text: string): boolean {
  if (text.length === 0 || text.length > MAX_ITEM_TEXT_LENGTH) return false
  return /^Item Class: .+\r?\n\s*Rarity: .+/.test(text.trimStart())
}

function toInt(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const n = Number.parseInt(raw.replace(/[.,\s]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

export function extractNumbers(text: string): number[] {
  return (text.match(NUMBER) ?? []).map(Number)
}

interface AdvancedContext {
  kind: ModKind | null
  affix: Affix | null
  tier: number | null
  affixName: string | null
}

function parseAdvancedHeader(inner: string): AdvancedContext {
  // Ex.: `Prefix Modifier "Hale" (Tier: 3) — Life`, `Implicit Modifier — Resistance`
  const lower = inner.toLowerCase()
  const affix: Affix | null = lower.startsWith('prefix') ? 'prefix' : lower.startsWith('suffix') ? 'suffix' : null
  let kind: ModKind | null = null
  if (lower.startsWith('implicit')) kind = 'implicit'
  else if (lower.startsWith('rune')) kind = 'rune'
  else if (lower.startsWith('enchant')) kind = 'enchant'
  else if (lower.includes('crafted')) kind = 'crafted'
  else if (lower.includes('fractured')) kind = 'fractured'
  else if (lower.includes('desecrated')) kind = 'desecrated'
  const name = /"([^"]+)"/.exec(inner)?.[1] ?? null
  const tier = toInt(/\b(?:Tier|Rank):\s*(\d+)/i.exec(inner)?.[1])
  return { kind, affix, tier, affixName: name }
}

function cleanModLine(line: string): { text: string; kind: ModKind | null } {
  let text = line.replace(ROLL_RANGE, '').trim()
  let kind: ModKind | null = null
  const marker = KIND_SUFFIX.exec(text)
  if (marker) {
    kind = marker[1]!.toLowerCase() as ModKind
    text = text.slice(0, marker.index).trim()
  }
  return { text, kind }
}

function splitSections(text: string): string[][] {
  const sections: string[][] = [[]]
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (SEPARATOR.test(line)) {
      sections.push([])
    } else if (line.length > 0) {
      sections[sections.length - 1]!.push(line)
    }
  }
  return sections.filter((s) => s.length > 0)
}

export function parseItemText(text: string): ParsedItem {
  if (!looksLikeItemText(text)) {
    throw new ItemParseError('not-an-item')
  }
  const sections = splitSections(text)
  const header = sections[0]!
  const itemClass = header[0]!.replace(/^Item Class:\s*/, '')
  const rarity = header[1]!.replace(/^Rarity:\s*/, '')
  const nameLines = header.slice(2)
  if (nameLines.length === 0) throw new ItemParseError('missing-name')

  const item: ParsedItem = {
    itemClass,
    rarity,
    name: nameLines.length >= 2 ? nameLines[0]! : null,
    baseLine: nameLines[nameLines.length - 1]!,
    itemLevel: null,
    quality: null,
    gemLevel: null,
    stackSize: null,
    corrupted: false,
    unidentified: false,
    mirrored: false,
    mods: [],
    properties: { armour: null, evasion: null, energyShield: null, spirit: null, physical: [], elemental: [], chaos: [], attacksPerSecond: null },
  }

  let seenItemLevel = false
  for (const section of sections.slice(1)) {
    // Bloco de defesa/dano vem antes do nível do item (pode começar com o nome da classe, ex.: "Bow").
    if (!seenItemLevel) for (const line of section) if (PROPERTY_LINE.test(line)) readProperty(line, item.properties!)
    const isRequirements = section[0] === 'Requirements:' || section[0]!.startsWith('Requires')
    const allProperties = section.every((l) => PROPERTY_LINE.test(l))

    if (allProperties) {
      for (const line of section) {
        const [key, ...rest] = line.split(':')
        const value = rest.join(':').trim()
        switch (key) {
          case 'Item Level':
            item.itemLevel = toInt(value)
            seenItemLevel = true
            break
          case 'Quality':
            item.quality = toInt(/\d+/.exec(value)?.[0])
            break
          case 'Stack Size':
            item.stackSize = toInt(value.split('/')[0])
            break
          case 'Level':
            if (!isRequirements && item.gemLevel === null && /gem/i.test(itemClass)) {
              item.gemLevel = toInt(/\d+/.exec(value)?.[0])
            }
            break
        }
      }
      continue
    }

    if (section.length === 1 && FLAG_LINES.has(section[0]!)) {
      if (section[0] === 'Corrupted') item.corrupted = true
      if (section[0] === 'Unidentified') item.unidentified = true
      if (section[0] === 'Mirrored') item.mirrored = true
      continue
    }

    if (!seenItemLevel) continue

    let context: AdvancedContext = { kind: null, affix: null, tier: null, affixName: null }
    for (const line of section) {
      if (FLAG_LINES.has(line) || line.startsWith('Note:')) continue
      const advanced = ADVANCED_HEADER.exec(line)
      if (advanced) {
        context = parseAdvancedHeader(advanced[1]!)
        continue
      }
      // Texto explicativo do modo avançado, ex.: "(Armour reduces physical damage...)"
      if (line.startsWith('(') && line.endsWith(')')) continue
      const { text: modText, kind } = cleanModLine(line)
      if (modText.length === 0) continue
      item.mods.push({
        text: modText,
        kind: kind ?? context.kind ?? 'explicit',
        values: extractNumbers(modText),
        affix: context.affix,
        tier: context.tier,
        affixName: context.affixName,
      })
    }
  }

  // Itens únicos têm texto de ambientação depois dos mods; ele não casa com
  // nenhum mod da trade e é descartado pelo matcher. Aqui só marcamos flags.
  return item
}

export function itemTitle(item: ParsedItem): string {
  return item.name ? `${item.name} — ${item.baseLine}` : item.baseLine
}
