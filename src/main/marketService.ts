// Mantém os dados de mercado atualizados e faz as checagens de preço.
// Único lugar do app que fala com a internet.

import { ApiError, HttpClient, type FetchLike } from '../core/http/client'
import { StatIndex } from '../core/item/statMatcher'
import { evaluateWatchlist, type WatchAlert } from '../core/market/watchlist'
import type { RareKeyContext } from '../core/collection/priceCache'
import type { Build, BuildItem } from '../core/build/model'
import { buildTierReport, type TierReport } from '../core/build/tierReport'
import { buildItemSearch, tradeBaseType } from '../core/build/trade'
import { findRecipe, MECHANICS } from '../core/farm/mechanics'
import { buildPriceIndex, toDivine } from '../core/money'
import { topTabletMods, type TopTablets } from '../core/farm/market'
import { buildPresets, type RegexPreset, type TabletMod } from '../core/farm/regex'
import { FULL_USES_FILTER, recipeQuery } from '../core/farm/recipes'
import type { PriceCheckErrorCode } from '../core/pricecheck'
import { buildTierTable, type TierOption } from '../core/item/tiers'
import { allTiersForBase, priceCheck, searchAndPrice, tiersForBase, toPriceCheckError, type PriceCheckResult, type TierContext } from '../core/pricecheck'
import { RepoeClient, repoeArtUrl, type RepoeData } from '../core/sources/repoe'
import type { DataStore } from './dataStore'
import type { DiskCache } from './diskCache'
import { isFilterGroups, isItemCatalog, isLeagues, isSnapshot, isStatEntries, isTablets, isTabletMods, isTopTablets, isUniqueEntries, slug } from './storeShapes'
import type { Settings } from '../core/settings'
import { fetchMarketSnapshot, NinjaClient, type NinjaCategory, type TabletPrice, type UniqueInfo } from '../core/sources/ninja'
import { pickDefaultLeague, TradeClient, tradeLinkUrl, tradeSiteUrl, type FilterGroupDef, type ItemCatalog } from '../core/sources/trade'
import { buildManualQuery, type FilterValue, type ManualSearch } from '../core/trade/manual'
import type { FilterOverride, TradeQuery } from '../core/trade/query'
import type { League, MarketSnapshot, PriceHistory } from '../core/types'
import type { BuildItemInfo, MarketSearchResult, MarketState, RecipePrice, SearchCatalog } from '../shared/ipc'

/** Grupos de mods oferecidos na busca manual (os demais são raros de se buscar). */
const SEARCHABLE_GROUPS = new Set(['pseudo', 'explicit', 'implicit'])
import type { SettingsStore } from './settingsStore'

const STATIC_TTL_MS = 24 * 60 * 60 * 1000
const HISTORY_TTL_MS = 30 * 60 * 1000
const MAX_BASE_ICONS = 10_000
/** Preço de receita de tablet: média guardada em disco, refeita no máximo a cada 3 h. */
const RECIPE_TTL_MS = 3 * 60 * 60 * 1000
const MAX_RECIPE_PRICES = 500
const ICON_RETRY_MS = 10 * 60 * 1000
/** Máximo de itens sem imagem procurados na trade por atualização do mercado. */
const MAX_ICON_FILL = 30

interface Cached<T> {
  value: T
  at: number
}

function fresh<T>(entry: Cached<T> | undefined, ttl: number): entry is Cached<T> {
  return entry !== undefined && Date.now() - entry.at < ttl
}

export class MarketService {
  private readonly trade: TradeClient
  private readonly ninja: NinjaClient

  private artCache: Record<string, string> | null = null
  private readonly dataLoading = new Map<string, Promise<unknown>>()
  private readonly dataFailure = new Map<string, { until: number; error: unknown }>()
  private statsCache: { source: unknown; index: StatIndex; at: number } | undefined
  /** Último catálogo carregado (a estimativa da lista precisa dele sem esperar). */
  private catalogNow: ItemCatalog | null = null
  private tierCache: Cached<TierContext> | undefined

