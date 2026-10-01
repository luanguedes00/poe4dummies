// Menu do botão direito: recortar/copiar/colar em campos de texto e copiar
// texto selecionado. Útil para quem não usa atalho de teclado.

import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { Language } from '../core/settings'
import { translator } from '../shared/i18n'

export function installContextMenu(language: () => Language): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('context-menu', (_e, params) => {
      const t = translator(language())
      const items: MenuItemConstructorOptions[] = []
      if (params.isEditable) {
        items.push(
          { role: 'cut', label: t('menu.cut'), enabled: params.editFlags.canCut },
          { role: 'copy', label: t('menu.copy'), enabled: params.editFlags.canCopy },
          { role: 'paste', label: t('menu.paste'), enabled: params.editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll', label: t('menu.selectAll'), enabled: params.editFlags.canSelectAll },
        )
      } else if (params.selectionText.trim()) {
        items.push({ role: 'copy', label: t('menu.copy') })
      }
      if (items.length > 0) Menu.buildFromTemplate(items).popup()
    })
  })
}
