// Lê o código de exportação do Path of Building 2:
// XML → zlib → base64 com "+" e "/" trocados por "-" e "_".
// O código vem de fora (colado pelo usuário ou baixado de um site): tamanho
// limitado, sem DOCTYPE/entidades e só os campos que usamos são lidos.

import { deflateSync, inflateRawSync, inflateSync } from 'node:zlib'
import { XMLParser } from 'fast-xml-parser'
import { BuildImportError, MAX_CODE_LENGTH, MAX_NOTES, type Build, type BuildGem, type BuildItem, type BuildSkillGroup, type ItemProperties } from './model'

export { MAX_CODE_LENGTH }
const MAX_XML_BYTES = 32 * 1024 * 1024

/** Slots de equipamento que o app compara (joias e enxertos ficam de fora). */
export const EQUIPMENT_SLOTS = [
  'Weapon 1', 'Weapon 2', 'Weapon 1 Swap', 'Weapon 2 Swap', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Amulet', 'Ring 1', 'Ring 2', 'Ring 3', 'Belt',
  'Charm 1', 'Charm 2', 'Charm 3', 'Flask 1', 'Flask 2',
] as const

export function decodePobCode(code: string): string {
  const clean = code.replace(/\s+/g, '')
  if (clean.length < 20 || clean.length > MAX_CODE_LENGTH || !/^[A-Za-z0-9+/_=-]+$/.test(clean)) {
    throw new BuildImportError('invalid-code')
  }
  const bytes = Buffer.from(clean.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  for (const inflate of [inflateSync, inflateRawSync]) {
    try {
      return inflate(bytes, { maxOutputLength: MAX_XML_BYTES }).toString('utf8')
    } catch {
      // Tenta o outro formato; se nenhum servir, o código é inválido.
    }
  }
  throw new BuildImportError('invalid-code')
}

/** O inverso de decodePobCode (usado nos testes e para gerar exemplos). */
export function encodePobCode(xml: string): string {
  return deflateSync(Buffer.from(xml, 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

// ---------------------------------------------------------------- itens

const NAMED_RARITIES = new Set(['RARE', 'UNIQUE', 'RELIC'])
const FLAG_LINES = new Set(['Corrupted', 'Mirrored', 'Sanctified', 'Twice Corrupted', 'Unmodifiable', 'Split'])
// Linhas de cabeçalho que o PoB escreve antes dos mods.
const HEADER_KEYS = new Set([
  'Item Class', 'Rarity', 'Unique ID', 'Item Level', 'Level', 'Quality', 'Sockets', 'Rune', 'LevelReq', 'Radius', 'Limited to',
  'League', 'Crafted', 'Prefix', 'Suffix', 'Catalyst', 'CatalystQuality', 'Charm Slots', 'Spirit', 'Armour', 'Evasion',
  'Evasion Rating', 'Energy Shield', 'Ward', 'Runic Ward', 'Variant', 'Selected Variant', 'Selected Variant Group',
  'Has Alt Variant', 'Selected Alt Variant', 'Has Alt Variant Two', 'Selected Alt Variant Two', 'Has Alt Variant Three',
  'Selected Alt Variant Three', 'Has Alt Variant Four', 'Selected Alt Variant Four', 'Has Alt Variant Five',
  'Selected Alt Variant Five', 'Version', 'Selected Version', 'Base Variant', 'Selected Base Variant', 'Talisman Tier',
  'Cluster Jewel Skill', 'Cluster Jewel Node Count', 'Unreleased', 'Allow Duplicate Variants', 'Implicits',
])
const RANGE = /([+-]?)\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g
const HAS_RANGE = /\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)/
const TAG = /^\{([^}]*)\}/

function decimals(n: string): number {
  return n.split('.')[1]?.length ?? 0
}

/** Troca "(10-20)" pelo valor rolado, como o PoB faz (0 = mínimo, 1 = máximo). */
export function applyRange(line: string, range: number): string {
  return line.replace(RANGE, (_m, sign: string, min: string, max: string) => {
    const lo = Number(min)
    const hi = Number(max)
    const places = Math.max(decimals(min), decimals(max))
    let value = lo + range * (hi - lo)
    value = places === 0 ? Math.round(value) : Number(value.toFixed(places))
    if (sign === '-') value = -value
    return sign === '+' && value > 0 ? `+${value}` : String(value)
  })
}

interface ModLine {
  text: string
  variants: number[] | null
  range: number | null
  disabled: boolean
}

function readModLine(line: string): ModLine {
  let rest = line
  const mod: ModLine = { text: '', variants: null, range: null, disabled: false }
  for (let tag = TAG.exec(rest); tag; tag = TAG.exec(rest)) {
    const [key, value = ''] = tag[1]!.split(':')
    if (key === 'variant') mod.variants = value.split(',').map(Number).filter(Number.isFinite)
    else if (key === 'range') mod.range = Number.isFinite(Number(value)) ? Number(value) : null
    else if (key === 'disabled') mod.disabled = true
    rest = rest.slice(tag[0].length)
  }
  mod.text = rest.trim()
  return mod
}

function headerKey(line: string): string | null {
  const key = /^([A-Za-z][A-Za-z ]*?):/.exec(line)?.[1]
  return key && HEADER_KEYS.has(key) ? key : null
}

function number(value: string | undefined): number {
  const n = Number.parseFloat(value ?? '')
  return Number.isFinite(n) ? n : 0
}

function titleCase(rarity: string): string {
  const r = rarity.trim().toLowerCase()
  return r.charAt(0).toUpperCase() + r.slice(1)
}

/** Lê o texto de um item no formato do PoB ("Rarity: RARE", nome, base, "Implicits: N", mods). */
export function parsePobItem(raw: string): Omit<BuildItem, 'slot'> | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const rarityLine = lines.findIndex((l) => l.startsWith('Rarity:'))
  if (rarityLine < 0) return null
  const rarity = lines[rarityLine]!.slice('Rarity:'.length).trim().toUpperCase()
  const named = NAMED_RARITIES.has(rarity)
  const name = named ? (lines[rarityLine + 1] ?? null) : null
  const baseType = lines[rarityLine + (named ? 2 : 1)]
  if (!baseType) return null

  const properties: ItemProperties = { armour: 0, evasion: 0, energyShield: 0, spirit: 0 }
  let selectedVariant: number | null = null
  const body = lines.slice(rarityLine + (named ? 3 : 2))
  const implicitsAt = body.findIndex((l) => /^Implicits:\s*\d+$/.test(l))
  const header = implicitsAt >= 0 ? body.slice(0, implicitsAt) : body.filter((l) => headerKey(l) !== null)
  const modLines = implicitsAt >= 0 ? body.slice(implicitsAt + 1) : body.filter((l) => headerKey(l) === null)

  for (const line of header) {
    const key = headerKey(line)
    const value = line.slice(line.indexOf(':') + 1).trim()
    if (key === 'Armour') properties.armour = number(value)
    else if (key === 'Evasion' || key === 'Evasion Rating') properties.evasion = number(value)
    else if (key === 'Energy Shield') properties.energyShield = number(value)
    else if (key === 'Spirit') properties.spirit = number(value)
    else if (key === 'Selected Variant') selectedVariant = number(value) || null
  }

  // "Implicits: N": as N primeiras linhas de mod são implícitos, runas e encantamentos.
  const implicitLines = implicitsAt >= 0 ? Number(/\d+/.exec(body[implicitsAt]!)![0]) : 0
  const mods: string[] = []
  let implicits = 0
  for (const [index, line] of modLines.entries()) {
    if (FLAG_LINES.has(line)) continue
    const mod = readModLine(line)
    if (mod.disabled || mod.text.length === 0) continue
    if (mod.variants && selectedVariant !== null && !mod.variants.includes(selectedVariant)) continue
    // Sem {range}, o PoB usa o meio da faixa.
    const text = HAS_RANGE.test(mod.text) ? applyRange(mod.text, mod.range ?? 0.5) : mod.text
    mods.push(text.slice(0, 500))
    if (index < implicitLines) implicits++
    if (mods.length >= 80) break
  }

  return { rarity: titleCase(rarity), name: name?.slice(0, 200) ?? null, baseType: baseType.slice(0, 200), properties, mods, implicits }
}

// ---------------------------------------------------------------- XML

type Node = Record<string, unknown>

const ARRAY_TAGS = new Set(['Item', 'ItemSet', 'Slot', 'PlayerStat', 'SkillSet', 'Skill', 'Gem', 'Spec', 'Socket'])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  attributesGroupName: '$',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (tag) => ARRAY_TAGS.has(tag),
})