  /** Preços de receitas (lidos do disco na primeira vez). */
  private recipePrices: Map<string, Cached<RecipePrice>> | null = null
  private readonly recipeLoading = new Map<string, Promise<RecipePrice>>()
  private uniquesMap: { source: unknown; map: Map<string, UniqueInfo> } | undefined
  /** Ícone de cada tipo base (lido do disco na primeira vez). */
  private baseIcons: Map<string, string> | null = null
  private readonly baseIconLoading = new Map<string, Promise<string | null>>()
  private readonly iconMisses = new Set<string>()
  /** Busca de ícone que falhou (rede, limite): só tenta de novo depois de um tempo. */
  private readonly iconRetryAt = new Map<string, number>()
  private fillingIcons = false
  private tierLoading: Promise<TierContext | null> | null = null
  private readonly repoe: RepoeClient
  private readonly historyCache = new Map<string, Cached<PriceHistory>>()
  private state: MarketState = { league: null, snapshot: null, loading: false, error: null }
  /** Atualização em andamento e a liga escolhida quando ela começou (null = sempre a mais recente). */
  private inflight: { choice: string | null; run: Promise<MarketState> } | null = null
  /** Cresce a cada atualização nova: resposta de uma atualização antiga (outra liga) é descartada. */
  private generation = 0
  private timer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(s: MarketState) => void>()

  constructor(
    private readonly settings: SettingsStore,
    userAgent: string,
    private readonly onAlerts: (alerts: WatchAlert[], settings: Settings) => void,
    private readonly tierDisk: DiskCache<RepoeData>,
    private readonly iconDisk: DiskCache<Record<string, string>>,
    private readonly recipeDisk: DiskCache<Record<string, Cached<RecipePrice>>>,
    private readonly artDisk: DiskCache<Record<string, string>>,
    /** Tudo que se baixa fica aqui: disco primeiro, rede só quando precisa. */
    private readonly store: DataStore,
    /** Só para testes (rede falsa); o app usa o fetch padrão. */
    fetchImpl?: FetchLike,
  ) {
    const http = new HttpClient({ userAgent, fetch: fetchImpl })
    this.trade = new TradeClient(http)
    this.ninja = new NinjaClient(http)
    // Arquivos do RePoE são maiores; damos mais tempo para baixar.
    this.repoe = new RepoeClient(new HttpClient({ userAgent, timeoutMs: 60_000, fetch: fetchImpl }))
  }

