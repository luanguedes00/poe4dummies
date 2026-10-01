// Páginas que conectam os componentes "puros" (recebem tudo por props) à API
// do processo principal.

import { useEffect, useState } from 'react'
import type { CollectionView } from '../../../core/collection/collection'
import type { TrackerPayload } from '../../../shared/ipc'
import { sessionProfit } from '../../../core/farm/session'
import { CollectionPanel } from '../components/CollectionPanel'
import { Hint } from '../components/ui'
import { api, useApp } from '../lib/app'
import { formatDuration, TrackerPage } from './TrackerPage'

export function TrackerRoute() {
  const { t, locale } = useApp()
  const [data, setData] = useState<TrackerPayload | null>(null)
  useEffect(() => {
    void api.getTracker().then(setData)
    return api.onTracker(setData)
  }, [])
  return (
    <TrackerPage
      t={t}
      locale={locale}
      snapshot={data?.snapshot ?? null}
      sessions={data?.sessions ?? []}
      status={data?.status ?? { state: 'searching', path: null, lastLineAt: null, error: null }}
      onChooseFile={() => void api.chooseLogFile().then(setData)}
      onUseAutomatic={() => void api.setLogPath(null).then(setData)}
      onReload={() => void api.reloadTracker().then(setData)}
    />
  )
}

/** Loot da lista + tempo/mapas do tracker = loot por mapa e por hora. */
function SessionCard({ view, tracker }: { view: CollectionView; tracker: TrackerPayload | null }) {
  const { t, price } = useApp()
  const session = tracker?.snapshot.session ?? null
  const r = sessionProfit({ lootDivine: view.total.divine, maps: session?.maps ?? 0, totalMs: session?.totalMs ?? 0 })
  return (
    <div className="card session-card">
      <span className="label">
        {t('session.title')} <Hint text={t('session.hint')} />
      </span>
      <dl className="stats session-stats">
        <div>
          <dt>{t('session.loot')}</dt>
          <dd>{price(view.total.divine)}</dd>
        </div>
        <div>
          <dt>{t('session.maps')}</dt>
          <dd>{session ? session.maps : '–'}</dd>
        </div>
        <div>
          <dt>{t('session.time')}</dt>
          <dd>{session ? formatDuration(session.totalMs) : '–'}</dd>
        </div>
        <div>
          <dt>{t('session.perMap')}</dt>
          <dd>{r.lootPerMap === null ? '–' : price(r.lootPerMap)}</dd>
        </div>
        <div>
          <dt>{t('session.perHour')}</dt>
          <dd className="up">{r.lootPerHour === null ? '–' : price(r.lootPerHour)}</dd>
        </div>
      </dl>
      {!session && <p className="fine">{t('session.noTracker')}</p>}
    </div>
  )
}

export function CollectionRoute() {
  const { t, price, amount, settings } = useApp()
  const [view, setView] = useState<CollectionView | null>(null)
  const [tracker, setTracker] = useState<TrackerPayload | null>(null)
  useEffect(() => {
    void api.getCollection().then(setView)
    void api.getTracker().then(setTracker)
    const off1 = api.onCollection(setView)
    const off2 = api.onTracker(setTracker)
    return () => {
      off1()
      off2()
    }
  }, [])
  if (!view) return null
  return (
    <>
    <h2 className="page-title">{t('nav.collection')}</h2>
    <SessionCard view={view} tracker={tracker} />
    <div className="card pc collection-page">
      <CollectionPanel
        view={view}
        t={t}
        price={price}
        amount={amount}
        onRemove={(id) => void api.removeFromCollection(id)}
        onClear={() => void api.clearCollection()}
        onToggle={() => void api.toggleCollection()}
        onAcknowledge={() => void api.acknowledgeCollection()}
        addKey={settings.collectionAddHotkey}
      />
    </div>
    </>
  )
}
