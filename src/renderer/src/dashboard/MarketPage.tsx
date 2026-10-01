import { useEffect, useMemo, useRef, useState } from 'react'
import { watchKey } from '../../../core/market/watchlist'
import { isNinjaCategory, NINJA_CATEGORIES, type NinjaCategory } from '../../../core/categories'
import { Sparkline } from '../components/charts'
import { ItemIcon } from '../components/ItemIcon'
import { TickerTape } from '../components/TickerTape'
import { changeClass, Hint, TableSkeleton } from '../components/ui'
import { api, useApp } from '../lib/app'
import { useSticky } from '../lib/sticky'
import { buildRows, type MarketRow } from '../lib/market'
import { useItemDrawer } from './ItemDrawer'

type SortKey = 'name' | 'price' | 'change' | 'volume'

export function MarketPage() {
  const { t, market, unit, unitLabel, price, percent, locale, settings } = useApp()
  const { openItem, openKey } = useItemDrawer()
  const [category, setCategory] = useSticky<NinjaCategory>('market.category', 'Currency', { persist: true })
  const [query, setQuery] = useSticky('market.query', '')
  const [sort, setSort] = useSticky<{ key: SortKey; desc: boolean }>('market.sort', { key: 'volume', desc: true }, { persist: true })
  const searchRef = useRef<HTMLInputElement>(null)
  // Número inteiro (sem "mil"): o usuário prefere ver o valor cheio.
  const compact = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale])

  // "/" ou Ctrl+F focam a busca.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select')
      if (!typing && (e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'f'))) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const snapshot = market.snapshot
  const rows = useMemo(() => (snapshot ? buildRows(snapshot, unit) : []), [snapshot, unit])
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) map.set(r.item.category, (map.get(r.item.category) ?? 0) + 1)
    return map
  }, [rows])
  const watched = useMemo(() => new Set(settings.watchlist.map(watchKey)), [settings.watchlist])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = rows.filter((r) => (q ? r.item.name.toLowerCase().includes(q) : r.item.category === category))
    const value = (r: MarketRow): number | string => {
      switch (sort.key) {
        case 'name':
          return r.item.name
        case 'price':
          return r.item.valueDivine
        case 'change':
          return r.change ?? -Infinity
        case 'volume':
          return r.item.volumeDivine
      }
    }
    return [...list].sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return sort.desc ? -cmp : cmp
    })
  }, [rows, query, category, sort])

  const ticker = rows
    .filter((r) => r.item.category === 'Currency')
    .sort((a, b) => b.item.volumeDivine - a.item.volumeDivine)
    .slice(0, 10)

  const header = (key: SortKey, label: string, right = false, hint?: string) => (
    <th className={`${right ? 'r' : ''} ${sort.key === key ? 'sorted' : ''}`} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="th-btn" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))}>
        {label}{' '}
        <span className="sort-ind" aria-hidden="true">
          {sort.key === key ? (sort.desc ? '▾' : '▴') : '↕'}
        </span>
      </button>
      {hint && <Hint text={hint} align={right ? 'right' : 'center'} />}
    </th>
  )

  if (!snapshot) return <TableSkeleton label={t('market.loading')} />

  return (
    <>
      <TickerTape itemsKey={ticker.map((r) => r.item.id).join(',')}>
        {ticker.map((r) => (
          <button type="button" className="tick" key={r.item.id} onClick={() => openItem(`${r.item.category}:${r.item.id}`)}>
            <b>{r.item.name}</b>
            <span className="num">{price(r.item.valueDivine)}</span>
            <span className={`num ${changeClass(r.change)}`}>
              {(r.change ?? 0) >= 0 ? '▲' : '▼'} {percent(r.change)}
            </span>
          </button>
        ))}
      </TickerTape>

      <div className="toolbar">
        <div className="search">
          <svg className="search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            className="input"
            placeholder={t('market.search')}
            aria-label={t('market.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              aria-label={t('market.clear')}
              onClick={() => {
                setQuery('')
                searchRef.current?.focus()
              }}
            >
              ×
            </button>
          )}
        </div>
        {query && <span className="toolbar-hint">{t('market.searchAll', { n: visible.length })}</span>}
      </div>

      <div className="chips" role="group" aria-label={t('market.categories')}>
        {NINJA_CATEGORIES.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => {
          const on = c === category && !query
          return (
            <button
              key={c}
              type="button"
              className={`chip ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={() => {
                setCategory(c)
                setQuery('')
              }}
            >
              {t(`cat.${c}`)} <span className="chip-n">{counts.get(c)}</span>
            </button>
          )
        })}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th aria-label={t('market.watch')} />
              {header('name', t('market.col.item'))}
              {header('price', t('market.col.price', { unit: unitLabel }), true)}
              <th>{t('market.col.spark')}</th>
              {header('change', t('market.col.change'), true, t('market.hint.change', { unit: unitLabel }))}
              {header('volume', t('market.col.volume'), true, t('market.hint.volume'))}
              <th>
                {t('market.col.signal')} <Hint text={t('market.hint.signal')} align="right" />
              </th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  {t('market.empty')}{' '}
                  {query && (
                    <button className="btn small" type="button" onClick={() => setQuery('')}>
                      {t('market.clear')}
                    </button>
                  )}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const key = `${r.item.category}:${r.item.id}`
              const isWatched = watched.has(key)
              return (
                <tr
                  key={key}
                  className={`clickable ${openKey === key ? 'sel' : ''}`}
                  tabIndex={0}
                  onClick={() => openItem(key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openItem(key)
                    }
                  }}
                >
                  <td>
                    <button
                      type="button"
                      className={`star ${isWatched ? 'on' : ''}`}
                      title={isWatched ? t('market.unwatch') : t('market.watch')}
                      aria-label={isWatched ? t('market.unwatch') : t('market.watch')}
                      aria-pressed={isWatched}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isNinjaCategory(r.item.category)) void api.toggleWatch({ category: r.item.category, itemId: r.item.id })
                      }}
                    >
                      {isWatched ? '★' : '☆'}
                    </button>
                  </td>
                  <td>
                    <span className="item-cell">
                      <ItemIcon url={r.item.iconUrl} name={r.item.name} />
                      {r.item.name}
                    </span>
                  </td>
                  <td className="r num">{price(r.item.valueDivine)}</td>
                  <td>
                    <Sparkline data={r.spark} />
                  </td>
                  <td className={`r num ${changeClass(r.change)}`}>{percent(r.change)}</td>
                  <td className="r num">{compact.format(r.item.volumeDivine)}</td>
                  <td>
                    {r.signals.map((s) => (
                      <span key={s} className={`sig ${s}`} title={t(`signal.${s}.hint`)}>
                        {t(`signal.${s}`)}
                      </span>
                    ))}
                  </td>
                  <td className="go" aria-hidden="true">
                    ›
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
