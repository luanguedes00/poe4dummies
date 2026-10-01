// Handlers IPC. Cada entrada vinda da interface é validada com zod aqui,
// porque a interface é tratada como não confiável.

import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { BUILD_KINDS } from '../core/build/model'
import { EQUIPMENT_SLOTS, MAX_CODE_LENGTH } from '../core/build/pob'
import { checkHotkey, currentHotkeys, DEFAULT_HOTKEYS, HOTKEY_SLOTS, type HotkeyErrorCode } from '../core/hotkeys'
import { MAX_ITEM_TEXT_LENGTH } from '../core/item/parser'
import { externalUrl } from '../core/links'
import { createWatchEntry, watchKey } from '../core/market/watchlist'
import { NINJA_CATEGORIES } from '../core/sources/ninja'
import { isSearchable, STAT_GROUP_TYPES } from '../core/trade/manual'
import { IPC, type CampaignEvent, type CampaignUi, type CloseAnswer, type HotkeySetResult } from '../shared/ipc'
import type { BuildService } from './buildService'
import type { CollectionService } from './collectionService'
import type { HotkeyManager } from './hotkeys'
import { logPathSchema } from './logWatcher'
import type { MarketService } from './marketService'
import type { TrackerService } from './trackerService'
import { assertTrustedSender } from './security'
import type { SettingsStore } from './settingsStore'

