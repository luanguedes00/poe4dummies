// Tela "Campanha e mapas": nível do personagem contra o nível da área, tempo
// por ato e estatísticas de mapas, tudo lido do log local do jogo (Client.txt).
// Recebe estado e ações por props (não chama window.oraculo), para poder ser
// ligada ao IPC em main.tsx e testada isoladamente.

import { useEffect, useMemo, useState } from 'react'
import type { LogSourceStatus } from '../../../core/log/clientLog'
import type { SessionView } from '../../../core/log/playSession'
import type { ActRef, AreaKind, LevelGap, RunStats, RunView, TrackerSnapshot } from '../../../core/log/tracker'
import { EmptyState, Hint } from '../components/ui'
import { useSticky } from '../lib/sticky'
import { api, useApp } from '../lib/app'
import { GUIDE_SOURCE, zoneGuide } from '../../../core/campaign/guide'
import { ZoneCard } from '../components/ZoneCard'

/** Chaves de texto desta tela (precisam existir em src/shared/i18n.ts, pt-BR e en). */
export type TrackerMessageKey =
  | 'tracker.title'
  | 'tracker.intro'
  | 'tracker.tab.campaign'
  | 'tracker.tab.maps'
  | 'tracker.status.off'
  | 'tracker.status.searching'
  | 'tracker.status.missing'
  | 'tracker.status.missingHint'
  | 'tracker.status.error'
  | 'tracker.status.reading'
  | 'tracker.status.idle'
  | 'tracker.action.choose'
  | 'tracker.action.auto'
  | 'tracker.action.reload'
  | 'tracker.empty.title'
  | 'tracker.empty.text'
  | 'tracker.character'
  | 'tracker.character.unknown'
  | 'tracker.character.level'
  | 'tracker.area'
  | 'tracker.area.none'
  | 'tracker.area.level'
  | 'tracker.kind.town'
  | 'tracker.kind.hideout'
  | 'tracker.kind.campaign'
  | 'tracker.kind.map'
  | 'tracker.kind.endgame'
  | 'tracker.kind.other'
  | 'tracker.act'
  | 'tracker.interlude'
  | 'tracker.gap'
  | 'tracker.gap.even'
  | 'tracker.gap.under'
  | 'tracker.gap.under1'
  | 'tracker.gap.over'
  | 'tracker.gap.over1'
  | 'tracker.gap.none'
  | 'tracker.xp.ok'
  | 'tracker.xp.edge'
  | 'tracker.xp.penalty'
  | 'tracker.xp.estimate'
  | 'tracker.xp.hint'
  | 'tracker.acts'
  | 'tracker.acts.empty'
  | 'tracker.acts.total'
  | 'tracker.col.act'
  | 'tracker.col.time'
  | 'tracker.deaths'
  | 'tracker.map.current'
  | 'tracker.map.none'
  | 'tracker.map.time'
  | 'tracker.map.portals'
  | 'tracker.session'
  | 'tracker.overall'
  | 'tracker.stat.maps'
  | 'tracker.stat.perHour'
  | 'tracker.stat.avg'
  | 'tracker.stat.total'
  | 'tracker.stat.deaths'
  | 'tracker.stat.hint'
  | 'tracker.runs'
  | 'tracker.runs.empty'
  | 'tracker.col.map'
  | 'tracker.col.level'
  | 'tracker.col.inMap'
  | 'tracker.col.cycle'
  | 'tracker.col.deaths'
  | 'tracker.col.start'
  | 'tracker.play.played'
  | 'tracker.play.open'
  | 'tracker.play.live'
  | 'tracker.play.last'
  | 'tracker.play.since'
  | 'tracker.play.range'
  | 'tracker.stat.empty'
  | 'tracker.play.endgame'
  | 'tracker.play.story'
  | 'tracker.play.maps'
  | 'tracker.play.hideout'
  | 'tracker.play.campaign'
  | 'tracker.play.town'
  | 'tracker.play.other'
  | 'tracker.play.idle'
  | 'tracker.play.hint'
  | 'tracker.play.history'

