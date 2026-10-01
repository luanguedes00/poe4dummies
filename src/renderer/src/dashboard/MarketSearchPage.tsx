// "Buscar preço": igual ao site de trade — item, grupos de mods (E, NÃO, SE,
// CONTAGEM, PESO) e todas as seções de filtros oficiais — com duas camadas a
// mais: tier por mod (quando há tipo base) e preço já calculado aqui.

import { useEffect, useMemo, useState } from 'react'
import type { StatEntry } from '../../../core/item/statMatcher'
import type { TierOption } from '../../../core/item/tiers'
import type { PriceCheckResult } from '../../../core/pricecheck'
import type { FilterValue, ManualSearch, ManualStatFilter } from '../../../core/trade/manual'
import type { FilterOverride } from '../../../core/trade/query'
import type { MarketSearchResult, SearchCatalog } from '../../../shared/ipc'
import { ListingList, PriceSummary } from '../components/Listings'
import { PriceCheckView, type ResearchExtra } from '../components/PriceCheckView'
import { api, errorKey, useApp } from '../lib/app'
import { useSticky } from '../lib/sticky'
import { FilterSections, isActive, type FilterDraft, type FilterDrafts } from '../components/FilterSections'
import { StatGroupEditor, type StatGroupDraft } from './search/StatGroupEditor'
import { rank, Suggest, toNumber } from './search/Suggest'

interface ItemOption {
  label: string
  detail: string
  name: string | null
  type: string
}

/** Mods que iniciantes mais procuram. Só aparecem se existirem na base atual da trade. */
const QUICK_STATS = [
  'pseudo.pseudo_total_life',
  'pseudo.pseudo_total_elemental_resistance',
  'pseudo.pseudo_total_resistance',
  'pseudo.pseudo_total_energy_shield',
  'pseudo.pseudo_increased_movement_speed',
]

let nextGroupKey = 1
const newGroup = (type: StatGroupDraft['type'] = 'and'): StatGroupDraft => ({ key: nextGroupKey++, type, min: '', max: '', rows: [] })

function toStatFilters(group: StatGroupDraft): ManualStatFilter[] {
  return group.rows.map((r) => ({ id: r.stat.id, min: toNumber(r.min), max: toNumber(r.max) }))
}

function toFilterValues(drafts: FilterDrafts): Record<string, Record<string, FilterValue>> {
  const out: Record<string, Record<string, FilterValue>> = {}
  for (const [groupId, values] of Object.entries(drafts)) {
    for (const [filterId, d] of Object.entries(values)) {
      if (!isActive(d)) continue
      out[groupId] ??= {}
      out[groupId][filterId] = { min: toNumber(d.min), max: toNumber(d.max), option: d.option, input: d.input.trim() || null }
    }
  }
  return out
}

