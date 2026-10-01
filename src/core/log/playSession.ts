// Sessões de jogo a partir do log: cada "LOG FILE OPENING" (jogo aberto) começa
// uma sessão; o tempo até a próxima área vai para o tipo da área em que você
// estava (mapa, esconderijo, campanha, cidade...). Tempo com o modo AFK ligado
// (o jogo escreve no log) vai para "parado". A sessão termina quando o jogo
// fecha (o app percebe a janela sumindo) ou no último evento antes da próxima
// abertura.

import type { LogEvent } from './clientLog'
import { classifyArea, type AreaKind, type TrackerOptions } from './tracker'

/** Tipo de área, ou "idle" para o tempo com o modo AFK ligado. */
export type PlayBucket = AreaKind | 'idle'
const BUCKETS: readonly PlayBucket[] = ['town', 'hideout', 'campaign', 'map', 'endgame', 'other', 'idle']

export interface PlaySession {
  startedAt: number
  /** null enquanto o jogo está aberto. */
  endedAt: number | null
  /** Tempo (ms) em cada tipo de área. */
  byKind: Partial<Record<PlayBucket, number>>
}

export interface PlaySessionsState {
  sessions: PlaySession[]
  /** Área atual e desde quando (para somar o tempo dela). */
  kind: AreaKind | null
  since: number | null
  /** Modo AFK ligado: o tempo vai para "parado". */
  afk: boolean
  /** Último evento do log (fim provável da sessão se o jogo fechar sem aviso). */
  lastAt: number | null
}

/** Sessões guardadas (as mais recentes). */
const MAX_SESSIONS = 30

export function initialSessions(): PlaySessionsState {
  return { sessions: [], kind: null, since: null, afk: false, lastAt: null }
}

/** Soma o tempo desde `since` até `at` na sessão aberta (na área atual, ou em "parado" se AFK). */
function accumulate(state: PlaySessionsState, at: number): PlaySessionsState {
  const open = state.sessions[state.sessions.length - 1]
  const bucket: PlayBucket | null = state.afk ? 'idle' : state.kind
  if (!open || open.endedAt !== null || bucket === null || state.since === null || at <= state.since) return { ...state, since: state.since === null ? null : Math.max(at, state.since) }
  const byKind = { ...open.byKind, [bucket]: (open.byKind[bucket] ?? 0) + (at - state.since) }
  return { ...state, sessions: [...state.sessions.slice(0, -1), { ...open, byKind }], since: at }
}

/** Fecha a sessão aberta em `at` (jogo fechado). */
export function closeSession(state: PlaySessionsState, at: number): PlaySessionsState {
  const open = state.sessions[state.sessions.length - 1]
  if (!open || open.endedAt !== null) return state
  const next = accumulate(state, Math.max(at, state.since ?? at))
  const last = next.sessions[next.sessions.length - 1]!
  return { ...next, sessions: [...next.sessions.slice(0, -1), { ...last, endedAt: Math.max(at, last.startedAt) }], kind: null, since: null, afk: false }
}

export function applySessionEvent(state: PlaySessionsState, event: LogEvent, options: TrackerOptions): PlaySessionsState {
  let next: PlaySessionsState = { ...state, lastAt: Math.max(event.at, state.lastAt ?? event.at) }
  if (event.type === 'log-opened') {
    // Jogo aberto de novo: a sessão anterior terminou no último evento dela.
    if (state.lastAt !== null) next = closeSession(next, state.lastAt)
    const sessions = [...next.sessions, { startedAt: event.at, endedAt: null, byKind: {} }].slice(-MAX_SESSIONS)
    return { ...next, sessions, kind: null, since: null, afk: false, lastAt: event.at }
  }
  if (event.type === 'afk') {
    const open = openSession(next)
    if (!open || event.at < open.startedAt || next.afk === event.on) return next
    next = accumulate(next, event.at)
    return { ...next, afk: event.on, since: event.at }
  }
  if (event.type === 'area-generated') {
    const last = next.sessions[next.sessions.length - 1]
    // Linha lida atrasada, de uma sessão que o app já fechou: não abre sessão fantasma.
    if (last && last.endedAt !== null && event.at <= last.endedAt) return next
    // Log que começou antes da janela lida: a sessão começa na primeira área vista.
    if (!last || last.endedAt !== null) {
      next = { ...next, sessions: [...next.sessions, { startedAt: event.at, endedAt: null, byKind: {} }].slice(-MAX_SESSIONS) }
    }
    next = accumulate(next, event.at)
    // Trocar de área tira do AFK (o jogo desliga o modo ao primeiro comando).
    return { ...next, kind: classifyArea(event.areaId, event.level, options), since: event.at, afk: false }
  }
  return next
}

