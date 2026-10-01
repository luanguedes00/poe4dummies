// Selo "Beta" para partes liberadas que ainda estão em teste (Farm, Comparar e plano).

import { useApp } from '../lib/app'

export function BetaBadge() {
  const { t } = useApp()
  return (
    <span className="beta-badge" title={t('beta.hint')}>
      {t('beta.label')}
    </span>
  )
}

/** Linha de aviso no topo da parte em teste. */
export function BetaNote() {
  const { t } = useApp()
  return (
    <p className="beta-note">
      <BetaBadge /> {t('beta.note')}
    </p>
  )
}
