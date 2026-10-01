// Contrato entre o processo principal (acesso ao sistema) e as janelas
// (interface, sem acesso ao sistema). Tudo que cruza essa fronteira passa
// por aqui e é validado no lado principal.

import type { ApiErrorCode } from '../core/http/client'
import type { Build, BuildImportErrorCode, BuildKind, BuildPair } from '../core/build/model'
import type { TierReport } from '../core/build/tierReport'
import type { ZoneGuide } from '../core/campaign/guide'
import type { TopTablets } from '../core/farm/market'
import type { RegexPreset, TabletMod } from '../core/farm/regex'
import type { ExternalTarget } from '../core/links'
import type { CollectionView } from '../core/collection/collection'
import type { HotkeyErrorCode, HotkeySlot } from '../core/hotkeys'
import type { ItemParseErrorCode } from '../core/item/parser'
import type { StatEntry } from '../core/item/statMatcher'
import type { LogSourceStatus } from '../core/log/clientLog'
import type { SessionView } from '../core/log/playSession'
import type { ActRef, LevelGap, TrackerSnapshot } from '../core/log/tracker'
import type { TierOption } from '../core/item/tiers'
import type { PriceCheckErrorCode, PriceCheckResult, PricedSearch } from '../core/pricecheck'
import type { Settings, SettingsPatch } from '../core/settings'
import type { NinjaCategory, TabletPrice } from '../core/sources/ninja'
import type { BaseTypeEntry, FilterGroupDef, UniqueEntry } from '../core/sources/trade'
import type { FilterValue, ManualSearch } from '../core/trade/manual'
import type { FilterOverride } from '../core/trade/query'
import type { League, MarketSnapshot, PriceHistory } from '../core/types'

export const IPC = {
  getLeagues: 'leagues:list',
  getMarket: 'market:get',
  refreshMarket: 'market:refresh',
  getHistory: 'market:history',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  hotkeyStatus: 'hotkeys:status',
  hotkeySet: 'hotkeys:set',
  hotkeySuspend: 'hotkeys:suspend',
  priceCheck: 'pricecheck:run',
  searchCatalog: 'search:catalog',
  searchTiers: 'search:tiers',
  baseMods: 'search:base-mods',
  farmTablets: 'farm:tablets',
  farmOpenRecipe: 'farm:open-recipe',
  farmRecipePrice: 'farm:recipe-price',
  farmTopTablets: 'farm:top-tablets',
  farmTabletRegex: 'farm:tablet-regex',
  filterGroups: 'search:filter-groups',
  marketSearch: 'search:run',
  openExternal: 'shell:open-external',
  hideOverlay: 'overlay:hide',
  hideCampaign: 'campaign:hide',
  showCampaign: 'campaign:show',
  getCampaign: 'campaign:get',
  campaignUi: 'campaign:ui',
  campaignFit: 'campaign:fit',
  openApp: 'app:open',
  answerClose: 'app:close-answer',
  toggleWatch: 'watch:toggle',
  setWatchAlert: 'watch:set-alert',
  getTracker: 'tracker:get',
  chooseLogFile: 'tracker:choose-file',
  setLogPath: 'tracker:set-path',
  reloadTracker: 'tracker:reload',
  collectionGet: 'collection:get',
  collectionAdd: 'collection:add',
  collectionRemove: 'collection:remove',
  collectionClear: 'collection:clear',
  collectionToggle: 'collection:toggle',
  collectionAck: 'collection:ack',
  buildGet: 'build:get',
  buildImport: 'build:import',
  buildClear: 'build:clear',
  buildOpenTrade: 'build:open-trade',
  buildTiers: 'build:tiers',
  buildItemInfo: 'build:item-info',
  buildGemIcon: 'build:gem-icon',
} as const

export const EVENTS = {
  market: 'event:market',
  settings: 'event:settings',
  overlay: 'event:overlay',
  campaign: 'event:campaign',
  /** Painel: ir para uma página (ex.: botão de configurações do quadro da campanha). */
  navigate: 'event:navigate',
  /** Painel: o usuário clicou no X; mostrar a pergunta "minimizar ou fechar". */
  closeAsk: 'event:close-ask',
  tracker: 'event:tracker',
  collection: 'event:collection',
  build: 'event:build',
} as const

/** Ícone oficial (CDN da GGG) e, para únicos, o preço do poe.ninja. */
export interface BuildItemInfo {
  iconUrl: string | null
  priceDivine: number | null
  /** Arma de duas mãos: ocupa também o espaço da outra mão (mostrado apagado). */
  twoHanded: boolean
}

export type BuildImportResult = { ok: true; build: Build } | { ok: false; code: BuildImportErrorCode }