export function applySessionEvents(state: PlaySessionsState, events: readonly LogEvent[], options: TrackerOptions): PlaySessionsState {
  return events.reduce((s, e) => applySessionEvent(s, e, options), state)
}

/** Tempos agrupados para a tela: fim de jogo (mapas x esconderijo) e história (campanha x cidade). */
export interface SessionView {
  startedAt: number
  endedAt: number | null
  /** Jogo ainda aberto: o tempo continua correndo. */
  live: boolean
  total: number
  maps: number
  hideout: number
  campaign: number
  town: number
  /** Modo AFK do jogo ligado. */
  idle: number
  /** Carregamento, seleção de personagem e áreas sem tipo. */
  other: number
  /** Sessão aberta e o jogo está em AFK agora (o tempo ao vivo vai para "parado"). */
  afkNow: boolean
}

/** Abaixo disso a sessão não aparece (abriu e fechou o jogo). */
const MIN_SESSION_MS = 60_000

function toView(s: PlaySession, now: number, afkNow: boolean): SessionView {
  const k = s.byKind
  const total = Math.max((s.endedAt ?? now) - s.startedAt, 0)
  const maps = (k.map ?? 0) + (k.endgame ?? 0)
  const hideout = k.hideout ?? 0
  const campaign = k.campaign ?? 0
  const town = k.town ?? 0
  const idle = k.idle ?? 0
  const live = s.endedAt === null
  return {
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    live,
    total,
    maps,
    hideout,
    campaign,
    town,
    idle,
    other: Math.max(total - maps - hideout - campaign - town - idle, 0),
    afkNow: live && afkNow,
  }
}

/**
 * Sessões para mostrar, mais recentes primeiro. `saved` são as fechadas pelo app
 * (com a hora real em que o jogo fechou) e valem mais que as tiradas do log.
 * Jogo fechado (`gameRunning === false`) e sessão ainda aberta no log: termina no último evento.
 */
export function sessionViews(saved: readonly PlaySession[], state: PlaySessionsState, now: number, gameRunning: boolean | null, limit = 10): SessionView[] {
  const derived = gameRunning === false && state.lastAt !== null ? closeSession(state, state.lastAt).sessions : accumulate(state, now).sessions
  const byStart = new Map<number, PlaySession>()
  for (const s of derived) byStart.set(s.startedAt, s)
  for (const s of saved) byStart.set(s.startedAt, s)
  return [...byStart.values()]
    .map((s) => toView(s, now, state.afk))
    .filter((v) => v.live || v.total >= MIN_SESSION_MS)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit)
}

/** A sessão aberta (jogo rodando), se houver. */
export function openSession(state: PlaySessionsState): PlaySession | null {
  const last = state.sessions[state.sessions.length - 1]
  return last && last.endedAt === null ? last : null
}

/** Confere uma sessão lida do disco. */
export function isPlaySession(v: unknown): v is PlaySession {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  const byKind = s['byKind']
  return (
    typeof s['startedAt'] === 'number' &&
    typeof s['endedAt'] === 'number' &&
    typeof byKind === 'object' &&
    byKind !== null &&
    Object.entries(byKind).every(([k, ms]) => (BUCKETS as readonly string[]).includes(k) && typeof ms === 'number' && ms >= 0)
  )
}
