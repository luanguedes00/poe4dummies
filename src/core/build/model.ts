// Build importada do Path of Building 2 (PoB2). Só guardamos o que o app usa:
// classe, nível, stats finais calculados pelo PoB e os itens equipados.

import { z } from 'zod'

/** Sites que hospedam códigos do PoB2 (os mesmos que o próprio PoB2 aceita). */
export const BUILD_SITES = ['pobbin', 'poeninja', 'poeninja-character', 'maxroll', 'poe2db'] as const
export type BuildSite = (typeof BUILD_SITES)[number]

/** Defesas e spirit do item, como o jogo e o PoB mostram (já com qualidade e mods locais). */
export interface ItemProperties {
  armour: number
  evasion: number
  energyShield: number
  spirit: number
}

export interface BuildItem {
  /** Nome do slot no PoB, ex.: "Helmet", "Ring 1", "Weapon 1". */
  slot: string
  rarity: string
  /** Nome próprio de raros e únicos. */
  name: string | null
  baseType: string
  properties: ItemProperties
  /** Mods já com os valores rolados (implícitos, runas e explícitos). */
  mods: string[]
  /** Quantos dos primeiros mods são implícitos/runas/encantamentos (não entram na busca). */
  implicits: number
}

export interface BuildGem {
  name: string
  level: number
  quality: number
  support: boolean
  enabled: boolean
}

/** Grupo de skill do PoB: uma gema ativa e seus supports. */
export interface BuildSkillGroup {
  label: string | null
  enabled: boolean
  /** Grupo da skill principal (a usada nos cálculos do PoB). */
  main: boolean
  gems: BuildGem[]
}

/** Detalhes oficiais de uma gema (como a dica do jogo), vindos do poe.ninja. */
export interface GemDetail {
  icon: string | null
  /** Tags da gema, ex.: "Attack, AoE, Projectile". */
  tags: string | null
  /** Propriedades, ex.: Level 21, Cost 35 Mana, Attack Speed 80% of base. */
  properties: Array<{ label: string; value: string }>
  /** Abas da gema (a skill e as skills que ela concede), cada uma com seus textos. */
  pages: Array<{ title: string | null; stats: string[] }>
}

/** Dados que só o poe.ninja entrega (perfil de personagem): ícones oficiais e detalhes das gemas. */
export interface BuildExtras {
  /** Slot (nome do PoB) → ícone. */
  itemIcons: Record<string, string>
  /** Nome da joia (ou tipo base) → ícone. */
  jewelIcons: Record<string, string>
  gems: Record<string, GemDetail>
}

export interface Build {
  className: string
  ascendancy: string | null
  level: number
  mainSkill: string | null
  /** Stats finais do PoB (PlayerStat), ex.: Life, FireResist, FireResistOverCap. */
  stats: Record<string, number>
  /** Slots "Weapon 1/2" (set I) e "Weapon 1/2 Swap" (set II). */
  items: BuildItem[]
  /** Set de armas em uso na build (I ou II). */
  activeWeaponSet: 1 | 2
  skills: BuildSkillGroup[]
  /** Joias encaixadas na árvore (slot "Jewel"). */
  jewels: BuildItem[]
  /** Pontos passivos alocados (inclui ascensão). */
  passives: number | null
  /** Notas do autor da build (texto puro, sem códigos de cor do PoB). */
  notes: string | null
  /** Só em builds importadas pelo perfil do poe.ninja. */
  extras?: BuildExtras
  source: { kind: 'code' } | { kind: 'link'; site: BuildSite; id: string }
  importedAt: string
}

export const MAX_NOTES = 20_000
/** Tamanho máximo de um código do PoB2 colado ou baixado. */
export const MAX_CODE_LENGTH = 2_000_000

const propertiesSchema = z
  .object({ armour: z.number().finite(), evasion: z.number().finite(), energyShield: z.number().finite(), spirit: z.number().finite() })
  .strict()

/** Ícones só do CDN oficial da GGG (é o único host de imagem que a interface aceita). */
export const ICON_URL = /^https:\/\/web\.poecdn\.com\/[\w/.%=+-]{1,600}$/
const iconSchema = z.string().max(700).regex(ICON_URL)
const shortText = z.string().max(400)
const boundedRecord = <T extends z.ZodType>(value: T, max: number) =>
  z.record(z.string().max(120), value).refine((r) => Object.keys(r).length <= max)

const gemDetailSchema = z
  .object({
    icon: iconSchema.nullable(),
    tags: shortText.nullable(),
    properties: z.array(z.object({ label: shortText, value: shortText }).strict()).max(30),
    pages: z.array(z.object({ title: shortText.nullable(), stats: z.array(shortText).max(40) }).strict()).max(8),
  })
  .strict()

const extrasSchema = z
  .object({
    itemIcons: boundedRecord(iconSchema, 40),
    jewelIcons: boundedRecord(iconSchema, 40),
    gems: boundedRecord(gemDetailSchema, 200),
  })
  .strict()