function attr(node: unknown, name: string): string | null {
  const attrs = (node as Node | null)?.['$'] as Record<string, unknown> | undefined
  const value = attrs?.[name]
  return typeof value === 'string' ? value : null
}

function children(node: unknown, tag: string): unknown[] {
  const value = (node as Node | null)?.[tag]
  return Array.isArray(value) ? value : []
}

function child(node: unknown, tag: string): Node | null {
  const value = (node as Node | null)?.[tag]
  if (Array.isArray(value)) return (value[0] as Node) ?? null
  return typeof value === 'object' && value !== null ? (value as Node) : null
}

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  const text = (node as Node | null)?.['#text']
  return typeof text === 'string' ? text : ''
}

function readStats(build: Node | null): Record<string, number> {
  const stats: Record<string, number> = {}
  for (const s of children(build, 'PlayerStat')) {
    const stat = attr(s, 'stat')
    const value = Number(attr(s, 'value'))
    if (stat && /^\w{1,60}$/.test(stat) && Number.isFinite(value) && !(stat in stats)) stats[stat] = value
  }
  return stats
}

function int(value: string | null, min: number, max: number): number {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}

// Support: o id da skill começa com "Support" ou o id da gema tem "Support" (ex.: "SkillGemFocusedCurseSupport").
const isSupport = (gem: unknown) => (attr(gem, 'skillId') ?? '').startsWith('Support') || /Support/.test(attr(gem, 'gemId') ?? '')

