// RePoE (repoe-fork.github.io): dados de mods e bases extraídos do jogo pela
// comunidade. Os dados pertencem à GGG, então o app NÃO os embute: baixa no
// primeiro uso e guarda em cache no computador do usuário.

import { z } from 'zod'
import type { HttpClient } from '../http/client'
import { parseTabletMods, type TabletMod } from '../farm/regex'

const BASE_URL = 'https://repoe-fork.github.io/poe2'

const modSchema = z.object({
  domain: z.string(),
  generation_type: z.string(),
  is_essence_only: z.boolean().optional(),
  name: z.string().optional(),
  required_level: z.number(),
  groups: z.array(z.string()).optional(),
  spawn_weights: z.array(z.object({ tag: z.string(), weight: z.number() })).optional(),
  stats: z.array(z.object({ id: z.string(), min: z.number(), max: z.number() })),
  text: z.string().nullish(),
})

const baseSchema = z.object({
  name: z.string(),
  item_class: z.string().optional(),
  domain: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export type RepoeMod = z.infer<typeof modSchema>
export type RepoeBase = z.infer<typeof baseSchema>

export interface RepoeData {
  mods: RepoeMod[]
  /** Nome do tipo base → tags usadas nas regras de onde cada mod pode aparecer. */
  baseTags: Record<string, string[]>
}

// Validação tolerante: entradas estranhas são descartadas uma a uma, sem
// derrubar o arquivo inteiro (os dados mudam a cada patch).
const modsFileSchema = z.record(z.string(), z.unknown())

const artSchema = z.object({ dds_file: z.string().regex(/^Art\/[A-Za-z0-9_\-/ ]+\.dds$/) })
const artBaseSchema = z.object({ name: z.string(), release_state: z.string().optional(), visual_identity: artSchema })
const uniqueSchema = z.object({ name: z.string(), is_alternate_art: z.boolean().optional(), visual_identity: artSchema })
const gemSchema = z.object({ base_item: z.object({ id: z.string(), display_name: z.string() }).nullish() })

/** Endereço público da imagem de um arquivo de arte do jogo (o RePoE publica todas em PNG). */
export function repoeArtUrl(ddsFile: string): string {
  return `${BASE_URL}/${ddsFile.replace(/\.dds$/, '.png')}`
}

/**
 * Catálogo de ícones: nome (base, único ou gema) → arquivo de arte do jogo.
 * Sem limite de requisições (arquivos estáticos), ao contrário da trade.
 */
export function artCatalogFrom(rawBases: Record<string, unknown>, rawUniques: Record<string, unknown>, rawGems: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  const byId = new Map<string, string>()
  for (const [id, value] of Object.entries(rawBases)) {
    const parsed = artBaseSchema.safeParse(value)
    if (!parsed.success) continue
    byId.set(id, parsed.data.visual_identity.dds_file)
    // Bases "unreleased" repetem nomes de bases reais: a lançada vence.
    const released = parsed.data.release_state !== 'unreleased'
    if (released || !out[parsed.data.name]) out[parsed.data.name] = parsed.data.visual_identity.dds_file
  }
  for (const value of Object.values(rawGems)) {
    const parsed = gemSchema.safeParse(value)
    const base = parsed.success ? parsed.data.base_item : null
    const art = base ? byId.get(base.id) : undefined
    if (base && art && !out[base.display_name]) out[base.display_name] = art
  }
  // Únicos por último: o nome do único vale mais que uma base de mesmo nome.
  for (const value of Object.values(rawUniques)) {
    const parsed = uniqueSchema.safeParse(value)
    if (parsed.success && !parsed.data.is_alternate_art) out[parsed.data.name] = parsed.data.visual_identity.dds_file
  }
  return out
}

export class RepoeClient {
  constructor(private readonly http: HttpClient) {}

  /** Mods de tablet com o texto do item (para o gerador de regex). */
  async tabletMods(): Promise<TabletMod[]> {
    return parseTabletMods(await this.http.request(`${BASE_URL}/mods.min.json`, { schema: modsFileSchema }))
  }

  async artCatalog(): Promise<Record<string, string>> {
    const [bases, uniques, gems] = await Promise.all(
      ['base_items', 'uniques', 'skill_gems'].map((f) => this.http.request(`${BASE_URL}/${f}.min.json`, { schema: modsFileSchema })),
    )
    return artCatalogFrom(bases!, uniques!, gems!)
  }

  async load(): Promise<RepoeData> {
    const [rawMods, rawBases] = await Promise.all([
      this.http.request(`${BASE_URL}/mods.min.json`, { schema: modsFileSchema }),
      this.http.request(`${BASE_URL}/base_items.min.json`, { schema: modsFileSchema }),
    ])
    const mods: RepoeMod[] = []
    for (const value of Object.values(rawMods)) {
      const parsed = modSchema.safeParse(value)
      if (parsed.success && parsed.data.domain === 'item') mods.push(parsed.data)
    }
    const baseTags: Record<string, string[]> = {}
    for (const value of Object.values(rawBases)) {
      const parsed = baseSchema.safeParse(value)
      if (parsed.success && parsed.data.domain === 'item' && parsed.data.tags) baseTags[parsed.data.name] = parsed.data.tags
    }
    return { mods, baseTags }
  }
}
