// Bandeja do Windows (ícones perto do relógio): o app pode seguir rodando sem a
// janela, só com a sobreposição e os atalhos, como Discord, Steam e Exiled
// Exchange 2. O X da janela pergunta (na própria janela do app, no estilo dele)
// ou usa a escolha salva; minimizar continua indo para a barra de tarefas.

import { app, dialog, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
// .ico com vários tamanhos: o Windows escolhe o certo para a escala da tela.
import trayIconPath from '../../build/icon.ico?asset'
import { effectiveCloseAction, type Settings } from '../core/settings'
import { translator } from '../shared/i18n'
import { EVENTS, type CloseAnswer } from '../shared/ipc'
import type { SettingsStore } from './settingsStore'

export class TrayController {
  private tray: Tray | null = null
  private quitting = false
  private hintShown = false
  /** Janela esperando a resposta da pergunta ao fechar. */
  private asking: BrowserWindow | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly open: () => void,
  ) {
    app.on('before-quit', () => (this.quitting = true))
  }

  /** Cria o ícone da bandeja (fica lá enquanto o app roda). */
  start(): void {
    if (this.tray) return
    this.tray = new Tray(nativeImage.createFromPath(trayIconPath))
    this.tray.setToolTip('PoE4Dummies II')
    this.tray.on('click', () => this.open())
    this.tray.on('double-click', () => this.open())
    this.refresh(this.settings.get())
  }

  /** Menu no idioma atual. */
  refresh(current: Settings): void {
    if (!this.tray) return
    const t = translator(current.language)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('tray.open'), click: () => this.open() },
        { type: 'separator' },
        { label: t('tray.quit'), click: () => app.quit() },
      ]),
    )
  }

  /** Liga o X da janela à escolha do usuário. */
  attach(win: BrowserWindow): void {
    // Windows desligando ou saindo da sessão: fecha sem perguntar (senão o app segura o desligamento).
    win.on('session-end', () => (this.quitting = true))
    win.on('close', (event) => {
      if (this.quitting) return
      const current = this.settings.get()
      const action = effectiveCloseAction(current, Date.now())
      // Venceu o prazo (15 dias) do "Não perguntar de novo": volta a perguntar, sem aviso (a configuração volta para "Perguntar").
      if (action !== current.closeAction) void this.settings.update({ closeAction: 'ask', closeActionRememberedAt: null })
      if (action === 'quit') return
      event.preventDefault()
      if (action === 'tray') this.hide(win)
      else this.ask(win)
    })
  }

  /** Resposta da pergunta (vem da janela do app). */
  async answer({ choice, remember }: CloseAnswer): Promise<void> {
    const win = this.asking
    this.asking = null
    if (!win || win.isDestroyed() || choice === 'cancel') return
    if (remember) await this.settings.update({ closeAction: choice, closeActionRememberedAt: Date.now() })
    if (choice === 'tray') this.hide(win)
    else app.quit()
  }

  private hide(win: BrowserWindow): void {
    this.start()
    win.hide()
    // Primeira vez na sessão: avisa onde o app foi parar.
    if (!this.hintShown && this.tray && process.platform === 'win32') {
      this.hintShown = true
      const t = translator(this.settings.get().language)
      this.tray.displayBalloon({ iconType: 'info', title: t('tray.hint.title'), content: t('tray.hint.body') })
    }
  }

  private ask(win: BrowserWindow): void {
    // A pergunta aparece dentro da janela do app. Se a página não carregou (erro), usa a caixa do Windows.
    if (win.webContents.isLoading() || win.webContents.isCrashed()) {
      void this.askNative(win)
      return
    }
    this.asking = win
    win.webContents.send(EVENTS.closeAsk)
  }

  private async askNative(win: BrowserWindow): Promise<void> {
    const t = translator(this.settings.get().language)
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'PoE4Dummies II',
      message: t('close.message'),
      detail: t('close.detail'),
      buttons: [t('close.tray'), t('close.quit'), t('close.cancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: t('close.remember'),
    })
    this.asking = win
    await this.answer({ choice: response === 0 ? 'tray' : response === 1 ? 'quit' : 'cancel', remember: checkboxChecked })
  }
}
