// API oficial de trade do PoE2 (pathofexile.com/api/trade2). Não usa login:
// o app nunca pede nem guarda o POESESSID ou qualquer credencial.

import { z } from 'zod'
import type { HttpClient } from '../http/client'
import { RateLimiter } from '../http/rateLimiter'
import type { StatEntry } from '../item/statMatcher'
import type { TradeQuery } from '../trade/query'
import type { League } from '../types'

export const TRADE_API = 'https://www.pathofexile.com/api/trade2'
export const TRADE_SITE = 'https://www.pathofexile.com/trade2/search/poe2'
/** A API de fetch aceita no máximo 10 ids por chamada. */
export const FETCH_BATCH = 10

const leaguesSchema = z.object({
  result: z.array(z.object({ id: z.string(), text: z.string().optional(), realm: z.string().optional() })),
})

const statsSchema = z.object({
  result: z.array(
    z.object({
      id: z.string(),
      entries: z.array(z.object({ id: z.string(), text: z.string(), type: z.string().optional() })),
    }),
  ),
})

const itemsSchema = z.object({
  result: z.array(
    z.object({
      id: z.string(),
      entries: z.array(z.object({ type: z.string(), name: z.string().optional() })),
    }),
  ),
})

const filtersSchema = z.object({
  result: z.array(
    z.object({
      id: z.string(),
      title: z.string().optional(),
      hidden: z.boolean().optional(),
      filters: z.array(
        z.object({
          id: z.string(),
          text: z.string().optional(),
          minMax: z.boolean().optional(),
          option: z
            .object({ options: z.array(z.object({ id: z.union([z.string(), z.null()]), text: z.string() })) })
            .optional(),
        }),
      ),
    }),
  ),
})

/** Definição de um filtro do site de trade (texto e opções oficiais). */
export interface FilterDef {
  id: string
  text: string
  minMax: boolean
  /** Opções de um select; `id: null` significa "Qualquer". */
  options: Array<{ id: string | null; text: string }> | null
}

export interface FilterGroupDef {
  id: string
  title: string
  hidden: boolean
  filters: FilterDef[]
}

const searchSchema = z.object({
  id: z.string(),
  total: z.number(),
  result: z.array(z.string()),
})

// No PoE2 cada mod vem como objeto: { description, mods: [{ name, tier: "P4" }] }. Texto puro também é aceito.
const modEntry = z.union([
  z.string(),
  z.object({ description: z.string(), mods: z.array(z.object({ tier: z.string().optional() }).passthrough()).optional() }).passthrough(),
])
const modLines = z.array(modEntry).optional().catch(undefined)

const fetchSchema = z.object({
  result: z.array(
    z
      .object({
        id: z.string(),
        listing: z.object({
          indexed: z.string().optional(),
          account: z.object({ name: z.string().optional() }).optional(),
          price: z
            .object({ amount: z.number(), currency: z.string() })
            .nullish(),
        }),
        item: z.object({
          name: z.string().optional(),
          typeLine: z.string().optional(),
          icon: z.string().optional(),
          ilvl: z.number().optional(),
          corrupted: z.boolean().optional(),
          // Mods e propriedades: para comparar o item do vendedor com o seu (Shift na lista).
          // Tolerantes: formato diferente só tira a comparação, nunca derruba o preço.
          implicitMods: modLines,
          explicitMods: modLines,
          runeMods: modLines,
          fracturedMods: modLines,
          desecratedMods: modLines,
          enchantMods: modLines,
          properties: z.array(z.object({ name: z.string(), values: z.array(z.tuple([z.string(), z.number()]).rest(z.unknown())).optional() })).optional().catch(undefined),
        }),
      })
      .nullable(),
  ),
})

export interface Listing {
  id: string
  amount: number | null
  currency: string | null
  seller: string | null
  indexedAt: string | null
  iconUrl: string | null
  itemLevel: number | null
  /** Item do vendedor (para comparar com o seu). */
  name?: string | null
  typeLine?: string | null
  mods?: Array<{ text: string; kind: 'implicit' | 'explicit' | 'rune' | 'fractured' | 'desecrated' | 'enchant'; tier?: string | null }>
  properties?: string[]
}

