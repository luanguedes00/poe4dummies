import { app, BrowserWindow, globalShortcut, Notification } from 'electron'
import { applyAppIdentity } from './appIdentity'
import { TrayController } from './tray'
import { promises as fs, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RepoeData } from '../core/sources/repoe'
import { isBuildPair, type BuildPair } from '../core/build/model'
import { HttpClient } from '../core/http/client'
import { BuildService } from './buildService'
import { DataStore } from './dataStore'
import { DiskCache } from './diskCache'
import { installIconCache } from './iconCache'
import { installAppProtocol, registerSchemes } from './appProtocol'
import { installContextMenu } from './contextMenu'
import { CURRENCY_SHORT, formatAmount, formatPercent, fromDivine } from '../core/money'
import type { WatchAlert } from '../core/market/watchlist'
import type { Settings } from '../core/settings'
import { localeOf, translator } from '../shared/i18n'
import { EVENTS, isRecipePriceMap, type CampaignEvent, type OverlayEvent, type RecipePrice, type TrackerPayload } from '../shared/ipc'
import { PriceCache, type PriceCacheJSON } from '../core/collection/priceCache'
import { ClipboardWatcher } from './clipboardWatcher'
import { CollectionService } from './collectionService'
import { clipboardSequence, focusState, gameRunning } from './gameFocus'
import { HotkeyManager } from './hotkeys'
import { sendKeys } from './keySender'
import { copyKeySequence, GAME_ONLY_SLOTS } from '../core/hotkeys'
import { TrackerService } from './trackerService'
import { captureDir, runCapture } from './devCapture'
import { registerIpc } from './ipc'
import { MarketService } from './marketService'
import { applyGlobalSecurity, applySessionSecurity } from './security'
import { SettingsStore } from './settingsStore'
import { createCampaignWindow, createDashboard, createOverlay, fitCampaignHeight, getCampaignUi, setCampaignUi, hideOverlay as hideOverlayWindow, showCampaignWindow, showOverlayNearCursor, stopOverlayAutoClose } from './windows'
import { zoneGuide } from '../core/campaign/guide'

// A GGG pede um User-Agent que identifique a ferramenta.
const USER_AGENT = `PoE4Dummies/${app.getVersion()} (desktop; windows)`

applyGlobalSecurity()
registerSchemes()
// Modo de fotos: renderização por software, para capturar mesmo com o monitor desligado.
// (O teste de desempenho usa a placa de vídeo, como o app normal.)
if (captureDir() && process.env['ORACULO_CAPTURE_ONLY'] !== 'perf') app.disableHardwareAcceleration()
// Modo de fotos usa uma pasta de dados própria: nunca mexe nas builds, lista e configurações do usuário.
const capture = captureDir()
if (capture) app.setPath('userData', join(capture, '.dados-captura'))

/**
 * O app já se chamou "Oráculo PoE2", "PoE for Lazies" e "PoE4Dummies"; o Electron guarda os dados numa pasta com o
 * nome do app. Na primeira execução com o nome novo, copia as configurações antigas.
 */