/** Grupos de skill do conjunto ativo e o nome da skill principal. */
function readSkills(root: Node, build: Node | null): { skills: BuildSkillGroup[]; mainSkill: string | null } {
  const skillsNode = child(root, 'Skills')
  if (!skillsNode) return { skills: [], mainSkill: null }
  const sets = children(skillsNode, 'SkillSet')
  const activeSet = sets.find((s) => attr(s, 'id') === attr(skillsNode, 'activeSkillSet')) ?? sets[0]
  const groups = children(activeSet ?? skillsNode, 'Skill')
  const mainIndex = int(attr(build, 'mainSocketGroup'), 1, 1000) - 1

  let mainSkill: string | null = null
  const skills: BuildSkillGroup[] = []
  groups.forEach((group, index) => {
    const gems: BuildGem[] = children(group, 'Gem')
      .filter((g) => attr(g, 'nameSpec'))
      .slice(0, 12)
      .map((g) => ({
        name: attr(g, 'nameSpec')!.slice(0, 120),
        level: int(attr(g, 'level'), 0, 40),
        quality: int(attr(g, 'quality'), 0, 100),
        support: isSupport(g),
        enabled: attr(g, 'enabled') !== 'false',
      }))
    if (gems.length === 0 || skills.length >= 40) return
    // Ativas primeiro, supports depois (como o poe.ninja mostra).
    gems.sort((a, b) => Number(a.support) - Number(b.support))
    const main = index === mainIndex
    if (main) {
      const active = gems.filter((g) => !g.support)
      const pick = int(attr(group, 'mainActiveSkill'), 1, Math.max(1, active.length)) - 1
      mainSkill = active[pick]?.name ?? null
    }
    skills.push({ label: attr(group, 'label')?.slice(0, 120) || null, enabled: attr(group, 'enabled') !== 'false', main, gems })
  })
  return { skills, mainSkill }
}

function itemsById(root: Node): Map<string, unknown> {
  const byId = new Map<string, unknown>()
  for (const item of children(child(root, 'Items'), 'Item')) {
    const id = attr(item, 'id')
    if (id) byId.set(id, item)
  }
  return byId
}

