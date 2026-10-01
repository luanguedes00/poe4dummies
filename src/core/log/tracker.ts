// Tracker de campanha e de mapas a partir dos eventos do log (`clientLog.ts`).
// Tudo aqui é PURO: o estado é um objeto simples (serializável em JSON) e cada
// evento gera um estado novo, sem mutar o anterior. O relógio entra como
// parâmetro (`now`), nunca é lido daqui.
//
// Decisões documentadas:
//
// 1. Tipo de área, pelo id interno do "Generating level N area "<id>"" (ids
//    conferidos no world_areas.json do RePoE para PoE2):
//    - cidade: termina em "_town" (G1_town, P1_Town...) ou G_Endgame_Town;
//    - hideout: começa com "Hideout", "MapHideout", "PersonalHideout" ou "GuildHideout";
//    - campanha: "G<n>_..." (ato n) e "P<n>_..." (interlúdio n). "C_G<n>_" (cruel antigo) conta como ato n;
//    - mapa: começa com "Map" (waystones: MapBluff, MapAzmerianRanges...);
//    - fim de jogo: qualquer outra área com nível >= `mapMinLevel` (padrão 65:
//      Expedition, Delirium, Breach, chefes...). Também abre uma corrida de mapa.
//
// 2. Corrida de mapa: começa quando se entra num mapa/área de fim de jogo vindo
//    de cidade, hideout ou do nada. Voltar pelo portal ao mesmo mapa (mesmo id e
//    seed) continua a mesma corrida. Ir direto de um mapa para outra área de fim
//    de jogo (ex.: subárea de Expedition) conta como parte da mesma corrida.
//    A corrida termina ao abrir outro mapa, entrar na campanha, reabrir o jogo ou
//    ficar mais de `sessionGapMs` fora do mapa.
//
// 3. Tempo: cada evento soma o tempo desde o evento anterior ao lugar onde o
//    jogador estava, limitado a `idleCapMs` (evita contar a noite em que o jogo
//    ficou aberto parado). "Tempo no mapa" é só o tempo dentro do mapa. "Ciclo"
//    é do início de um mapa até o início do próximo (inclui hideout), e é a base
//    de "mapas por hora".
//
// 4. Penalidade de XP. Fonte: fórmula do PoE1 documentada na wiki
//    (poewiki.net/wiki/Experience, reproduzida em calculadoras da comunidade):
//      zonaSegura = floor(3 + nivelPersonagem / 16)
//      diferencaEfetiva = max(|nivelPersonagem - nivelArea| - zonaSegura, 0)
//      multiplicador = max(((nivel + 5) / (nivel + 5 + diferencaEfetiva^2.5))^1.5, 0.01)
//    Para o PoE2, a comunidade confirma a zona segura (3 + nível/16), mas a GGG
//    não publicou a curva completa (o Exile-UI diz que "a fórmula exata é
//    desconhecida"). Por isso o multiplicador é marcado como estimativa e a
//    zona segura pode ser substituída por uma margem fixa (`safeZoneOverride`).
//    O ajuste de nível de monstro acima de 70 do PoE1 não é aplicado.

import { z } from 'zod'
import type { LogEvent } from './clientLog'

// ---------------------------------------------------------------------------
// Opções

export const trackerOptionsSchema = z
  .object({
    /** Nível mínimo para uma área desconhecida contar como fim de jogo. */
    mapMinLevel: z.number().int().min(1).max(100),
    /** Margem fixa de níveis sem penalidade. null = fórmula 3 + nível/16. */
    safeZoneOverride: z.number().int().min(0).max(30).nullable(),
    /** Maior intervalo entre dois eventos que ainda conta como jogo ativo. */
    idleCapMs: z.number().int().min(60_000).max(6 * 3_600_000),
    /** Tempo fora do mapa que encerra a corrida e separa sessões de farm. */
    sessionGapMs: z.number().int().min(60_000).max(6 * 3_600_000),
    /** Quantas corridas de mapa manter no estado. */
    maxRuns: z.number().int().min(1).max(5000),
  })
  .strict()

