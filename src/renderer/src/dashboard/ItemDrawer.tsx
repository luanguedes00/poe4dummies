// Detalhe de um item em painel lateral: abre por cima de qualquer tela, com
// "← Voltar" sempre visível, Esc e clique fora para fechar.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { analyzeHistory } from '../../../core/market/analysis'
import { watchKey } from '../../../core/market/watchlist'
import { isNinjaCategory } from '../../../core/categories'
import type { PriceHistory } from '../../../core/types'
import { PriceChart, type ChartPoint } from '../components/charts'
import { ItemIcon } from '../components/ItemIcon'
import { changeClass, Hint } from '../components/ui'
import { api, useApp } from '../lib/app'
import { buildRows, type MarketRow } from '../lib/market'
import { Star, ArrowSquareOut, CaretUp, CaretDown } from '@phosphor-icons/react'

const UNIT_NAMES: Record<string, string> = { exalted: 'Exalted', divine: 'Divine', chaos: 'Chaos' }

interface DrawerApi {
  openItem: (key: string) => void
  openKey: string | null
}

const DrawerContext = createContext<DrawerApi>({ openItem: () => undefined, openKey: null })

export function useItemDrawer(): DrawerApi {
  return useContext(DrawerContext)
}

/** Guarda qual item está aberto e desenha o painel por cima da tela atual. */
export function ItemDrawerProvider({ children }: { children: ReactNode }) {
  const { market, unit } = useApp()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const rows = useMemo(() => (market.snapshot ? buildRows(market.snapshot, unit) : []), [market.snapshot, unit])
  const row = openKey ? rows.find((r) => `${r.item.category}:${r.item.id}` === openKey) : undefined
  const value = useMemo(() => ({ openItem: setOpenKey, openKey }), [openKey])

  return (
    <DrawerContext.Provider value={value}>
      {children}
      {row && <ItemDrawer row={row} onClose={() => setOpenKey(null)} />}
    </DrawerContext.Provider>
  )
}

