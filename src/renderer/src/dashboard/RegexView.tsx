// Farm → Regex: escolha mods de tablet e copie o texto para a busca do baú ou
// da loja no PoE2; o jogo destaca só os tablets com esses mods.

import { useEffect, useMemo, useState } from 'react'
import { buildRegex, SEARCH_LIMIT, typeLabel, type Mode, type RegexPreset, type Selection, type TabletMod } from '../../../core/farm/regex'
import { Hint } from '../components/ui'
import { api, useApp } from '../lib/app'
import { useSticky } from '../lib/sticky'
import { rank, readable, Suggest, toNumber } from './search/Suggest'

// Obrigatório: o tablet precisa ter todos. Qualquer um: basta um deles. Esconder: tira da busca.
const MODES = ['all', 'any', 'exclude'] as const satisfies readonly Mode[]

export function RegexView() {
  const { t } = useApp()
  const [data, setData] = useState<{ mods: TabletMod[]; presets: RegexPreset[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [type, setType] = useSticky<string>('regex.type', 'all', { persist: true })
  const [selection, setSelection] = useSticky<Selection[]>('regex.selection', [], { persist: true })
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.farmTabletRegex().then(setData).catch(() => setFailed(true))
  }, [])

  const mods = data?.mods ?? []
  const byKey = useMemo(() => new Map(mods.map((m) => [m.key, m])), [mods])
  const types = useMemo(() => [...new Set(mods.flatMap((m) => m.types))].sort(), [mods])
  // Mods do tipo escolhido + os que servem em qualquer tablet.
  const visible = useMemo(() => mods.filter((m) => type === 'all' || m.types.length === 0 || m.types.includes(type)), [mods, type])
  const options = useMemo(() => rank(visible.filter((m) => !selection.some((s) => s.key === m.key)), query, (m) => m.text), [visible, query, selection])
  const result = useMemo(() => buildRegex(selection.filter((s) => byKey.has(s.key)), mods), [selection, mods, byKey])
  const presets = (data?.presets ?? []).filter((p) => type === 'all' || p.mechanic === type)

  const add = (mod: TabletMod) => {
    setSelection((all) => (all.some((s) => s.key === mod.key) ? all : [...all, { key: mod.key, mode: 'all', min: null }]))
    setQuery('')
  }
  const update = (key: string, change: Partial<Selection>) => setSelection((all) => all.map((s) => (s.key === key ? { ...s, ...change } : s)))
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  if (failed) return <div className="banner">{t('error.network')}</div>
  if (!data) return <p className="muted">{t('regex.loading')}</p>

  return (
    <div className="regex-view">
      <p className="muted regex-intro">{t('regex.intro')}</p>

      <div className="chips" role="tablist" aria-label={t('regex.type')}>
        {['all', ...types].map((ty) => (
          <button key={ty} type="button" role="tab" aria-selected={type === ty} className={`chip ${type === ty ? 'on' : ''}`} onClick={() => setType(ty)}>
            {ty === 'all' ? t('regex.allTypes') : typeLabel(ty)}
          </button>
        ))}
      </div>

      {presets.length > 0 && (
        <div className="regex-presets">
          <span className="label">{t('regex.presets')}</span>
          <div className="chips">
            {presets.map((p) => (
              <button key={p.id} type="button" className="chip" onClick={() => setSelection(p.selection)} title={t('regex.presetHint')}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="regex-add">
        <Suggest
          id="regex-mod"
          value={query}
          onChange={setQuery}
          options={options}
          render={(m) => ({ main: readable(m.text), detail: m.min !== null && m.max !== null ? `${m.min}–${m.max}` : undefined })}
          onPick={add}
          placeholder={t('regex.searchPlaceholder')}
        />
      </div>

      {selection.length > 0 && (
        <div className="regex-list">
          {selection.map((s) => {
            const mod = byKey.get(s.key)
            if (!mod) return null
            const hasNumber = mod.text.includes('#')
            return (
              <div key={s.key} className={`regex-row ${s.mode}`}>
                <span className="regex-mod">{readable(mod.text)}</span>
                <div className="seg" role="group" aria-label={t('regex.mode')}>
                  {MODES.map((m) => (
                    <button key={m} type="button" className={s.mode === m ? 'on' : ''} aria-pressed={s.mode === m} onClick={() => update(s.key, { mode: m })}>
                      {t(`regex.mode.${m}`)}
                    </button>
                  ))}
                </div>
                <input
                  className="input num regex-min"
                  inputMode="numeric"
                  placeholder={hasNumber && mod.min !== null ? `${t('pc.min')} ${mod.min}–${mod.max}` : '–'}
                  disabled={!hasNumber || s.mode === 'exclude'}
                  value={s.min ?? ''}
                  onChange={(e) => update(s.key, { min: toNumber(e.target.value) })}
                  aria-label={t('pc.min')}
                />
                <button type="button" className="btn ghost small" onClick={() => setSelection((all) => all.filter((x) => x.key !== s.key))} aria-label={t('search.remove')}>
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="regex-output">
        <div className="regex-output-head">
          <span className="label">
            {t('regex.result')} <Hint text={t('regex.resultHint')} />
          </span>
          <span className={`num regex-count ${result.tooLong ? 'down' : 'muted'}`}>
            {result.length}/{SEARCH_LIMIT}
          </span>
        </div>
        <textarea className="input regex-text" readOnly value={result.text} placeholder={t('regex.empty')} rows={3} onFocus={(e) => e.currentTarget.select()} />
        <div className="regex-actions">
          <button className="btn primary" type="button" disabled={!result.text} onClick={() => void copy()}>
            {copied ? `✓ ${t('regex.copied')}` : t('regex.copy')}
          </button>
          <button className="btn ghost" type="button" disabled={selection.length === 0} onClick={() => setSelection([])}>
            {t('search.clear')}
          </button>
          {result.tooLong && <small className="down">{t('regex.tooLong', { n: SEARCH_LIMIT })}</small>}
          {result.skipped.length > 0 && <small className="muted">{t('regex.skipped', { n: result.skipped.length })}</small>}
        </div>
      </div>
    </div>
  )
}