const historySchema = z.object({ category: z.enum(NINJA_CATEGORIES), detailsId: z.string().min(1).max(200) }).strict()
const watchRefSchema = z.object({ category: z.enum(NINJA_CATEGORIES), itemId: z.string().min(1).max(100) }).strict()
const watchAlertSchema = watchRefSchema.extend({ alertPercent: z.number().min(1).max(1000) }).strict()
// Filtros do site (Type, Misc, Trade...): ids simples e valores curtos.
const filterIdSchema = z.string().regex(/^[a-z_]{1,40}$/)
const filterValueSchema = z
  .object({
    min: z.number().finite().nullable().optional(),
    max: z.number().finite().nullable().optional(),
    option: z.string().regex(/^[\w.-]{1,64}$/).nullable().optional(),
    input: z.string().regex(/^[\w#. -]{0,64}$/u).nullable().optional(),
  })
  .strict()
const siteFiltersSchema = z.record(filterIdSchema, z.record(filterIdSchema, filterValueSchema))
const statusSchema = z.string().regex(/^[a-z]{1,20}$/).nullable().optional()

const priceCheckSchema = z
  .object({
    text: z.string().min(1).max(MAX_ITEM_TEXT_LENGTH),
    siteFilters: siteFiltersSchema.optional(),
    status: statusSchema,
    overrides: z
      .array(
        z
          .object({
            statId: z.string().min(1).max(100),
            enabled: z.boolean(),
            min: z.number().finite().nullable(),
            max: z.number().finite().nullable(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict()
const externalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trade'), league: z.string().max(64), queryId: z.string().max(1024) }).strict(),
  z.object({ kind: z.literal('poe2db'), name: z.string().max(200) }).strict(),
  z.object({ kind: z.literal('ninja'), league: z.string().max(64) }).strict(),
  z.object({ kind: z.literal('guide'), strategyId: z.string().regex(/^[a-z0-9-]{1,40}$/), index: z.number().int().min(0).max(10) }).strict(),
])
const recipeRefSchema = z.object({ mechanicId: z.string().regex(/^[a-z0-9-]{1,40}$/), recipeId: z.string().regex(/^[a-z0-9-]{1,60}$/) }).strict()
const setLogPathSchema = z.object({ path: logPathSchema }).strict()
const collectionIdSchema = z.string().regex(/^e\d{1,9}$/)
const collectionTextSchema = z.string().min(1).max(MAX_ITEM_TEXT_LENGTH)
const searchTiersSchema = z
  .object({
    baseType: z.string().min(1).max(120),
    statIds: z.array(z.string().regex(/^[a-z]+\.[a-z0-9_]+$/).max(100)).max(30),
  })
  .strict()
const statFilterSchema = z
  .object({
    id: z.string().regex(/^[a-z]+\.[a-z0-9_]+$/).max(100),
    min: z.number().finite().nullable(),
    max: z.number().finite().nullable(),
  })
  .strict()
const manualSearchSchema = z
  .object({
    name: z.string().min(1).max(120).nullable(),
    type: z.string().min(1).max(120).nullable(),
    stats: z.array(statFilterSchema).max(20),
    statGroups: z
      .array(
        z
          .object({
            type: z.enum(STAT_GROUP_TYPES),
            min: z.number().finite().nullable(),
            max: z.number().finite().nullable(),
            filters: z.array(statFilterSchema).max(20),
          })
          .strict(),
      )
      .max(10)
      .optional(),
    filters: siteFiltersSchema.optional(),
    status: statusSchema,
  })
  .strict()
  .refine((s) => isSearchable(s))

// Código do PoB2 (base64) ou link de site de build; o conteúdo é validado no parser.
const buildImportSchema = z.object({ input: z.string().min(1).max(MAX_CODE_LENGTH + 200), kind: z.enum(BUILD_KINDS) }).strict()
const buildSlotSchema = z.object({ kind: z.enum(BUILD_KINDS), slot: z.enum(EQUIPMENT_SLOTS) }).strict()
// Atalho: formato e conflitos são conferidos em checkHotkey; null = restaurar o padrão.
const hotkeySetSchema = z.object({ slot: z.enum(HOTKEY_SLOTS), accelerator: z.string().min(1).max(40).nullable() }).strict()

interface Deps {
  market: MarketService
  build: BuildService
  settings: SettingsStore
  collection: CollectionService
  tracker: TrackerService
  hotkeys: HotkeyManager
  /** Janela dona do seletor de arquivo do log. */
  dialogParent: () => BrowserWindow | null
  hideOverlay: () => void
  hideCampaign: () => void
  showCampaign: () => boolean
  getCampaign: () => CampaignEvent | null
  campaignUi: (change: Partial<CampaignUi>) => CampaignUi
  openApp: (page: 'tracker') => void
  campaignFit: (height: number) => void
  /** Resposta da pergunta ao fechar a janela. */
  answerClose: (answer: CloseAnswer) => void
}

const closeAnswerSchema = z.object({ choice: z.enum(['tray', 'quit', 'cancel']), remember: z.boolean() }).strict()

const campaignUiSchema = z.object({ pinned: z.boolean().optional(), collapsed: z.boolean().optional() }).strict()

function handle<T>(channel: string, fn: (event: IpcMainInvokeEvent, arg: unknown) => Promise<T> | T): void {
  ipcMain.handle(channel, async (event, arg: unknown) => {
    assertTrustedSender(event)
    return fn(event, arg)
  })
}

export function registerIpc({ market, build, settings, collection, tracker, hotkeys, dialogParent, hideOverlay, hideCampaign, showCampaign, getCampaign, campaignUi, openApp, campaignFit, answerClose }: Deps): void {
  handle(IPC.buildGet, () => build.all())
  handle(IPC.buildImport, (_e, arg) => {
    const { input, kind } = buildImportSchema.parse(arg)
    return build.import(input, kind)
  })
  handle(IPC.buildClear, (_e, arg) => build.clear(z.enum(BUILD_KINDS).parse(arg)))
  // A interface manda só qual build e o slot; o item vem da build guardada no processo principal.
  handle(IPC.buildItemInfo, (_e, arg) => {
    const { kind, slot } = buildSlotSchema.parse(arg)
    const current = build.get(kind)
    const item = current?.items.find((i) => i.slot === slot)
    return item ? market.buildItemInfo(item, current?.extras?.itemIcons[slot] ?? null) : null
  })
  handle(IPC.buildGemIcon, (_e, arg) => {
    // Só gemas que existem nas builds guardadas (nada de busca livre na trade).
    const name = z.string().min(1).max(120).parse(arg)
    const builds = [build.get('guide'), build.get('mine')]
    const known = builds.some((b) => b?.skills.some((g) => g.gems.some((gem) => gem.name === name)))
    if (!known) return null
    // Ícone oficial que veio com a build (poe.ninja): sem busca na trade.
    return builds.map((b) => b?.extras?.gems[name]?.icon).find(Boolean) ?? market.gemIcon(name)
  })
  // Tier dos mods de cada peça (para o plano de upgrade).
  handle(IPC.buildTiers, async (_e, arg) => {
    const current = build.get(z.enum(BUILD_KINDS).parse(arg))
    return current ? market.buildTierReport(current) : null
  })
  handle(IPC.buildOpenTrade, async (_e, arg) => {
    const { kind, slot } = buildSlotSchema.parse(arg)
    const item = build.get(kind)?.items.find((i) => i.slot === slot)
    if (!item) return { ok: false, code: 'unexpected' }
    const result = await market.buildItemTradeUrl(item)
    if (!result.ok) return result
    await shell.openExternal(result.url)
    return { ok: true }
  })
  handle(IPC.getLeagues, () => market.leagues())
  handle(IPC.getMarket, () => market.getState())
  handle(IPC.refreshMarket, () => market.refresh())
  handle(IPC.getHistory, (_e, arg) => {
    const { category, detailsId } = historySchema.parse(arg)
    return market.history(category, detailsId)
  })
  handle(IPC.getSettings, () => settings.get())
  handle(IPC.updateSettings, (_e, arg) => settings.update(arg))
  handle(IPC.hotkeyStatus, () => hotkeys.status())
  handle(IPC.hotkeySuspend, (_e, arg) => hotkeys.suspend(z.boolean().parse(arg)))
  handle(IPC.hotkeySet, async (_e, arg): Promise<HotkeySetResult> => {
    const { slot, accelerator } = hotkeySetSchema.parse(arg)
    const check = checkHotkey(slot, accelerator ?? DEFAULT_HOTKEYS[slot], currentHotkeys(settings.get()))
    const error = check.errors[0]
    if (error) return { ok: false, code: error.code as HotkeyErrorCode }
    // Só salva o que o sistema aceitou registrar.
    if (!hotkeys.trySet(slot, check.accelerator)) return { ok: false, code: 'register-failed' }
    const patch =
      slot === 'dashboard'
        ? { dashboardHotkey: check.accelerator }
        : slot === 'collection'
          ? { collectionHotkey: check.accelerator }
          : { overlay: { hotkey: check.accelerator } }
    return { ok: true, settings: await settings.update(patch) }
  })
  handle(IPC.priceCheck, async (_e, arg) => {
    const { text, overrides, siteFilters, status } = priceCheckSchema.parse(arg)
    // "Buscar de novo" também fura a fila do modo lista.
    const result = await collection.priorityCheck(text, () => market.priceCheck(text, overrides, siteFilters, status))
    return result ?? { kind: 'error', code: 'unexpected', retryAfterSec: null }
  })

  handle(IPC.getTracker, () => tracker.payload())
  handle(IPC.setLogPath, (_e, arg) => tracker.setPath(setLogPathSchema.parse(arg).path))
  handle(IPC.chooseLogFile, () => tracker.chooseFile(dialogParent()))
  handle(IPC.reloadTracker, () => tracker.reload())

  handle(IPC.collectionGet, () => collection.view())
  handle(IPC.collectionAdd, (_e, arg) => {
    const outcome = collection.add(collectionTextSchema.parse(arg))
    return outcome.ok ? { ok: true } : { ok: false, code: outcome.code }
  })
  handle(IPC.collectionRemove, (_e, arg) => collection.remove(collectionIdSchema.parse(arg)))
  handle(IPC.collectionClear, () => collection.clear())
  handle(IPC.collectionToggle, (_e, arg) => collection.setEnabled(z.boolean().optional().parse(arg) ?? !collection.isEnabled()))
  handle(IPC.collectionAck, (_e, arg) => collection.acknowledge(collectionIdSchema.optional().parse(arg)))
  handle(IPC.searchCatalog, () => market.searchCatalog())
  handle(IPC.filterGroups, () => market.filterGroups())
  handle(IPC.farmTablets, () => market.tablets())
  handle(IPC.farmRecipePrice, (_e, arg) => {
    const { mechanicId, recipeId } = recipeRefSchema.parse(arg)
    return market.recipePrice(mechanicId, recipeId)
  })
  handle(IPC.farmTabletRegex, () => market.tabletRegexData())
  handle(IPC.farmTopTablets, (_e, arg) => market.topTablets(z.string().regex(/^[a-z0-9-]{1,40}$/).parse(arg)))
  handle(IPC.farmOpenRecipe, async (_e, arg) => {
    const { mechanicId, recipeId } = recipeRefSchema.parse(arg)
    const result = await market.recipeTradeUrl(mechanicId, recipeId)
    if (!result.ok) return result
    await shell.openExternal(result.url)
    return { ok: true }
  })
  handle(IPC.baseMods, (_e, arg) => market.baseMods(z.string().min(1).max(120).parse(arg)))
  handle(IPC.searchTiers, (_e, arg) => {
    const { baseType, statIds } = searchTiersSchema.parse(arg)
    return market.searchTiers(baseType, statIds)
  })
  handle(IPC.marketSearch, (_e, arg) => market.marketSearch(manualSearchSchema.parse(arg)))
  handle(IPC.openExternal, async (_e, arg) => {
    const url = externalUrl(externalSchema.parse(arg))
    if (!url) return false
    await shell.openExternal(url)
    return true
  })
  handle(IPC.hideOverlay, () => hideOverlay())
  handle(IPC.hideCampaign, () => hideCampaign())
  handle(IPC.showCampaign, () => showCampaign())
  handle(IPC.getCampaign, () => getCampaign())
  handle(IPC.campaignUi, (_e, arg) => campaignUi(campaignUiSchema.parse(arg ?? {})))
  handle(IPC.openApp, (_e, arg) => openApp(z.enum(['tracker']).parse(arg)))
  handle(IPC.campaignFit, (_e, arg) => campaignFit(z.number().int().min(20).max(2000).parse(arg)))
  handle(IPC.answerClose, (_e, arg) => answerClose(closeAnswerSchema.parse(arg)))

  handle(IPC.toggleWatch, async (_e, arg) => {
    const ref = watchRefSchema.parse(arg)
    const current = settings.get()
    const key = watchKey(ref)
    if (current.watchlist.some((w) => watchKey(w) === key)) {
      return settings.replace({ ...current, watchlist: current.watchlist.filter((w) => watchKey(w) !== key) })
    }
    // O preço de referência vem dos dados do processo principal, nunca da interface.
    const snapshot = market.getState().snapshot
    const item = snapshot?.items.find((i) => i.id === ref.itemId && i.category === ref.category)
    if (!snapshot || !item) throw new Error('Item não encontrado no mercado atual')
    if (current.watchlist.length >= 200) throw new Error('Limite de 200 itens acompanhados')
    const entry = createWatchEntry(item, snapshot.rates, new Date(), undefined, snapshot.league)
    return settings.replace({ ...current, watchlist: [...current.watchlist, entry] })
  })

  handle(IPC.setWatchAlert, async (_e, arg) => {
    const { alertPercent, ...ref } = watchAlertSchema.parse(arg)
    const current = settings.get()
    const key = watchKey(ref)
    return settings.replace({
      ...current,
      watchlist: current.watchlist.map((w) => (watchKey(w) === key ? { ...w, alertPercent, lastAlert: null } : w)),
    })
  })
}