export type TrackerOptions = z.infer<typeof trackerOptionsSchema>

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  mapMinLevel: 65,
  safeZoneOverride: null,
  idleCapMs: 30 * 60_000,
  sessionGapMs: 20 * 60_000,
  maxRuns: 500,
}

/** Junta opções parciais com o padrão, validando (lança erro se inválido). */
export function resolveTrackerOptions(partial: Partial<TrackerOptions> = {}): TrackerOptions {
  return trackerOptionsSchema.parse({ ...DEFAULT_TRACKER_OPTIONS, ...partial })
}

// ---------------------------------------------------------------------------
// Áreas

export type AreaKind = 'town' | 'hideout' | 'campaign' | 'map' | 'endgame' | 'other'

export interface ActRef {
  kind: 'act' | 'interlude'
  number: number
}

export function actKey(act: ActRef): string {
  return `${act.kind}-${act.number}`
}

/** Ato da campanha pelo id da área (G1_4 → ato 1; P2_3 → interlúdio 2; G2_town → ato 2). */
export function actOf(areaId: string): ActRef | null {
  let m = /^(?:C_)?G(\d{1,2})_(?!WorldMap)/i.exec(areaId)
  if (m) return { kind: 'act', number: Number(m[1]) }
  m = /^P(\d{1,2})_(?!WorldMap)/i.exec(areaId)
  if (m) return { kind: 'interlude', number: Number(m[1]) }
  return null
}

export function classifyArea(areaId: string, level: number, options: Pick<TrackerOptions, 'mapMinLevel'> = DEFAULT_TRACKER_OPTIONS): AreaKind {
  if (/^(?:Map)?Hideout|^PersonalHideout|^GuildHideout/i.test(areaId)) return 'hideout'
  if (/_town$/i.test(areaId) || /^G_Endgame_Town$/i.test(areaId) || /^CurrentTown$/i.test(areaId)) return 'town'
  if (actOf(areaId)) return 'campaign'
  if (/^Map/i.test(areaId)) return 'map'
  if (level >= options.mapMinLevel) return 'endgame'
  return 'other'
}

/** Nome legível a partir do id quando o log não trouxe o nome ("MapAzmerianRanges" → "Azmerian Ranges"). */
export function areaNameFromId(areaId: string): string {
  const base = areaId
    .replace(/^Map(?:Unique)?/, '')
    .replace(/_+$/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return base || areaId
}

function countsAsMap(kind: AreaKind): boolean {
  return kind === 'map' || kind === 'endgame'
}

// ---------------------------------------------------------------------------
// Estado

export interface CharacterInfo {
  name: string
  className: string
  level: number
  /** Horário do último "is now level". */
  at: number
}

export interface AreaInfo {
  /** null quando só se sabe o nome (logs antigos, sem "Generating level"). */
  id: string | null
  name: string | null
  level: number | null
  seed: string | null
  kind: AreaKind
  act: ActRef | null
  enteredAt: number
  /** Esta área faz parte da corrida de mapa aberta. */
  inRun: boolean
}

export interface MapRun {
  id: number
  session: number
  areaId: string
  name: string | null
  level: number
  seed: string
  character: string | null
  startedAt: number
  /** Último momento em que o jogador estava dentro do mapa. */
  lastInMapAt: number
  /** Fim do ciclo: início do próximo mapa da mesma sessão, ou `lastInMapAt`. null = aberta. */
  endedAt: number | null
  /** Tempo dentro do mapa (e subáreas), com o limite de inatividade. */
  mapMs: number
  /** Quantas vezes entrou no mapa (1 + portais de volta). */
  entries: number
  deaths: number
}

export interface ActProgress {
  key: string
  act: ActRef
  firstAt: number
  /** Tempo ativo acumulado dentro do ato (inclui a cidade do ato). */
  ms: number
}

export interface TrackerState {
  version: 1
  character: CharacterInfo | null
  area: AreaInfo | null
  /** Horário do último evento processado. */
  lastAt: number | null
  runs: MapRun[]
  openRunId: number | null
  nextRunId: number
  session: number
  /** Tempo por ato do personagem atual, na ordem em que os atos foram visitados. */
  acts: ActProgress[]
  /** Mortes do personagem atual. */
  deaths: number
}

export function initialTrackerState(): TrackerState {
  return {
    version: 1,
    character: null,
    area: null,
    lastAt: null,
    runs: [],
    openRunId: null,
    nextRunId: 1,
    session: 0,
    acts: [],
    deaths: 0,
  }
}

// ---------------------------------------------------------------------------
// Redutor

function openRun(state: TrackerState): MapRun | null {
  if (state.openRunId === null) return null
  return state.runs.find((r) => r.id === state.openRunId) ?? null
}

function updateRun(state: TrackerState, id: number, patch: Partial<MapRun>): TrackerState {
  return { ...state, runs: state.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) }
}