export function MarketSearchPage() {
  const { t } = useApp()
  const [catalog, setCatalog] = useState<SearchCatalog | null>(null)
  const [catalogError, setCatalogError] = useState(false)
  // Tudo da busca fica guardado ao trocar de aba (só na memória: os grupos têm chaves da sessão).
  const [itemText, setItemText] = useSticky('search.itemText', '')
  const [item, setItem] = useSticky<ItemOption | null>('search.item', null)
  const [groups, setGroups] = useSticky<StatGroupDraft[]>('search.groups', () => [newGroup('and')])
  const [filters, setFilters] = useSticky<FilterDrafts>('search.filters', {})
  const [status, setStatus] = useSticky<string | null>('search.status', null)
  const [result, setResult] = useSticky<MarketSearchResult | null>('search.result', null)
  const [loading, setLoading] = useState(false)
  const [pasteOpen, setPasteOpen] = useSticky('search.pasteOpen', false)

  useEffect(() => {
    api.searchCatalog().then(setCatalog).catch(() => setCatalogError(true))
  }, [])

  // Com um tipo base escolhido, carrega todos os mods possíveis nele (com tiers).
  // Únicos têm rolagens próprias: sem filtro de mods possíveis.
  const [tiersById, setTiersById] = useState<Record<string, TierOption[]> | null>(null)
  const tierBase = item && !item.name ? item.type : null
  useEffect(() => {
    if (!tierBase) {
      setTiersById(null)
      return
    }
    let alive = true
    api
      .baseMods(tierBase)
      // Se os dados de tier não carregarem, não filtra (melhor que esconder tudo).
      .then((r) => alive && setTiersById(Object.keys(r).length > 0 ? r : null))
      .catch(() => alive && setTiersById(null))
    return () => {
      alive = false
    }
  }, [tierBase])

  const itemOptions = useMemo<ItemOption[]>(() => {
    if (!catalog) return []
    return [
      ...catalog.uniques.map((u) => ({ label: u.name, detail: `${u.type} · ${t('search.unique')}`, name: u.name, type: u.type })),
      ...catalog.bases.map((b) => ({ label: b.type, detail: b.category, name: null, type: b.type })),
    ]
  }, [catalog, t])
  const itemSuggestions = useMemo(() => (item && item.label === itemText ? [] : rank(itemOptions, itemText, (o) => o.label)), [itemOptions, itemText, item])
  const statById = useMemo(() => new Map((catalog?.stats ?? []).map((s) => [s.id, s])), [catalog])
  const quick = QUICK_STATS.map((id) => statById.get(id)).filter((s): s is StatEntry => s !== undefined)
  const statusFilter = catalog?.filterGroups.find((g) => g.id === 'status_filters')?.filters[0]
  const sections = useMemo(() => (catalog?.filterGroups ?? []).filter((g) => g.id !== 'status_filters'), [catalog])
  const primary = groups[0]!

  const search: ManualSearch = {
    name: item?.name ?? null,
    type: item?.type ?? null,
    stats: toStatFilters(primary),
    statGroups: groups.slice(1).map((g) => ({ type: g.type, min: toNumber(g.min), max: toNumber(g.max), filters: toStatFilters(g) })),
    filters: toFilterValues(filters),
    status,
  }
  const activeFilters = Object.values(search.filters ?? {}).reduce((n, g) => n + Object.keys(g).length, 0)
  const canSearch = Boolean(search.name || search.type || search.stats.length > 0 || activeFilters > 0 || search.statGroups?.some((g) => g.filters.length > 0))

  const run = async () => {
    if (!canSearch) return
    setLoading(true)
    try {
      setResult(await api.marketSearch(search))
    } finally {
      setLoading(false)
    }
  }

  const clear = () => {
    setItem(null)
    setItemText('')
    setGroups([newGroup('and')])
    setFilters({})
    setStatus(null)
    setResult(null)
  }

  const setFilter = (groupId: string, filterId: string, next: FilterDraft) =>
    setFilters((all) => ({ ...all, [groupId]: { ...all[groupId], [filterId]: next } }))

  return (
    <>
      <h2 className="page-title">{t('search.title')}</h2>
      {catalogError && <div className="banner">{t('error.network')}</div>}

      <div className="pc-page">
        <form
          className="card form-card"
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          <div className="search-top">
            <label className="field" htmlFor="search-item">
              <span className="field-title">{t('search.item')}</span>
              <Suggest
                id="search-item"
                value={itemText}
                onChange={(v) => {
                  setItemText(v)
                  if (item && v !== item.label) setItem(null)
                }}
                options={itemSuggestions}
                render={(o) => ({ main: o.label, detail: o.detail })}
                onPick={(o) => {
                  setItem(o)
                  setItemText(o.label)
                }}
                placeholder={catalog ? t('search.itemPlaceholder') : t('search.loadingCatalog')}
              />
            </label>
            {statusFilter?.options && (
              <label className="field" htmlFor="search-status">
                <span className="field-title">{t('search.status')}</span>
                <select id="search-status" className="select" value={status ?? ''} onChange={(e) => setStatus(e.target.value === '' ? null : e.target.value)}>
                  <option value="">{t('search.statusDefault')}</option>
                  {statusFilter.options
                    .filter((o) => o.id !== null)
                    .map((o) => (
                      <option key={o.id!} value={o.id!}>
                        {o.text}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>

          {quick.length > 0 && (
            <div className="chips">
              {quick.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="chip"
                  disabled={primary.rows.some((r) => r.stat.id === s.id)}
                  onClick={() => setGroups((all) => all.map((g, i) => (i === 0 ? { ...g, rows: [...g.rows, { stat: s, min: '', max: '' }] } : g)))}
                >
                  + {s.text.replace(/^\+?#%? ?/, '').replace(/^total /, '')}
                </button>
              ))}
            </div>
          )}

          {groups.map((g, i) => (
            <StatGroupEditor
              key={g.key}
              group={g}
              primary={i === 0}
              allStats={catalog?.stats ?? []}
              tiersById={tiersById}
              onChange={(next) => setGroups((all) => all.map((x) => (x.key === g.key ? next : x)))}
              onRemove={() => setGroups((all) => all.filter((x) => x.key !== g.key))}
            />
          ))}
          {groups.length < 6 && (
            <div>
              <button className="btn ghost small" type="button" onClick={() => setGroups((all) => [...all, newGroup('not')])}>
                + {t('search.group.add')}
              </button>
            </div>
          )}

          {sections.length > 0 && <FilterSections groups={sections} drafts={filters} onChange={setFilter} />}

          <div className="actions search-actions">
            <button className="btn primary big" type="submit" disabled={!canSearch || loading}>
              {loading ? t('pc.checking') : t('search.run')}
            </button>
            <button className="btn big" type="button" onClick={clear}>
              {t('search.clear')}
            </button>
            {!canSearch && <small className="muted">{t('search.needSomething')}</small>}
            {activeFilters > 0 && <small className="muted">{t('search.activeCount', { n: activeFilters })}</small>}
          </div>

          <details className="paste-box" open={pasteOpen} onToggle={(e) => setPasteOpen((e.target as HTMLDetailsElement).open)}>
            <summary>{t('search.pasteToggle')}</summary>
            {pasteOpen && <PasteCheck />}
          </details>
        </form>

        {result && (
          <div className="card pc sticky-result">
            {result.kind === 'error' ? (
              <div className="pc-error">{t(errorKey(result.code), { seconds: result.retryAfterSec ?? 60 })}</div>
            ) : (
              <>
                <div className="pc-head">
                  <div>
                    <b className={item?.name ? 'unique' : ''}>{item?.label ?? t('search.anyItem')}</b>
                    <small className="muted">{t('search.resultNote', { n: result.listings.length })}</small>
                  </div>
                </div>
                <PriceSummary cheapest={result.cheapestDivine} median={result.medianDivine} count={result.listings.length} total={result.total} />
                <ListingList listings={result.listings} />
                <div className="pc-foot">
                  <button className="btn primary" type="button" onClick={() => void api.openExternal({ kind: 'trade', league: result.league, queryId: result.queryId })}>
                    {t('search.openTrade')} ↗
                  </button>
                  {item && (
                    <button className="btn ghost" type="button" onClick={() => void api.openExternal({ kind: 'poe2db', name: item.name ?? item.type })}>
                      {t('pc.openPoe2db')} ↗
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

/** Opção avançada: colar o texto copiado do jogo (o mesmo que a sobreposição faz). */
function PasteCheck() {
  const { t } = useApp()
  const [text, setText] = useSticky('paste.text', '')
  const [checked, setChecked] = useSticky('paste.checked', '')
  const [result, setResult] = useSticky<PriceCheckResult | null>('paste.result', null)
  const [loading, setLoading] = useState(false)

  const run = async (source: string, overrides?: FilterOverride[], extra?: ResearchExtra) => {
    setLoading(true)
    setChecked(source)
    try {
      setResult(await api.priceCheck(overrides ? { text: source, overrides, siteFilters: extra?.siteFilters, status: extra?.status ?? null } : { text: source }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="paste-inner">
      <small className="muted">{t('pc.howto')}</small>
      <textarea className="input paste" placeholder={t('pc.paste')} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('pc.paste')} />
      <div>
        <button className="btn" type="button" disabled={loading || text.trim() === ''} onClick={() => void run(text)}>
          {loading ? t('pc.checking') : t('pc.check')}
        </button>
      </div>
      {(result || loading) && (
        <div className="card pc" style={{ padding: 0 }}>
          <PriceCheckView text={checked} result={result} loading={loading} onResearch={(o, extra) => void run(checked, o, extra)} />
        </div>
      )}
    </div>
  )
}
