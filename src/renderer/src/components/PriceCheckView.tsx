import { useEffect, useState } from 'react'
import type { PriceCheckResult } from '../../../core/pricecheck'
import type { FilterGroupDef } from '../../../core/sources/trade'
import type { FilterValue } from '../../../core/trade/manual'
import type { FilterOverride, StatFilter } from '../../../core/trade/query'
import type { DisplayCurrency } from '../../../core/types'
import { api, errorKey, useApp } from '../lib/app'
import { FilterSections, isActive, type FilterDrafts } from './FilterSections'
import { ItemIcon } from './ItemIcon'
import { ListingList } from './Listings'
import { TierBadge, TierSelect } from './TierSelect'
import { Hint } from './ui'
import { UpgradeCard } from './UpgradeCard'
import { ItemScore } from './ItemScore'
import { X, ArrowSquareOut } from '@phosphor-icons/react'

export interface ResearchExtra {
  siteFilters: Record<string, Record<string, FilterValue>>
  status: string | null
}

interface Props {
  text: string
  result: PriceCheckResult | null
  loading: boolean
  onResearch: (overrides: FilterOverride[], extra: ResearchExtra) => void
  onClose?: () => void
}

type FilterDraft = StatFilter & { minText: string }

function numText(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v)
}

function toSiteDrafts(values: Record<string, Record<string, FilterValue>>): FilterDrafts {
  const out: FilterDrafts = {}
  for (const [g, filters] of Object.entries(values)) {
    for (const [id, v] of Object.entries(filters)) {
      out[g] ??= {}
      out[g][id] = { min: numText(v.min), max: numText(v.max), option: v.option ?? null, input: v.input ?? '' }
    }
  }
  return out
}

function toSiteValues(drafts: FilterDrafts): Record<string, Record<string, FilterValue>> {
  const out: Record<string, Record<string, FilterValue>> = {}
  const num = (s: string) => {
    const n = Number(s.replace(',', '.'))
    return s.trim() === '' || !Number.isFinite(n) ? null : n
  }
  // Envia também os vazios: assim um padrão removido pelo usuário sai da busca.
  for (const [g, filters] of Object.entries(drafts)) {
    for (const [id, d] of Object.entries(filters)) {
      out[g] ??= {}
      out[g][id] = { min: num(d.min), max: num(d.max), option: d.option, input: d.input.trim() || null }
    }
  }
  return out
}

type AffixKind = 'prefix' | 'suffix' | 'implicit' | 'rune' | 'pseudo' | 'property' | 'other'

/** "12 Chaos (649 Ex)": a moeda principal e as outras entre parênteses. */
function withSecondary(values: readonly string[]) {
  const [first, ...rest] = values
  return (
    <>
      <span className="nowrap">{first ?? '–'}</span>
      {rest.length > 0 && <small className="pc-secondary"> ({rest.join(' · ')})</small>}
    </>
  )
}

/** Currency cuja própria moeda não deve aparecer no preço (uma Divine não vale "1 Div"). */
function selfUnit(marketId: string): DisplayCurrency | null {
  return marketId === 'divine' || marketId === 'exalted' || marketId === 'chaos' ? marketId : null
}

function affixOf(f: StatFilter): { cls: string; kind: AffixKind } {
  if (f.affix === 'prefix') return { cls: 'prefix', kind: 'prefix' }
  if (f.affix === 'suffix') return { cls: 'suffix', kind: 'suffix' }
  if (f.kind === 'implicit') return { cls: 'other', kind: 'implicit' }
  if (f.kind === 'rune') return { cls: 'other', kind: 'rune' }
  if (f.kind === 'pseudo') return { cls: 'pseudo', kind: 'pseudo' }
  if (f.kind === 'property') return { cls: 'pseudo', kind: 'property' }
  return { cls: 'other', kind: 'other' }
}

/** Manda o item checado para a lista (soma no total), sem precisar ligar o modo lista. */
function AddToListButton({ text }: { text: string }) {
  const { t } = useApp()
  const [done, setDone] = useState(false)
  useEffect(() => setDone(false), [text])
  return (
    <button
      className="btn ghost"
      type="button"
      disabled={done || text === ''}
      onClick={() =>
        void api.addToCollection(text).then((r) => {
          if (r.ok) setDone(true)
        })
      }
    >
      {done ? `✓ ${t('pc.addedToList')}` : `+ ${t('pc.addToList')}`}
    </button>
  )
}

