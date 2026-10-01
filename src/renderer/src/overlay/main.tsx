import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CollectionView } from '../../../core/collection/collection'
import type { PriceCheckResult } from '../../../core/pricecheck'
import type { FilterOverride } from '../../../core/trade/query'
import { CollectionPanel } from '../components/CollectionPanel'
import { PriceCheckView, type ResearchExtra } from '../components/PriceCheckView'
import { api, AppProvider, useApp } from '../lib/app'
import '../fonts'
import '../styles.css'

function OverlayApp() {
  const { t, price, amount, settings } = useApp()
  const [text, setText] = useState('')
  const [result, setResult] = useState<PriceCheckResult | null>(null)
  const [loading, setLoading] = useState(false)
  // Quando o modo lista manda uma atualização, a sobreposição mostra a lista.
  const [collection, setCollection] = useState<CollectionView | null>(null)

  useEffect(
    () =>
      api.onOverlay((event) => {
        if (event.state === 'collection') {
          setCollection(event.view)
          return
        }
        setCollection(null)
        setText(event.text)
        if (event.state === 'loading') {
          setLoading(true)
          setResult(null)
        } else {
          setLoading(false)
          setResult(event.result)
        }
      }),
    [],
  )
  // Mantém a lista viva enquanto está na tela (ex.: preço confirmado pela fila).
  useEffect(() => api.onCollection((view) => setCollection((current) => (current ? view : current))), [])

  const close = useCallback(() => void api.hideOverlay(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const research = async (overrides: FilterOverride[], extra: ResearchExtra) => {
    setLoading(true)
    try {
      setResult(await api.priceCheck({ text, overrides, siteFilters: extra.siteFilters, status: extra.status }))
    } finally {
      setLoading(false)
    }
  }

  if (collection) {
    return (
      <div className="overlay-root collection">
        <CollectionPanel
          view={collection}
          t={t}
          price={price}
          amount={amount}
          onRemove={(id) => void api.removeFromCollection(id)}
          onClear={() => void api.clearCollection()}
          onToggle={() => void api.toggleCollection()}
          onAcknowledge={() => void api.acknowledgeCollection()}
          onClose={close}
          addKey={settings.collectionAddHotkey}
        />
      </div>
    )
  }

  return (
    <div className="overlay-root">
      {/* Sem botão de fechar: some ao clicar fora, com Esc ou trocando de programa (processo principal). */}
      <PriceCheckView text={text} result={result} loading={loading} onResearch={(o, extra) => void research(o, extra)} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <OverlayApp />
    </AppProvider>
  </StrictMode>,
)