export type TrackerTranslate = (key: TrackerMessageKey, params?: Record<string, string | number>) => string

export interface TrackerPageProps {
  t: TrackerTranslate
  locale: string
  /** null enquanto o processo principal não enviou nada. */
  snapshot: TrackerSnapshot | null
  status: LogSourceStatus
  /** Sessões de jogo (abrir → fechar o jogo), mais recentes primeiro. */
  sessions?: SessionView[]
  /** Abre o seletor de arquivo (Client.txt) no processo principal. */
  onChooseFile: () => void
  /** Volta a procurar o log no caminho padrão. */
  onUseAutomatic: () => void
  /** Reprocessa o histórico recente do log. */
  onReload?: () => void
}

type Tab = 'campaign' | 'maps'

/** "1:05:09" ou "5:09". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '–'
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Relógio de 1 s para os cronômetros ao vivo. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

/** Tempo que passou desde que o snapshot foi montado, respeitando o limite de inatividade. */
function liveExtra(snapshot: TrackerSnapshot, now: number): number {
  if (snapshot.lastEventAt === null) return 0
  const cap = snapshot.idleCapMs
  const atSnapshot = Math.min(Math.max(snapshot.now - snapshot.lastEventAt, 0), cap)
  const atNow = Math.min(Math.max(now - snapshot.lastEventAt, 0), cap)
  return Math.max(atNow - atSnapshot, 0)
}

function actLabel(t: TrackerTranslate, act: ActRef): string {
  return t(act.kind === 'act' ? 'tracker.act' : 'tracker.interlude', { n: act.number })
}

const KIND_KEY: Record<AreaKind, TrackerMessageKey> = {
  town: 'tracker.kind.town',
  hideout: 'tracker.kind.hideout',
  campaign: 'tracker.kind.campaign',
  map: 'tracker.kind.map',
  endgame: 'tracker.kind.endgame',
  other: 'tracker.kind.other',
}

function gapText(t: TrackerTranslate, gap: LevelGap): string {
  const n = Math.abs(gap.diff)
  if (gap.direction === 'even') return t('tracker.gap.even')
  if (gap.direction === 'under') return t(n === 1 ? 'tracker.gap.under1' : 'tracker.gap.under', { n })
  return t(n === 1 ? 'tracker.gap.over1' : 'tracker.gap.over', { n })
}

// Reaproveita os selos de tendência do mercado: verde, âmbar e vermelho.
const GAP_CLASS: Record<LevelGap['status'], string> = { ok: 'sig rising', edge: 'sig fading', penalty: 'sig falling' }
const GAP_KEY: Record<LevelGap['status'], TrackerMessageKey> = { ok: 'tracker.xp.ok', edge: 'tracker.xp.edge', penalty: 'tracker.xp.penalty' }

function StatusBanner({ t, status, onChooseFile, onUseAutomatic, onReload }: Omit<TrackerPageProps, 'snapshot' | 'locale'>) {
  if (status.state === 'watching') {
    return (
      <div className="toolbar">
        <span className="fine">
          {t('tracker.status.reading')} <span className="num">{status.path}</span>
        </span>
        <span className="actions" style={{ marginLeft: 'auto' }}>
          {onReload && (
            <button className="btn small ghost" type="button" onClick={onReload}>
              {t('tracker.action.reload')}
            </button>
          )}
          <button className="btn small" type="button" onClick={onChooseFile}>
            {t('tracker.action.choose')}
          </button>
        </span>
      </div>
    )
  }
  if (status.state === 'missing' || status.state === 'error') {
    return (
      <div className="banner" role="alert">
        <span>
          {status.state === 'missing' ? t('tracker.status.missing') : t('tracker.status.error')}
          <br />
          <small>{status.path ? <span className="num">{status.path}</span> : t('tracker.status.missingHint')}</small>
        </span>
        <span className="actions">
          {status.path && (
            <button className="btn small" type="button" onClick={onUseAutomatic}>
              {t('tracker.action.auto')}
            </button>
          )}
          <button className="btn small primary" type="button" onClick={onChooseFile}>
            {t('tracker.action.choose')}
          </button>
        </span>
      </div>
    )
  }
  return <div className="banner info">{status.state === 'off' ? t('tracker.status.off') : t('tracker.status.searching')}</div>
}

