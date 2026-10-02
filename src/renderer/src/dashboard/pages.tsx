import { useEffect, useMemo, useState } from 'react'
import { topMovers } from '../../../core/market/analysis'
import { performance, watchKey } from '../../../core/market/watchlist'
import { fromDivine } from '../../../core/money'
import { currentHotkeys } from '../../../core/hotkeys'
import type { Settings } from '../../../core/settings'
import type { HotkeyStatus } from '../../../shared/ipc'
import { HotkeyField } from '../components/HotkeyField'
import type { MarketItem } from '../../../core/types'
import { ItemIcon } from '../components/ItemIcon'
import { LeagueSelect } from '../components/LeagueSelect'
import { changeClass, EmptyState, Hint, TableSkeleton } from '../components/ui'
import { api, useApp } from '../lib/app'
import { buildRows } from '../lib/market'
import { useItemDrawer } from './ItemDrawer'
import { CaretUp, CaretDown, Star } from '@phosphor-icons/react'

export function OpportunitiesPage() {
  const { t, market, unit, price, percent, locale } = useApp()
  const { openItem } = useItemDrawer()
  const rows = useMemo(() => (market.snapshot ? buildRows(market.snapshot, unit) : []), [market.snapshot, unit])
  const changeOf = useMemo(() => new Map(rows.map((r) => [r.item, r.change])), [rows])
  const movers = useMemo(() => topMovers(rows.map((r) => r.item), (i) => changeOf.get(i) ?? null), [rows, changeOf])
  // Número inteiro (sem "mil"): o usuário prefere ver o valor cheio.
  const compact = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale])

  if (!market.snapshot) return <TableSkeleton label={t('market.loading')} />

  const list = (title: React.ReactNode, items: MarketItem[], mode: 'change' | 'volume') => (
    <div className="card">
      <h3>{title}</h3>
      {items.length === 0 && <p className="muted">{t('opp.none')}</p>}
      {items.map((item) => {
        const key = `${item.category}:${item.id}`
        const change = changeOf.get(item) ?? null
        return (
          <button type="button" className="mover" key={key} onClick={() => openItem(key)}>
            <ItemIcon url={item.iconUrl} name={item.name} />
            <span className="name">
              <span className="n">{item.name}</span>
              <small className="muted">{t(`cat.${item.category}` as never)}</small>
            </span>
            <span className="num">{price(item.valueDivine)}</span>
            {mode === 'change' ? (
              <span className={`num ${changeClass(change)}`} style={{ minWidth: 64, textAlign: 'right' }}>
                {percent(change)}
              </span>
            ) : (
              <span className="num muted" style={{ minWidth: 72, textAlign: 'right' }}>
                {compact.format(item.volumeDivine)}/{t('opp.perDay')}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  return (
    <>
      <h2 className="page-title">{t('opp.title')}</h2>
      <div className="cols3">
        {list(<><CaretUp className="ico up" size={12} weight="fill" aria-hidden="true" /> {t('opp.risers')}</>, movers.risers, 'change')}
        {list(<><CaretDown className="ico down" size={12} weight="fill" aria-hidden="true" /> {t('opp.fallers')}</>, movers.fallers, 'change')}
        {list(t('opp.traded'), movers.mostTraded, 'volume')}
      </div>
    </>
  )
}

export function WatchlistPage({ onGoMarket }: { onGoMarket: () => void }) {
  const { t, market, unit, unitLabel, settings, price, percent, amount, locale } = useApp()
  const { openItem } = useItemDrawer()
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const snapshot = market.snapshot
  const items = useMemo(() => new Map((snapshot?.items ?? []).map((i) => [`${i.category}:${i.id}`, i])), [snapshot])

  return (
    <>
      <h2 className="page-title">{t('watch.title')}</h2>
      {settings.watchlist.length === 0 ? (
        <EmptyState
          icon="☆"
          title={t('watch.emptyTitle')}
          text={t('watch.empty')}
          action={
            <button className="btn primary" type="button" onClick={onGoMarket}>
              {t('watch.goMarket')}
            </button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th aria-hidden="true" />
                <th>{t('market.col.item')}</th>
                <th>{t('watch.col.since')}</th>
                <th className="r">{t('watch.col.then')}</th>
                <th className="r">{t('watch.col.now')}</th>
                <th className="r">{t('watch.col.result')}</th>
                <th className="r">
                  {t('watch.col.alert')} <Hint text={t('watch.hint.alert')} align="right" />
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settings.watchlist.map((w) => {
                const key = watchKey(w)
                const item = items.get(key)
                const result = item && snapshot ? performance(w, item, unit, snapshot.rates) : null
                // Preço ao adicionar, na moeda de exibição, com a cotação daquele dia.
                const then = fromDivine(w.baselineDivine, unit, {
                  exaltedPerDivine: w.baselineExaltedPerDivine,
                  chaosPerDivine: w.baselineChaosPerDivine,
                })
                return (
                  <tr
                    key={key}
                    className={item ? 'clickable' : ''}
                    tabIndex={item ? 0 : undefined}
                    onClick={() => item && openItem(key)}
                    onKeyDown={(e) => {
                      if (item && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        openItem(key)
                      }
                    }}
                  >
                    <td>
                      <span className="star on" aria-hidden="true">
                        <Star className="ico" size={15} weight="fill" aria-hidden="true" />
                      </span>
                    </td>
                    <td>
                      <span className="item-cell">
                        <ItemIcon url={item?.iconUrl ?? null} name={w.name} />
                        {w.name}
                      </span>
                    </td>
                    <td className="num">{new Date(w.addedAt).toLocaleDateString(locale)}</td>
                    <td className="r num">
                      {amount(then)} {unitLabel}
                    </td>
                    <td className="r num">{item ? price(item.valueDivine) : <span className="muted">{t('watch.missing')}</span>}</td>
                    <td className={`r num ${changeClass(result)}`}>{percent(result)}</td>
                    <td className="r" onClick={(e) => e.stopPropagation()}>
                      <input
                        className="input num"
                        style={{ width: 76, textAlign: 'right' }}
                        type="number"
                        min={1}
                        max={1000}
                        defaultValue={w.alertPercent}
                        aria-label={t('watch.col.alert')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                        onBlur={(e) => {
                          const v = Number(e.target.value)
                          if (Number.isFinite(v) && v >= 1 && v <= 1000 && v !== w.alertPercent) {
                            void api.setWatchAlert({ category: w.category, itemId: w.itemId, alertPercent: v }).then(() => {
                              setSavedKey(key)
                              setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1500)
                            })
                          }
                        }}
                      />
                      {savedKey === key && (
                        <span className="up" aria-live="polite">
                          {' '}
                          ✓
                        </span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className={`btn small ${confirmKey === key ? 'danger' : ''}`}
                        type="button"
                        onClick={() => {
                          if (confirmKey === key) {
                            void api.toggleWatch({ category: w.category, itemId: w.itemId })
                            setConfirmKey(null)
                          } else {
                            setConfirmKey(key)
                            setTimeout(() => setConfirmKey((k) => (k === key ? null : k)), 3000)
                          }
                        }}
                      >
                        {confirmKey === key ? t('watch.confirm') : t('watch.remove')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export function SettingsPage() {
  const { t, settings, updateSettings } = useApp()
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus | null>(null)
  const hotkeys = currentHotkeys(settings)

  // Se o Windows recusou algum atalho (ex.: outro programa já usa), o campo mostra o aviso.
  useEffect(() => {
    api.hotkeyStatus().then(setHotkeyStatus).catch(() => setHotkeyStatus(null))
  }, [settings])

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 1600)
  }

  const save = async (patch: Parameters<typeof updateSettings>[0]) => {
    try {
      await updateSettings(patch)
      showToast(true, t('settings.saved'))
    } catch {
      showToast(false, t('settings.invalid'))
    }
  }

  const onHotkeySaved = () => showToast(true, t('settings.saved'))

  const overlay = settings.overlay

  return (
    <>
      <h2 className="page-title">{t('settings.title')}</h2>
      <div className="form">
        <fieldset>
          <legend>{t('settings.group.general')}</legend>
          <label className="field">
            <span>{t('settings.language')}</span>
            <select className="select" value={settings.language} onChange={(e) => void save({ language: e.target.value as Settings['language'] })}>
              <option value="pt-BR">Português (Brasil)</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="field">
            <span>{t('settings.league')}</span>
            <LeagueSelect onPick={(league) => void save({ league })} />
          </label>
          <label className="field">
            <span>{t('settings.currency')}</span>
            <select className="select" value={settings.displayCurrency} onChange={(e) => void save({ displayCurrency: e.target.value as Settings['displayCurrency'] })}>
              <option value="exalted">Exalted Orb</option>
              <option value="divine">Divine Orb</option>
              <option value="chaos">Chaos Orb</option>
            </select>
          </label>
          <label className="field">
            <span>{t('settings.refresh')}</span>
            <select className="select" value={settings.refreshMinutes} onChange={(e) => void save({ refreshMinutes: Number(e.target.value) })}>
              {[5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {t('settings.minutes', { n: m })}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('settings.closeAction')}</span>
            {/* Escolha feita aqui não expira (só o "Não perguntar por 15 dias" da janela de fechar expira). */}
            <select
              className="select"
              value={settings.closeAction}
              onChange={(e) => void save({ closeAction: e.target.value as Settings['closeAction'], closeActionRememberedAt: null })}
            >
              <option value="ask">{t('settings.closeAction.ask')}</option>
              <option value="tray">{t('settings.closeAction.tray')}</option>
              <option value="quit">{t('settings.closeAction.quit')}</option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>{t('settings.group.alerts')}</legend>
          <label className="field row">
            <input type="checkbox" checked={settings.notifications} onChange={(e) => void save({ notifications: e.target.checked })} />
            <span>{t('settings.notifications')}</span>
          </label>
          <label className="field row">
            <input type="checkbox" checked={settings.tracker.enabled} onChange={(e) => void save({ tracker: { ...settings.tracker, enabled: e.target.checked } })} />
            <span>{t('settings.trackerEnabled')}</span>
          </label>
        </fieldset>

        <fieldset>
          <legend>{t('settings.group.hotkeys')}</legend>
          <small className="muted">{t('settings.hotkeyHint')}</small>
          <HotkeyField slot="dashboard" value={settings.dashboardHotkey} current={hotkeys} registered={hotkeyStatus?.dashboard.registered ?? true} onSaved={onHotkeySaved} />
          <HotkeyField slot="collection" value={settings.collectionHotkey} current={hotkeys} registered={hotkeyStatus?.collection.registered ?? true} onSaved={onHotkeySaved} />
          <HotkeyField slot="collectionAdd" value={settings.collectionAddHotkey} current={hotkeys} registered={hotkeyStatus?.collectionAdd.registered ?? true} hint={t('settings.collectionAddHint')} onSaved={onHotkeySaved} />
        </fieldset>

        <fieldset>
          <legend>{t('settings.overlay')}</legend>
          <div className="banner info">{t('settings.gameMode')}</div>
          <HotkeyField
            slot="overlay"
            value={overlay.hotkey}
            current={hotkeys}
            registered={hotkeyStatus?.overlay.registered ?? true}
            hint={t('settings.overlayHotkeyHint')}
            extraWarning={overlay.hotkey !== null && overlay.clipboardTrigger ? t('hotkey.warn.clipboard') : null}
            onSaved={onHotkeySaved}
          />
          {overlay.hotkey !== null && (
            <label className="field">
              <span>{t('settings.copyMode')}</span>
              <select className="select" value={overlay.copyMode} onChange={(e) => void save({ overlay: { copyMode: e.target.value as Settings['overlay']['copyMode'] } })}>
                <option value="simple">{t('settings.copyMode.simple')}</option>
                <option value="advanced">{t('settings.copyMode.advanced')}</option>
              </select>
            </label>
          )}
          <label className="field row">
            <input type="checkbox" checked={overlay.enabled} onChange={(e) => void save({ overlay: { enabled: e.target.checked } })} />
            <span>{t('settings.overlayEnabled')}</span>
          </label>
          <label className="field row">
            <input type="checkbox" checked={overlay.clipboardTrigger} onChange={(e) => void save({ overlay: { clipboardTrigger: e.target.checked } })} />
            <span>{t('settings.clipboard')}</span>
          </label>
          <label className="field row">
            <input type="checkbox" checked={overlay.requireGameFocus} onChange={(e) => void save({ overlay: { requireGameFocus: e.target.checked } })} />
            <span>{t('settings.requireGameFocus')}</span>
          </label>
          <label className="field">
            <span>{t('settings.minMod')}</span>
            <select className="select" value={overlay.minModPercent} onChange={(e) => void save({ overlay: { minModPercent: Number(e.target.value) } })}>
              {[70, 80, 85, 90, 95, 100].map((p) => (
                <option key={p} value={p}>
                  {p}%
                </option>
              ))}
            </select>
            <small>{t('settings.minModHint')}</small>
          </label>
          <label className="field">
            <span>{t('settings.status')}</span>
            <select className="select" value={overlay.listingStatus} onChange={(e) => void save({ overlay: { listingStatus: e.target.value as Settings['overlay']['listingStatus'] } })}>
              <option value="online">{t('settings.status.online')}</option>
              <option value="securable">{t('settings.status.securable')}</option>
              <option value="any">{t('settings.status.any')}</option>
            </select>
          </label>
        </fieldset>
      </div>
      {toast && (
        <div className="toast" role="status" style={toast.ok ? undefined : { background: 'var(--down-soft)', color: 'var(--down)', borderColor: 'var(--down)' }}>
          {toast.ok ? '✓' : '!'} {toast.text}
        </div>
      )}
    </>
  )
}
