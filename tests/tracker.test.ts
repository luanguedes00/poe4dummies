import { describe, expect, it } from 'vitest'
import { parseLines, type LogEvent } from '../src/core/log/clientLog'
import {
  actOf,
  applyEvents,
  areaNameFromId,
  classifyArea,
  initialTrackerState,
  levelGap,
  resolveTrackerOptions,
  safeZone,
  trackerSnapshot,
  xpMultiplier,
} from '../src/core/log/tracker'

const T0 = new Date(2025, 0, 10, 20, 0, 0).getTime()
const MIN = 60_000

/** Gera uma linha do Client.txt `min` minutos (e `sec` segundos) depois de T0. */
function line(min: number, msg: string, sec = 0): string {
  const d = new Date(T0 + min * MIN + sec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  return `${stamp} 123456 cffb0734 [INFO Client 4412] ${msg}`
}
const gen = (min: number, level: number, id: string, seed: number | string, sec = 0) =>
  line(min, `Generating level ${level} area "${id}" with seed ${seed}`, sec)
const scene = (min: number, name: string, sec = 1) => line(min, `[SCENE] Set Source [${name}]`, sec)

function run(lines: string[], now: number, options = resolveTrackerOptions()) {
  const events: LogEvent[] = parseLines(lines.join('\n'))
  const state = applyEvents(initialTrackerState(), events, options)
  return { state, snap: trackerSnapshot(state, now, options) }
}

describe('áreas', () => {
  it('classifica pelo id interno do PoE2', () => {
    expect(classifyArea('G1_town', 15)).toBe('town')
    expect(classifyArea('P2_Town', 64)).toBe('town')
    expect(classifyArea('G_Endgame_Town', 65)).toBe('town')
    expect(classifyArea('HideoutFelled', 65)).toBe('hideout')
    expect(classifyArea('MapHideoutFelled_Claimable', 65)).toBe('hideout')
    expect(classifyArea('G1_4', 4)).toBe('campaign')
    expect(classifyArea('P3_5', 56)).toBe('campaign')
    expect(classifyArea('MapBluff', 70)).toBe('map')
    expect(classifyArea('ExpeditionLogBook_Atoll', 72)).toBe('endgame')
    expect(classifyArea('Abyss_Hub', 22)).toBe('other')
  })

  it('identifica ato e interlúdio', () => {
    expect(actOf('G2_4_1')).toEqual({ kind: 'act', number: 2 })
    expect(actOf('G4_town')).toEqual({ kind: 'act', number: 4 })
    expect(actOf('C_G1_1')).toEqual({ kind: 'act', number: 1 })
    expect(actOf('P1_3')).toEqual({ kind: 'interlude', number: 1 })
    expect(actOf('G1_WorldMap')).toBeNull()
    expect(actOf('MapBluff')).toBeNull()
  })

  it('gera nome legível a partir do id', () => {
    expect(areaNameFromId('MapAzmerianRanges')).toBe('Azmerian Ranges')
    expect(areaNameFromId('MapUniqueFreight_')).toBe('Freight')
  })
})

describe('penalidade de XP', () => {
  it('zona segura = floor(3 + nível/16)', () => {
    expect(safeZone(1)).toBe(3)
    expect(safeZone(16)).toBe(4)
    expect(safeZone(60)).toBe(6)
    expect(safeZone(90)).toBe(8)
    expect(safeZone(90, 5)).toBe(5)
  })

  it('XP cheia dentro da zona, cai fora dela e nunca passa de 1% para baixo', () => {
    expect(xpMultiplier(20, 24)).toBe(1)
    expect(xpMultiplier(20, 26)).toBeLessThan(1)
    expect(xpMultiplier(20, 26)).toBeCloseTo(((25 / (25 + 2 ** 2.5)) ** 1.5), 10)
    expect(xpMultiplier(10, 80)).toBe(0.01)
  })

  it('indica direção e estado', () => {
    expect(levelGap(12, 15)).toMatchObject({ diff: -3, direction: 'under', status: 'edge', xpMultiplier: 1 })
    expect(levelGap(12, 17)).toMatchObject({ diff: -5, direction: 'under', status: 'penalty' })
    expect(levelGap(30, 28)).toMatchObject({ diff: 2, direction: 'over', status: 'ok' })
    expect(levelGap(30, 30).direction).toBe('even')
  })
})

describe('campanha', () => {
  const lines = [
    '2025/01/10 20:00:00 ***** LOG FILE OPENING *****',
    gen(0, 1, 'G1_1', 111),
    scene(0, 'The Riverbank'),
    line(3, ': Tavinho (Warrior) is now level 2'),
    gen(5, 15, 'G1_town', 1),
    scene(5, 'Clearfell Encampment'),
    gen(10, 2, 'G1_2', 222),
    scene(10, 'Clearfell'),
    line(20, ': Tavinho (Warrior) is now level 5'),
    line(25, ': Tavinho has been slain.'),
    line(26, ': OutroJogador has been slain.'),
    gen(40, 16, 'G2_1', 333),
    scene(40, 'Vastiri Outskirts'),
    line(45, ': Tavinho (Warrior) is now level 13'),
  ]

  it('mostra personagem, área atual e diferença de nível', () => {
    const { snap } = run(lines, T0 + 50 * MIN)
    expect(snap.character).toMatchObject({ name: 'Tavinho', className: 'Warrior', level: 13 })
    expect(snap.area).toMatchObject({ id: 'G2_1', name: 'Vastiri Outskirts', level: 16, kind: 'campaign', act: { kind: 'act', number: 2 } })
    expect(snap.gap).toMatchObject({ diff: -3, direction: 'under', status: 'edge' })
    expect(snap.deaths).toBe(1) // a morte de outro jogador não conta
  })

  it('soma o tempo por ato, inclusive a cidade, e o ato atual ao vivo', () => {
    const { snap } = run(lines, T0 + 50 * MIN)
    expect(snap.acts.map((a) => [a.key, a.ms / MIN, a.current])).toEqual([
      ['act-1', 40, false],
      ['act-2', 10, true],
    ])
  })

  it('não mostra diferença de nível em cidade', () => {
    const { snap } = run([...lines, gen(46, 32, 'G2_town', 1)], T0 + 47 * MIN)
    expect(snap.area?.kind).toBe('town')
    expect(snap.gap).toBeNull()
  })

  it('não conta o tempo em que o jogo ficou parado', () => {
    const { snap } = run([gen(0, 1, 'G1_1', 1), gen(300, 2, 'G1_2', 2)], T0 + 300 * MIN)
    // 300 min parado viram no máximo 30 min (limite de inatividade).
    expect(snap.acts[0]!.ms).toBe(30 * MIN)
  })

  it('recomeça tempo por ato e mortes ao trocar de personagem', () => {
    const { snap } = run([...lines, line(47, ': Alt (Ranger) is now level 2')], T0 + 50 * MIN)
    expect(snap.character?.name).toBe('Alt')
    expect(snap.deaths).toBe(0)
    expect(snap.acts.map((a) => a.key)).toEqual(['act-2'])
  })
})

describe('mapas', () => {
  // Hideout → mapa (morre, volta pelo portal) → hideout → mapa → hideout → mapa (aberto).
  const lines = [
    line(0, ': Tavinho (Stormweaver) is now level 80'),
    gen(0, 65, 'HideoutFelled', 1, 10),
    scene(0, 'Felled Hideout', 11),
    gen(1, 79, 'MapBluff', 1001),
    scene(1, 'Bluff'),
    line(4, ': Tavinho has been slain.'),
    gen(4, 65, 'HideoutFelled', 1, 20),
    gen(5, 79, 'MapBluff', 1001),
    gen(9, 65, 'HideoutFelled', 1),
    gen(11, 80, 'MapAzmerianRanges', 2002),
    scene(11, 'Azmerian Ranges'),
    gen(13, 80, 'ExpeditionSubArea_Cavern', 3003), // subárea aberta de dentro do mapa
    gen(15, 80, 'MapAzmerianRanges', 2002),
    gen(18, 65, 'HideoutFelled', 1),
    gen(21, 81, 'MapWetlands', 4004),
  ]

  it('agrupa entradas pelo portal na mesma corrida e conta mortes', () => {
    const { snap } = run(lines, T0 + 23 * MIN)
    const [second, first] = snap.recentRuns
    expect(first).toMatchObject({ name: 'Bluff', level: 79, entries: 2, deaths: 1 })
    // Dentro do mapa: 1:00→4:20 e 5:00→9:00 (a ida ao hideout no meio não conta).
    expect(first!.mapMs).toBe(7 * MIN + 20_000)
    expect(first!.cycleMs).toBe(10 * MIN) // 1 min → 11 min (início do próximo)
    expect(second).toMatchObject({ name: 'Azmerian Ranges', entries: 2, level: 80 })
    expect(second!.mapMs).toBe(7 * MIN) // 11 → 18, incluindo a subárea
  })

  it('mostra o mapa atual ao vivo e as estatísticas da sessão', () => {
    const { snap } = run(lines, T0 + 23 * MIN)
    expect(snap.currentRun).toMatchObject({ name: 'Wetlands', open: true, mapMs: 2 * MIN })
    expect(snap.area?.inRun).toBe(true)
    expect(snap.session?.maps).toBe(3)
    // 2 ciclos encerrados de 10 min cada = 6 mapas por hora.
    expect(snap.session?.mapsPerHour).toBeCloseTo(6, 5)
    expect(snap.session?.avgMapMs).toBe((7 * MIN + 20_000 + 7 * MIN) / 2)
    expect(snap.session?.deaths).toBe(1)
    expect(snap.gap).toMatchObject({ diff: -1, status: 'ok' })
  })

  it('separa sessões e encerra a corrida após muito tempo fora do mapa', () => {
    const later = [...lines, gen(24, 65, 'HideoutFelled', 1), gen(90, 79, 'MapBluff', 5005)]
    const { snap } = run(later, T0 + 95 * MIN)
    const wetlands = snap.recentRuns[0]!
    expect(wetlands.name).toBe('Wetlands')
    expect(wetlands.cycleMs).toBe(3 * MIN) // termina ao sair do mapa, sem contar a pausa
    expect(snap.session?.maps).toBe(1)
    expect(snap.overall?.maps).toBe(4)
  })

  it('voltar à campanha ou reabrir o jogo encerra a corrida', () => {
    const campaign = run([...lines, gen(24, 2, 'G1_2', 9)], T0 + 25 * MIN)
    expect(campaign.snap.currentRun).toBeNull()
    const reopened = run([...lines, '2025/01/10 20:30:00 ***** LOG FILE OPENING *****'], T0 + 31 * MIN)
    expect(reopened.snap.currentRun).toBeNull()
    expect(reopened.snap.area).toBeNull()
  })

  it('usa margem configurável no lugar da fórmula', () => {
    const { snap } = run(lines, T0 + 23 * MIN, resolveTrackerOptions({ safeZoneOverride: 0 }))
    expect(snap.gap).toMatchObject({ safeZone: 0, status: 'penalty' })
  })

  it('rejeita opções inválidas', () => {
    expect(() => resolveTrackerOptions({ mapMinLevel: 0 })).toThrow()
  })

  it('não muta o estado anterior', () => {
    const events = parseLines(lines.join('\n'))
    const before = applyEvents(initialTrackerState(), events.slice(0, 5))
    const copy = JSON.parse(JSON.stringify(before))
    applyEvents(before, events.slice(5))
    expect(before).toEqual(copy)
  })
})
