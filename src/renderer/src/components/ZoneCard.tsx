import type { ReactNode } from 'react'
import type { ZoneGuide } from '../../../core/campaign/guide'
import type { ActRef, LevelGap } from '../../../core/log/tracker'
import { useApp } from '../lib/app'

interface Props {
  area: string
  zone: ZoneGuide | null
  act?: ActRef | null
  areaLevel?: number | null
  charLevel?: number | null
  gap?: LevelGap | null
  /** Botões da barra (janela da campanha): minimizar, fixar, configurações, fechar. */
  controls?: ReactNode
  /** Minimizado: só a linha do nome. */
  collapsed?: boolean
  /** Arrastar a janela pela barra (desligado quando fixada). */
  draggable?: boolean
}

/**
 * Área da campanha, enxuto: nome + selo com a diferença de nível (verde = XP
 * cheia; amarelo = no limite; vermelho = perdendo XP) e a lista do que fazer.
 * Opcionais com etiqueta; recompensas que não pode perder em destaque.
 */
export function ZoneCard({ area, zone, act, areaLevel, charLevel, gap, controls, collapsed = false, draggable = false }: Props) {
  const { t } = useApp()
  const actText = act ? t(act.kind === 'act' ? 'zone.act' : 'zone.interlude', { act: act.number }) : (zone?.act ?? null)
  const levels = [actText, areaLevel != null ? t('zone.areaLevel', { n: areaLevel }) : null, charLevel != null ? t('zone.charLevel', { n: charLevel }) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <section className="zone-card" aria-label={t('zone.title', { area })}>
      <header className={`zone-head ${draggable ? 'drag' : ''}`} title={draggable ? t('zone.drag') : undefined}>
        <b>{area}</b>
        {gap && (
          <span className={`zone-diff ${gap.status}`} title={`${levels}${gap.status === 'penalty' ? ` · ${t('zone.gap.penalty')}` : ''}`}>
            {gap.diff > 0 ? `+${gap.diff}` : gap.diff}
          </span>
        )}
        {controls}
      </header>
      {!collapsed &&
        (zone && zone.tasks.length > 0 ? (
          <ul className="zone-tasks">
            {zone.tasks.map((task) => (
              <li key={task.text} className={task.kind}>
                {task.key ? <span className="zone-tag reward">{task.text}</span> : task.text}
                {task.kind === 'optional' && <span className="zone-tag optional">{t('zone.optional')}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="zone-empty">{t('zone.nothing')}</p>
        ))}
    </section>
  )
}
