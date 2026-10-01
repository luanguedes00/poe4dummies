// Painel do modo lista. Componente puro: recebe o estado pronto (vindo do
// processo principal) e callbacks; não fala com `window.oraculo`, então
// serve tanto na sobreposição quanto no painel principal.

import type { CollectionEntry, CollectionView } from '../../../core/collection/collection'
import { ItemIcon } from './ItemIcon'

/** Chaves de texto usadas aqui (todas precisam existir em src/shared/i18n.ts). */
export type CollectionMessageKey =
  | 'collection.title'
  | 'collection.on'
  | 'collection.off'
  | 'collection.turnOn'
  | 'collection.turnOff'
  | 'collection.total'
  | 'collection.items'
  | 'collection.queue'
  | 'collection.queueIdle'
  | 'collection.queueEta'
  | 'collection.eta.seconds'
  | 'collection.eta.minutes'
  | 'collection.empty'
  | 'collection.clear'
  | 'collection.remove'
  | 'collection.changedNote'
  | 'collection.ack'
  | 'collection.status.market'
  | 'collection.status.cache'
  | 'collection.status.trade'
  | 'collection.status.estimated'
  | 'collection.status.queued'
  | 'collection.status.next'
  | 'collection.status.searching'
  | 'collection.status.changed'
  | 'collection.status.error'
  | 'collection.error.no-listings'
  | 'pc.close'
  | 'error.not-an-item'
  | 'error.missing-name'
  | 'error.unknown-base-type'
  | 'error.network'
  | 'error.timeout'
  | 'error.rate-limited'
  | 'error.http'
  | 'error.invalid-response'
  | 'error.unexpected'

export type CollectionTranslate = (key: CollectionMessageKey, params?: Record<string, string | number>) => string

interface Props {
  view: CollectionView
  t: CollectionTranslate
  /** Valor em Divine → texto na moeda de exibição (ex.: `useApp().price`). */
  price: (valueDivine: number) => string
  amount: (value: number) => string
  onRemove: (id: string) => void
  onClear: () => void
  onToggle?: () => void
  onAcknowledge?: () => void
  onClose?: () => void
}

const ERROR_KEYS: ReadonlySet<string> = new Set([
  'not-an-item', 'missing-name', 'unknown-base-type', 'network', 'timeout', 'rate-limited', 'http', 'invalid-response',
])

function errorText(entry: CollectionEntry, t: CollectionTranslate): string {
  if (entry.errorCode === 'no-listings') return t('collection.error.no-listings')
  const code = entry.errorCode && ERROR_KEYS.has(entry.errorCode) ? entry.errorCode : 'unexpected'
  return t(`error.${code}` as CollectionMessageKey, { seconds: 60 })
}

function etaText(seconds: number, t: CollectionTranslate): string {
  return seconds < 90 ? t('collection.eta.seconds', { n: Math.max(1, seconds) }) : t('collection.eta.minutes', { n: Math.ceil(seconds / 60) })
}

function signedPercent(value: number): string {
  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

export function CollectionPanel({ view, t, price, amount, onRemove, onClear, onToggle, onAcknowledge, onClose }: Props) {
  const { entries, total, progress, positions } = view
  // Mais recentes primeiro: o item que acabou de entrar aparece no topo.
  const rows = [...entries].reverse()

  const valueCell = (e: CollectionEntry) => {
    if (e.status === 'error' || e.unitDivine === null) return <span className="num muted">–</span>
    const text = price(e.unitDivine * e.quantity)
    if (e.status === 'estimated') return <span className="num muted">≈ {text}</span>
    if (e.status === 'changed') {
      return <span className={`num ${e.changePercent !== null && e.changePercent < 0 ? 'down' : 'up'}`}>{text}</span>
    }
    return <span className="num">{text}</span>
  }

  const statusText = (e: CollectionEntry): { text: string; cls: string } => {
    switch (e.status) {
      case 'priced':
        return { text: t(`collection.status.${e.source ?? 'trade'}`), cls: 'muted' }
      case 'estimated':
        return { text: t('collection.status.estimated'), cls: 'muted' }
      case 'queued': {
        const pos = positions[e.searchKey]
        return { text: pos ? t('collection.status.queued', { n: pos }) : t('collection.status.next'), cls: 'muted' }
      }
      case 'searching':
        return { text: t('collection.status.searching'), cls: 'muted' }
      case 'changed':
        return { text: t('collection.status.changed', { pct: signedPercent(e.changePercent ?? 0) }), cls: (e.changePercent ?? 0) < 0 ? 'down' : 'up' }
      case 'error':
        return { text: e.errorCode === 'no-listings' ? t('collection.error.no-listings') : t('collection.status.error'), cls: 'down' }
    }
  }

  return (
    <div className="pc collection">
      <div className="pc-head drag">
        <div>
          <b>{t('collection.title')}</b>
          <small className="muted">{view.enabled ? t('collection.on') : t('collection.off')}</small>
        </div>
        {onClose && (
          <button className="btn small" type="button" onClick={onClose} title={t('pc.close')} aria-label={t('pc.close')}>
            ✕
          </button>
        )}
      </div>

      <div className="pc-sum">
        <div>
          <span className="label">{t('collection.total')}</span>
          <b>
            {total.approximate && total.divine > 0 ? '≈ ' : ''}
            {price(total.divine)}
          </b>
        </div>
        <div>
          <span className="label">{t('collection.items')}</span>
          <b>{amount(total.quantity)}</b>
        </div>
        <div>
          <span className="label">{t('collection.queue')}</span>
          <b>
            {progress.pending > 0
              ? t('collection.queueEta', { n: progress.pending, eta: etaText(progress.etaSeconds, t) })
              : t('collection.queueIdle')}
          </b>
        </div>
      </div>

      {total.changed > 0 && (
        <div className="pc-note">
          {t('collection.changedNote', { n: total.changed })}{' '}
          {onAcknowledge && (
            <button className="btn small" type="button" onClick={onAcknowledge}>
              {t('collection.ack')}
            </button>
          )}
        </div>
      )}

      <div className="listings">
        {rows.length === 0 && <div className="pc-note">{t('collection.empty')}</div>}
        {rows.map((e) => {
          const status = statusText(e)
          const title = [e.name, e.baseType, e.status === 'error' ? errorText(e, t) : null].filter(Boolean).join(' · ')
          return (
            <div className="lrow" key={e.id} title={title}>
              {valueCell(e)}
              <span className="who">
                <span className="item-cell">
                  <ItemIcon url={e.iconUrl} name={e.name} />
                  <span>
                    {e.quantity > 1 && <span className="num">{amount(e.quantity)}× </span>}
                    <span className={e.rarity === 'Unique' ? 'unique' : e.rarity === 'Rare' ? 'rare' : ''}>{e.name}</span>
                    <small className={status.cls}> · {status.text}</small>
                  </span>
                </span>
              </span>
              <button
                className="btn small ghost"
                type="button"
                onClick={() => onRemove(e.id)}
                title={t('collection.remove')}
                aria-label={`${t('collection.remove')}: ${e.name}`}
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>

      <div className="pc-foot">
        {onToggle && (
          <button className={`btn ${view.enabled ? '' : 'primary'}`} type="button" onClick={onToggle}>
            {view.enabled ? t('collection.turnOff') : t('collection.turnOn')}
          </button>
        )}
        <button className="btn ghost" type="button" onClick={onClear} disabled={rows.length === 0}>
          {t('collection.clear')}
        </button>
      </div>
    </div>
  )
}
