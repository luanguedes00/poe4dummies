// Seções de filtros montadas a partir de /api/trade2/data/filters: os mesmos
// grupos, textos e opções do site oficial (em inglês, como no jogo).

import type { FilterDef, FilterGroupDef } from '../../../core/sources/trade'
import { useApp } from '../lib/app'

export interface FilterDraft {
  min: string
  max: string
  option: string | null
  input: string
}

export type FilterDrafts = Record<string, Record<string, FilterDraft>>

export const EMPTY_FILTER: FilterDraft = { min: '', max: '', option: null, input: '' }

export function isActive(d: FilterDraft | undefined): boolean {
  return !!d && (d.min.trim() !== '' || d.max.trim() !== '' || d.option !== null || d.input.trim() !== '')
}

/** Filtro sem faixa nem opções é um campo de texto (ex.: conta do vendedor). */
function isText(f: FilterDef): boolean {
  return !f.minMax && f.options === null
}

interface Props {
  groups: readonly FilterGroupDef[]
  drafts: FilterDrafts
  onChange: (groupId: string, filterId: string, next: FilterDraft) => void
}

export function FilterSections({ groups, drafts, onChange }: Props) {
  const { t } = useApp()
  return (
    <div className="filter-sections">
      {groups.map((g) => {
        const active = g.filters.filter((f) => isActive(drafts[g.id]?.[f.id])).length
        return (
          <details key={g.id} className="filter-section" open={!g.hidden || active > 0}>
            <summary>
              <span>{g.title}</span>
              {active > 0 && <span className="chip-n">{t('search.activeCount', { n: active })}</span>}
            </summary>
            <div className="filter-grid">
              {g.filters.map((f) => {
                const d = drafts[g.id]?.[f.id] ?? EMPTY_FILTER
                const set = (patch: Partial<FilterDraft>) => onChange(g.id, f.id, { ...d, ...patch })
                const id = `f-${g.id}-${f.id}`
                return (
                  <div key={f.id} className={`filter-field ${isActive(d) ? 'on' : ''}`}>
                    <label htmlFor={id}>{f.text}</label>
                    <div className="filter-controls">
                      {f.options && (
                        <select id={id} className="select" value={d.option ?? ''} onChange={(e) => set({ option: e.target.value === '' ? null : e.target.value })}>
                          {f.options.map((o) => (
                            <option key={o.id ?? ''} value={o.id ?? ''}>
                              {o.text}
                            </option>
                          ))}
                        </select>
                      )}
                      {f.minMax && (
                        <>
                          <input
                            id={f.options ? undefined : id}
                            className="input num"
                            inputMode="decimal"
                            placeholder={t('pc.min')}
                            aria-label={`${f.text} ${t('pc.min')}`}
                            value={d.min}
                            onChange={(e) => set({ min: e.target.value })}
                          />
                          <input className="input num" inputMode="decimal" placeholder={t('search.max')} aria-label={`${f.text} ${t('search.max')}`} value={d.max} onChange={(e) => set({ max: e.target.value })} />
                        </>
                      )}
                      {isText(f) && <input id={id} className="input" maxLength={64} value={d.input} onChange={(e) => set({ input: e.target.value })} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </details>
        )
      })}
    </div>
  )
}
