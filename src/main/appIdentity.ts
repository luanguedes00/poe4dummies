// Identidade do app no Windows: a barra de tarefas agrupa janelas pelo
// AppUserModelID e mostra o ícone do atalho do Menu Iniciar com esse id. Sem
// isso, a versão de desenvolvimento aparece como "Electron" (ícone padrão) e a
// portátil herda atalhos antigos. O atalho com o id também é o que o Windows
// exige para mostrar as notificações do app.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'

export const APP_USER_MODEL_ID = 'com.poe4dummies.app'
const SHORTCUT_NAME = 'PoE4Dummies II.lnk'

export function applyAppIdentity(): void {
  if (process.platform !== 'win32') return
  app.setAppUserModelId(APP_USER_MODEL_ID)
  // Modo de fotos/testes: não mexe no Menu Iniciar.
  if (process.env['ORACULO_CAPTURE']) return
  try {
    const shortcut = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', SHORTCUT_NAME)
    // Portátil: o exe de verdade (o processo roda de uma cópia temporária). Desenvolvimento: electron.exe + pasta do projeto.
    const portable = process.env['PORTABLE_EXECUTABLE_FILE']
    const target = app.isPackaged ? (portable ?? process.execPath) : process.execPath
    const args = app.isPackaged ? '' : `"${app.getAppPath()}"`
    const devIcon = join(app.getAppPath(), 'build', 'icon.ico')
    const icon = app.isPackaged ? target : existsSync(devIcon) ? devIcon : target
    const details = { target, args, icon, iconIndex: 0, appUserModelId: APP_USER_MODEL_ID, description: 'PoE4Dummies II' }
    const current = existsSync(shortcut) ? safeRead(shortcut) : null
    if (current && current.target === target && current.args === args && current.icon === icon && current.appUserModelId === APP_USER_MODEL_ID) return
    shell.writeShortcutLink(shortcut, current ? 'replace' : 'create', details)
  } catch {
    // Sem permissão no Menu Iniciar: a janela continua com o ícone próprio.
  }
}

function safeRead(path: string): Electron.ShortcutDetails | null {
  try {
    return shell.readShortcutLink(path)
  } catch {
    return null
  }
}
