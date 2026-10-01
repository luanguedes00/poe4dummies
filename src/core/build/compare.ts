// "É upgrade para a minha build?": compara o item copiado no jogo com o item
// equipado no mesmo slot da build importada. Sem cálculo de dano: soma os
// stats de defesa e utilidade que dá para ler com segurança e usa os totais
// do PoB (resistência, atributos) para dizer se a diferença importa.

import type { ParsedItem } from '../item/parser'
import type { Build, BuildItem, ItemProperties } from './model'

export const STAT_KEYS = [
  'life', 'energyShield', 'mana', 'armour', 'evasion', 'spirit',
  'fireRes', 'coldRes', 'lightningRes', 'chaosRes', 'moveSpeed', 'str', 'dex', 'int',
] as const
export type StatKey = (typeof STAT_KEYS)[number]
export type ItemStats = Record<StatKey, number>

const RES_KEYS = ['fireRes', 'coldRes', 'lightningRes', 'chaosRes'] as const
type ResKey = (typeof RES_KEYS)[number]
const RES_STAT: Record<ResKey, string> = { fireRes: 'FireResist', coldRes: 'ColdResist', lightningRes: 'LightningResist', chaosRes: 'ChaosResist' }
const ATTR_STAT = { str: 'Str', dex: 'Dex', int: 'Int' } as const
/** Atributos só pesam no veredito quando faltam para os requisitos. */
const NEUTRAL: ReadonlySet<StatKey> = new Set(['str', 'dex', 'int'])

function empty(): ItemStats {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as ItemStats
}

const ELEMENT: Record<string, ResKey> = { fire: 'fireRes', cold: 'coldRes', lightning: 'lightningRes', chaos: 'chaosRes' }
const ATTRIBUTE: Record<string, 'str' | 'dex' | 'int'> = { strength: 'str', dexterity: 'dex', intelligence: 'int' }

type Rule = [RegExp, (m: RegExpExecArray, add: (key: StatKey, value: number) => void, hasDefences: boolean) => void]

const num = (s: string | undefined) => Number(s)

const RULES: Rule[] = [
  [/^([+-]?\d+) to maximum Life$/i, (m, add) => add('life', num(m[1]))],
  [/^([+-]?\d+) to maximum Mana$/i, (m, add) => add('mana', num(m[1]))],
  // Em armaduras, ES/Armadura/Evasão planos são locais e já estão nas propriedades do item.
  [/^([+-]?\d+) to maximum Energy Shield$/i, (m, add, local) => !local && add('energyShield', num(m[1]))],
  [/^([+-]?\d+) to Armour$/i, (m, add, local) => !local && add('armour', num(m[1]))],
  [/^([+-]?\d+) to Evasion Rating$/i, (m, add, local) => !local && add('evasion', num(m[1]))],
  [/^([+-]?\d+) to Spirit$/i, (m, add) => add('spirit', num(m[1]))],
  [/^([+-]?\d+(?:\.\d+)?)% to all Elemental Resistances$/i, (m, add) => {
    for (const k of ['fireRes', 'coldRes', 'lightningRes'] as const) add(k, num(m[1]))
  }],
  [/^([+-]?\d+(?:\.\d+)?)% to (Fire|Cold|Lightning|Chaos) Resistance$/i, (m, add) => add(ELEMENT[m[2]!.toLowerCase()]!, num(m[1]))],
  [/^([+-]?\d+(?:\.\d+)?)% to (Fire|Cold|Lightning|Chaos) and (Fire|Cold|Lightning|Chaos) Resistances$/i, (m, add) => {
    add(ELEMENT[m[2]!.toLowerCase()]!, num(m[1]))
    add(ELEMENT[m[3]!.toLowerCase()]!, num(m[1]))
  }],
  [/^([+-]?\d+) to all Attributes$/i, (m, add) => {
    for (const k of ['str', 'dex', 'int'] as const) add(k, num(m[1]))
  }],
  [/^([+-]?\d+) to (Strength|Dexterity|Intelligence)$/i, (m, add) => add(ATTRIBUTE[m[2]!.toLowerCase()]!, num(m[1]))],
  [/^([+-]?\d+) to (Strength|Dexterity|Intelligence) and (Strength|Dexterity|Intelligence)$/i, (m, add) => {
    add(ATTRIBUTE[m[2]!.toLowerCase()]!, num(m[1]))
    add(ATTRIBUTE[m[3]!.toLowerCase()]!, num(m[1]))
  }],
  [/^(\d+(?:\.\d+)?)% (increased|reduced) Movement Speed$/i, (m, add) => add('moveSpeed', m[2]!.toLowerCase() === 'reduced' ? -num(m[1]) : num(m[1]))],
]

