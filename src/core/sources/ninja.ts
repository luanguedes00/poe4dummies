// poe.ninja (PoE2): preços do mercado de troca de currency e histórico diário.

import { z } from 'zod'
import type { HttpClient } from '../http/client'
import type { CurrencyRates, MarketItem, MarketSnapshot, PriceHistory } from '../types'

const BASE_URL = 'https://poe.ninja/poe2/api/economy/exchange/current'
/** Os caminhos de imagem do poe.ninja são servidos pelo CDN da GGG. */
const ICON_HOST = 'https://web.poecdn.com'

import { NINJA_CATEGORIES, type NinjaCategory } from '../categories'

// Mantém os nomes exportados daqui para quem já importava do cliente.
export { isNinjaCategory, NINJA_CATEGORIES, type NinjaCategory } from '../categories'

const overviewSchema = z.object({
  core: z.object({
    rates: z.record(z.string(), z.number()),
    primary: z.string(),
  }),
  lines: z.array(
    z.object({
      id: z.string(),
      primaryValue: z.number(),
      volumePrimaryValue: z.number().nullish(),
      sparkline: z
        .object({
          totalChange: z.number().nullish(),
          data: z.array(z.number().nullable()),
        })
        .nullish(),
    }),
  ),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      image: z.string().nullish(),
      detailsId: z.string(),
    }),
  ),
})

const detailsSchema = z.object({
  pairs: z.array(
    z.object({
      id: z.string(),
      history: z.array(
        z.object({
          timestamp: z.string(),
          rate: z.number(),
          volumePrimaryValue: z.number().nullish(),
        }),
      ),
    }),
  ),
})

function iconUrl(path: string | null | undefined): string | null {
  if (!path || !path.startsWith('/gen/image/')) return null
  return ICON_HOST + path
}

const PAIR_PREFERENCE = ['exalted', 'divine', 'chaos']

export function pickHistoryPair<P extends { id: string; history: ReadonlyArray<{ rate: number }> }>(pairs: readonly P[]): P | undefined {
  const usable = (p: P) => p.history.filter((h) => h.rate > 0).length
  const rank = (p: P) => {
    const i = PAIR_PREFERENCE.indexOf(p.id)
    return i === -1 ? PAIR_PREFERENCE.length : i
  }
  return [...pairs].filter((p) => usable(p) > 0).sort((a, b) => usable(b) - usable(a) || rank(a) - rank(b))[0]
}

// Endpoint "stash" do poe.ninja: itens agrupados por base + raridade (tablets).
const stashItemSchema = z.object({
  lines: z.array(
    z.object({
      name: z.string(),
      baseType: z.string().optional(),
      variant: z.string().nullish(),
      icon: z.string().nullish(),
      primaryValue: z.number(),
      listingCount: z.number().optional(),
      sparkLine: z.object({ totalChange: z.number().nullish() }).nullish(),
    }),
  ),
})

/** Categorias de únicos do endpoint "stash" do poe.ninja (PoE2). */
const UNIQUE_TYPES = ['UniqueArmours', 'UniqueAccessories', 'UniqueWeapons', 'UniqueJewels', 'UniqueFlasks', 'UniqueCharms'] as const

export interface UniqueInfo {
  iconUrl: string | null
  valueDivine: number | null
}

export interface TabletPrice {
  name: string
  baseType: string
  /** "Normal" | "Magic" | "Rare" para tablets comuns; null para únicos. */
  variant: string | null
  unique: boolean
  iconUrl: string | null
  valueDivine: number
  change7d: number | null
  listings: number | null
}

export interface CategoryOverview {
  rates: CurrencyRates
  items: MarketItem[]
}

export class NinjaClient {
  constructor(private readonly http: HttpClient) {}

  async overview(league: string, category: NinjaCategory): Promise<CategoryOverview> {
    const url = `${BASE_URL}/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(category)}`
    const data = await this.http.request(url, { schema: overviewSchema })

    // Os valores vêm na moeda "primary" (hoje, Divine). Se isso mudar,
    // convertemos usando o preço do Divine na mesma resposta.
    let divineInPrimary = 1
    if (data.core.primary !== 'divine') {
      const divineLine = data.lines.find((l) => l.id === 'divine')
      if (!divineLine || divineLine.primaryValue <= 0) throw new Error('poe.ninja: moeda base desconhecida')
      divineInPrimary = divineLine.primaryValue
    }

    const meta = new Map(data.items.map((i) => [i.id, i]))
    const items: MarketItem[] = []
    for (const line of data.lines) {
      const info = meta.get(line.id)
      if (!info || !(line.primaryValue > 0)) continue
      const spark = (line.sparkline?.data ?? []).filter((v): v is number => v !== null)
      items.push({
        id: line.id,
        detailsId: info.detailsId,
        name: info.name,
        category,
        iconUrl: iconUrl(info.image),
        valueDivine: line.primaryValue / divineInPrimary,
        volumeDivine: (line.volumePrimaryValue ?? 0) / divineInPrimary,
        change7d: line.sparkline?.totalChange ?? null,
        sparkline: spark,
      })
    }

    const rates: CurrencyRates = {
      exaltedPerDivine: (data.core.rates['exalted'] ?? 0) * divineInPrimary,
      chaosPerDivine: (data.core.rates['chaos'] ?? 0) * divineInPrimary,
    }
    return { rates, items }
  }