function closeOpenRun(state: TrackerState, endedAt?: number): TrackerState {
  const run = openRun(state)
  if (!run) return state
  const next = updateRun(state, run.id, { endedAt: Math.max(endedAt ?? run.lastInMapAt, run.startedAt) })
  return { ...next, openRunId: null }
}

/** Soma o tempo decorrido ao lugar onde o jogador estava. */
function attribute(state: TrackerState, at: number, options: TrackerOptions): TrackerState {
  if (state.lastAt === null || !state.area) return state
  const delta = Math.min(Math.max(at - state.lastAt, 0), options.idleCapMs)
  if (delta === 0) return state
  let next = state
  const area = state.area
  const run = openRun(state)
  if (run && area.inRun) next = updateRun(next, run.id, { mapMs: run.mapMs + delta, lastInMapAt: at })
  if (area.act) {
    const key = actKey(area.act)
    next = { ...next, acts: next.acts.map((a) => (a.key === key ? { ...a, ms: a.ms + delta } : a)) }
  }
  return next
}

function touchAct(state: TrackerState, act: ActRef, at: number): TrackerState {
  const key = actKey(act)
  if (state.acts.some((a) => a.key === key)) return state
  return { ...state, acts: [...state.acts, { key, act, firstAt: at, ms: 0 }] }
}

function enterArea(state: TrackerState, e: Extract<LogEvent, { type: 'area-generated' }>, options: TrackerOptions): TrackerState {
  const kind = classifyArea(e.areaId, e.level, options)
  const act = actOf(e.areaId)
  const previous = state.area
  let next = state
  let inRun = false

  if (countsAsMap(kind)) {
    const run = openRun(next)
    if (run && run.areaId === e.areaId && run.seed === e.seed) {
      // Voltou pelo portal ao mesmo mapa.
      next = updateRun(next, run.id, { entries: run.entries + 1, lastInMapAt: e.at })
      inRun = true
    } else if (run && previous?.inRun) {
      // Subárea aberta de dentro do mapa (Expedition, Abyss, etc.).
      next = updateRun(next, run.id, { lastInMapAt: e.at })
      inRun = true
    } else {
      // Mapa novo. O ciclo anterior termina aqui se for da mesma sessão.
      const sameSession = run !== null && e.at - run.lastInMapAt <= options.sessionGapMs
      next = closeOpenRun(next, sameSession ? e.at : undefined)
      const last = next.runs[next.runs.length - 1]
      const newSession = !last || e.at - (last.endedAt ?? last.lastInMapAt) > options.sessionGapMs
      const session = newSession ? next.session + 1 : next.session
      const created: MapRun = {
        id: next.nextRunId,
        session,
        areaId: e.areaId,
        name: null,
        level: e.level,
        seed: e.seed,
        character: next.character?.name ?? null,
        startedAt: e.at,
        lastInMapAt: e.at,
        endedAt: null,
        mapMs: 0,
        entries: 1,
        deaths: 0,
      }
      const runs = [...next.runs, created]
      next = {
        ...next,
        runs: runs.length > options.maxRuns ? runs.slice(runs.length - options.maxRuns) : runs,
        openRunId: created.id,
        nextRunId: created.id + 1,
        session,
      }
      inRun = true
    }
  } else {
    const run = openRun(next)
    if (run && previous?.inRun) next = updateRun(next, run.id, { lastInMapAt: e.at })
    // Voltar para a campanha encerra o farm de mapas.
    if (kind === 'campaign') next = closeOpenRun(next)
  }

  if (act) next = touchAct(next, act, e.at)

  const area: AreaInfo = { id: e.areaId, name: null, level: e.level, seed: e.seed, kind, act, enteredAt: e.at, inRun }
  return { ...next, area }
}