  onChange(listener: (s: MarketState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState(): MarketState {
    return this.state
  }

  private setState(next: MarketState): void {
    this.state = next
    for (const listener of this.listeners) listener(next)
  }

  /**
   * Dados fixos da trade (ligas, stats, catálogo): chamadas simultâneas usam a
   * mesma requisição e, se falhar, ninguém tenta de novo até o limite liberar.
   * Sem isso, cada ícone/preço pedia a lista de ligas de novo e enchia a fila.
   */
  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    const failed = this.dataFailure.get(key)
    if (failed && failed.until > Date.now()) return Promise.reject(failed.error)
    const pending = this.dataLoading.get(key) as Promise<T> | undefined
    if (pending) return pending
    const run = load()
      .catch((error: unknown) => {
        const waitSec = error instanceof ApiError && error.code === 'rate-limited' ? (error.retryAfterSec ?? 60) : 30
        this.dataFailure.set(key, { until: Date.now() + waitSec * 1000, error })
        throw error
      })
      .finally(() => this.dataLoading.delete(key))
    this.dataLoading.set(key, run)
    return run
  }

  /** Ligas: guardadas no disco; a trade só é consultada uma vez por dia. */
  leagues(): Promise<League[]> {
    return this.store.get({ name: 'trade-leagues', ttlMs: STATIC_TTL_MS, validate: isLeagues, load: () => this.trade.leagues() })
  }

  /** Bloqueio ativo da trade (para guardar ao fechar e respeitar ao abrir de novo). */
  tradeBlockedUntil(): number {
    return Date.now() + this.trade.searchCooldown() * 1000
  }

  restoreTradeBlock(until: number): void {
    this.trade.blockUntil(until)
  }

  async currentLeague(): Promise<string> {
    const chosen = this.settings.get().league
    if (chosen) return chosen
    return pickDefaultLeague(await this.leagues())
  }

  /**
   * Atualiza os preços. Chamadas simultâneas para a mesma liga compartilham a mesma
   * requisição; trocar de liga começa outra na hora e descarta a resposta da antiga.
   */
  refresh(): Promise<MarketState> {
    const choice = this.settings.get().league
    if (this.inflight && this.inflight.choice === choice) return this.inflight.run
    const generation = ++this.generation
    const run: Promise<MarketState> = this.doRefresh(generation).finally(() => {
      if (this.inflight?.run === run) this.inflight = null
    })
    this.inflight = { choice, run }
    return run
  }

  private async doRefresh(generation: number): Promise<MarketState> {
    // Trocou de liga no meio do caminho: quem esperava por esta atualização recebe a da liga nova.
    const superseded = () => generation !== this.generation
    const latest = (): Promise<MarketState> | MarketState => this.inflight?.run ?? this.state
    const chosen = this.settings.get().league
    // Liga escolhida pelo nome: o topo mostra a nova na hora, sem os preços da antiga.
    if (chosen && chosen !== this.state.league) this.setState({ league: chosen, snapshot: null, loading: true, error: null })
    else this.setState({ ...this.state, loading: true, error: null })
    try {
      const league = await this.currentLeague()
      if (superseded()) return latest()
      const spec = this.snapshotSpec(league)
      // Mostra na hora os últimos preços guardados desta liga (se houver); os novos chegam em seguida.
      if (this.state.snapshot?.league !== league) {
        const saved = await this.store.peek(spec)
        const snapshot = saved ? await this.withKnownIcons(saved.value) : null
        if (superseded()) return latest()
        this.setState({ league, snapshot, loading: true, error: null })
      }
      const fetched = await this.store.refresh(spec)
      if (superseded()) return latest()
      const snapshot = await this.withKnownIcons(fetched)
      if (superseded()) return latest()
      this.setState({ league, snapshot, loading: false, error: null })
      await this.checkAlerts(snapshot)
      void this.fillMissingIcons(league)
    } catch (error) {
      if (superseded()) return latest()
      const code = error instanceof ApiError ? error.code : 'unexpected'
      this.setState({ ...this.state, loading: false, error: code })
    }
    return this.state
  }

  /** Itens novos da liga às vezes vêm do poe.ninja sem imagem: usa o ícone já achado na trade. */
  private async withKnownIcons(snapshot: MarketSnapshot): Promise<MarketSnapshot> {
    if (snapshot.items.every((i) => i.iconUrl)) return snapshot
    this.baseIcons ??= new Map(Object.entries((await this.iconDisk?.read()) ?? {}))
    const icons = this.baseIcons
    return { ...snapshot, items: snapshot.items.map((i) => (i.iconUrl ? i : { ...i, iconUrl: this.artIcon(i.name) ?? icons.get(`item:${i.name}`) ?? null })) }
  }

  /**
   * Catálogo de ícones dos dados do jogo (RePoE): nome → arte. Arquivos estáticos,
   * sem limite de requisições: é a fonte principal de ícones fora do poe.ninja.
   */
  private async art(): Promise<Record<string, string>> {
    if (this.artCache) return this.artCache
    const saved = await this.artDisk?.read()
    if (saved) return (this.artCache = saved)
    const catalog = await this.once('art', () => this.repoe.artCatalog())
    this.artCache = catalog
    await this.artDisk?.write(catalog)
    return catalog
  }

  /** Ícone pelo catálogo (só se já carregado). Aceita "Fire Penetration I" e "Fire Penetration". */
  private artIcon(name: string): string | null {
    const catalog = this.artCache
    if (!catalog) return null
    const file = catalog[name] ?? catalog[name.replace(/\s[IVX]+$/, '')] ?? catalog[`${name} I`]
    return file ? repoeArtUrl(file) : null
  }

  /**
   * Em segundo plano, procura na trade o ícone oficial dos itens que ficaram sem imagem
   * (um por vez, respeitando o limite da GGG) e atualiza o mercado quando achar.
   */
  private async fillMissingIcons(league: string): Promise<void> {
    if (this.fillingIcons) return
    this.fillingIcons = true
    try {
      await this.art().catch(() => null)
      // Primeiro o catálogo do jogo (sem limite); a trade só para o que não estiver nele.
      const missing = (this.state.snapshot?.items ?? []).filter((i) => !i.iconUrl && !this.artIcon(i.name)).slice(0, MAX_ICON_FILL)
      let found = (this.state.snapshot?.items ?? []).some((i) => !i.iconUrl && this.artIcon(i.name)) ? 1 : 0
      for (const item of missing) {
        // Trocou de liga: para de gastar a cota da trade com os itens da liga antiga.
        if (this.state.league !== league) break
        const url = await this.tradeIcon(league, `item:${item.name}`, item.name, false).catch(() => null)
        if (url) found++
      }
      const current = this.state.snapshot
      if (found > 0 && current?.league === league) {
        const withIcons = await this.withKnownIcons(current)
        // Só aplica se o mercado não mudou (outra liga, preços novos) enquanto isso.
        if (this.state.snapshot === current) this.setState({ ...this.state, snapshot: withIcons })
      }
    } finally {
      this.fillingIcons = false
    }
  }

  private async checkAlerts(snapshot: MarketSnapshot): Promise<void> {
    const settings = this.settings.get()
    if (settings.watchlist.length === 0) return
    const { entries, alerts } = evaluateWatchlist(settings.watchlist, snapshot, settings.displayCurrency)
    if (alerts.length > 0) {
      await this.settings.replace({ ...settings, watchlist: entries })
      this.onAlerts(alerts, this.settings.get())
    }
  }

  /** Garante um snapshot da liga atual (usa o que já tem se for da mesma liga). */
  async snapshot(): Promise<MarketSnapshot> {
    const league = await this.currentLeague()
    if (this.state.snapshot?.league === league) return this.state.snapshot
    const state = await this.refresh()
    if (!state.snapshot) throw new ApiError(state.error === 'unexpected' || state.error === null ? 'network' : state.error)
    return state.snapshot
  }

  /** (Re)agenda a atualização automática. */
  schedule(): void {
    if (this.timer) clearInterval(this.timer)
    const minutes = this.settings.get().refreshMinutes
    this.timer = setInterval(() => void this.refresh(), minutes * 60 * 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async history(category: NinjaCategory, detailsId: string): Promise<PriceHistory> {
    const league = await this.currentLeague()
    const key = `${league}|${category}|${detailsId}`
    const cached = this.historyCache.get(key)
    if (fresh(cached, HISTORY_TTL_MS)) return cached.value
    const value = await this.ninja.history(league, category, detailsId)
    this.historyCache.set(key, { value, at: Date.now() })
    return value
  }

  private async statIndex(): Promise<StatIndex> {
    const entries = await this.store.get({ name: 'trade-stats', ttlMs: STATIC_TTL_MS, validate: isStatEntries, load: () => this.trade.stats() })
    if (this.statsCache?.source !== entries) this.statsCache = { source: entries, index: new StatIndex(entries), at: Date.now() }
    return this.statsCache.index
  }

  private async itemCatalog(): Promise<ItemCatalog> {
    this.catalogNow = await this.store.get({ name: 'trade-items', ttlMs: STATIC_TTL_MS, validate: isItemCatalog, load: () => this.trade.catalog() })
    return this.catalogNow
  }

  /** Preços do poe.ninja da liga (guardados: o app abre com os últimos preços). */
  private snapshotSpec(league: string) {
    return { name: `ninja-market-${slug(league)}`, ttlMs: 0, validate: isSnapshot(league), load: () => fetchMarketSnapshot(this.ninja, league) }
  }

  private async baseTypes(): Promise<string[]> {
    return (await this.itemCatalog()).bases.map((b) => b.type)
  }

  /** Dados para autocompletar a busca manual (itens e mods mais usados). */
  async searchCatalog(): Promise<SearchCatalog> {
    const [items, index, filterGroups] = await Promise.all([this.itemCatalog(), this.statIndex(), this.filterGroups()])
    return {
      bases: items.bases,
      uniques: items.uniques,
      stats: index.entries.filter((s) => SEARCHABLE_GROUPS.has(s.group)),
      filterGroups,
    }
  }

  filterGroups(): Promise<FilterGroupDef[]> {
    return this.store.get({ name: 'trade-filters', ttlMs: STATIC_TTL_MS, validate: isFilterGroups, load: () => this.trade.filters() })
  }

  /**
   * Tabela de tiers (RePoE + stats da trade). Baixa uma vez, guarda em disco
   * por alguns dias e na memória. Se falhar, as telas funcionam sem tiers.
   */
  tierContext(): Promise<TierContext | null> {
    if (fresh(this.tierCache, STATIC_TTL_MS)) return Promise.resolve(this.tierCache.value)
    this.tierLoading ??= this.loadTiers().finally(() => {
      this.tierLoading = null
    })
    return this.tierLoading
  }

  private async loadTiers(): Promise<TierContext | null> {
    try {
      let data = await this.tierDisk?.read()
      if (!data) {
        data = await this.repoe.load()
        await this.tierDisk?.write(data)
      }
      const value: TierContext = { table: buildTierTable(data, await this.statIndex()), baseTags: data.baseTags }
      this.tierCache = { value, at: Date.now() }
      return value
    } catch {
      return null
    }
  }

  /**
   * Contexto para montar a chave de cache de itens raros SEM rede: só devolve
   * algo se stats e catálogo já estiverem na memória (senão dispara o carregamento).
   */
  rareKeyContextCached(): RareKeyContext | null {
    if (!this.statsCache || !this.catalogNow) {
      void this.statIndex().catch(() => undefined)
      void this.itemCatalog().catch(() => undefined)
      return null
    }
    return {
      index: this.statsCache.index,
      baseTypes: this.catalogNow.bases.map((b) => b.type),
      minModPercent: this.settings.get().overlay.minModPercent,
    }
  }

  /** Segundos até a busca da trade liberar (0 se livre). */
  searchCooldown(): number {
    return this.trade.searchCooldown()
  }

  /**
   * Link do site da trade com o filtro da receita (busca dentro do link: abre na
   * hora e não gasta a cota da API). A receita vem do arquivo curado.
   */
  async recipeTradeUrl(mechanicId: string, recipeId: string): Promise<{ ok: true; url: string } | { ok: false; code: PriceCheckErrorCode }> {
    const recipe = findRecipe(mechanicId, recipeId)
    if (!recipe) return { ok: false, code: 'unexpected' }
    try {
      const league = await this.currentLeague()
      const url = tradeLinkUrl(league, recipeQuery(recipe, this.settings.get().overlay.listingStatus))
      return url ? { ok: true, url } : { ok: false, code: 'unexpected' }
    } catch (error) {
      return { ok: false, code: error instanceof ApiError ? error.code : 'unexpected' }
    }
  }

  /**
   * Ícone (e preço, para únicos) de um item da build. Ordem: ícone que veio com a
   * build (poe.ninja) → único no poe.ninja → catálogo do jogo (RePoE, sem limite)
   * → trade só em último caso. Funciona mesmo com a trade fora do ar ou limitada.
   */
  async buildItemInfo(item: BuildItem, knownIcon: string | null = null): Promise<BuildItemInfo> {
    const art = await this.art().catch(() => null)
    const league = await this.currentLeague().catch(() => null)
    const [uniques, catalog, tiers] = await Promise.all([
      league ? this.uniqueInfo(league).catch(() => new Map<string, UniqueInfo>()) : new Map<string, UniqueInfo>(),
      this.itemCatalog().catch(() => null),
      // Só armas precisam dos dados de tags (duas mãos); não atrasa os outros ícones.
      item.slot.startsWith('Weapon') ? this.tierContext().catch(() => null) : Promise.resolve(null),
    ])
    const unique = item.rarity === 'Unique' && item.name ? uniques.get(item.name) : undefined
    const base = tradeBaseType(item, catalog?.bases.map((b) => b.type) ?? Object.keys(art ?? {}))
    // Ícone oficial que veio com a build (poe.ninja) vale mais: é o do item de verdade.
    let iconUrl = knownIcon ?? unique?.iconUrl ?? null
    if (!iconUrl && item.rarity === 'Unique' && item.name) iconUrl = this.artIcon(item.name)
    if (!iconUrl && base) iconUrl = this.artIcon(base)
    // Último caso: uma busca na trade (tarefa de fundo); depois fica em disco.
    if (!iconUrl && base && league) iconUrl = await this.baseIcon(league, base).catch(() => null)
    // Duas mãos (tag "twohand" do jogo), exceto arco: com arco, a outra mão é a aljava.
    const tags = base ? (tiers?.baseTags[base] ?? []) : []
    return { iconUrl, priceDivine: unique?.valueDivine ?? null, twoHanded: tags.includes('twohand') && !tags.includes('bow') }
  }

  /** Únicos do poe.ninja (ícone e preço), guardados por 6 h. */
  private async uniqueInfo(league: string): Promise<Map<string, UniqueInfo>> {
    const entries = await this.store.get({
      name: `ninja-uniques-${slug(league)}`,
      ttlMs: 6 * 60 * 60 * 1000,
      validate: isUniqueEntries,
      load: async () => [...(await this.ninja.uniques(league)).entries()],
    })
    if (this.uniquesMap?.source !== entries) this.uniquesMap = { source: entries, map: new Map(entries) }
    return this.uniquesMap.map
  }

  /** Tier de cada mod das peças da build (dados do jogo; sem rede além do que já está guardado). */
  async buildTierReport(build: Build): Promise<TierReport | null> {
    const [context, index, catalog] = await Promise.all([this.tierContext(), this.statIndex().catch(() => null), this.itemCatalog().catch(() => null)])
    if (!context || !index || !catalog) return null
    return buildTierReport(build, index, catalog.bases.map((b) => b.type), context)
  }

  /** Ícone oficial de uma gema: catálogo do jogo; a trade só se não estiver nele. */
  async gemIcon(name: string): Promise<string | null> {
    await this.art().catch(() => null)
    const fromArt = this.artIcon(name)
    if (fromArt) return fromArt
    const exact = await this.tryGemIcon(name)
    if (exact) return exact
    // No PoE2 vários supports têm nível no nome ("Fire Penetration I"); o ícone é o mesmo em todos.
    return /\s[IVX]+$/.test(name) ? null : this.tryGemIcon(`${name} I`)
  }

  private async tryGemIcon(name: string): Promise<string | null> {
    try {
      return await this.tradeIcon(await this.currentLeague(), `gem:${name}`, name, false)
    } catch {
      return null
    }
  }

  private baseIcon(league: string, base: string): Promise<string | null> {
    return this.tradeIcon(league, base, base, true)
  }

  /** Ícone do primeiro anúncio da trade de um tipo; chamadas iguais simultâneas compartilham a busca. */
  private async tradeIcon(league: string, key: string, type: string, nonUnique: boolean): Promise<string | null> {
    this.baseIcons ??= new Map(Object.entries((await this.iconDisk?.read()) ?? {}))
    const known = this.baseIcons.get(key)
    if (known) return known
    // Tipo sem anúncio (ou nome que a trade não conhece): não busca de novo nesta sessão.
    if (this.iconMisses.has(key)) return null
    if ((this.iconRetryAt.get(key) ?? 0) > Date.now()) return null
    const pending = this.baseIconLoading.get(key)
    if (pending) return pending
    const load = (async () => {
      // Ícone é tarefa de fundo: usa só a folga do limite da trade.
      const search = await this.trade
        .search(
          league,
          {
            query: {
              status: { option: 'any' },
              type,
              stats: [{ type: 'and', filters: [] }],
              ...(nonUnique ? { filters: { type_filters: { filters: { rarity: { option: 'nonunique' } } } } } : {}),
            },
            sort: { price: 'asc' },
          },
          true,
        )
        .catch((error: unknown) => {
          // 400 = a trade não conhece esse nome: não tenta de novo nesta sessão.
          if (error instanceof ApiError && error.status === 400) return null
          this.iconRetryAt.set(key, Date.now() + ICON_RETRY_MS)
          throw error
        })
      if (!search) {
        this.iconMisses.add(key)
        return null
      }
      const [first] = search.result.length > 0 ? await this.trade.fetchListings(search.id, search.result.slice(0, 1), true) : []
      const icon = first?.iconUrl ?? null
      if (!icon) this.iconMisses.add(key)
      if (icon && this.baseIcons && this.baseIcons.size < MAX_BASE_ICONS) {
        this.baseIcons.set(key, icon)
        await this.iconDisk?.write(Object.fromEntries(this.baseIcons))
      }
      return icon
    })().finally(() => this.baseIconLoading.delete(key))
    this.baseIconLoading.set(key, load)
    return load
  }

  /**
   * Link do site da trade para um item parecido com o da build (mesma base,
   * maioria dos mods). A busca vai dentro do link: não gasta a cota da API.
   */
  async buildItemTradeUrl(item: BuildItem): Promise<{ ok: true; url: string } | { ok: false; code: PriceCheckErrorCode }> {
    try {
      const [index, catalog, league] = await Promise.all([this.statIndex(), this.itemCatalog(), this.currentLeague()])
      const settings = this.settings.get()
      const names = { baseTypes: catalog.bases.map((b) => b.type), uniques: catalog.uniques.map((u) => u.name) }
      const built = buildItemSearch(item, index, names, settings.overlay.minModPercent)
      if (!built) return { ok: false, code: 'unknown-base-type' }
      const url = tradeLinkUrl(league, buildManualQuery(built.search, settings.overlay.listingStatus))
      return url ? { ok: true, url } : { ok: false, code: 'unexpected' }
    } catch (error) {
      return { ok: false, code: error instanceof ApiError ? error.code : 'unexpected' }
    }
  }

  /**
   * Preço REAL de uma receita (tablets à venda com aqueles mods): mediana e
   * mais barato dos primeiros anúncios, em Divine. Guardado em disco e refeito
   * no máximo a cada 3 h, como tarefa de fundo (nunca atrasa um price check).
   */
  async recipePrice(mechanicId: string, recipeId: string): Promise<RecipePrice | null> {
    const recipe = findRecipe(mechanicId, recipeId)
    if (!recipe) return null
    const league = await this.currentLeague()
    const key = `${league}|${this.settings.get().overlay.listingStatus}|${mechanicId}|${recipeId}`
    this.recipePrices ??= new Map(Object.entries((await this.recipeDisk?.read()) ?? {}))
    const cached = this.recipePrices.get(key)
    if (fresh(cached, RECIPE_TTL_MS)) return cached.value
    const stale: RecipePrice | undefined = this.recipePrices.get(key)?.value
    const pending = this.recipeLoading.get(key)
    if (pending) return pending
    const load = (async () => {
      const snapshot = await this.snapshot()
      const priced = await searchAndPrice(league, recipeQuery(recipe, this.settings.get().overlay.listingStatus), snapshot, {
        search: (l, q) => this.trade.search(l, q, true),
        fetchListings: (id, ids) => this.trade.fetchListings(id, ids, true),
      })
      const value: RecipePrice = { medianDivine: priced.medianDivine, cheapestDivine: priced.cheapestDivine, sample: priced.listings.length, total: priced.total }
      if (this.recipePrices && this.recipePrices.size < MAX_RECIPE_PRICES) {
        this.recipePrices.set(key, { value, at: Date.now() })
        await this.recipeDisk?.write(Object.fromEntries(this.recipePrices))
      }
      return value
    })().finally(() => this.recipeLoading.delete(key))
    this.recipeLoading.set(key, load)
    // Média antiga aparece na hora; a nova fica guardada para a próxima vez.
    if (stale) {
      load.catch(() => undefined)
      return stale
    }
    return load
  }

  /**
   * "O que o mercado paga caro agora": os 10 anúncios mais baratos a partir de 1 Div do tablet raro
   * da mecânica (compra instantânea) e os mods que se repetem neles. Tarefa de
   * fundo, guardada por 6 h: 2 consultas à trade por mecânica nesse período.
   */
  async topTablets(mechanicId: string): Promise<TopTablets | null> {
    const guide = MECHANICS.find((m) => m.id === mechanicId)
    const baseType = guide?.recipes.find((r) => r.rarity === 'rare')?.baseType
    if (!guide || !baseType) return null
    const league = await this.currentLeague()
    return this.store.get({
      name: `farm-top-${mechanicId}-${slug(league)}`,
      ttlMs: 6 * 60 * 60 * 1000,
      validate: isTopTablets,
      load: async () => {
        const snapshot = await this.snapshot()
        const query: TradeQuery = {
          query: {
            status: { option: 'securable' },
            type: baseType,
            stats: [{ type: 'and', filters: [FULL_USES_FILTER] }],
            // Do mais barato para cima, mas só a partir de 1 Div: ordenar pelo mais caro só traz preço de troll.
            filters: { type_filters: { filters: { rarity: { option: 'rare' } } }, trade_filters: { filters: { price: { option: 'divine', min: 1 } } } },
          },
          sort: { price: 'asc' },
        }
        // 10 anúncios espalhados pelos (até 100) mais baratos acima de 1 Div: cobre a faixa de preço real.
        const search = await this.trade.search(league, query, true)
        const step = Math.max(1, Math.floor(search.result.length / 10))
        const ids = search.result.filter((_, i) => i % step === 0).slice(0, 10)
        const prices = buildPriceIndex(snapshot.items)
        const listings = (ids.length > 0 ? await this.trade.fetchListings(search.id, ids, true) : []).map((l) => ({
          ...l,
          divine: l.amount !== null && l.currency ? toDivine(l.amount, l.currency, prices) : null,
        }))
        return topTabletMods(baseType, listings)
      },
    })
  }

  /**
   * Gerador de regex de tablets: mods com o texto do item (RePoE, guardado por 7 dias;
   * não usa a trade) e atalhos prontos a partir das receitas de cada mecânica.
   */
  async tabletRegexData(): Promise<{ mods: TabletMod[]; presets: RegexPreset[] }> {
    const mods = await this.store.get({ name: 'repoe-tablet-mods', ttlMs: 7 * 24 * 60 * 60 * 1000, validate: isTabletMods, load: () => this.repoe.tabletMods() })
    // Texto dos mods das receitas: lista de mods da trade já guardada (sem nova consulta se já houver).
    const index = await this.statIndex().catch(() => null)
    const texts = new Map((index?.entries ?? []).map((e) => [e.id, e.text]))
    return { mods, presets: buildPresets(MECHANICS, mods, (id) => texts.get(id) ?? null) }
  }

  /** Preços de tablets (poe.ninja atualiza ~1x por hora): guardados; renova a cada 30 min. */
  async tablets(): Promise<TabletPrice[]> {
    const league = await this.currentLeague()
    return this.store.get({ name: `ninja-tablets-${slug(league)}`, ttlMs: HISTORY_TTL_MS, validate: isTablets, load: () => this.ninja.tablets(league) })
  }

  /** Mods possíveis numa base, com tiers. Vazio se os dados de tier não carregaram. */
  async baseMods(baseType: string): Promise<Record<string, TierOption[]>> {
    const context = await this.tierContext()
    return context ? allTiersForBase(context, baseType) : {}
  }

  async searchTiers(baseType: string, statIds: readonly string[]): Promise<Record<string, TierOption[]>> {
    const context = await this.tierContext()
    return context ? tiersForBase(context, baseType, statIds) : {}
  }

  async marketSearch(search: ManualSearch): Promise<MarketSearchResult> {
    try {
      const league = await this.currentLeague()
      const snapshot = await this.snapshot()
      const query = buildManualQuery(search, this.settings.get().overlay.listingStatus)
      const priced = await searchAndPrice(league, query, snapshot, {
        search: (l, q) => this.trade.search(l, q),
        fetchListings: (id, ids) => this.trade.fetchListings(id, ids),
      })
      return { kind: 'ok', league, ...priced }
    } catch (error) {
      const result = toPriceCheckError(error)
      return result.kind === 'error' ? result : { kind: 'error', code: 'unexpected', retryAfterSec: null }
    }
  }

  async priceCheck(
    text: string,
    overrides?: FilterOverride[],
    siteFilters?: Record<string, Record<string, FilterValue>>,
    statusOverride?: string | null,
  ): Promise<PriceCheckResult> {
    const settings = this.settings.get()
    let league: string
    try {
      league = await this.currentLeague()
    } catch (error) {
      return { kind: 'error', code: error instanceof ApiError ? error.code : 'unexpected', retryAfterSec: null }
    }
    return priceCheck(
      text,
      {
        league,
        status: settings.overlay.listingStatus,
        minModPercent: settings.overlay.minModPercent,
        overrides,
        siteFilters,
        statusOverride,
      },
      {
        snapshot: () => this.snapshot(),
        statIndex: () => this.statIndex(),
        baseTypes: () => this.baseTypes(),
        search: (l, q) => this.trade.search(l, q),
        fetchListings: (id, ids) => this.trade.fetchListings(id, ids),
        tiers: () => this.tierContext(),
      },
    )
  }
}