export interface ReadStats {
  stats: ItemStats
  /** Mods que não entram na conta (dano, crítico...), para o usuário conferir. */
  other: string[]
}

/** Soma os stats conhecidos de um item. */
export function readItemStats(mods: string[], properties: ItemProperties): ReadStats {
  const stats = empty()
  const hasDefences = properties.armour > 0 || properties.evasion > 0 || properties.energyShield > 0
  stats.armour += properties.armour
  stats.evasion += properties.evasion
  stats.energyShield += properties.energyShield
  const add = (key: StatKey, value: number) => {
    if (Number.isFinite(value)) stats[key] += value
  }
  const other: string[] = []
  for (const line of mods) {
    const text = line.trim()
    // Spirit de cetros e armaduras já vem somado na propriedade "Spirit".
    if (properties.spirit > 0 && /to Spirit$/i.test(text)) continue
    const rule = RULES.find(([re]) => re.test(text))
    if (rule) rule[1](rule[0].exec(text)!, add, hasDefences)
    else other.push(text)
  }
  stats.spirit += properties.spirit
  return { stats, other }
}

/** Defesas e spirit do item copiado no jogo (bloco de propriedades). */
export function gameItemProperties(text: string): ItemProperties {
  const props: ItemProperties = { armour: 0, evasion: 0, energyShield: 0, spirit: 0 }
  for (const line of text.split(/\r?\n/)) {
    const m = /^(Armour|Evasion Rating|Energy Shield|Spirit):\s*(\d+)/.exec(line.trim())
    if (!m) continue
    const value = Number(m[2])
    if (m[1] === 'Armour') props.armour = value
    else if (m[1] === 'Evasion Rating') props.evasion = value
    else if (m[1] === 'Energy Shield') props.energyShield = value
    else props.spirit = value
  }
  return props
}

// ---------------------------------------------------------------- slots

const SLOT_BY_CLASS: Record<string, string[]> = {
  Helmets: ['Helmet'],
  'Body Armours': ['Body Armour'],
  Gloves: ['Gloves'],
  Boots: ['Boots'],
  Belts: ['Belt'],
  Amulets: ['Amulet'],
  Rings: ['Ring 1', 'Ring 2', 'Ring 3'],
  Shields: ['Weapon 2'],
  Bucklers: ['Weapon 2'],
  Foci: ['Weapon 2'],
  Quivers: ['Weapon 2'],
}
const WEAPON_CLASS = /Swords|Axes|Maces|Daggers|Claws|Wands|Sceptres|Spears|Flails|Bows|Staves|Quarterstaves|Talismans|Traps/

export type SlotKind = 'gear' | 'weapon'

/** Slot de arma do set em uso: set II usa os slots "Swap". */
export function activeWeaponSlot(build: Build, slot: 'Weapon 1' | 'Weapon 2'): string {
  return build.activeWeaponSet === 2 ? `${slot} Swap` : slot
}

/** Slots da build onde o item copiado poderia entrar; null se não comparamos esse tipo. */
export function slotsFor(itemClass: string, build: Build): { slots: string[]; kind: SlotKind } | null {
  const gear = SLOT_BY_CLASS[itemClass]
  if (gear) {
    // Ring 3 só existe em algumas ascensões: só entra se a build usa.
    const slots = gear
      .filter((s) => s !== 'Ring 3' || build.items.some((i) => i.slot === 'Ring 3'))
      .map((s) => (s === 'Weapon 2' ? activeWeaponSlot(build, 'Weapon 2') : s))
    return { slots, kind: 'gear' }
  }
  if (WEAPON_CLASS.test(itemClass)) return { slots: [activeWeaponSlot(build, 'Weapon 1')], kind: 'weapon' }
  return null
}

// ---------------------------------------------------------------- comparação

export interface StatDelta {
  key: StatKey
  current: number
  next: number
  delta: number
  /** Quanto muda de fato na build (resistência acima do cap não conta). */
  effective: number
  /** Resistência: total da build depois da troca e o cap. */
  resAfter?: { value: number; cap: number }
}

export type UpgradeVerdict = 'upgrade' | 'downgrade' | 'sidegrade' | 'same'
export type UpgradeWarning = { kind: 'attribute'; key: 'str' | 'dex' | 'int'; missing: number } | { kind: 'spirit'; missing: number }

export interface SlotComparison {
  slot: string
  equipped: BuildItem | null
  deltas: StatDelta[]
  verdict: UpgradeVerdict
  warnings: UpgradeWarning[]
  /** Mods fora da conta que o item novo tem e o equipado não (e vice-versa). */
  gained: string[]
  lost: string[]
}