async function migrateOldSettings(): Promise<void> {
  const target = join(app.getPath('userData'), 'settings.json')
  const legacy = join(app.getPath('appData'), 'Oráculo PoE2', 'settings.json')
  try {
    await fs.access(target)
    return
  } catch {
    // Ainda não existe: tenta migrar.
  }
  // Nomes anteriores, do mais recente ao mais antigo ("PoE4Dummies" → "PoE4Dummies II").
  // Copia configurações, builds, janela da campanha e o nosso cache (ícones, imagens,
  // dados da trade). Os arquivos internos do navegador ficam para trás.
  for (const previous of ['PoE4Dummies', 'PoE for Lazies']) {
    const from = join(app.getPath('appData'), previous)
    try {
      await fs.access(join(from, 'settings.json'))
    } catch {
      continue
    }
    await fs.mkdir(join(app.getPath('userData'), 'cache'), { recursive: true })
    for (const file of ['settings.json', 'builds.json', 'campaign-window.json', 'campaign-ui.json']) {
      await fs.copyFile(join(from, file), join(app.getPath('userData'), file)).catch(() => undefined)
    }
    for (const entry of ['data', 'img', 'art.json', 'icons.json', 'repoe.json', 'recipes.json', 'prices.json', 'trade-block.json']) {
      await fs.cp(join(from, 'cache', entry), join(app.getPath('userData'), 'cache', entry), { recursive: true }).catch(() => undefined)
    }
    return
  }
  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.copyFile(legacy, target)
  } catch {
    // Sem configurações antigas: começa com o padrão.
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let dashboard: BrowserWindow | null = null
  let overlay: BrowserWindow | null = null
  // Bandeja: o X pode deixar o app rodando só com a sobreposição (criada quando as configurações carregam).
  let tray: TrayController | null = null

  const showDashboard = () => {
    if (!dashboard || dashboard.isDestroyed()) {
      dashboard = createDashboard()
      tray?.attach(dashboard)
      // Janela fechada de verdade (escolheu "fechar"): encerra o app junto com a sobreposição.
      dashboard.on('closed', () => app.quit())
    }
    if (dashboard.isMinimized()) dashboard.restore()
    dashboard.show()
    dashboard.focus()
  }

  const broadcast = (channel: string, payload: unknown) => {
    for (const win of [dashboard, overlay]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  app.on('second-instance', showDashboard)

  app.whenReady().then(async () => {
    // Ícone e nome certos na barra de tarefas (antes de abrir qualquer janela).
    applyAppIdentity()
    applySessionSecurity()
    installIconCache(USER_AGENT)
    installAppProtocol(join(__dirname, '../renderer'))
    await migrateOldSettings()
    const settings = await SettingsStore.open(app.getPath('userData'))
    installContextMenu(() => settings.get().language)
    tray = new TrayController(settings, showDashboard)
    if (!captureDir()) tray.start()
    settings.onChange((current) => tray?.refresh(current))

    const notify = (alerts: WatchAlert[], current: Settings) => {
      if (!current.notifications || !Notification.isSupported()) return
      const t = translator(current.language)
      const locale = localeOf(current.language)
      for (const alert of alerts) {
        new Notification({
          title: t('watch.notify.title', {
            name: alert.item.name,
            direction: t(alert.direction === 'up' ? 'watch.notify.up' : 'watch.notify.down'),
            value: formatPercent(alert.change, locale),
          }),
          body: t('watch.notify.body', {
            date: new Date(alert.entry.addedAt).toLocaleDateString(locale),
            unit: t(`unit.${current.displayCurrency}`),
          }),
        }).show()
      }
    }

    const tierDisk = new DiskCache<RepoeData>(
      join(app.getPath('userData'), 'cache', 'repoe.json'),
      3 * 24 * 60 * 60 * 1000,
      (v): v is RepoeData =>
        typeof v === 'object' && v !== null && Array.isArray((v as RepoeData).mods) && typeof (v as RepoeData).baseTags === 'object',
    )
    // Ícones de tipos base e gemas (vêm de anúncios da trade; só links do CDN da GGG).
    // Sem validade: o ícone de uma base não muda; buscar de novo só gastaria o limite da trade.
    const iconDisk = new DiskCache<Record<string, string>>(
      join(app.getPath('userData'), 'cache', 'icons.json'),
      Number.POSITIVE_INFINITY,
      (v): v is Record<string, string> =>
        typeof v === 'object' && v !== null && Object.values(v).every((u) => typeof u === 'string' && u.startsWith('https://web.poecdn.com/')),
    )
    // Média de preço das receitas de tablet (a validade de cada uma fica no MarketService).
    const recipeDisk = new DiskCache<Record<string, { value: RecipePrice; at: number }>>(
      join(app.getPath('userData'), 'cache', 'recipes.json'),
      Number.POSITIVE_INFINITY,
      isRecipePriceMap,
    )
    // Catálogo de ícones dos dados do jogo (nome → arte no RePoE); renova por semana (patches).
    const artDisk = new DiskCache<Record<string, string>>(
      join(app.getPath('userData'), 'cache', 'art.json'),
      7 * 24 * 60 * 60 * 1000,
      (v): v is Record<string, string> =>
        typeof v === 'object' && v !== null && Object.values(v).every((f) => typeof f === 'string' && /^Art\/[A-Za-z0-9_\-/ ]+\.dds$/.test(f)),
    )
    // Tudo que se baixa (ligas, stats, catálogo, preços do poe.ninja): disco primeiro, rede só quando precisa.
    const store = new DataStore(join(app.getPath('userData'), 'cache', 'data'))
    const market = new MarketService(settings, USER_AGENT, notify, tierDisk, iconDisk, recipeDisk, artDisk, store)
    // Bloqueio da trade sobrevive a fechar e abrir o app: não insiste antes da hora.
    const blockFile = join(app.getPath('userData'), 'cache', 'trade-block.json')
    try {
      const until = Number(JSON.parse(readFileSync(blockFile, 'utf8')).until)
      if (Number.isFinite(until) && until > Date.now()) market.restoreTradeBlock(Math.min(until, Date.now() + 2 * 60 * 60 * 1000))
    } catch {
      // Sem bloqueio guardado.
    }
    app.on('will-quit', () => {
      try {
        mkdirSync(dirname(blockFile), { recursive: true })
        writeFileSync(blockFile, JSON.stringify({ until: market.tradeBlockedUntil() }))
      } catch {
        // Sem disco: na próxima vez só respeita o que a GGG responder.
      }
    })
    market.onChange((state) => broadcast(EVENTS.market, state))

    const ensureOverlay = (): BrowserWindow => {
      if (!overlay || overlay.isDestroyed()) overlay = createOverlay()
      return overlay
    }

    // Modo lista: fila com prioridade, cache de preços e aviso rápido sem tirar o foco do jogo.
    const priceDisk = new DiskCache<PriceCacheJSON>(join(app.getPath('userData'), 'cache', 'prices.json'), 24 * 60 * 60 * 1000, PriceCache.isValidJSON)
    let toastTimer: NodeJS.Timeout | null = null
    const collection = new CollectionService(market, priceDisk, () => settings.get().displayCurrency, {
      view: (view) => broadcast(EVENTS.collection, view),
      added: (_entry, _merged, view) => {
        const win = ensureOverlay()
        const event: OverlayEvent = { state: 'collection', view }
        win.webContents.send(EVENTS.overlay, event)
        // Modo lista mantém o comportamento dele (✕ e aviso que some sozinho), mesmo se o price check estava aberto.
        stopOverlayAutoClose(win)
        if (!win.isVisible()) showOverlayNearCursor(win, false)
        if (toastTimer) clearTimeout(toastTimer)
        toastTimer = setTimeout(() => {
          if (!win.isDestroyed() && !win.isFocused()) win.hide()
        }, 2500)
      },
      changed: (entries) => {
        const current = settings.get()
        if (!current.notifications || !Notification.isSupported()) return
        const t = translator(current.language)
        const locale = localeOf(current.language)
        const rates = market.getState().snapshot?.rates
        const fmt = (divine: number | null) =>
          divine === null || !rates ? '–' : `${formatAmount(fromDivine(divine, current.displayCurrency, rates), locale)} ${CURRENCY_SHORT[current.displayCurrency]}`
        for (const entry of entries.slice(0, 3)) {
          new Notification({
            title: t('collection.notify.title', { name: entry.name }),
            body: t('collection.notify.body', { from: fmt(entry.estimateDivine), to: fmt(entry.unitDivine) }),
            silent: true,
          }).show()
        }
      },
    })
    void collection.load()
    market.onChange((state) => {
      if (state.snapshot) collection.onSnapshot(state.snapshot)
    })

    const runPriceCheck = async (text: string) => {
      const win = ensureOverlay()
      const loading: OverlayEvent = { state: 'loading', text }
      win.webContents.send(EVENTS.overlay, loading)
      showOverlayNearCursor(win)
      // A checagem unitária passa na frente da fila do modo lista.
      const result = await collection.priorityCheck(text, () => market.priceCheck(text), true)
      if (result === null) return
      const done: OverlayEvent = { state: 'done', text, result }
      if (!win.isDestroyed()) win.webContents.send(EVENTS.overlay, done)
    }

    // Atalho próprio da sobreposição: com o PoE2 em foco, aperta a cópia do jogo no lugar do usuário;
    // o texto copiado chega pelo observador da área de transferência logo abaixo.
    let hotkeyCopyAt = 0
    const overlayHotkey = () => {
      const { overlay: current } = settings.get()
      if (!current.enabled || !current.hotkey || focusState() !== 'game') return
      hotkeyCopyAt = Date.now()
      if (!sendKeys(copyKeySequence(current.hotkey, current.copyMode))) hotkeyCopyAt = 0
    }

    // Tecla "adicionar à lista" (padrão F3, só com o jogo em foco): copia o item sob o mouse e manda para a lista.
    // Assim o Ctrl+C fica só para o price check (antes, com o modo lista ligado, o Ctrl+C ia para a lista).
    // Janela para reconhecer a cópia simulada (o jogo copia em menos de 0,5 s; o observador lê a cada 250 ms).
    // Curta de propósito: F3 sem item embaixo não pode capturar o Ctrl+C seguinte do usuário.
    const SIMULATED_COPY_MS = 700
    let listCopyAt = 0
    const collectionAddHotkey = () => {
      if (focusState() !== 'game') return
      listCopyAt = Date.now()
      if (!sendKeys(copyKeySequence(settings.get().collectionAddHotkey, 'simple'))) listCopyAt = 0
    }

    const clipboardWatcher = new ClipboardWatcher((text) => {
      const viaList = Date.now() - listCopyAt < SIMULATED_COPY_MS
      listCopyAt = 0
      if (viaList) {
        if (!collection.isEnabled()) collection.setEnabled(true)
        collection.add(text)
        return
      }
      const viaHotkey = Date.now() - hotkeyCopyAt < SIMULATED_COPY_MS
      hotkeyCopyAt = 0
      const current = settings.get().overlay
      if (!viaHotkey) {
        if (!current.clipboardTrigger) return
        // Boa prática das ferramentas de overlay: só reagir a Ctrl+C feito dentro do jogo.
        // Se não der para saber a janela em foco ("unknown"), não bloqueia.
        if (current.requireGameFocus && focusState() === 'other') return
      }
      void runPriceCheck(text)
    }, clipboardSequence)

    // Campanha: janela própria (separada do price check). Ao entrar numa área da campanha,
    // mostra nível da área x seu nível e o que não pode perder ali; some ao sair da campanha.
    let campaignWin: BrowserWindow | null = null
    const ensureCampaign = (): BrowserWindow => {
      if (!campaignWin || campaignWin.isDestroyed()) campaignWin = createCampaignWindow()
      return campaignWin
    }
    let lastArea: string | null = null
    let currentCampaign: CampaignEvent | null = null
    // O quadro aparece só com o PoE2 em foco (como o PoE Overlay II): trocou de janela, some; voltou ao jogo, volta.
    // `campaignWanted`: há área de campanha e o usuário não fechou no ✕.
    let campaignWanted = false
    setInterval(() => {
      if (!campaignWin || campaignWin.isDestroyed()) return
      const inGame = focusState() !== 'other'
      if (campaignWanted && inGame && !campaignWin.isVisible()) campaignWin.showInactive()
      else if ((!inGame || !campaignWanted) && campaignWin.isVisible()) campaignWin.hide()
    }, 400).unref()
    const showZoneTips = (snapshot: TrackerPayload['snapshot']) => {
      const area = snapshot.area
      // Espera o nome real da área (o provisório vem do código interno, ex.: "G4 11").
      if (!area?.name || !area.nameKnown || area.name === lastArea) return
      lastArea = area.name
      // Só na campanha (atos e interlúdios), e em cidades que têm algo no guia (ex.: rota das ilhas em Kingsmarch).
      // Esconderijo, mapa e o resto: o quadro some.
      const guided = area.kind === 'town' && zoneGuide(area.name) !== null
      if ((area.kind !== 'campaign' && !guided) || !settings.get().overlay.enabled) {
        campaignWanted = false
        if (campaignWin && !campaignWin.isDestroyed()) campaignWin.hide()
        return
      }
      const win = ensureCampaign()
      const event: CampaignEvent = {
        area: area.name,
        zone: zoneGuide(area.name),
        act: area.act,
        areaLevel: area.level,
        charLevel: snapshot.character?.level ?? null,
        gap: snapshot.gap,
      }
      // Guarda a área atual: a janela pergunta ao abrir (getCampaign) e recebe as próximas pelo evento.
      currentCampaign = event
      campaignWanted = true
      win.webContents.send(EVENTS.campaign, event)
      if (focusState() !== 'other') showCampaignWindow(win)
    }
    const tracker = new TrackerService(
      settings,
      (payload) => {
        broadcast(EVENTS.tracker, payload)
        showZoneTips(payload.snapshot)
      },
      join(app.getPath('userData'), 'play-sessions.json'),
    )
    // Jogo fechou: a sessão termina, fica guardada e o painel abre na aba Campanha e mapas com o resumo.
    const checkGame = () => {
      if (!settings.get().tracker.enabled) return
      if (tracker.setGameRunning(gameRunning())) {
        showDashboard()
        dashboard?.webContents.send(EVENTS.navigate, 'tracker')
      }
    }
    checkGame()
    setInterval(checkGame, 5000).unref()

    // Builds (guia e do jogador): guardadas sem validade; arquivo mexido ou corrompido é descartado.
    const buildDisk = new DiskCache<BuildPair>(join(app.getPath('userData'), 'builds.json'), Number.POSITIVE_INFINITY, isBuildPair)
    const build = new BuildService(buildDisk, new HttpClient({ userAgent: USER_AGENT }), (current) => broadcast(EVENTS.build, current))
    void build.load()

    const hotkeys = new HotkeyManager({
      dashboard: showDashboard,
      collection: () => collection.setEnabled(!collection.isEnabled()),
      collectionAdd: collectionAddHotkey,
      overlay: overlayHotkey,
    })
    // Atalhos "só no jogo" (adicionar à lista): registrados com o PoE2 em foco, soltos fora dele.
    setInterval(() => {
      const inGame = focusState() === 'game'
      for (const slot of GAME_ONLY_SLOTS) hotkeys.setActive(slot, inGame)
    }, 300).unref()

    registerIpc({
      market,
      build,
      settings,
      collection,
      tracker,
      hotkeys,
      dialogParent: () => dashboard,
      // ✕ da lista / Esc na sobreposição: fecha e devolve o foco ao jogo.
      hideOverlay: () => {
        if (overlay) hideOverlayWindow(overlay)
      },
      hideCampaign: () => {
        campaignWanted = false
        campaignWin?.hide()
      },
      // Reabre o quadro com a última área de campanha (aparece quando o jogo estiver em foco).
      // Se ainda não entrou em nenhuma área de campanha, avisa a tela.
      showCampaign: () => {
        if (!currentCampaign) return false
        const win = ensureCampaign()
        campaignWanted = true
        win.webContents.send(EVENTS.campaign, currentCampaign)
        showCampaignWindow(win)
        return true
      },
      getCampaign: () => currentCampaign,
      campaignUi: (change) => (Object.keys(change).length > 0 ? setCampaignUi(ensureCampaign(), change) : getCampaignUi()),
      campaignFit: (height) => fitCampaignHeight(ensureCampaign(), height),
      answerClose: (answer) => void tray?.answer(answer),
      openApp: (page) => {
        showDashboard()
        dashboard?.webContents.send(EVENTS.navigate, page)
      },
    })

    const applySettings = (current: Settings) => {
      const { overlay: o } = current
      // A tecla de adicionar à lista também lê a cópia: com a sobreposição ligada, o observador fica ativo.
      if (o.enabled) void clipboardWatcher.start()
      else clipboardWatcher.stop()
      hotkeys.apply('dashboard', current.dashboardHotkey)
      hotkeys.apply('collection', current.collectionHotkey)
      hotkeys.apply('collectionAdd', o.enabled ? current.collectionAddHotkey : null)
      // Sobreposição desligada: solta a combinação para o resto do sistema.
      hotkeys.apply('overlay', o.enabled ? o.hotkey : null)
      tracker.apply(current.tracker.enabled)
      market.schedule()
    }

    let lastLeague = settings.get().league
    settings.onChange((current) => {
      broadcast(EVENTS.settings, current)
      applySettings(current)
      if (current.league !== lastLeague) {
        lastLeague = current.league
        void market.refresh()
      }
    })

    showDashboard()
    // Pré-carrega a janela da sobreposição para abrir instantaneamente no jogo.
    overlay = createOverlay()
    applySettings(settings.get())
    const firstLoad = market.refresh()

    const capture = captureDir()
    if (capture && dashboard) {
      const win = dashboard
      void firstLoad.then(() => runCapture(capture, win, () => overlay, runPriceCheck))
    }

    app.on('will-quit', () => {
      tracker.stop()
      void collection.flush()
      collection.dispose()
    })
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => app.quit())
}
