import { app, BrowserWindow, screen } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
// O bundler copia o PNG para out/ e devolve o caminho real (funciona dentro do asar).
import appIcon from '../../build/icon.png?asset'
import { APP_ORIGIN } from './appProtocol'
import { captureDir } from './devCapture'
import { focusGame, foregroundExe, isGameExe, pointerState } from './gameFocus'
import { secureWebPreferences } from './security'

const BACKGROUND = '#0e0f11'
/** Altura da faixa do topo (.topbar no CSS) = altura dos botões da janela. */
const TITLEBAR_HEIGHT = 50
const OVERLAY_SIZE = { width: 420, height: 620 }

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function load(win: BrowserWindow, page: 'dashboard' | 'overlay' | 'campaign'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}/${page}.html`)
  // Protocolo próprio (não file://): no .exe, a trava de segurança impede file:// de carregar scripts.
  else void win.loadURL(`${APP_ORIGIN}/${page}.html`)
}

export function createDashboard(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    title: 'PoE4Dummies II',
    icon: appIcon,
    // Sem a barra de título branca do Windows: a faixa do topo do app vira a barra da janela
    // (arrastável no CSS) e os botões minimizar/maximizar/fechar nativos ganham as cores do app.
    // Nativos de propósito: mantêm o encaixe de janelas do Windows ao passar o mouse no maximizar.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BACKGROUND, symbolColor: '#a39d8f', height: TITLEBAR_HEIGHT },
    // Modo de fotos (só em desenvolvimento): desenha fora da tela, funciona com o monitor desligado.
    webPreferences: { ...secureWebPreferences(preloadPath()), offscreen: captureDir() !== null },
  })
  win.once('ready-to-show', () => win.show())
  load(win, 'dashboard')
  return win
}

export function createOverlay(): BrowserWindow {
  const win = new BrowserWindow({
    ...OVERLAY_SIZE,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: BACKGROUND,
    icon: appIcon,
    webPreferences: { ...secureWebPreferences(preloadPath()), offscreen: captureDir() !== null },
  })
  // "screen-saver" fica acima de jogos em modo janela sem borda.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true)
  win.on('blur', () => win.hide())
  closeOnOutsideClick(win)
  load(win, 'overlay')
  return win
}

/** Só o price check fecha sozinho; o aviso/painel do modo lista mantém o comportamento dele (com o ✕). */
const autoClose = new WeakSet<BrowserWindow>()

/**
 * Fecha a sobreposição. Se ela estava com o foco (o usuário clicou nela, ex.: no ✕ da lista),
 * o foco volta direto para o jogo, sem precisar clicar nele de novo. Se o foco estava em outro
 * lugar (jogo, painel do app, outro programa), não mexe.
 */
export function hideOverlay(win: BrowserWindow): void {
  if (win.isDestroyed() || !win.isVisible()) return
  const hadFocus = win.isFocused()
  win.hide()
  if (hadFocus) focusGame()
}

/** A sobreposição passou a mostrar o modo lista: para de fechar sozinha. */
export function stopOverlayAutoClose(win: BrowserWindow): void {
  autoClose.delete(win)
}

/**
 * Fecha o price check como as janelas do jogo: clique fora dele, Esc ou trocar
 * de programa. O Windows nem sempre deixa a sobreposição ganhar o foco do jogo
 * (aí o "blur" nunca acontece), então olhamos o mouse enquanto ela está aberta.
 * Clique dentro dela funciona normal; depois de focada, o blur cuida do resto.
 */
function closeOnOutsideClick(win: BrowserWindow): void {
  const ownExe = basename(process.execPath).toLowerCase()
  let timer: NodeJS.Timeout | null = null
  // Botão já apertado quando a janela abriu não conta: só cliques novos.
  let mouseWas = true
  let escapeWas = true
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  const tick = () => {
    if (win.isDestroyed() || !win.isVisible() || !autoClose.has(win)) return stop()
    const state = pointerState()
    if (!state) return
    const click = state.mouse && !mouseWas
    const escape = state.escape && !escapeWas
    mouseWas = state.mouse
    escapeWas = state.escape
    if (escape) return hideOverlay(win)
    // Não confia em isFocused(): o Electron pode achar que a janela tem foco quando o Windows
    // recusou tirar o foco do jogo, e aí o clique no jogo era ignorado (não fechava).
    if (click) {
      const p = screen.getCursorScreenPoint()
      const b = win.getBounds()
      if (p.x < b.x || p.x >= b.x + b.width || p.y < b.y || p.y >= b.y + b.height) return win.hide()
    }
    // Trocou para outro programa (nem o jogo, nem este app).
    const exe = foregroundExe()
    if (exe !== null && !isGameExe(exe) && exe.toLowerCase() !== ownExe) win.hide()
  }
  win.on('show', () => {
    stop()
    mouseWas = true
    escapeWas = true
    timer = setInterval(tick, 50)
  })
  win.on('hide', stop)
  win.on('closed', stop)
}

// ---------------------------------------------------------------- campanha
// Janela própria do quadro da campanha (separada do price check): pequena,
// por cima do jogo, não rouba o foco, não some ao perder o foco, arrastável
// pelo cabeçalho e lembra a posição.

const CAMPAIGN_SIZE = { width: 360, height: 220 }

export function createCampaignWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...CAMPAIGN_SIZE,
    show: false,
    frame: false,
    // Fundo transparente: a página desenha um painel semitransparente para não atrapalhar o jogo.
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    // Tamanho ajustável pela borda; posição e tamanho ficam guardados.
    resizable: true,
    minWidth: 260,
    minHeight: 120,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Nunca pega o foco: clicar ou arrastar o quadro não tira o jogo de foco.
    focusable: false,
    icon: appIcon,
    webPreferences: { ...secureWebPreferences(preloadPath()), offscreen: captureDir() !== null },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true)
  win.on('moved', () => saveCampaignBounds(win.getBounds()))
  win.on('resized', () => {
    if (!campaignUi.collapsed) saveCampaignBounds(win.getBounds())
  })
  load(win, 'campaign')
  campaignUi = { ...campaignUi, ...savedCampaignUi() }
  applyCampaignUi(win)
  return win
}

// Estado da barra do quadro: fixado (não move nem redimensiona) e minimizado (só o título).
const COLLAPSED_HEIGHT = 30
let campaignUi = { pinned: false, collapsed: false }

export function getCampaignUi(): { pinned: boolean; collapsed: boolean } {
  return { ...campaignUi }
}

export function setCampaignUi(win: BrowserWindow, next: Partial<{ pinned: boolean; collapsed: boolean }>): { pinned: boolean; collapsed: boolean } {
  campaignUi = { ...campaignUi, ...next }
  applyCampaignUi(win)
  saveCampaignUi()
  return getCampaignUi()
}

/** Altura do conteúdo (medida pela página): a janela acompanha o texto. */
let contentHeight = CAMPAIGN_SIZE.height

function applyCampaignUi(win: BrowserWindow): void {
  win.setMovable(!campaignUi.pinned)
  const height = campaignUi.collapsed ? COLLAPSED_HEIGHT : contentHeight
  // Altura travada no conteúdo; só a largura é ajustável à mão (o texto quebra e a altura acompanha).
  win.setMinimumSize(260, height)
  win.setMaximumSize(900, height)
  win.setBounds({ ...win.getBounds(), height })
  win.setResizable(!campaignUi.collapsed && !campaignUi.pinned)
}

/** A página mediu o conteúdo: ajusta a altura da janela. */
export function fitCampaignHeight(win: BrowserWindow, height: number): void {
  contentHeight = Math.max(40, Math.min(800, Math.ceil(height)))
  applyCampaignUi(win)
}

const campaignUiFile = () => join(app.getPath('userData'), 'campaign-ui.json')

function saveCampaignUi(): void {
  try {
    writeFileSync(campaignUiFile(), JSON.stringify(campaignUi))
  } catch {
    // Sem disco: volta ao padrão na próxima vez.
  }
}

function savedCampaignUi(): Partial<{ pinned: boolean; collapsed: boolean }> {
  try {
    const p = JSON.parse(readFileSync(campaignUiFile(), 'utf8')) as Record<string, unknown>
    return { pinned: p['pinned'] === true, collapsed: p['collapsed'] === true }
  } catch {
    return {}
  }
}

/** Mostra o quadro onde o usuário deixou (ou no canto superior direito), sem tirar o foco do jogo. */
export function showCampaignWindow(win: BrowserWindow): void {
  if (!win.isVisible()) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const saved = savedCampaignBounds()
    win.setBounds(saved ?? { x: area.x + area.width - CAMPAIGN_SIZE.width - 24, y: area.y + 120, ...CAMPAIGN_SIZE })
    applyCampaignUi(win)
  }
  win.showInactive()
}

const campaignFile = () => join(app.getPath('userData'), 'campaign-window.json')

function saveCampaignBounds(b: { x: number; y: number; width: number; height: number }): void {
  try {
    writeFileSync(campaignFile(), JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }))
  } catch {
    // Sem disco: volta ao canto padrão na próxima vez.
  }
}

/** Posição e tamanho salvos, se ainda couberem em alguma tela. */
function savedCampaignBounds(): { x: number; y: number; width: number; height: number } | null {
  try {
    const p = JSON.parse(readFileSync(campaignFile(), 'utf8')) as Record<string, unknown>
    const [x, y, width, height] = [p['x'], p['y'], p['width'], p['height']]
    if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') return null
    const visible = screen.getAllDisplays().some((d) => x >= d.bounds.x - 50 && x < d.bounds.x + d.bounds.width - 50 && y >= d.bounds.y - 10 && y < d.bounds.y + d.bounds.height - 50)
    if (!visible) return null
    return { x, y, width: Math.max(260, Math.min(width, 900)), height: Math.max(120, Math.min(height, 900)) }
  } catch {
    return null
  }
}

/**
 * Mostra a sobreposição ao lado do cursor, sem sair da tela.
 * `focus: false` mostra sem tirar o foco do jogo (aviso rápido do modo lista).
 */
export function showOverlayNearCursor(win: BrowserWindow, focus = true): void {
  const cursor = screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(cursor).workArea
  const margin = 16
  let x = cursor.x + margin
  if (x + OVERLAY_SIZE.width > area.x + area.width) x = cursor.x - OVERLAY_SIZE.width - margin
  x = Math.max(area.x, Math.min(x, area.x + area.width - OVERLAY_SIZE.width))
  const y = Math.max(area.y, Math.min(cursor.y - 80, area.y + area.height - OVERLAY_SIZE.height))
  win.setBounds({ x: Math.round(x), y: Math.round(y), ...OVERLAY_SIZE })
  // Com foco = price check (fecha ao clicar fora); sem foco = aviso do modo lista (fica como era).
  if (focus) autoClose.add(win)
  else autoClose.delete(win)
  if (focus) {
    win.show()
    win.focus()
  } else {
    win.showInactive()
  }
}