/** Nome da cena chega logo depois do "Generating level". Sem ele (logs antigos), cria a área só com o nome. */
function nameArea(state: TrackerState, e: Extract<LogEvent, { type: 'area-entered' }>): TrackerState {
  const area = state.area
  if (area && area.name === e.name) return state
  if (area && area.id !== null) {
    // A área veio do "Generating level": a cena só dá o nome. Nunca troca id nem nível.
    if (area.name !== null && e.at - area.enteredAt > 5_000) return state
    let next: TrackerState = { ...state, area: { ...area, name: e.name } }
    const run = openRun(next)
    if (run && area.inRun && run.areaId === area.id && run.name === null) next = updateRun(next, run.id, { name: e.name })
    return next
  }
  const kind: AreaKind = /hideout/i.test(e.name) ? 'hideout' : 'other'
  const run = openRun(state)
  let next = state
  if (run && area?.inRun) next = updateRun(next, run.id, { lastInMapAt: e.at })
  return { ...next, area: { id: null, name: e.name, level: null, seed: null, kind, act: null, enteredAt: e.at, inRun: false } }
}

function levelUp(state: TrackerState, e: Extract<LogEvent, { type: 'level-up' }>): TrackerState {
  const character: CharacterInfo = { name: e.character, className: e.className, level: e.level, at: e.at }
  if (state.character && state.character.name !== e.character) {
    // Outro personagem: tempo por ato e mortes recomeçam a partir do ato atual.
    const act = state.area?.act ?? null
    return {
      ...state,
      character,
      deaths: 0,
      acts: act ? [{ key: actKey(act), act, firstAt: e.at, ms: 0 }] : [],
    }
  }
  return { ...state, character }
}

function death(state: TrackerState, e: Extract<LogEvent, { type: 'death' }>): TrackerState {
  // Em grupo, o log também mostra mortes de outros jogadores.
  if (state.character && state.character.name !== e.character) return state
  let next: TrackerState = { ...state, deaths: state.deaths + 1 }
  const run = openRun(next)
  if (run && next.area?.inRun) next = updateRun(next, run.id, { deaths: run.deaths + 1 })
  return next
}

/** Aplica um evento ao estado e devolve o estado novo. Eventos fora de ordem não voltam o relógio. */
export function applyEvent(state: TrackerState, event: LogEvent, options: TrackerOptions = DEFAULT_TRACKER_OPTIONS): TrackerState {
  let next = attribute(state, event.at, options)
  const at = Math.max(event.at, state.lastAt ?? event.at)
  next = { ...next, lastAt: at }
  const e = { ...event, at } as LogEvent

  // Muito tempo fora do mapa encerra a corrida aberta.
  const run = openRun(next)
  if (run && !next.area?.inRun && at - run.lastInMapAt > options.sessionGapMs) next = closeOpenRun(next)

  switch (e.type) {
    case 'log-opened': {
      // Jogo reaberto: não se sabe mais onde o jogador está.
      const r = openRun(next)
      if (r && next.area?.inRun) next = updateRun(next, r.id, { lastInMapAt: at })
      return closeOpenRun({ ...next, area: null })
    }
    case 'area-generated':
      return enterArea(next, e, options)
    case 'area-entered':
      return nameArea(next, e)
    case 'level-up':
      return levelUp(next, e)
    case 'death':
      return death(next, e)
    case 'afk':
      return next
  }
}

