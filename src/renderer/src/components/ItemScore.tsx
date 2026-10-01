import type { PriceCheckResult } from '../../../core/pricecheck'
import { priceConfidence, scoreItem } from '../../../core/item/value'
import { useApp } from '../lib/app'
import { Hint } from './ui'

/** Faixas da nota (0–100): o rótulo e a cor seguem a mesma escala em todo o app. */
export const SCORE_BANDS = [
  { min: 85, key: 'excellent' },
  { min: 70, key: 'great' },
  { min: 50, key: 'good' },
  { min: 30, key: 'average' },
  { min: 0, key: 'weak' },
] as const

export function scoreBand(score: number): (typeof SCORE_BANDS)[number]['key'] {
  return SCORE_BANDS.find((b) => score >= b.min)!.key
}

/**
 * Nota do item (qualidade dos mods para aquela peça, ajustada pelo tier) e
 * confiança do preço. Só para itens da trade; currency já tem o preço direto.
 */
export function ItemScore({ result }: { result: PriceCheckResult }) {
  const { t } = useApp()
  if (result.kind !== 'trade') return null
  const unique = result.item.rarity === 'Unique'
  const score = unique ? null : scoreItem(result.filters, result.item.itemClass).score
  const conf = priceConfidence(result.listings, result.total)
  const band = score === null ? null : scoreBand(score)
  return (
    <div className="item-score" role="status">
      {score !== null && band && (
        <div className={`score-badge ${band}`}>
          <b className="num">{score}</b>
          <span>{t(`score.${band}`)}</span>
        </div>
      )}
      {score !== null && (
        <div className="score-scale" aria-hidden="true">
          <span className="score-fill" style={{ width: `${score}%` }} />
        </div>
      )}
      <small className={`score-conf conf-${conf.level}`}>
        {t('score.price')} {t(`verdict.conf.${conf.level}`)}
        {conf.sample > 0 && <> ({t('verdict.conf.sample', { n: conf.sample })})</>} <Hint text={t('score.hint')} align="right" />
      </small>
    </div>
  )
}