function StatsList({ t, stats, locale }: { t: TrackerTranslate; stats: RunStats | null; locale: string }) {
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  if (!stats) return <p className="muted" style={{ margin: 0 }}>{t('tracker.stat.empty')}</p>
  return (
    <dl className="stats">
      <div>
        <dt>{t('tracker.stat.maps')}</dt>
        <dd>{stats ? stats.maps : '–'}</dd>
      </div>
      <div>
        <dt>{t('tracker.stat.perHour')}</dt>
        <dd>{stats?.mapsPerHour != null ? fmt.format(stats.mapsPerHour) : '–'}</dd>
      </div>
      <div>
        <dt>{t('tracker.stat.avg')}</dt>
        <dd>{formatDuration(stats?.avgMapMs ?? null)}</dd>
      </div>
      <div>
        <dt>{t('tracker.stat.total')}</dt>
        <dd>{formatDuration(stats?.totalMs ?? null)}</dd>
      </div>
      <div>
        <dt>{t('tracker.stat.deaths')}</dt>
        <dd>{stats ? stats.deaths : '–'}</dd>
      </div>
    </dl>
  )
}

/** O que fazer na área atual (mesmo guia do aviso no jogo). */
function ZoneNow({ areaName }: { areaName: string | null }) {
  const { t } = useApp()
  const [note, setNote] = useState<string | null>(null)
  const zone = zoneGuide(areaName)
  // Reabre o quadro da campanha depois de fechado no ✕ (sem reiniciar o app).
  const show = async () => setNote((await api.showCampaign()) ? null : t('zone.showNone'))
  const button = (
    <div className="zone-show">
      <button className="btn small" type="button" onClick={() => void show()}>
        {t('zone.show')}
      </button>
      {note && <small className="muted">{note}</small>}
    </div>
  )
  if (!zone || !areaName) return <div className="card">{button}</div>
  return (
    <div className="card">
      {button}
      <ZoneCard area={areaName} zone={zone} />
      <p className="fine">{t('zone.source', { source: GUIDE_SOURCE.label, date: GUIDE_SOURCE.date.split('-').reverse().join('/') })}</p>
    </div>
  )
}