/** Aplica vários eventos em sequência. */
export function applyEvents(state: TrackerState, events: readonly LogEvent[], options: TrackerOptions = DEFAULT_TRACKER_OPTIONS): TrackerState {
  let next = state
  for (const e of events) next = applyEvent(next, e, options)
  return next
}

// ---------------------------------------------------------------------------
// Penalidade de XP

/** Níveis de diferença sem penalidade (fórmula da wiki; a comunidade confirma para o PoE2). */
export function safeZone(characterLevel: number, override: number | null = null): number {
  if (override !== null) return override
  return Math.floor(3 + characterLevel / 16)
}

/** Multiplicador de XP estimado (fórmula do PoE1; a curva exata do PoE2 não é pública). */
export function xpMultiplier(characterLevel: number, areaLevel: number, override: number | null = null): number {
  const effective = Math.max(Math.abs(characterLevel - areaLevel) - safeZone(characterLevel, override), 0)
  const m = ((characterLevel + 5) / (characterLevel + 5 + effective ** 2.5)) ** 1.5
  return Math.max(m, 0.01)
}

export interface LevelGap {
  /** Nível do personagem menos o da área. Negativo: personagem abaixo da área. */
  diff: number
  direction: 'under' | 'over' | 'even'
  safeZone: number
  /** ok: XP cheia | edge: no limite da zona segura | penalty: perdendo XP */
  status: 'ok' | 'edge' | 'penalty'
  /** Estimativa (0,01 a 1). */
  xpMultiplier: number
}

export function levelGap(characterLevel: number, areaLevel: number, override: number | null = null): LevelGap {
  const diff = characterLevel - areaLevel
  const zone = safeZone(characterLevel, override)
  const abs = Math.abs(diff)
  return {
    diff,
    direction: diff < 0 ? 'under' : diff > 0 ? 'over' : 'even',
    safeZone: zone,
    status: abs > zone ? 'penalty' : abs === zone && zone > 0 ? 'edge' : 'ok',
    xpMultiplier: xpMultiplier(characterLevel, areaLevel, override),
  }
}

// ---------------------------------------------------------------------------
// Visão para a interface (derivada, com o relógio atual)

export interface RunView {
  id: number
  areaId: string
  name: string
  level: number
  startedAt: number
  /** Tempo dentro do mapa, ao vivo para a corrida aberta. */
  mapMs: number
  /** Duração do ciclo (até o próximo mapa ou até agora). */
  cycleMs: number
  entries: number
  deaths: number
  open: boolean
}

export interface RunStats {
  /** Corridas iniciadas (inclui a aberta). */
  maps: number
  /** Mapas por hora, com base nos ciclos encerrados. null sem dados suficientes. */
  mapsPerHour: number | null
  /** Tempo médio dentro do mapa, só corridas encerradas. */
  avgMapMs: number | null
  /** Tempo total dos ciclos (inclui a corrida aberta). */
  totalMs: number
  deaths: number
}

export interface ActView {
  key: string
  act: ActRef
  ms: number
  current: boolean
}

export interface TrackerSnapshot {
  now: number
  character: CharacterInfo | null
  area: {
    id: string | null
    name: string
    /** false enquanto o nome é provisório, tirado do código da área ("G4 11"); o nome real chega logo depois. */
    nameKnown: boolean
    level: number | null
    kind: AreaKind
    act: ActRef | null
    enteredAt: number
    /** Dentro da corrida de mapa aberta (o cronômetro do mapa está correndo). */
    inRun: boolean
  } | null
  /** Só em áreas com monstros (campanha, mapa, fim de jogo) e com o nível do personagem conhecido. */
  gap: LevelGap | null
  currentRun: RunView | null
  /** Corridas encerradas, mais recentes primeiro (até 50). */
  recentRuns: RunView[]
  /** Sessão de farm atual (mapas com intervalos menores que `sessionGapMs`). */
  session: RunStats | null
  overall: RunStats | null
  acts: ActView[]
  deaths: number
  lastEventAt: number | null
  /** Limite de inatividade usado nas contas (a interface usa para o cronômetro ao vivo). */
  idleCapMs: number
}