/** Joias encaixadas na árvore ativa e quantos pontos passivos ela tem. */
function readTree(root: Node, byId: Map<string, unknown>): { jewels: BuildItem[]; passives: number | null } {
  const tree = child(root, 'Tree')
  const specs = children(tree, 'Spec')
  const spec = specs[int(attr(tree, 'activeSpec'), 1, Math.max(1, specs.length)) - 1]
  if (!spec) return { jewels: [], passives: null }
  const nodes = attr(spec, 'nodes')
  const passives = nodes ? nodes.split(',').filter((n) => /^\d+$/.test(n.trim())).length : null
  const jewels: BuildItem[] = []
  for (const socket of children(child(spec, 'Sockets'), 'Socket')) {
    const itemId = attr(socket, 'itemId')
    if (!itemId || itemId === '0' || jewels.length >= 30) continue
    const raw = byId.get(itemId)
    const parsed = raw ? parsePobItem(textOf(raw)) : null
    if (parsed) jewels.push({ slot: 'Jewel', ...parsed })
  }
  return { jewels, passives: passives === null ? null : Math.min(passives, 1000) }
}

/** Notas do autor, sem os códigos de cor do PoB (^7, ^xRRGGBB). */
export function cleanNotes(text: string): string | null {
  const clean = text
    .replace(/\^x[0-9a-fA-F]{6}/g, '')
    .replace(/\^\d/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return clean.length > 0 ? clean.slice(0, MAX_NOTES) : null
}

/** Itens equipados (os dois sets de armas) e qual set de armas está ativo. */
function readItems(root: Node, byId: Map<string, unknown>): { items: BuildItem[]; activeWeaponSet: 1 | 2 } {
  const itemsNode = child(root, 'Items')
  if (!itemsNode) return { items: [], activeWeaponSet: 1 }

  const sets = children(itemsNode, 'ItemSet')
  const activeSet = sets.find((s) => attr(s, 'id') === attr(itemsNode, 'activeItemSet')) ?? sets[0]
  // Builds antigas guardam os slots direto em <Items>.
  const slotOwner = activeSet ?? itemsNode
  const swap = (attr(activeSet, 'useSecondWeaponSet') ?? attr(itemsNode, 'useSecondWeaponSet')) === 'true'
  const allowed = new Set<string>(EQUIPMENT_SLOTS)

  const items: BuildItem[] = []
  for (const slot of children(slotOwner, 'Slot')) {
    // "Weapon 1/2" = set I e "Weapon 1/2 Swap" = set II, como no jogo.
    const name = attr(slot, 'name') ?? ''
    if (!allowed.has(name)) continue
    const itemId = attr(slot, 'itemId')
    if (!itemId || itemId === '0') continue
    const raw = byId.get(itemId)
    const parsed = raw ? parsePobItem(textOf(raw)) : null
    if (parsed) items.push({ slot: name, ...parsed })
  }
  const order = EQUIPMENT_SLOTS as readonly string[]
  return { items: items.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot)), activeWeaponSet: swap ? 2 : 1 }
}

export function parsePobXml(xml: string): Omit<Build, 'source' | 'importedAt'> {
  // Sem DOCTYPE: evita entidades definidas pelo arquivo (expansão de memória).
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new BuildImportError('invalid-code')
  let doc: Node
  try {
    doc = parser.parse(xml) as Node
  } catch {
    throw new BuildImportError('invalid-code')
  }
  const root = child(doc, 'PathOfBuilding2')
  if (!root) throw new BuildImportError(child(doc, 'PathOfBuilding') ? 'not-poe2' : 'invalid-code')
  const build = child(root, 'Build')
  const className = attr(build, 'className')
  if (!className) throw new BuildImportError('invalid-code')
  const ascendancy = attr(build, 'ascendClassName')
  const level = Math.trunc(Number(attr(build, 'level')))

  const byId = itemsById(root)
  const notes = child(root, 'Notes') ?? (root['Notes'] as unknown)
  return {
    className: className.slice(0, 60),
    ascendancy: ascendancy && ascendancy !== 'None' ? ascendancy.slice(0, 60) : null,
    level: Number.isFinite(level) ? Math.min(100, Math.max(1, level)) : 1,
    stats: readStats(build),
    ...readSkills(root, build),
    ...readItems(root, byId),
    ...readTree(root, byId),
    notes: cleanNotes(textOf(notes)),
  }
}

export function importPobCode(code: string, source: Build['source'], now = new Date()): Build {
  return { ...parsePobXml(decodePobCode(code)), source, importedAt: now.toISOString() }
}
