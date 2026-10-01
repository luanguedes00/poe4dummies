import { useMemo } from 'react'
import { checkUpgrade, type StatDelta, type UpgradeWarning } from '../../../core/build/compare'
import { parseItemText } from '../../../core/item/parser'
import type { MessageKey, Translate } from '../../../shared/i18n'
import { useApp } from '../lib/app'

const ATTR_KEY = { str: 'stat.str', dex: 'stat.dex', int: 'stat.int' } as const

function signed(n: number, amount: (v: number) => string): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${amount(Math.abs(n))}`
}

function DeltaChip({ d }: { d: StatDelta }) {
  const { t, amount } = useApp()
  const isRes = d.resAfter !== undefined
  const unit = isRes || d.key === 'moveSpeed' ? '%' : ''
  // Atributos não pesam no veredito: ficam neutros.
  const neutral = d.key === 'str' || d.key === 'dex' || d.key === 'int'
  const cls = neutral || d.effective === 0 ? 'muted' : d.effective > 0 ? 'up' : 'down'
  let extra = ''
  if (d.resAfter) {
    extra = d.effective === 0 ? t('up.capped') : t('up.resAfter', { value: amount(Math.min(d.resAfter.value, d.resAfter.cap)), cap: amount(d.resAfter.cap) })
  }
  return (
    <span className={`delta-chip ${cls}`}>
      {t(`stat.${d.key}` as MessageKey)} <b className="num">{signed(d.delta, amount)}{unit}</b>
      {extra && <small> · {extra}</small>}
    </span>
  )
}

function warningText(w: UpgradeWarning, t: Translate): string {
  return w.kind === 'attribute' ? t('up.warn.attribute', { n: w.missing, attr: t(ATTR_KEY[w.key]) }) : t('up.warn.spirit', { n: w.missing })
}

/** "É upgrade para a sua build?" dentro da checagem de preço. Some sem build ou sem slot. */
export function UpgradeCard({ text }: { text: string }) {
  const { t, build } = useApp()
  const check = useMemo(() => {
    if (!build || !text) return null
    try {
      return checkUpgrade(build, parseItemText(text), text)
    } catch {
      return null
    }
  }, [build, text])
  if (!check) return null

  const { best } = check
  const weapon = check.kind === 'weapon'
  const changed = best.deltas.filter((d) => d.delta !== 0)
  const slot = t(`slot.${best.slot}` as MessageKey)

  return (
    // Recolhido por padrão: uma linha com o veredito; os detalhes abrem com clique.
    <details className={`upgrade ${weapon ? 'weapon' : best.verdict}`} aria-label={t('up.title')}>
      <summary className="upgrade-head">
        <span className="label">{t('up.title')}</span>
        {!weapon && <b className="upgrade-verdict">{t(`up.verdict.${best.verdict}`)}</b>}
        <small className="muted upgrade-vs">
          {best.equipped ? `${slot} · ${t('up.vs', { item: best.equipped.name ?? best.equipped.baseType })}` : t('up.vsEmpty', { slot })}
        </small>
      </summary>
      {best.warnings.length > 0 && (
        <ul className="upgrade-warn">
          {best.warnings.map((w) => (
            <li key={w.kind === 'attribute' ? w.key : w.kind}>⚠ {warningText(w, t)}</li>
          ))}
        </ul>
      )}
      {changed.length > 0 ? (
        <div className="delta-list">
          {changed.map((d) => (
            <DeltaChip key={d.key} d={d} />
          ))}
        </div>
      ) : (
        <small className="muted">{t('up.noChange')}</small>
      )}
      {(best.gained.length > 0 || best.lost.length > 0) && (
        <div className="upgrade-other">
          {best.gained.length > 0 && (
            <div>
              <span className="label up">{t('up.gained')}</span>
              {best.gained.map((l) => (
                <small key={l}>{l}</small>
              ))}
            </div>
          )}
          {best.lost.length > 0 && (
            <div>
              <span className="label down">{t('up.lost')}</span>
              {best.lost.map((l) => (
                <small key={l}>{l}</small>
              ))}
            </div>
          )}
        </div>
      )}
      {check.alternatives.length > 0 && (
        <small className="muted">
          {check.alternatives
            .map((c) => t('up.alt', { slot: t(`slot.${c.slot}` as MessageKey), verdict: t(`up.verdict.${c.verdict}`) }))
            .join(' · ')}
        </small>
      )}
      <small className="fine">{weapon ? t('up.weapon') : t('up.note')}</small>
    </details>
  )
}