function liveDelta(state: TrackerState, now: number, options: TrackerOptions): number {
  if (state.lastAt === null || !state.area) return 0
  return Math.min(Math.max(now - state.lastAt, 0), options.idleCapMs)
}

function runView(run: MapRun, state: TrackerState, now: number, options: TrackerOptions): RunView {
  const open = run.id === state.openRunId
  const live = open && state.area?.inRun ? liveDelta(state, now, options) : 0
  const end = open ? Math.max(now, run.lastInMapAt) : (run.endedAt ?? run.lastInMapAt)
  return {
    id: run.id,
    areaId: run.areaId,
    name: run.name ?? areaNameFromId(run.areaId),
    level: run.level,
    startedAt: run.startedAt,
    mapMs: run.mapMs + live,
    cycleMs: Math.max(end - run.startedAt, 0),
    entries: run.entries,
    deaths: run.deaths,
    open,
  }
}

function stats(runs: RunView[]): RunStats | null {
  if (runs.length === 0) return null
  const closed = runs.filter((r) => !r.open)
  const closedCycle = closed.reduce((sum, r) => sum + r.cycleMs, 0)
  return {
    maps: runs.length,
    mapsPerHour: closed.length > 0 && closedCycle > 0 ? (closed.length * 3_600_000) / closedCycle : null,
    avgMapMs: closed.length > 0 ? closed.reduce((sum, r) => sum + r.mapMs, 0) / closed.length : null,
    totalMs: runs.reduce((sum, r) => sum + r.cycleMs, 0),
    deaths: runs.reduce((sum, r) => sum + r.deaths, 0),
  }
}

/** Monta a visão para a interface. `now` vem de fora para manter a função pura. */
export function trackerSnapshot(state: TrackerState, now: number, options: TrackerOptions = DEFAULT_TRACKER_OPTIONS): TrackerSnapshot {
  const area = state.area
  const character = state.character
  const views = state.runs.map((r) => runView(r, state, now, options))
  const current = views.find((r) => r.open) ?? null
  const lastSession = state.runs[state.runs.length - 1]?.session ?? null
  // A sessão só é "atual" se ainda há corrida aberta ou o último mapa terminou há pouco.
  const lastRun = views[views.length - 1]
  const sessionActive = lastRun !== undefined && (lastRun.open || now - (lastRun.startedAt + lastRun.cycleMs) <= options.sessionGapMs)
  const sessionRuns = sessionActive && lastSession !== null ? views.filter((_, i) => state.runs[i]!.session === lastSession) : []

  const hasMonsters = area !== null && (area.kind === 'campaign' || area.kind === 'map' || area.kind === 'endgame')
  const gap =
    character && area && area.level !== null && hasMonsters ? levelGap(character.level, area.level, options.safeZoneOverride) : null

  const currentActKey = area?.act ? actKey(area.act) : null
  const actLive = liveDelta(state, now, options)

  return {
    now,
    character,
    area: area
      ? {
          id: area.id,
          name: area.name ?? (area.id ? areaNameFromId(area.id) : ''),
          nameKnown: area.name !== null,
          level: area.level,
          kind: area.kind,
          act: area.act,
          enteredAt: area.enteredAt,
          inRun: area.inRun,
        }
      : null,
    gap,
    currentRun: current,
    recentRuns: views.filter((r) => !r.open).reverse().slice(0, 50),
    session: stats(sessionRuns),
    overall: stats(views),
    acts: state.acts.map((a) => ({
      key: a.key,
      act: a.act,
      ms: a.ms + (a.key === currentActKey ? actLive : 0),
      current: a.key === currentActKey,
    })),
    deaths: state.deaths,
    lastEventAt: state.lastAt,
    idleCapMs: options.idleCapMs,
  }
}