  /** Preços de Precursor Tablets (por tipo + raridade) e tablets únicos. Valores em Divine. */
  async tablets(league: string): Promise<TabletPrice[]> {
    const base = 'https://poe.ninja/poe2/api/economy/stash/current/item/overview'
    const load = (type: string) =>
      this.http.request(`${base}?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`, { schema: stashItemSchema })
    const [common, uniques] = await Promise.all([load('PrecursorTablets'), load('UniqueTablets')])
    const map = (unique: boolean) => (l: z.infer<typeof stashItemSchema>['lines'][number]): TabletPrice => ({
      name: l.name,
      baseType: l.baseType ?? l.name,
      variant: unique ? null : (l.variant ?? null),
      unique,
      iconUrl: l.icon && l.icon.startsWith(`${ICON_HOST}/`) ? l.icon : null,
      valueDivine: l.primaryValue,
      change7d: l.sparkLine?.totalChange ?? null,
      listings: l.listingCount ?? null,
    })
    return [...common.lines.map(map(false)), ...uniques.lines.map(map(true))].filter((t) => t.valueDivine >= 0)
  }

  /**
   * Itens únicos (armaduras, acessórios, armas, joias, frascos e charms): ícone
   * oficial e preço em Divine, por nome. Uma categoria que falhar fica de fora.
   */
  async uniques(league: string): Promise<Map<string, UniqueInfo>> {
    const base = 'https://poe.ninja/poe2/api/economy/stash/current/item/overview'
    const results = await Promise.allSettled(
      UNIQUE_TYPES.map((type) =>
        this.http.request(`${base}?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`, { schema: stashItemSchema }),
      ),
    )
    const out = new Map<string, UniqueInfo>()
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      for (const l of result.value.lines) {
        // Variantes do mesmo único (ex.: links) repetem o nome: fica a primeira.
        if (out.has(l.name)) continue
        out.set(l.name, {
          iconUrl: l.icon && l.icon.startsWith(`${ICON_HOST}/`) ? l.icon : null,
          valueDivine: l.primaryValue >= 0 ? l.primaryValue : null,
        })
      }
    }
    return out
  }

  /**
   * Histórico diário desde o início da liga. Usa o par com mais dias de dados;
   * no empate, prefere Exalted (números mais legíveis), depois Divine e Chaos.
   * (O Mirror, por exemplo, vem com o par em Exalted vazio.)
   */
  async history(league: string, category: NinjaCategory, detailsId: string): Promise<PriceHistory> {
    const url =
      `${BASE_URL}/details?league=${encodeURIComponent(league)}` +
      `&type=${encodeURIComponent(category)}&id=${encodeURIComponent(detailsId)}`
    const data = await this.http.request(url, { schema: detailsSchema })
    const pair = pickHistoryPair(data.pairs)
    const points = (pair?.history ?? [])
      .filter((h) => h.rate > 0)
      .map((h) => ({ timestamp: h.timestamp, value: h.rate, volumeDivine: h.volumePrimaryValue ?? 0 }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    return { league, detailsId, unit: pair?.id ?? 'divine', points }
  }
}

/**
 * Baixa todas as categorias, uma de cada vez (para não sobrecarregar o
 * poe.ninja). Categorias vazias ou com erro são ignoradas; se a Currency
 * falhar, o erro sobe, porque sem ela não há taxas de câmbio.
 */
export async function fetchMarketSnapshot(
  client: NinjaClient,
  league: string,
  now: () => Date = () => new Date(),
): Promise<MarketSnapshot> {
  const currency = await client.overview(league, 'Currency')
  const items = [...currency.items]
  for (const category of NINJA_CATEGORIES) {
    if (category === 'Currency') continue
    try {
      const overview = await client.overview(league, category)
      items.push(...overview.items)
    } catch {
      // Uma categoria fora do ar não deve derrubar o painel inteiro.
    }
  }
  return { league, fetchedAt: now().toISOString(), rates: currency.rates, items }
}
