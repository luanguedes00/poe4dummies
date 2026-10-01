// Personagem do poe.ninja (link de perfil): o site gera o código do Path of Building 2
// do personagem ("pathOfBuildingExport") e traz os dados oficiais da GGG de cada item e
// gema (ícone e, nas gemas, as abas com os textos do jogo).

import { z } from 'zod'
import type { HttpClient } from '../http/client'
import { BuildImportError, ICON_URL, MAX_CODE_LENGTH, type BuildExtras, type BuildLink, type GemDetail } from './model'

const codeSchema = z.object({
  charModel: z.object({ pathOfBuildingExport: z.string().min(20).max(MAX_CODE_LENGTH) }),
})

// Leitura tolerante: qualquer parte estranha é ignorada, sem derrubar a importação.
const itemDataSchema = z
  .object({
    inventoryId: z.string().nullish(),
    x: z.number().nullish(),
    name: z.string().nullish(),
    typeLine: z.string().nullish(),
    icon: z.string().nullish(),
    properties: z.array(z.object({ name: z.string(), values: z.array(z.tuple([z.string(), z.number()]).or(z.array(z.unknown()))) })).nullish(),
    gemTabs: z
      .array(z.object({ name: z.string().nullish(), pages: z.array(z.object({ skillName: z.string().nullish(), stats: z.array(z.string()).nullish() })).nullish() }))
      .nullish(),
  })
  .passthrough()
const entrySchema = z.object({ itemData: itemDataSchema })
const extrasModelSchema = z.object({
  charModel: z.object({
    useSecondWeaponSet: z.boolean().nullish(),
    items: z.array(entrySchema).nullish(),
    flasks: z.array(entrySchema).nullish(),
    jewels: z.array(entrySchema).nullish(),
    skills: z.array(z.object({ allGems: z.array(z.object({ name: z.string(), itemData: itemDataSchema.nullish() })).nullish() })).nullish(),
  }),
})

// inventoryId da GGG → slot do PoB.
const SLOT_BY_INVENTORY: Record<string, string> = {
  Weapon: 'Weapon 1',
  Offhand: 'Weapon 2',
  Weapon2: 'Weapon 1 Swap',
  Offhand2: 'Weapon 2 Swap',
  Helm: 'Helmet',
  BodyArmour: 'Body Armour',
  Gloves: 'Gloves',
  Boots: 'Boots',
  Amulet: 'Amulet',
  Ring: 'Ring 1',
  Ring2: 'Ring 2',
  Ring3: 'Ring 3',
  Belt: 'Belt',
}
// Cinto de frascos: x=0 vida, x=1 mana, x=2..4 charms.
const FLASK_BY_X = ['Flask 1', 'Flask 2', 'Charm 1', 'Charm 2', 'Charm 3']

/** Tira a marcação de links do jogo: "[Tag|Texto]" → "Texto", "[Tag]" → "Tag". */
export function cleanGameText(text: string): string {
  return text
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
    .slice(0, 400)
}

const icon = (url: string | null | undefined) => (url && ICON_URL.test(url) ? url : null)

function gemDetail(data: z.infer<typeof itemDataSchema>): GemDetail {
  let tags: string | null = null
  const properties: GemDetail['properties'] = []
  for (const p of data.properties ?? []) {
    const values = p.values.map((v) => (typeof v[0] === 'string' ? v[0] : '')).filter(Boolean)
    // A primeira propriedade sem valor é a linha de tags.
    if (values.length === 0 && tags === null && p.name) tags = cleanGameText(p.name)
    else if (values.length > 0) properties.push({ label: cleanGameText(p.name), value: cleanGameText(values.join(' ')) })
    if (properties.length >= 30) break
  }
  const pages: GemDetail['pages'] = []
  for (const tab of data.gemTabs ?? []) {
    for (const page of tab.pages ?? []) {
      const stats = (page.stats ?? []).map(cleanGameText).filter(Boolean).slice(0, 40)
      if (stats.length > 0 && pages.length < 8) pages.push({ title: page.skillName ? cleanGameText(page.skillName) : null, stats })
    }
  }
  return { icon: icon(data.icon), tags, properties, pages }
}

export interface NinjaCharacter {
  code: string
  extras: BuildExtras | null
  /** Set de armas em uso segundo o jogo (o do código do PoB pode vir diferente). */
  useSecondWeaponSet: boolean | null
}

/** Lê os extras do modelo do personagem; se o formato mudar, volta null e a importação segue. */
export function readNinjaExtras(json: unknown): Omit<NinjaCharacter, 'code'> {
  const parsed = extrasModelSchema.safeParse(json)
  if (!parsed.success) return { extras: null, useSecondWeaponSet: null }
  const model = parsed.data.charModel
  const itemIcons: Record<string, string> = {}
  for (const { itemData } of model.items ?? []) {
    const slot = SLOT_BY_INVENTORY[itemData.inventoryId ?? '']
    const url = icon(itemData.icon)
    if (slot && url) itemIcons[slot] = url
  }
  for (const { itemData } of model.flasks ?? []) {
    const slot = FLASK_BY_X[itemData.x ?? -1]
    const url = icon(itemData.icon)
    if (slot && url) itemIcons[slot] = url
  }
  const jewelIcons: Record<string, string> = {}
  for (const { itemData } of (model.jewels ?? []).slice(0, 40)) {
    const url = icon(itemData.icon)
    const key = itemData.name || itemData.typeLine
    if (url && key) jewelIcons[key.slice(0, 120)] = url
  }
  const gems: Record<string, GemDetail> = {}
  for (const skill of model.skills ?? []) {
    for (const gem of skill.allGems ?? []) {
      if (!gem.itemData || gems[gem.name] || Object.keys(gems).length >= 200) continue
      gems[gem.name.slice(0, 120)] = gemDetail(gem.itemData)
    }
  }
  return { extras: { itemIcons, jewelIcons, gems }, useSecondWeaponSet: model.useSecondWeaponSet ?? null }
}

/** Baixa o personagem do poe.ninja: código do PoB2 + ícones e detalhes oficiais. */
export async function ninjaCharacter(http: HttpClient, link: BuildLink, now = Date.now()): Promise<NinjaCharacter> {
  // O número no fim do endereço é só anti-cache (o site aceita qualquer um); muda a cada minuto.
  const json = await http.request(`${link.rawUrl}${Math.floor(now / 60_000)}`, { schema: z.unknown() })
  // Perfil privado ou personagem que o site ainda não leu: vem sem o código.
  const parsed = codeSchema.safeParse(json)
  if (!parsed.success) throw new BuildImportError('not-found')
  return { code: parsed.data.charModel.pathOfBuildingExport, ...readNinjaExtras(json) }
}
