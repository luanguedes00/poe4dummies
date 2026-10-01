// Janela própria do quadro da campanha (separada da sobreposição de preço):
// nome da área + selo de nível, e o que não pode perder ali. A barra tem
// minimizar, fixar (não move nem redimensiona), configurações (abre o app na
// aba Campanha) e fechar. A altura acompanha o conteúdo.

import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CampaignEvent, CampaignUi } from '../../../shared/ipc'
import { ZoneCard } from '../components/ZoneCard'
import { api, AppProvider, useApp } from '../lib/app'
import '../fonts'
import '../styles.css'

function CampaignApp() {
  const { t } = useApp()
  const [event, setEvent] = useState<CampaignEvent | null>(null)
  const [ui, setUi] = useState<CampaignUi>({ pinned: false, collapsed: false })
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Ao abrir, pergunta a área atual (a mensagem pode ter chegado antes da página ficar pronta).
    void api.getCampaign().then((current) => setEvent((e) => e ?? current))
    void api.campaignUi().then(setUi)
    return api.onCampaign(setEvent)
  }, [])

  // A janela acompanha a altura do conteúdo (mais texto, janela maior).
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const fit = () => void api.campaignFit(Math.ceil(el.scrollHeight) + 2)
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [event, ui.collapsed])

  const change = (next: Partial<CampaignUi>) => void api.campaignUi(next).then(setUi)
  if (!event) return null

  const controls = (
    <span className="zone-controls">
      <button type="button" onClick={() => change({ collapsed: !ui.collapsed })} title={t(ui.collapsed ? 'zone.expand' : 'zone.collapse')} aria-label={t(ui.collapsed ? 'zone.expand' : 'zone.collapse')}>
        {ui.collapsed ? '▸' : '▾'}
      </button>
      <button type="button" className={ui.pinned ? 'on' : ''} onClick={() => change({ pinned: !ui.pinned })} title={t(ui.pinned ? 'zone.unpin' : 'zone.pin')} aria-label={t(ui.pinned ? 'zone.unpin' : 'zone.pin')} aria-pressed={ui.pinned}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M10 1.5 14.5 6l-2 .6-2.4 2.4.4 3.5-1 1-2.8-2.8L3 14.4 1.6 13l3.7-3.7L2.5 6.5l1-1 3.5.4L9.4 3.5Z" fill="currentColor" />
        </svg>
      </button>
      <button type="button" onClick={() => void api.openApp('tracker')} title={t('zone.settings')} aria-label={t('zone.settings')}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M8 5.2A2.8 2.8 0 1 0 8 10.8 2.8 2.8 0 0 0 8 5.2Zm6.3 3.7V7.1l-1.7-.4a4.9 4.9 0 0 0-.5-1.2l.9-1.5-1.3-1.3-1.5.9a4.9 4.9 0 0 0-1.2-.5L8.9 1.7H7.1l-.4 1.7c-.4.1-.8.3-1.2.5L4 3 2.7 4.3l.9 1.5c-.2.4-.4.8-.5 1.2l-1.7.4v1.8l1.7.4c.1.4.3.8.5 1.2l-.9 1.5L4 13.6l1.5-.9c.4.2.8.4 1.2.5l.4 1.7h1.8l.4-1.7c.4-.1.8-.3 1.2-.5l1.5.9 1.3-1.3-.9-1.5c.2-.4.4-.8.5-1.2Z" fill="currentColor" />
        </svg>
      </button>
      <button type="button" onClick={() => void api.hideCampaign()} title={t('pc.close')} aria-label={t('pc.close')}>
        ✕
      </button>
    </span>
  )

  return (
    <div ref={rootRef} className={`campaign-root ${ui.pinned ? 'pinned' : ''} ${ui.collapsed ? 'collapsed' : ''}`}>
      <ZoneCard
        area={event.area}
        zone={event.zone}
        act={event.act}
        areaLevel={event.areaLevel}
        charLevel={event.charLevel}
        gap={event.gap}
        controls={controls}
        collapsed={ui.collapsed}
        draggable={!ui.pinned}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <CampaignApp />
    </AppProvider>
  </StrictMode>,
)
