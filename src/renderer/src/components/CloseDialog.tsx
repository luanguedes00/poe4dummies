// Pergunta ao fechar a janela: continuar na bandeja ou fechar o app. No estilo
// do app (a caixa padrão do Windows destoava). O processo principal pede pelo
// evento `closeAsk` e recebe a resposta por `api.answerClose`.

import { useEffect, useRef, useState } from 'react'
import divineIcon from '../../../../build/divine.png'
import { api, useApp } from '../lib/app'
import './CloseDialog.css'

export function CloseDialog() {
  const { t } = useApp()
  const [open, setOpen] = useState(false)
  const [remember, setRemember] = useState(false)
  const primary = useRef<HTMLButtonElement>(null)

  useEffect(
    () =>
      api.onCloseAsk(() => {
        setRemember(false)
        setOpen(true)
      }),
    [],
  )
  useEffect(() => {
    if (open) primary.current?.focus()
  }, [open])

  if (!open) return null
  const answer = (choice: 'tray' | 'quit' | 'cancel') => {
    setOpen(false)
    void api.answerClose({ choice, remember: choice !== 'cancel' && remember })
  }

  return (
    <div className="close-backdrop" onMouseDown={(e) => e.target === e.currentTarget && answer('cancel')}>
      <div
        className="close-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') answer('cancel')
        }}
      >
        <div className="close-head">
          <img src={divineIcon} alt="" className="close-icon" />
          <h3 id="close-title">{t('close.message')}</h3>
        </div>
        <p className="close-detail">{t('close.detail')}</p>
        <label className="close-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>{t('close.remember')}</span>
        </label>
        <div className="close-actions">
          <button type="button" className="btn ghost" onClick={() => answer('cancel')}>
            {t('close.cancel')}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => answer('quit')}>
            {t('close.quit')}
          </button>
          <button ref={primary} type="button" className="btn primary" onClick={() => answer('tray')}>
            {t('close.tray')}
          </button>
        </div>
      </div>
    </div>
  )
}