/** Preço real de uma receita de tablet na trade (Divine). */
export interface RecipePrice {
  medianDivine: number | null
  cheapestDivine: number | null
  /** Quantos anúncios entraram na mediana. */
  sample: number
  total: number
}

const numOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))

/** Valida o arquivo de preços de receitas guardado em disco. */
export function isRecipePriceMap(v: unknown): v is Record<string, { value: RecipePrice; at: number }> {
  if (typeof v !== 'object' || v === null) return false
  return Object.values(v).every((e: unknown) => {
    const entry = e as { value?: Partial<RecipePrice>; at?: unknown } | null
    const p = entry?.value
    return typeof entry?.at === 'number' && !!p && numOrNull(p.medianDivine) && numOrNull(p.cheapestDivine) && typeof p.sample === 'number' && typeof p.total === 'number'
  })
}

export interface TrackerPayload {
  snapshot: TrackerSnapshot
  status: LogSourceStatus
  /** Sessões de jogo (abrir → fechar o jogo), mais recentes primeiro. */
  sessions: SessionView[]
}

export type CollectionAddResult = { ok: true } | { ok: false; code: ItemParseErrorCode | 'list-full' }

export interface MarketState {
  league: string | null
  snapshot: MarketSnapshot | null
  loading: boolean
  error: ApiErrorCode | 'unexpected' | null
}

export type OverlayEvent =
  | { state: 'loading'; text: string }
  | { state: 'done'; text: string; result: PriceCheckResult }
  /** Modo lista: a sobreposição vira um aviso com a lista e o total. */
  | { state: 'collection'; view: CollectionView }

/** Estado da barra do quadro da campanha. */
export interface CampaignUi {
  /** Fixado: não move nem redimensiona. */
  pinned: boolean
  /** Minimizado: só a barra de título. */
  collapsed: boolean
}

/** Janela da campanha: entrou numa área (nível da área x seu nível e o que não pode perder ali). */
export interface CampaignEvent {
  area: string
  zone: ZoneGuide | null
  act: ActRef | null
  areaLevel: number | null
  charLevel: number | null
  gap: LevelGap | null
}

export interface HotkeySlotStatus {
  accelerator: string | null
  /** false = o sistema recusou o registro (outro programa usa a combinação). */
  registered: boolean
}

export type HotkeyStatus = Record<HotkeySlot, HotkeySlotStatus>

/** Troca de atalho: o processo principal só salva se o sistema aceitar o registro. */
export type HotkeySetResult =
  | { ok: true; settings: Settings }
  | { ok: false; code: HotkeyErrorCode | 'register-failed' }

export interface HistoryRequest {
  category: NinjaCategory
  detailsId: string
}

export interface WatchRef {
  category: NinjaCategory
  itemId: string
}

export interface PriceCheckRequest {
  text: string
  overrides?: FilterOverride[]
  /** Filtros do site editados na sobreposição. */
  siteFilters?: Record<string, Record<string, FilterValue>>
  status?: string | null
}

export interface SearchCatalog {
  bases: BaseTypeEntry[]
  uniques: UniqueEntry[]
  stats: StatEntry[]
  /** Filtros do site de trade (Type, Equipment, Requirements, Endgame, Misc, Trade). */
  filterGroups: FilterGroupDef[]
}

export type MarketSearchResult =
  | ({ kind: 'ok'; league: string } & PricedSearch)
  | { kind: 'error'; code: PriceCheckErrorCode; retryAfterSec: number | null }