/** Tira a marcação da GGG: "[Resistances|Fire Resistance]" → "Fire Resistance". */
function plainText(line: string): string {
  return line.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1').slice(0, 200)
}

type FetchedItem = z.infer<typeof fetchSchema>['result'][number] extends infer R ? (R extends { item: infer I } ? I : never) : never

function listingDetails(item: FetchedItem): Pick<Listing, 'name' | 'typeLine' | 'mods' | 'properties'> {
  const mods: NonNullable<Listing['mods']> = []
  const add = (lines: Array<z.infer<typeof modEntry>> | undefined, kind: NonNullable<Listing['mods']>[number]['kind']) => {
    for (const l of (lines ?? []).slice(0, 20)) {
      if (typeof l === 'string') mods.push({ text: plainText(l), kind })
      else mods.push({ text: plainText(l.description), kind, tier: l.mods?.[0]?.tier ?? null })
    }
  }
  add(item.enchantMods, 'enchant')
  add(item.runeMods, 'rune')
  add(item.implicitMods, 'implicit')
  add(item.fracturedMods, 'fractured')
  add(item.explicitMods, 'explicit')
  add(item.desecratedMods, 'desecrated')
  const properties = (item.properties ?? [])
    .filter((p) => p.values && p.values.length > 0 && /^(\[?Armour|\[?Evasion|\[?Energy Shield|\[?Physical Damage|\[?Elemental Damage|\[?Attacks per Second|\[?Critical|\[?Spirit)/.test(p.name))
    .slice(0, 8)
    .map((p) => `${plainText(p.name)}: ${p.values!.map((v) => v[0]).join(', ')}`)
  return { name: item.name || null, typeLine: item.typeLine ?? null, mods, properties }
}

export interface SearchResult {
  id: string
  total: number
  result: string[]
}

export interface BaseTypeEntry {
  type: string
  category: string
}

export interface UniqueEntry {
  name: string
  type: string
  category: string
}

export interface ItemCatalog {
  bases: BaseTypeEntry[]
  uniques: UniqueEntry[]
}

/** Liga padrão: a primeira temporária de softcore; se não houver, Standard. */
export function pickDefaultLeague(leagues: readonly League[]): string {
  const current = leagues.find((l) => !l.hardcore && l.id !== 'Standard')
  return current?.id ?? 'Standard'
}

function isHardcore(id: string): boolean {
  return id === 'Hardcore' || id.startsWith('HC ') || /\bHardcore\b/.test(id)
}

function safeIcon(url: string | undefined): string | null {
  return url && url.startsWith('https://web.poecdn.com/') ? url : null
}

export class TradeClient {
  constructor(
    private readonly http: HttpClient,
    private readonly limiter: RateLimiter = new RateLimiter(),
  ) {}

  async leagues(): Promise<League[]> {
    const data = await this.http.request(`${TRADE_API}/data/leagues`, {
      schema: leaguesSchema,
      limiter: { instance: this.limiter, key: 'data' },
    })
    return data.result
      .filter((l) => l.realm === undefined || l.realm === 'poe2')
      .map((l) => ({ id: l.id, label: l.text ?? l.id, hardcore: isHardcore(l.id) }))
  }

  async stats(): Promise<StatEntry[]> {
    const data = await this.http.request(`${TRADE_API}/data/stats`, {
      schema: statsSchema,
      limiter: { instance: this.limiter, key: 'data' },
    })
    // O grupo é o id do bloco ("rune"), não o campo `type` da entrada, que
    // pode divergir (as runas vêm com type "augment").
    return data.result.flatMap((group) => group.entries.map((e) => ({ id: e.id, text: e.text, group: group.id })))
  }

  /** Tipos base e itens únicos conhecidos pela trade (para autocompletar e para achar o tipo base). */
  async catalog(): Promise<ItemCatalog> {
    const data = await this.http.request(`${TRADE_API}/data/items`, {
      schema: itemsSchema,
      limiter: { instance: this.limiter, key: 'data' },
    })
    const bases: BaseTypeEntry[] = []
    const uniques: UniqueEntry[] = []
    const seenBase = new Set<string>()
    const seenUnique = new Set<string>()
    for (const group of data.result) {
      for (const entry of group.entries) {
        // Entradas com "name" são únicos; as demais são tipos base.
        if (entry.name) {
          if (seenUnique.has(entry.name)) continue
          seenUnique.add(entry.name)
          uniques.push({ name: entry.name, type: entry.type, category: group.id })
        } else if (!seenBase.has(entry.type)) {
          seenBase.add(entry.type)
          bases.push({ type: entry.type, category: group.id })
        }
      }
    }
    return { bases, uniques }
  }

  /** Grupos de filtros exatamente como o site de trade mostra. */
  async filters(): Promise<FilterGroupDef[]> {
    const data = await this.http.request(`${TRADE_API}/data/filters`, {
      schema: filtersSchema,
      limiter: { instance: this.limiter, key: 'data' },
    })
    return data.result
      .filter((g) => /^[a-z_]+$/.test(g.id))
      .map((g) => ({
        id: g.id,
        title: g.title ?? g.id,
        hidden: g.hidden ?? false,
        filters: g.filters
          .filter((f) => /^[a-z_]+$/.test(f.id))
          .map((f) => ({ id: f.id, text: f.text ?? f.id, minMax: f.minMax ?? false, options: f.option?.options ?? null })),
      }))
  }

  /** `background`: só usa folga do limite (ícones); nunca passa na frente do usuário. */
  async search(league: string, query: TradeQuery, background = false): Promise<SearchResult> {
    return this.http.request(`${TRADE_API}/search/poe2/${encodeURIComponent(league)}`, {
      schema: searchSchema,
      method: 'POST',
      body: query,
      limiter: { instance: this.limiter, key: 'search', background },
    })
  }

  async fetchListings(queryId: string, ids: readonly string[], background = false): Promise<Listing[]> {
    const batch = ids.slice(0, FETCH_BATCH).filter((id) => /^[a-f0-9]+$/i.test(id))
    if (batch.length === 0) return []
    const url = `${TRADE_API}/fetch/${batch.join(',')}?query=${encodeURIComponent(queryId)}`
    const data = await this.http.request(url, {
      schema: fetchSchema,
      limiter: { instance: this.limiter, key: 'fetch', background },
    })
    return data.result
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => ({
        id: r.id,
        amount: r.listing.price?.amount ?? null,
        currency: r.listing.price?.currency ?? null,
        seller: r.listing.account?.name ?? null,
        indexedAt: r.listing.indexed ?? null,
        iconUrl: safeIcon(r.item.icon),
        itemLevel: r.item.ilvl ?? null,
        ...listingDetails(r.item),
      }))
  }

  /** Aplica um bloqueio conhecido (ex.: guardado ao fechar o app) a todas as políticas. */
  blockUntil(at: number): void {
    for (const key of ['data', 'search', 'fetch']) this.limiter.policy(key).blockUntil(at)
  }

  /** Segundos até a API de busca liberar de novo (0 se livre). */
  searchCooldown(now = Date.now()): number {
    return this.limiter.policy('search').blockedFor(now)
  }
}

/** Link seguro para abrir a busca no site oficial. Valida tudo antes de montar a URL. */
/**
 * Link do site oficial com a busca dentro da URL (?q=): abre na hora, sem gastar
 * a cota da API. O próprio site faz a busca ao abrir.
 */
export function tradeLinkUrl(league: string, query: TradeQuery): string | null {
  if (league.length === 0 || league.length > 64) return null
  const q = JSON.stringify({ query: query.query, sort: query.sort })
  if (q.length > 6000) return null
  return `${TRADE_SITE}/${encodeURIComponent(league)}?q=${encodeURIComponent(q)}`
}

export function tradeSiteUrl(league: string, queryId: string): string | null {
  // Ids reais vêm em base64 url-safe e podem ser longos (ex.: "H4sIAAAA...AAA").
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(queryId)) return null
  if (league.length === 0 || league.length > 64) return null
  return `${TRADE_SITE}/${encodeURIComponent(league)}/${queryId}`
}