export function PriceCheckView({ text, result, loading, onResearch, onClose }: Props) {
  const { t, smart, others, amount } = useApp()
  const [drafts, setDrafts] = useState<FilterDraft[]>([])
  const [siteDrafts, setSiteDrafts] = useState<FilterDrafts>({})
  const [siteDirty, setSiteDirty] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [groups, setGroups] = useState<FilterGroupDef[] | null>(null)
  /** Linhas totais (ex.: resistência elemental) abertas para ver as individuais. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (result?.kind === 'trade') {
      setDrafts(result.filters.map((f) => ({ ...f, minText: f.min === null ? '' : String(f.min) })))
      setSiteDrafts(toSiteDrafts(result.siteFilters))
    } else {
      setDrafts([])
      setSiteDrafts({})
    }
    setSiteDirty(false)
  }, [result])

  // Os grupos de filtros do site só são carregados quando o usuário abre "Mais filtros".
  useEffect(() => {
    if (!moreOpen || groups) return
    api.filterGroups().then(setGroups).catch(() => setGroups([]))
  }, [moreOpen, groups])

  const research = () => {
    onResearch(
      drafts.map((d) => {
        const parsed = d.minText.trim() === '' ? null : Number(d.minText.replace(',', '.'))
        return { statId: d.statId, enabled: d.enabled, min: parsed !== null && Number.isFinite(parsed) ? parsed : null, max: d.max }
      }),
      { siteFilters: toSiteValues(siteDrafts), status: result?.kind === 'trade' ? result.status : null },
    )
  }

  const header = (title: string, subtitle: string, rarityClass: string, iconUrl: string | null = null) => (
    <div className="pc-head drag">
      <div className="item-cell">
        {iconUrl && <ItemIcon url={iconUrl} name={title} />}
        <div>
          <b className={rarityClass}>{title}</b>
          <small className="muted">{subtitle}</small>
        </div>
      </div>
      {onClose && (
        <button className="btn small" type="button" onClick={onClose} title={t('pc.close')}>
          <X className="ico" size={14} weight="bold" aria-hidden="true" />
        </button>
      )}
    </div>
  )

  if (loading && !result) {
    return (
      <div className="pc">
        {header(text.split(/\r?\n/)[2] ?? '…', '', '')}
        <div className="pc-loading">{t('pc.checking')}</div>
      </div>
    )
  }
  if (!result) return null

  if (result.kind === 'error') {
    return (
      <div className="pc">
        {header(t('app.name'), '', '')}
        <div className="pc-error">{t(errorKey(result.code), { seconds: result.retryAfterSec ?? 60 })}</div>
      </div>
    )
  }

  const item = result.item
  const rarityClass = item.rarity === 'Unique' ? 'unique' : item.rarity === 'Rare' ? 'rare' : ''
  const subtitleParts = [item.name ? item.baseLine : null, item.itemLevel ? t('pc.ilvl', { n: item.itemLevel }) : null, item.rarity, item.corrupted ? t('pc.corrupted') : null]
  const subtitle = subtitleParts.filter(Boolean).join(' · ')

  if (result.kind === 'market') {
    const stack = item.stackSize ?? 1
    return (
      <div className="pc">
        {header(item.name ?? item.baseLine, subtitle, rarityClass, result.market.iconUrl)}
        
        {/* Currency: nas outras moedas (uma Divine não aparece em Divine); números redondos. */}
        <div className="pc-sum pc-sum-col">
          <div>
            <span className="label">{t('pc.each')}</span>
            <b>{withSecondary(others(result.market.valueDivine, selfUnit(result.market.id)))}</b>
          </div>
          {stack > 1 && (
            <div>
              <span className="label">{t('pc.stackTotal', { n: amount(stack) })}</span>
              <b>{withSecondary(others(result.market.valueDivine * stack, selfUnit(result.market.id)))}</b>
            </div>
          )}
        </div>
        <div className="pc-note">
          <span className="item-cell">
            <ItemIcon url={result.market.iconUrl} name={result.market.name} />
            {t('pc.marketTitle')}
          </span>
        </div>
      </div>
    )
  }

  const hasAffixInfo = drafts.some((d) => d.affix !== null)
  // "Atualizar busca" só vira o botão principal quando algum filtro mudou.
  const dirty =
    siteDirty ||
    drafts.some((d, i) => {
      const f = result.filters[i]
      return !!f && (d.enabled !== f.enabled || d.minText !== (f.min === null ? '' : String(f.min)))
    })
  const siteActive = Object.values(siteDrafts).reduce((n, g) => n + Object.values(g).filter(isActive).length, 0)
  return (
    <div className="pc">
      {header(item.name ?? item.baseType ?? item.baseLine, subtitle, rarityClass, result.listings.find((l) => l.iconUrl)?.iconUrl ?? null)}
      {/* Topo enxuto: veredito e preço numa faixa; os mods logo abaixo. */}
      <ItemScore result={result} />
      <div className="pc-line">
        <span>
          <span className="label">{t('pc.cheapest')}</span> <b>{result.cheapestDivine === null ? '–' : smart(result.cheapestDivine)}</b>
        </span>
        <span>
          <span className="label">{t('pc.median', { n: result.listings.length })}</span> <b>{result.medianDivine === null ? '–' : smart(result.medianDivine)}</b>
        </span>
        <span className="muted">{t('pc.listedN', { n: amount(result.total) })}</span>
      </div>

      {drafts.length > 0 && (
        <div className="mods">
          <div className="mods-head">
            <span>
              {t('pc.filters')} <Hint text={t('pc.filtersHint')} />
            </span>
            <span>
              {t('tier.label')} <Hint text={t('tier.hint')} align="right" /> · {t('pc.min')}
            </span>
          </div>
          {drafts.map((d, i) => {
            // Individuais de uma linha total só aparecem com ela aberta.
            if (d.group && !expanded.has(d.group)) return null
            const aff = affixOf(d)
            const children = d.kind === 'pseudo' ? drafts.filter((x) => x.group === d.statId).length : 0
            const open = expanded.has(d.statId)
            return (
              <div key={d.statId} className={d.group ? 'mod-child' : undefined}>
              <label className={`mod ${d.enabled ? '' : 'off'}`}>
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={(e) => setDrafts((all) => all.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
                />
                <span className={`aff ${aff.cls}`} title={`${t(`pc.affix.${aff.kind}.long`)}${d.tier ? ` · Tier ${d.tier}` : ''}`}>
                  {t(`pc.affix.${aff.kind}`)}
                </span>
                <span>{d.modText}</span>
                <TierBadge tiers={d.tiers} tier={d.rolledTier} />
                {d.tiers && d.value !== null && d.value > 0 ? (
                  <TierSelect
                    tiers={d.tiers}
                    minText={d.minText}
                    label={`${t('tier.label')} ${d.modText}`}
                    onPick={(min) => setDrafts((all) => all.map((x, j) => (j === i ? { ...x, minText: min, enabled: true } : x)))}
                  />
                ) : (
                  <span />
                )}
                <input
                  className="min"
                  inputMode="decimal"
                  aria-label={`${t('pc.min')} ${d.modText}`}
                  placeholder={t('pc.min')}
                  value={d.minText}
                  disabled={d.value === null || d.value < 0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') research()
                  }}
                  onChange={(e) => setDrafts((all) => all.map((x, j) => (j === i ? { ...x, minText: e.target.value } : x)))}
                />
              </label>
              {children > 0 && (
                <button
                  type="button"
                  className="mod-expand"
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded((all) => {
                      const next = new Set(all)
                      if (open) next.delete(d.statId)
                      else next.add(d.statId)
                      return next
                    })
                  }
                >
                  {open ? '▾' : '▸'} {t(open ? 'pc.collapse' : 'pc.expand', { n: children })}
                </button>
              )}
              </div>
            )
          })}
          {!hasAffixInfo && <small className="muted">{t('pc.affixTip')}</small>}
        </div>
      )}

      {/* "Serve para mim?" fica recolhido: uma linha com o veredito, detalhes ao abrir. */}
      <UpgradeCard text={text} />

      {result.unmatched.length > 0 && (
        <div className="pc-note">
          {t('pc.unmatched')} {result.unmatched.join(' · ')}
        </div>
      )}

      <details className="more-filters" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
        <summary>
          {t('pc.moreFilters')}
          {siteActive > 0 && <span className="chip-n"> · {t('search.activeCount', { n: siteActive })}</span>}
        </summary>
        {moreOpen && groups === null && <div className="pc-loading">{t('pc.checking')}</div>}
        {moreOpen && groups && (
          <FilterSections
            groups={groups.filter((g) => g.id !== 'status_filters')}
            drafts={siteDrafts}
            onChange={(g, id, next) => {
              setSiteDrafts((all) => ({ ...all, [g]: { ...all[g], [id]: next } }))
              setSiteDirty(true)
            }}
          />
        )}
      </details>

      <ListingList listings={result.listings} ownMods={result.filters.filter((f) => f.kind !== 'pseudo' && f.kind !== 'property').map((f) => f.modText)} />

      <div className="pc-foot">
        <button className={`btn ${dirty ? 'primary' : ''}`} type="button" onClick={research} disabled={loading}>
          {loading ? t('pc.checking') : dirty ? t('pc.update') : t('pc.research')}
        </button>
        <AddToListButton text={text} />
        <button className="btn ghost" type="button" onClick={() => void api.openExternal({ kind: 'trade', league: result.league, queryId: result.queryId })}>
          {t('pc.openTrade')} <ArrowSquareOut className="ico" size={14} aria-hidden="true" />
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={() => void api.openExternal({ kind: 'poe2db', name: item.rarity === 'Unique' && item.name ? item.name : (item.baseType ?? item.baseLine) })}
        >
          {t('pc.openPoe2db')} <ArrowSquareOut className="ico" size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