/** API exposta às janelas como `window.oraculo`. */
export interface OraculoApi {
  getLeagues(): Promise<League[]>
  getMarket(): Promise<MarketState>
  refreshMarket(): Promise<MarketState>
  getHistory(request: HistoryRequest): Promise<PriceHistory>
  getSettings(): Promise<Settings>
  updateSettings(patch: SettingsPatch): Promise<Settings>
  /** Atalhos em uso e se o sistema aceitou cada um. */
  hotkeyStatus(): Promise<HotkeyStatus>
  /** Troca um atalho. null = restaurar o padrão. */
  setHotkey(slot: HotkeySlot, accelerator: string | null): Promise<HotkeySetResult>
  /** Solta os atalhos enquanto o campo captura uma combinação. */
  suspendHotkeys(on: boolean): Promise<void>
  priceCheck(request: PriceCheckRequest): Promise<PriceCheckResult>
  searchCatalog(): Promise<SearchCatalog>
  /** Só os grupos de filtros do site (leve, para a sobreposição). */
  filterGroups(): Promise<FilterGroupDef[]>
  /** Tiers de cada stat para um tipo base (vazio se os dados de tier não estiverem disponíveis). */
  searchTiers(request: { baseType: string; statIds: string[] }): Promise<Record<string, TierOption[]>>
  /** Todos os mods possíveis numa base, com os tiers de cada um. */
  baseMods(baseType: string): Promise<Record<string, TierOption[]>>
  /** Preços de tablets (comuns e únicos) da liga atual. */
  farmTablets(): Promise<TabletPrice[]>
  /** Preço real (trade) de uma receita de tablet; null se não existir. */
  farmRecipePrice(ref: { mechanicId: string; recipeId: string }): Promise<RecipePrice | null>
  /** Mods que se repetem nos tablets mais caros da mecânica (cache de 6 h). */
  farmTopTablets(mechanicId: string): Promise<TopTablets | null>
  /** Mods de tablet e atalhos prontos para o gerador de regex. */
  farmTabletRegex(): Promise<{ mods: TabletMod[]; presets: RegexPreset[] }>
  /** Busca a receita de tablet na trade e abre o site com o mesmo filtro. */
  farmOpenRecipe(ref: { mechanicId: string; recipeId: string }): Promise<{ ok: true } | { ok: false; code: PriceCheckErrorCode }>
  marketSearch(search: ManualSearch): Promise<MarketSearchResult>
  openExternal(target: ExternalTarget): Promise<boolean>
  hideOverlay(): Promise<void>
  /** Fecha a janela da campanha (botão ✕). */
  hideCampaign(): Promise<void>
  /** Reabre o quadro da campanha (botão na aba Campanha). false = ainda não há área de campanha. */
  showCampaign(): Promise<boolean>
  /** Área atual da campanha (a janela pergunta ao abrir; depois recebe por onCampaign). */
  getCampaign(): Promise<CampaignEvent | null>
  /** Barra do quadro da campanha: lê (sem argumento) ou muda fixado/minimizado. */
  campaignUi(change?: Partial<CampaignUi>): Promise<CampaignUi>
  /** Ajusta a altura da janela ao conteúdo (px). */
  campaignFit(height: number): Promise<void>
  /** Abre o painel numa página (ex.: 'tracker' = Campanha e mapas). */
  openApp(page: 'tracker'): Promise<void>
  /** Resposta da pergunta ao fechar (minimizar para a bandeja, fechar ou cancelar). */
  answerClose(answer: CloseAnswer): Promise<void>
  toggleWatch(ref: WatchRef): Promise<Settings>
  setWatchAlert(ref: WatchRef & { alertPercent: number }): Promise<Settings>
  getTracker(): Promise<TrackerPayload>
  chooseLogFile(): Promise<TrackerPayload>
  setLogPath(path: string | null): Promise<TrackerPayload>
  reloadTracker(): Promise<TrackerPayload>
  getCollection(): Promise<CollectionView>
  addToCollection(text: string): Promise<CollectionAddResult>
  removeFromCollection(id: string): Promise<CollectionView>
  clearCollection(): Promise<CollectionView>
  toggleCollection(enabled?: boolean): Promise<CollectionView>
  acknowledgeCollection(id?: string): Promise<CollectionView>
  /** Builds importadas do Path of Building 2: a do guia e a do jogador. */
  getBuilds(): Promise<BuildPair>
  /** Aceita o código do PoB2 ou um link (pobb.in, poe.ninja, maxroll, poe2db). */
  importBuild(input: string, kind: BuildKind): Promise<BuildImportResult>
  clearBuild(kind: BuildKind): Promise<BuildPair>
  /** Ícone e preço (únicos) do item de um slot da build (null se o slot está vazio). */
  buildItemInfo(kind: BuildKind, slot: string): Promise<BuildItemInfo | null>
  /** Ícone oficial de uma gema das builds (null se não achar). */
  buildGemIcon(name: string): Promise<string | null>
  /** Busca na trade um item parecido com o do slot da build e abre o site com o mesmo filtro. */
  /** Tier de cada mod das peças (slot → mods). null sem dados de tier. */
  buildTiers(kind: BuildKind): Promise<TierReport | null>
  openBuildItemTrade(kind: BuildKind, slot: string): Promise<{ ok: true } | { ok: false; code: PriceCheckErrorCode }>
  onBuilds(listener: (builds: BuildPair) => void): () => void
  onTracker(listener: (payload: TrackerPayload) => void): () => void
  onCollection(listener: (view: CollectionView) => void): () => void
  onMarket(listener: (state: MarketState) => void): () => void
  onSettings(listener: (settings: Settings) => void): () => void
  onOverlay(listener: (event: OverlayEvent) => void): () => void
  onCampaign(listener: (event: CampaignEvent) => void): () => void
  onNavigate(listener: (page: string) => void): () => void
  onCloseAsk(listener: () => void): () => void
}

export interface CloseAnswer {
  choice: 'tray' | 'quit' | 'cancel'
  /** Salvar a escolha (não perguntar de novo). */
  remember: boolean
}
