// Seletor de liga (topo do painel e Configurações). A lista vem do cache do app
// (a trade só é consultada uma vez por dia, no processo principal) e é lida uma
// vez por sessão, dividida entre os dois lugares.

import { useEffect, useState } from 'react'
import type { MessageKey } from '../../../shared/i18n'
import type { League } from '../../../core/types'
import { api, useApp } from '../lib/app'

let shared: Promise<League[]> | null = null

function loadLeagues(): Promise<League[]> {
  shared ??= api.getLeagues().catch((error: unknown) => {
    // Falhou (sem cache e trade indisponível): a próxima tela que abrir tenta de novo.
    shared = null
    throw error
  })
  return shared
}

export function useLeagues(): League[] {
  const [leagues, setLeagues] = useState<League[]>([])
  useEffect(() => {
    let alive = true
    loadLeagues()
      .then((list) => alive && setLeagues(list))
      .catch(() => alive && setLeagues([]))
    return () => {
      alive = false
    }
  }, [])
  return leagues
}

/** Mesma regra do processo principal (pickDefaultLeague): primeira liga sem hardcore que não seja a Standard. */
function latestLeague(leagues: readonly League[]): League | undefined {
  return leagues.find((l) => !l.hardcore && l.id !== 'Standard')
}

interface Props {
  /** Recebe a liga escolhida (null = sempre a mais recente). */
  onPick: (league: string | null) => void
  className?: string
  /** Texto da opção "sempre a mais recente" (versão curta no topo). */
  autoKey?: MessageKey
  'aria-label'?: string
}

export function LeagueSelect({ onPick, className = 'select', autoKey = 'settings.leagueAuto', 'aria-label': ariaLabel }: Props) {
  const { t, settings, market } = useApp()
  const leagues = useLeagues()
  const chosen = settings.league
  // Sem a lista (trade fora e sem cache), a liga em uso continua aparecendo.
  const latest = latestLeague(leagues)?.label ?? (chosen === null ? market.league : null) ?? '…'
  const options = chosen && !leagues.some((l) => l.id === chosen) ? [{ id: chosen, label: chosen, hardcore: false }, ...leagues] : leagues

  return (
    <select className={className} value={chosen ?? ''} aria-label={ariaLabel} onChange={(e) => onPick(e.target.value === '' ? null : e.target.value)}>
      <option value="">{t(autoKey, { league: latest })}</option>
      {options.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  )
}
