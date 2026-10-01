// Endurecimento do Electron (checklist oficial de segurança):
// sandbox em tudo, sem Node na interface, sem navegação para fora, sem
// janelas novas, sem permissões (câmera, microfone, etc.) e IPC só do app.

import { app, session, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { isAllowedExternalUrl } from '../core/links'
import { APP_ORIGIN } from './appProtocol'

export const secureWebPreferences = (preload: string): Electron.WebPreferences => ({
  preload,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: false,
  navigateOnDragDrop: false,
})

/** Origem das páginas do próprio app (servidor de desenvolvimento ou arquivos locais). */
export function rendererOrigin(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) return new URL(devUrl).origin
  return APP_ORIGIN
}

export function isTrustedUrl(url: string): boolean {
  const origin = rendererOrigin()
  // Protocolo próprio: o URL do Node não calcula a origem ("null"), então compara o começo.
  if (origin === APP_ORIGIN) return url.startsWith(`${APP_ORIGIN}/`)
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

/** Toda chamada IPC precisa vir de uma página do próprio app. */
export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  if (!isTrustedUrl(url)) throw new Error('Remetente IPC não autorizado')
}

function hardenContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    // Links clicados na interface abrem no navegador, se forem permitidos.
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

export function applyGlobalSecurity(): void {
  app.enableSandbox()
  app.on('web-contents-created', (_event, contents) => hardenContents(contents))
}

/** Chamar depois do `app.whenReady()`. */
export function applySessionSecurity(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)
}
