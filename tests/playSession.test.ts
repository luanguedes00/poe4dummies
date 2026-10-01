import { describe, expect, it } from 'vitest'
import { parseLine, type LogEvent } from '../src/core/log/clientLog'
import { applySessionEvents, closeSession, initialSessions, isPlaySession, sessionViews } from '../src/core/log/playSession'
import { DEFAULT_TRACKER_OPTIONS } from '../src/core/log/tracker'

const MIN = 60_000
const t0 = Date.UTC(2026, 9, 1, 20, 0)
const open = (at: number): LogEvent => ({ type: 'log-opened', at })
const area = (at: number, areaId: string, level = 1): LogEvent => ({ type: 'area-generated', at, areaId, level, seed: '1' })
const run = (events: LogEvent[]) => applySessionEvents(initialSessions(), events, DEFAULT_TRACKER_OPTIONS)

describe('sessões de jogo', () => {
  it('soma o tempo de cada tipo de área e fecha quando o jogo fecha', () => {
    let s = run([
      open(t0),
      area(t0 + 1 * MIN, 'HideoutFelled'),
      area(t0 + 6 * MIN, 'MapAzmerianRanges', 70),
      area(t0 + 16 * MIN, 'HideoutFelled'),
      area(t0 + 18 * MIN, 'MapBluff', 70),
    ])
    s = closeSession(s, t0 + 30 * MIN)
    const [v] = sessionViews([], s, t0 + 40 * MIN, false)
    expect(v).toMatchObject({ live: false, total: 30 * MIN, maps: 22 * MIN, hideout: 7 * MIN, campaign: 0, town: 0, other: 1 * MIN })
  })

  it('separa campanha e cidade', () => {
    const s = closeSession(run([open(t0), area(t0, 'G1_town'), area(t0 + 5 * MIN, 'G1_2', 3), area(t0 + 25 * MIN, 'G1_town')]), t0 + 28 * MIN)
    const [v] = sessionViews([], s, t0 + 30 * MIN, false)
    expect(v).toMatchObject({ campaign: 20 * MIN, town: 8 * MIN, maps: 0, hideout: 0 })
  })

  it('jogo aberto: conta ao vivo; jogo fechado sem aviso: termina no último evento', () => {
    const s = run([open(t0), area(t0, 'HideoutFelled')])
    expect(sessionViews([], s, t0 + 10 * MIN, true)[0]).toMatchObject({ live: true, total: 10 * MIN, hideout: 10 * MIN })
    const s2 = run([open(t0), area(t0, 'HideoutFelled'), area(t0 + 3 * MIN, 'MapBluff', 70)])
    expect(sessionViews([], s2, t0 + 60 * MIN, false)[0]).toMatchObject({ live: false, total: 3 * MIN, hideout: 3 * MIN })
  })

  it('nova abertura do jogo fecha a sessão anterior no último evento dela', () => {
    const s = run([open(t0), area(t0, 'HideoutFelled'), area(t0 + 5 * MIN, 'MapBluff', 70), open(t0 + 120 * MIN), area(t0 + 121 * MIN, 'HideoutFelled')])
    const views = sessionViews([], s, t0 + 130 * MIN, true)
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({ live: true, startedAt: t0 + 120 * MIN })
    expect(views[1]).toMatchObject({ live: false, total: 5 * MIN, hideout: 5 * MIN })
  })

  it('a sessão guardada (com a hora real de fechar) vale mais que a do log; sessões curtas somem', () => {
    const s = run([open(t0), area(t0, 'HideoutFelled'), open(t0 + 100 * MIN)])
    const saved = { startedAt: t0, endedAt: t0 + 50 * MIN, byKind: { hideout: 50 * MIN } }
    const views = sessionViews([saved], s, t0 + 100 * MIN + 30_000, false)
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ total: 50 * MIN, hideout: 50 * MIN })
  })

  it('linha atrasada de uma sessão já fechada não cria sessão fantasma', () => {
    let s = run([open(t0), area(t0, 'HideoutFelled')])
    s = closeSession(s, t0 + 10 * MIN)
    s = applySessionEvents(s, [area(t0 + 9 * MIN, 'MapBluff', 70)], DEFAULT_TRACKER_OPTIONS)
    expect(s.sessions).toHaveLength(1)
  })

  it('tempo com o modo AFK ligado vai para "parado", não para a área', () => {
    const afk = (at: number, on: boolean): LogEvent => ({ type: 'afk', at, on })
    const s = closeSession(run([open(t0), area(t0, 'G4_11_2', 50), afk(t0 + 10 * MIN, true), afk(t0 + 490 * MIN, false), area(t0 + 495 * MIN, 'G4_town', 50)]), t0 + 500 * MIN)
    const [v] = sessionViews([], s, t0 + 500 * MIN, false)
    expect(v).toMatchObject({ campaign: 15 * MIN, idle: 480 * MIN, town: 5 * MIN, other: 0 })
    // AFK no momento: o ao vivo marca para a tela somar em "parado".
    const live = run([open(t0), area(t0, 'HideoutFelled'), afk(t0 + 5 * MIN, true)])
    expect(sessionViews([], live, t0 + 20 * MIN, true)[0]).toMatchObject({ afkNow: true, hideout: 5 * MIN, idle: 15 * MIN })
  })

  it('lê as linhas de AFK do log (e não as do chat)', () => {
    expect(parseLine('2026/09/30 23:52:40 274128203 3ef23348 [INFO Client 33504] : AFK mode is now ON. Autoreply "This player is AFK."')).toMatchObject({ type: 'afk', on: true })
    expect(parseLine('2026/10/01 07:59:07 303315359 3ef23348 [INFO Client 33504] : AFK mode is now OFF.')).toMatchObject({ type: 'afk', on: false })
    expect(parseLine('2026/10/01 07:59:07 303315359 3ef23348 [INFO Client 33504] #Fulano: AFK mode is now ON.')).toBeNull()
  })

  it('valida o arquivo guardado', () => {
    expect(isPlaySession({ startedAt: 1, endedAt: 2, byKind: { map: 5 } })).toBe(true)
    expect(isPlaySession({ startedAt: 1, endedAt: null, byKind: {} })).toBe(false)
    expect(isPlaySession({ startedAt: 1, endedAt: 2, byKind: { hack: 5 } })).toBe(false)
    expect(isPlaySession({ startedAt: 1, endedAt: 2, byKind: { map: -1 } })).toBe(false)
  })
})