export interface UpgradeCheck {
  kind: SlotKind
  best: SlotComparison
  /** Outros slots possíveis (ex.: o outro anel). */
  alternatives: SlotComparison[]
}

function resistance(build: Build, key: ResKey): { uncapped: number; cap: number } | null {
  const capped = build.stats[RES_STAT[key]]
  if (capped === undefined) return null
  const over = build.stats[`${RES_STAT[key]}OverCap`] ?? 0
  // Com sobra acima do cap, o valor mostrado é o próprio cap; sem sobra, assume o cap padrão.
  const cap = over > 0 ? capped : Math.max(75, capped)
  return { uncapped: capped + over, cap }
}

const RANK: Record<UpgradeVerdict, number> = { upgrade: 3, sidegrade: 2, same: 1, downgrade: 0 }
// Só mostra linhas "outras" com número: evita o texto de ambientação dos únicos.
const hasNumber = (s: string) => /\d/.test(s)

function compareSlot(build: Build, slot: string, next: ReadStats): SlotComparison {
  const equipped = build.items.find((i) => i.slot === slot) ?? null
  const current = equipped ? readItemStats(equipped.mods, equipped.properties) : { stats: empty(), other: [] }

  const deltas: StatDelta[] = []
  for (const key of STAT_KEYS) {
    const a = current.stats[key]
    const b = next.stats[key]
    if (a === 0 && b === 0) continue
    const delta = b - a
    const entry: StatDelta = { key, current: a, next: b, delta, effective: delta }
    if ((RES_KEYS as readonly string[]).includes(key)) {
      const res = resistance(build, key as ResKey)
      if (res) {
        const before = Math.min(res.uncapped, res.cap)
        const after = Math.min(res.uncapped + delta, res.cap)
        entry.effective = after - before
        entry.resAfter = { value: res.uncapped + delta, cap: res.cap }
      }
    }
    deltas.push(entry)
  }

  const warnings: UpgradeWarning[] = []
  for (const key of ['str', 'dex', 'int'] as const) {
    const have = build.stats[ATTR_STAT[key]]
    const need = build.stats[`Req${ATTR_STAT[key]}`]
    const delta = next.stats[key] - current.stats[key]
    if (have === undefined || need === undefined || delta >= 0) continue
    const after = have + delta
    if (after < need && have >= need) warnings.push({ kind: 'attribute', key, missing: Math.round(need - after) })
  }
  const unreserved = build.stats.SpiritUnreserved
  const spiritDelta = next.stats.spirit - current.stats.spirit
  if (unreserved !== undefined && spiritDelta < 0 && unreserved >= 0 && unreserved + spiritDelta < 0) {
    warnings.push({ kind: 'spirit', missing: Math.round(-(unreserved + spiritDelta)) })
  }

  const counted = deltas.filter((d) => !NEUTRAL.has(d.key) && d.effective !== 0)
  const gains = counted.some((d) => d.effective > 0)
  const losses = counted.some((d) => d.effective < 0)
  const gained = next.other.filter((l) => hasNumber(l) && !current.other.includes(l)).slice(0, 8)
  const lost = current.other.filter((l) => hasNumber(l) && !next.other.includes(l)).slice(0, 8)

  let verdict: UpgradeVerdict
  if (warnings.length > 0) verdict = gains ? 'sidegrade' : 'downgrade'
  else if (gains && !losses) verdict = lost.length > 0 ? 'sidegrade' : 'upgrade'
  else if (losses && !gains) verdict = gained.length > 0 ? 'sidegrade' : 'downgrade'
  else if (gains && losses) verdict = 'sidegrade'
  else verdict = gained.length > 0 || lost.length > 0 ? 'sidegrade' : 'same'

  return { slot, equipped, deltas, verdict, warnings, gained, lost }
}

function score(c: SlotComparison): number {
  return c.deltas.filter((d) => !NEUTRAL.has(d.key)).reduce((sum, d) => sum + d.effective, 0)
}

/** Compara o item do jogo com a build. null quando não há slot para esse tipo de item. */
export function checkUpgrade(build: Build, item: ParsedItem, itemText: string): UpgradeCheck | null {
  if (item.unidentified) return null
  const target = slotsFor(item.itemClass, build)
  if (!target || target.slots.length === 0) return null
  const next = readItemStats(
    item.mods.map((m) => m.text),
    gameItemProperties(itemText),
  )
  const all = target.slots
    .map((slot) => compareSlot(build, slot, next))
    // O melhor slot para trocar: o que dá o melhor veredito; empate, o maior ganho.
    .sort((a, b) => RANK[b.verdict] - RANK[a.verdict] || score(b) - score(a))
  return { kind: target.kind, best: all[0]!, alternatives: all.slice(1) }
}
