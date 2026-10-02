import { useMemo, useState } from 'react'
import type { StatEntry } from '../../../../core/item/statMatcher'
import type { TierOption } from '../../../../core/item/tiers'
import { STAT_GROUP_TYPES, type StatGroupType } from '../../../../core/trade/manual'
import { TierSelect, tierSpan } from '../../components/TierSelect'
import { Hint } from '../../components/ui'
import { useApp } from '../../lib/app'
import { rank, readable, Suggest } from './Suggest'
import { X } from '@phosphor-icons/react'

export interface StatRowDraft {
  stat: StatEntry
  min: string
  max: string
}

export interface StatGroupDraft {
  key: number
  type: StatGroupType
  min: string
  max: string
  rows: StatRowDraft[]
}

interface Props {
  group: StatGroupDraft
  /** O primeiro grupo é sempre "E" (todos os mods) e não pode ser removido. */
  primary: boolean
  allStats: readonly StatEntry[]
  /**
   * Com uma base escolhida: mods possíveis nela, com tiers. A busca de mods
   * passa a oferecer só esses (mais os "total"/pseudo). null = sem base.
   */
  tiersById: Readonly<Record<string, TierOption[]>> | null
  onChange: (next: StatGroupDraft) => void
  onRemove: () => void
}

export function StatGroupEditor({ group, primary, allStats, tiersById, onChange, onRemove }: Props) {
  const { t } = useApp()
  const [query, setQuery] = useState('')
  const used = useMemo(() => new Set(group.rows.map((r) => r.stat.id)), [group.rows])
  const candidates = useMemo(
    () => allStats.filter((s) => !used.has(s.id) && (tiersById === null || s.group === 'pseudo' || s.id in tiersById)),
    [allStats, used, tiersById],
  )
  // Com base escolhida e campo vazio: mostra TODOS os mods possíveis nela, para navegar.
  const suggestions = useMemo(() => {
    if (query.trim() === '' && tiersById) {
      return candidates
        .filter((s) => s.id in tiersById)
        .sort((a, b) => a.text.localeCompare(b.text))
        .slice(0, 150)
    }
    return rank(candidates, query, (s) => s.text)
  }, [candidates, query, tiersById])
  const groupLabel = (s: StatEntry) => (s.group === 'pseudo' ? t('search.group.pseudo') : s.group === 'implicit' ? t('search.group.implicit') : '')
  const detail = (s: StatEntry) => [tierSpan(tiersById?.[s.id]), groupLabel(s)].filter(Boolean).join(' · ')
  const setRow = (i: number, patch: Partial<StatRowDraft>) => onChange({ ...group, rows: group.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const needsRange = group.type === 'count' || group.type === 'weight'

  return (
    <div className={`stat-group ${primary ? 'primary' : ''}`}>
      <div className="stat-group-head">
        {primary ? (
          <span className="field-title">
            {t('search.mods')} <Hint text={t('search.groupHint.and')} />
          </span>
        ) : (
          <>
            <select
              className="select"
              aria-label={t('search.groupType')}
              value={group.type}
              onChange={(e) => onChange({ ...group, type: e.target.value as StatGroupType })}
            >
              {STAT_GROUP_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`search.groupType.${type}`)}
                </option>
              ))}
            </select>
            <Hint text={t(`search.groupHint.${group.type}`)} />
            {needsRange && (
              <span className="group-range">
                <input className="input num" inputMode="decimal" placeholder={t('pc.min')} aria-label={t('pc.min')} value={group.min} onChange={(e) => onChange({ ...group, min: e.target.value })} />
                <input className="input num" inputMode="decimal" placeholder={t('search.max')} aria-label={t('search.max')} value={group.max} onChange={(e) => onChange({ ...group, max: e.target.value })} />
              </span>
            )}
            <button className="btn ghost small" type="button" onClick={onRemove} style={{ marginLeft: 'auto' }}>
              {t('search.group.remove')}
            </button>
          </>
        )}
      </div>

      <Suggest
        id={`stat-${group.key}`}
        value={query}
        onChange={setQuery}
        options={suggestions}
        render={(s) => ({ main: readable(s.text), detail: detail(s) })}
        onPick={(s) => {
          if (group.rows.length < 20) onChange({ ...group, rows: [...group.rows, { stat: s, min: '', max: '' }] })
          setQuery('')
        }}
        placeholder={t('search.modPlaceholder')}
      />

      {group.rows.length > 0 && (
        <div className="stat-rows">
          {group.rows.map((r, i) => {
            const tiers = tiersById?.[r.stat.id]
            return (
              <div className="stat-row" key={r.stat.id}>
                <span className="stat-text" title={r.stat.text}>
                  {readable(r.stat.text)} {groupLabel(r.stat) && <small className="muted">· {groupLabel(r.stat)}</small>}
                </span>
                {tiers ? (
                  <TierSelect exact tiers={tiers} minText={r.min} maxText={r.max} label={`${t('tier.label')} ${r.stat.text}`} onPick={(min, max) => setRow(i, { min, max })} />
                ) : (
                  <span className="muted tier-none" title={t('search.tierNeedsBase')}>
                    —
                  </span>
                )}
                <input className="input num" inputMode="decimal" placeholder={t('pc.min')} aria-label={`${t('pc.min')} ${r.stat.text}`} value={r.min} onChange={(e) => setRow(i, { min: e.target.value })} />
                <input className="input num" inputMode="decimal" placeholder={t('search.max')} aria-label={`${t('search.max')} ${r.stat.text}`} value={r.max} onChange={(e) => setRow(i, { max: e.target.value })} />
                <button className="btn icon-btn" type="button" aria-label={`${t('search.remove')} ${r.stat.text}`} onClick={() => onChange({ ...group, rows: group.rows.filter((_, j) => j !== i) })}>
                  <X className="ico" size={14} weight="bold" aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