const itemSchema = z
  .object({
    slot: z.string().max(40),
    rarity: z.string().max(20),
    name: z.string().max(200).nullable(),
    baseType: z.string().max(200),
    properties: propertiesSchema,
    mods: z.array(z.string().max(500)).max(80),
    implicits: z.number().int().min(0).max(80),
  })
  .strict()

/** Valida a build lida do disco: um arquivo mexido ou corrompido é descartado. */
export const buildSchema = z
  .object({
    className: z.string().max(60),
    ascendancy: z.string().max(60).nullable(),
    level: z.number().int().min(1).max(100),
    mainSkill: z.string().max(120).nullable(),
    stats: z.record(z.string().max(60), z.number().finite()),
    items: z.array(itemSchema).max(60),
    activeWeaponSet: z.union([z.literal(1), z.literal(2)]),
    skills: z
      .array(
        z
          .object({
            label: z.string().max(120).nullable(),
            enabled: z.boolean(),
            main: z.boolean(),
            gems: z
              .array(
                z
                  .object({
                    name: z.string().max(120),
                    level: z.number().int().min(0).max(40),
                    quality: z.number().int().min(0).max(100),
                    support: z.boolean(),
                    enabled: z.boolean(),
                  })
                  .strict(),
              )
              .max(12),
          })
          .strict(),
      )
      .max(40),
    jewels: z.array(itemSchema).max(30),
    passives: z.number().int().min(0).max(1000).nullable(),
    notes: z.string().max(MAX_NOTES).nullable(),
    extras: extrasSchema.optional(),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('code') }).strict(),
      // Perfil do poe.ninja: "conta/liga/personagem".
      z.object({ kind: z.literal('link'), site: z.enum(BUILD_SITES), id: z.string().regex(/^[\w-]{1,64}(\/[\w-]{1,64}){0,2}$/) }).strict(),
    ]),
    importedAt: z.string().max(40),
  })
  .strict()

export function isBuild(value: unknown): value is Build {
  return buildSchema.safeParse(value).success
}

/** "guide" = build de um guia (a meta); "mine" = a build do jogador. */
export const BUILD_KINDS = ['guide', 'mine'] as const
export type BuildKind = (typeof BUILD_KINDS)[number]
export type BuildPair = Record<BuildKind, Build | null>

const pairSchema = z.object({ guide: buildSchema.nullable(), mine: buildSchema.nullable() }).strict()

export function isBuildPair(value: unknown): value is BuildPair {
  return pairSchema.safeParse(value).success
}

/** Build usada no "é upgrade?" da sobreposição: a do jogador; sem ela, a do guia. */
export function buildForOverlay(builds: BuildPair): Build | null {
  return builds.mine ?? builds.guide
}

export type BuildImportErrorCode = 'invalid-code' | 'not-poe2' | 'unsupported-link' | 'not-found' | 'network'

export class BuildImportError extends Error {
  override name = 'BuildImportError'
  constructor(readonly code: BuildImportErrorCode) {
    super(code)
  }
}

const ID = '([\\w-]{1,64})'
const LINK_PATTERNS: Array<{ site: BuildSite; pattern: RegExp; raw: (id: string) => string }> = [
  { site: 'pobbin', pattern: new RegExp(`^https?://pobb\\.in/(?:pob/)?${ID}/?$`), raw: (id) => `https://pobb.in/pob/${id}` },
  { site: 'poeninja', pattern: new RegExp(`^https?://poe\\.ninja/poe2/pob/(?:raw/)?${ID}/?$`), raw: (id) => `https://poe.ninja/poe2/pob/raw/${id}` },
  { site: 'maxroll', pattern: new RegExp(`^https?://maxroll\\.gg/poe2/(?:api/)?pob/${ID}/?$`), raw: (id) => `https://maxroll.gg/poe2/api/pob/${id}` },
  { site: 'poe2db', pattern: new RegExp(`^https?://poe2db\\.tw/pob/${ID}(?:/raw)?/?$`), raw: (id) => `https://poe2db.tw/pob/${id}/raw` },
]

export interface BuildLink {
  site: BuildSite
  id: string
  /** Endereço que devolve o código puro (fixo por site, nunca vindo da entrada). */
  rawUrl: string
}

// Perfil de personagem do poe.ninja: /poe2/profile/<conta>/<liga>/character/<nome>
const NINJA_CHARACTER = /^https?:\/\/poe\.ninja\/poe2\/profile\/([\w-]{1,64})\/([\w-]{1,64})\/character\/([\w-]{1,64})\/?$/

/** Reconhece um link de build. Aceita só os sites conhecidos e ids simples. */
export function parseBuildLink(input: string): BuildLink | null {
  const text = input.trim()
  const character = NINJA_CHARACTER.exec(text)
  if (character) {
    const [, account, league, name] = character
    return {
      site: 'poeninja-character',
      id: `${account}/${league}/${name}`,
      rawUrl: `https://poe.ninja/poe2/api/profile/characters/${account}/${league}/${name}/model/`,
    }
  }
  for (const { site, pattern, raw } of LINK_PATTERNS) {
    const id = pattern.exec(text)?.[1]
    if (id) return { site, id, rawUrl: raw(id) }
  }
  return null
}

export function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim())
}