function ItemDrawer({ row, onClose }: { row: MarketRow; onClose: () => void }) {
  const { t, amount, percent, price, market, settings } = useApp()
  const [history, setHistory] = useState<PriceHistory | null>(null)
  const [failed, setFailed] = useState(false)
  const backRef = useRef<HTMLButtonElement>(null)
  const { item } = row
  const watched = settings.watchlist.some((w) => watchKey(w) === `${item.category}:${item.id}`)

  useEffect(() => {
    backRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    setHistory(null)
    setFailed(false)
    if (!isNinjaCategory(item.category)) return
    api
      .getHistory({ category: item.category, detailsId: item.detailsId })
      .then((h) => alive && setHistory(h))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [item.category, item.detailsId])

  const analysis = useMemo(
    () => (history ? analyzeHistory(history.points.map((p) => p.value), history.points.map((p) => p.volumeDivine)) : null),
    [history],
  )
  const points: ChartPoint[] = useMemo(() => {
    if (!history || !analysis) return []
    return history.points.map((p, i) => ({
      date: p.timestamp,
      price: p.value,
      volume: p.volumeDivine,
      sma7: analysis.sma7[i] ?? null,
      sma20: analysis.sma20[i] ?? null,
    }))
  }, [history, analysis])
  const unitName = history ? (UNIT_NAMES[history.unit] ?? history.unit) : ''

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={item.name}>
        <div className="drawer-head">
          <button ref={backRef} className="btn" type="button" onClick={onClose}>
            ← {t('detail.back')}
          </button>
          <ItemIcon url={item.iconUrl} name={item.name} />
          <h3>{item.name}</h3>
          <button
            type="button"
            className={`btn ${watched ? '' : 'ghost'}`}
            aria-pressed={watched}
            onClick={() => isNinjaCategory(item.category) && void api.toggleWatch({ category: item.category, itemId: item.id })}
          >
            {watched ? <><Star className="ico" size={14} weight="fill" aria-hidden="true" /> {t('market.unwatch')}</> : <><Star className="ico" size={14} aria-hidden="true" /> {t('market.watch')}</>}
          </button>
          {market.league && (
            <button className="btn ghost" type="button" onClick={() => void api.openExternal({ kind: 'ninja', league: market.league! })}>
              poe.ninja <ArrowSquareOut className="ico" size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="drawer-body">
          <div className="detail-top">
            <span className="price-big">{price(item.valueDivine)}</span>
            <span className={`num ${changeClass(row.change)}`}>{t('detail.week', { value: percent(row.change) })}</span>
            {analysis && <span className={`num ${changeClass(analysis.change1d)}`}>{t('detail.today', { value: percent(analysis.change1d) })}</span>}
          </div>

          {!history && !failed && <div className="skeleton" style={{ height: 320 }} role="status" aria-label={t('detail.loading')} />}
          {(failed || (history && !analysis)) && <div className="banner info">{t('detail.noHistory')}</div>}

          {analysis && (
            <div className="detail">
              <div className="card">
                <PriceChart points={points} format={(v) => amount(v)} unit={unitName} />
                <div className="legend">
                  <span>
                    <i style={{ background: 'var(--gold)' }} />
                    {t('detail.legend.price', { unit: unitName })}
                  </span>
                  <span>
                    <i style={{ background: 'var(--prefix)' }} />
                    {t('detail.legend.sma7')}
                  </span>
                  <span>
                    <i style={{ background: 'var(--suffix)' }} />
                    {t('detail.legend.sma20')}
                  </span>
                  <span>
                    <i style={{ background: 'var(--line)', height: 8 }} />
                    {t('detail.legend.volume')}
                  </span>
                </div>
                <p className="fine" style={{ marginTop: 8 }}>
                  {t('detail.chartHelp')}
                </p>
              </div>

              <div className="card verdict">
                <div className="verdict-head">
                  <span className="label">{t('detail.verdict')}</span>
                  <span className={`stance ${analysis.stance}`}>{t(`stance.${analysis.stance}`)}</span>
                </div>
                <div className="gauge" role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={analysis.score} aria-label={t('detail.verdict')}>
                  <i style={{ left: `calc(${(analysis.score + 100) / 2}% - 2px)` }} />
                </div>
                <div className="gauge-scale">
                  <span>{t('detail.gauge.low')}</span>
                  <span>{t('detail.gauge.high')}</span>
                </div>
                <ul className="reasons">
                  {analysis.reasons.map((r) => (
                    <li key={r.code}>
                      <span className={r.weight > 0 ? 'up' : r.weight < 0 ? 'down' : 'muted'} aria-hidden="true">
                        {r.weight > 0 ? <CaretUp className="ico" size={12} weight="fill" aria-hidden="true" /> : r.weight < 0 ? <CaretDown className="ico" size={12} weight="fill" aria-hidden="true" /> : '•'}
                      </span>
                      <span>{t(`reason.${r.code}`, { value: r.value === undefined ? '' : Math.round(Math.abs(r.value)) })}</span>
                    </li>
                  ))}
                </ul>
                <details className="more">
                  <summary>{t('detail.moreStats')}</summary>
                  <dl className="stats">
                    <div>
                      <dt>{t('detail.stat.7d')}</dt>
                      <dd className={changeClass(analysis.change7d)}>{percent(analysis.change7d)}</dd>
                    </div>
                    <div>
                      <dt>{t('detail.stat.30d')}</dt>
                      <dd className={changeClass(analysis.change30d)}>{percent(analysis.change30d)}</dd>
                    </div>
                    <div>
                      <dt>
                        {t('detail.stat.rsi')} <Hint text={t('detail.hint.rsi')} />
                      </dt>
                      <dd>{analysis.rsi14 === null ? '–' : Math.round(analysis.rsi14)}</dd>
                    </div>
                    <div>
                      <dt>
                        {t('detail.stat.volatility')} <Hint text={t('detail.hint.volatility')} align="right" />
                      </dt>
                      <dd>{analysis.volatility === null ? '–' : `${amount(analysis.volatility)}%`}</dd>
                    </div>
                    <div>
                      <dt>{t('detail.stat.high')}</dt>
                      <dd>{amount(analysis.high)}</dd>
                    </div>
                    <div>
                      <dt>{t('detail.stat.low')}</dt>
                      <dd>{amount(analysis.low)}</dd>
                    </div>
                    <div>
                      <dt>
                        {t('detail.stat.fromHigh')} <Hint text={t('detail.hint.fromHigh')} />
                      </dt>
                      <dd className="down">{percent(analysis.fromHigh)}</dd>
                    </div>
                    <div>
                      <dt>
                        {t('detail.stat.volume')} <Hint text={t('detail.hint.volume')} align="right" />
                      </dt>
                      <dd className={changeClass(analysis.volumeTrend)}>{percent(analysis.volumeTrend)}</dd>
                    </div>
                  </dl>
                </details>
                <p className="fine">
                  {t('detail.unitNote', { unit: unitName })} {t('detail.disclaimer')}
                </p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