function CampaignView({ t, snapshot, extra }: { t: TrackerTranslate; snapshot: TrackerSnapshot; extra: number }) {
  const { character, area, gap } = snapshot
  const acts = snapshot.acts.map((a) => ({ ...a, ms: a.ms + (a.current ? extra : 0) }))
  const total = acts.reduce((sum, a) => sum + a.ms, 0)

  return (
    <>
      <div className="cols3">
        <div className="card">
          <div className="label">{t('tracker.character')}</div>
          {character ? (
            <>
              <h3>{character.name}</h3>
              <div className="muted">{character.className}</div>
              <div className="level-big">{t('tracker.character.level', { n: character.level })}</div>
            </>
          ) : (
            <p className="muted">{t('tracker.character.unknown')}</p>
          )}
        </div>

        <div className="card">
          <div className="label">{t('tracker.area')}</div>
          {area ? (
            <>
              <h3>{area.name || '–'}</h3>
              <div className="muted">
                {area.act ? actLabel(t, area.act) : t(KIND_KEY[area.kind])}
              </div>
              <div className="level-big">{area.level !== null ? t('tracker.area.level', { n: area.level }) : '–'}</div>
            </>
          ) : (
            <p className="muted">{t('tracker.area.none')}</p>
          )}
        </div>

        <div className="card">
          <div className="label">
            {t('tracker.gap')} {gap && <Hint text={t('tracker.xp.hint', { n: gap.safeZone })} align="right" />}
          </div>
          {gap ? (
            <>
              <h3>{gapText(t, gap)}</h3>
              <span className={GAP_CLASS[gap.status]}>{t(GAP_KEY[gap.status])}</span>
              <p className="fine" style={{ marginTop: 8 }}>
                {t('tracker.xp.estimate', { value: Math.round(gap.xpMultiplier * 100) })}
              </p>
            </>
          ) : (
            <p className="muted">{t('tracker.gap.none')}</p>
          )}
        </div>
      </div>

      <ZoneNow areaName={area?.name ?? null} />

      <div className="card">
        <h3>{t('tracker.acts')}</h3>
        {acts.length === 0 ? (
          <p className="muted">{t('tracker.acts.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th aria-hidden="true" />
                  <th>{t('tracker.col.act')}</th>
                  <th className="r">{t('tracker.col.time')}</th>
                </tr>
              </thead>
              <tbody>
                {acts.map((a) => (
                  <tr key={a.key} className={a.current ? 'sel' : ''} aria-current={a.current ? 'step' : undefined}>
                    <td />
                    <td>{actLabel(t, a.act)}</td>
                    <td className="r num">{formatDuration(a.ms)}</td>
                  </tr>
                ))}
                <tr>
                  <td />
                  <td>
                    <b>{t('tracker.acts.total')}</b>
                  </td>
                  <td className="r num">
                    <b>{formatDuration(total)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="fine" style={{ marginTop: 8 }}>
          {t('tracker.deaths', { n: snapshot.deaths })}
        </p>
      </div>
    </>
  )
}

function MapsView({ t, snapshot, extra, locale }: { t: TrackerTranslate; snapshot: TrackerSnapshot; extra: number; locale: string }) {
  const run: RunView | null = snapshot.currentRun
  const inRun = snapshot.area?.inRun ?? false
  const time = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])

  return (
    <>
      <div className="cols3">
        <div className="card">
          <div className="label">{t('tracker.map.current')}</div>
          {run ? (
            <>
              <h3>{run.name}</h3>
              <div className="muted">{t('tracker.area.level', { n: run.level })}</div>
              <div className="price-big">{formatDuration(run.mapMs + (inRun ? extra : 0))}</div>
              <p className="fine">
                {t('tracker.map.time')} · {t('tracker.map.portals', { n: run.entries })} · {t('tracker.deaths', { n: run.deaths })}
              </p>
            </>
          ) : (
            <p className="muted">{t('tracker.map.none')}</p>
          )}
        </div>
        <div className="card">
          <h3>
            {t('tracker.session')} <Hint text={t('tracker.stat.hint')} />
          </h3>
          <StatsList t={t} stats={snapshot.session} locale={locale} />
        </div>
        <div className="card">
          <h3>{t('tracker.overall')}</h3>
          <StatsList t={t} stats={snapshot.overall} locale={locale} />
        </div>
      </div>

      <h3 style={{ margin: 0 }}>{t('tracker.runs')}</h3>
      {snapshot.recentRuns.length === 0 ? (
        <p className="muted">{t('tracker.runs.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th aria-hidden="true" />
                <th>{t('tracker.col.map')}</th>
                <th className="r">{t('tracker.col.level')}</th>
                <th className="r">{t('tracker.col.inMap')}</th>
                <th className="r">{t('tracker.col.cycle')}</th>
                <th className="r">{t('tracker.col.deaths')}</th>
                <th className="r">{t('tracker.col.start')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.recentRuns.map((r) => (
                <tr key={r.id}>
                  <td />
                  <td>{r.name}</td>
                  <td className="r num">{r.level}</td>
                  <td className="r num">{formatDuration(r.mapMs)}</td>
                  <td className="r num">{formatDuration(r.cycleMs)}</td>
                  <td className={`r num ${r.deaths > 0 ? 'down' : 'muted'}`}>{r.deaths}</td>
                  <td className="r num">{time.format(r.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/** "2h 05min", "45min" — para tempos de sessão, onde segundos só poluem. */
function formatSpan(ms: number): string {
  const min = Math.floor(Math.max(ms, 0) / 60_000)
  const h = Math.floor(min / 60)
  return h > 0 ? `${h}h ${String(min % 60).padStart(2, '0')}min` : `${min}min`
}

/** Tempo jogado: jogo aberto menos o AFK. */
function played(v: SessionView): number {
  return Math.max(v.total - v.idle, 0)
}

const BUCKET: Partial<Record<AreaKind, 'maps' | 'hideout' | 'campaign' | 'town'>> = {
  map: 'maps',
  endgame: 'maps',
  hideout: 'hideout',
  campaign: 'campaign',
  town: 'town',
}

function SplitGroup({ title, a, b, labelA, labelB }: { title: string; a: number; b: number; labelA: string; labelB: string }) {
  const sum = a + b
  if (sum <= 0) return null
  const pa = Math.round((a / sum) * 100)
  return (
    <div className="play-group">
      <div className="label play-group-head">
        <span>{title}</span> <span className="num">{formatSpan(sum)}</span>
      </div>
      <div className="play-split" aria-hidden="true">
        <span className="a" style={{ width: `${(a / sum) * 100}%` }} />
        <span className="b" style={{ width: `${(b / sum) * 100}%` }} />
      </div>
      <div className="play-legend">
        <span>
          <i className="a" />
          {labelA} <span className="num">{formatSpan(a)}</span> <span className="muted">({pa}%)</span>
        </span>
        <span>
          <i className="b" />
          {labelB} <span className="num">{formatSpan(b)}</span> <span className="muted">({100 - pa}%)</span>
        </span>
      </div>
    </div>
  )
}

/** Sessão de jogo: tempo total do jogo aberto, dividido em fim de jogo (mapas x hideout) e história (campanha x cidade). */
function PlaySessionCard({ t, locale, sessions, snapshot, now }: { t: TrackerTranslate; locale: string; sessions: SessionView[]; snapshot: TrackerSnapshot | null; now: number }) {
  const latest = sessions[0]
  if (!latest) return null
  // Jogo aberto: soma o tempo desde o último envio na área atual.
  const v = { ...latest }
  if (v.live && snapshot) {
    const extra = Math.max(now - snapshot.now, 0)
    const bucket = v.afkNow ? 'idle' : snapshot.area ? BUCKET[snapshot.area.kind] : undefined
    v.total += extra
    if (bucket) v[bucket] += extra
    else v.other += extra
  }
  // Grupo só aparece quando houve a parte principal dele (mapas ou campanha); hideout/cidade sozinhos ficam no grupo do que houve.
  const showEndgame = v.maps > 0 || (v.campaign === 0 && v.hideout > 0)
  const showStory = v.campaign > 0 || (v.maps === 0 && v.hideout === 0 && v.town > 0)
  const extras = [
    v.idle >= 60_000 || v.other >= 60_000 ? t('tracker.play.open', { time: formatSpan(v.total) }) : null,
    v.idle >= 60_000 ? t('tracker.play.idle', { time: formatSpan(v.idle) }) : null,
    v.other >= 60_000 ? t('tracker.play.other', { time: formatSpan(v.other) }) : null,
  ].filter(Boolean)
  const time = (at: number) => new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const day = (at: number) => new Date(at).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
  const previous = sessions.slice(1, 6)
  return (
    <div className="card">
      <div className="play-head">
        <div>
          <div className="label">
            {t(v.live ? 'tracker.play.live' : 'tracker.play.last')} <Hint text={t('tracker.play.hint')} />
          </div>
          <div className="level-big num">{formatSpan(played(v))}</div>
        </div>
        <span className="muted">
          {v.live || v.endedAt === null
            ? t('tracker.play.since', { start: time(v.startedAt) })
            : `${day(v.startedAt)}, ${t('tracker.play.range', { start: time(v.startedAt), end: time(v.endedAt) })}`}
        </span>
      </div>
      <div className="play-groups">
        {showEndgame && <SplitGroup title={t('tracker.play.endgame')} a={v.maps} b={v.hideout} labelA={t('tracker.play.maps')} labelB={t('tracker.play.hideout')} />}
        {showStory && <SplitGroup title={t('tracker.play.story')} a={v.campaign} b={v.town} labelA={t('tracker.play.campaign')} labelB={t('tracker.play.town')} />}
      </div>
      {extras.length > 0 && <p className="muted play-extras" style={{ margin: 'var(--sp-3) 0 0' }}>{extras.map((x) => <span key={x}>{x}</span>)}</p>}
      {previous.length > 0 && (
        <details style={{ marginTop: 'var(--sp-3)' }}>
          <summary className="muted">{t('tracker.play.history')}</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('tracker.col.start')}</th>
                  <th className="r">{t('tracker.play.played')}</th>
                  <th className="r">{t('tracker.play.maps')}</th>
                  <th className="r">{t('tracker.play.hideout')}</th>
                  <th className="r">{t('tracker.play.campaign')}</th>
                  <th className="r">{t('tracker.play.town')}</th>
                </tr>
              </thead>
              <tbody>
                {previous.map((s) => (
                  <tr key={s.startedAt}>
                    <td className="num">
                      {day(s.startedAt)} {time(s.startedAt)}
                    </td>
                    {[played(s), s.maps, s.hideout, s.campaign, s.town].map((ms, i) => (
                      <td key={i} className="r num">
                        {ms > 0 ? formatSpan(ms) : '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}

/** Aba inicial: mapas quando o jogador está no fim de jogo, campanha no resto. */
function defaultTab(snapshot: TrackerSnapshot | null): Tab {
  if (!snapshot) return 'campaign'
  const kind = snapshot.area?.kind
  if (kind === 'map' || kind === 'endgame' || snapshot.currentRun) return 'maps'
  if (kind === 'campaign') return 'campaign'
  return snapshot.overall && (snapshot.character?.level ?? 0) >= 60 ? 'maps' : 'campaign'
}

export function TrackerPage({ t, locale, snapshot, status, sessions = [], onChooseFile, onUseAutomatic, onReload }: TrackerPageProps) {
  const [chosen, setChosen] = useSticky<Tab | null>('tracker.tab', null, { persist: true })
  const tab = chosen ?? defaultTab(snapshot)
  const now = useNow(status.state === 'watching')
  const extra = snapshot ? liveExtra(snapshot, now) : 0
  const hasData = snapshot !== null && (snapshot.character !== null || snapshot.area !== null || snapshot.overall !== null || snapshot.acts.length > 0)

  return (
    <>
      <h2 className="page-title">{t('tracker.title')}</h2>
      <StatusBanner t={t} status={status} onChooseFile={onChooseFile} onUseAutomatic={onUseAutomatic} onReload={onReload} />
      <PlaySessionCard t={t} locale={locale} sessions={sessions} snapshot={snapshot} now={now} />

      {!snapshot || !hasData ? (
        status.state === 'watching' && <EmptyState icon="⌛" title={t('tracker.empty.title')} text={t('tracker.empty.text')} />
      ) : (
        <>
          <div className="chips" role="tablist" aria-label={t('tracker.title')}>
            {(['campaign', 'maps'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={`chip ${tab === id ? 'on' : ''}`}
                aria-selected={tab === id}
                onClick={() => setChosen(id)}
              >
                {t(id === 'campaign' ? 'tracker.tab.campaign' : 'tracker.tab.maps')}
              </button>
            ))}
            {status.state === 'watching' && snapshot.lastEventAt !== null && now - snapshot.lastEventAt > snapshot.idleCapMs && (
              <span className="toolbar-hint">{t('tracker.status.idle')}</span>
            )}
          </div>
          {tab === 'campaign' ? (
            <CampaignView t={t} snapshot={snapshot} extra={extra} />
          ) : (
            <MapsView t={t} snapshot={snapshot} extra={extra} locale={locale} />
          )}
        </>
      )}
    </>
  )
}
