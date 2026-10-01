import type { TierOption } from '../../../core/item/tiers'
import { useApp } from '../lib/app'

/** Quantos tiers oferecer no seletor (os piores raramente interessam). */
const MAX_TIERS = 8

function sameNumber(text: string, value: number | null): boolean {
  if (value === null) return text.trim() === ''
  const n = Number(text.replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(n) && Math.abs(n - value) < 1e-9
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** Máximo (pela média, como a trade compara) de um tier. */
function tierMax(tier: TierOption): number {
  return tier.ranges.reduce((a, [, hi]) => a + hi, 0) / tier.ranges.length
}

/**
 * Escolhe o mínimo (e, no modo exato, o máximo) por tier.
 * - exato (busca): "T2" = só a faixa do T2 (mín e máx preenchidos).
 * - "ou melhor" (sobreposição): "T2+" = T2 ou melhor (só mínimo).
 * "Só T1" aparece quando a média de dano flat se sobrepõe ao T2.
 */
export function TierSelect({
  tiers,
  minText,
  maxText = '',
  onPick,
  label,
  exact = false,
}: {
  tiers: readonly TierOption[]
  minText: string
  maxText?: string
  onPick: (min: string, max: string) => void
  label: string
  exact?: boolean
}) {
  const { t } = useApp()
  const shown = tiers.slice(0, MAX_TIERS)
  const top = shown[0]
  const hasStrict = top !== undefined && top.strictMin > top.min
  const maxFor = (tier: TierOption) => (exact && tier.tier > 1 ? tierMax(tier) : null)

  let value = 'custom'
  if (hasStrict && sameNumber(minText, top.strictMin)) value = 'strict'
  else {
    const hit = shown.find((tier) => sameNumber(minText, tier.min) && (!exact || sameNumber(maxText, maxFor(tier))))
    if (hit) value = `t${hit.tier}`
  }

  return (
    <select
      className="tier-select"
      aria-label={label}
      title={t('tier.hint')}
      value={value}
      onChange={(e) => {
        const v = e.target.value
        if (v === 'custom') return
        if (v === 'strict' && top) {
          onPick(fmt(top.strictMin), '')
          return
        }
        const tier = shown.find((x) => `t${x.tier}` === v)
        if (tier) {
          const max = maxFor(tier)
          onPick(fmt(tier.min), max === null ? '' : fmt(max))
        }
      }}
    >
      <option value="custom">{t('tier.custom')}</option>
      {hasStrict && <option value="strict">{t('tier.only', { n: 1 })}</option>}
      {shown.map((tier) => (
        <option key={tier.tier} value={`t${tier.tier}`}>
          {exact ? `T${tier.tier} · ${fmt(tier.min)}–${fmt(tierMax(tier))}` : t('tier.orBetter', { n: tier.tier })}
        </option>
      ))}
    </select>
  )
}

/** Selo com o tier do valor rolado no item. */
export function TierBadge({ tiers, tier }: { tiers?: readonly TierOption[]; tier?: number | null }) {
  const { t } = useApp()
  if (!tiers || tier === null || tier === undefined) return <span className="tier-badge empty" aria-hidden="true" />
  const info = tiers.find((x) => x.tier === tier)
  return (
    <span className={`tier-badge t${Math.min(tier, 4)}`} title={t('tier.rolled', { n: tier, affix: info?.affix ?? '', of: tiers.length })}>
      T{tier}
    </span>
  )
}

/** Resumo "T1–T9" para listas de sugestão. */
export function tierSpan(tiers: readonly TierOption[] | undefined): string {
  if (!tiers || tiers.length === 0) return ''
  return tiers.length === 1 ? 'T1' : `T1–T${tiers.length}`
}
