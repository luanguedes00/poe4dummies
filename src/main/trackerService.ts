// Tracker de campanha e mapas: lê o log local do jogo (Client.txt) e mantém
// o estado derivado. Sem login e sem acesso à memória do jogo.

import { readFileSync, writeFileSync } from 'node:fs'
import { dialog, type BrowserWindow } from 'electron'
import {
  applySessionEvents,
  closeSession,
  initialSessions,
  isPlaySession,
  openSession,
  sessionViews,
  type PlaySession,
  type PlaySessionsState,
} from '../core/log/playSession'
import { applyEvents, initialTrackerState, resolveTrackerOptions, trackerSnapshot, type TrackerState } from '../core/log/tracker'
import type { TrackerPayload } from '../shared/ipc'
import { isAllowedLogPath, LogWatcher } from './logWatcher'
import type { SettingsStore } from './settingsStore'

/** Quantas linhas do fim do log reprocessar ao abrir (recupera personagem e mapas recentes). */
const BACKFILL_LINES = 50_000
const PUSH_DELAY_MS = 300
/** Sessões fechadas guardadas no disco. */
const MAX_SAVED_SESSIONS = 50

export class TrackerService {
  private readonly options = resolveTrackerOptions()
  private state: TrackerState = initialTrackerState()
  private play: PlaySessionsState = initialSessions()
  private saved: PlaySession[]
  private gameRunning: boolean | null = null
  private readonly watcher: LogWatcher
  private pushTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly onPayload: (payload: TrackerPayload) => void,
    private readonly sessionsFile: string | null = null,
  ) {
    this.saved = this.loadSaved()
    this.watcher = new LogWatcher({
      path: settings.get().tracker.logPath,
      backfillLines: BACKFILL_LINES,
      onEvents: (events, { backfill }) => {
        if (backfill) {
          this.state = initialTrackerState()
          this.play = initialSessions()
        }
        this.state = applyEvents(this.state, events, this.options)
        this.play = applySessionEvents(this.play, events, this.options)
        this.schedulePush()
      },
      onStatus: () => this.schedulePush(),
    })
  }

  payload(): TrackerPayload {
    const now = Date.now()
    return {
      snapshot: trackerSnapshot(this.state, now, this.options),
      status: this.watcher.status,
      sessions: sessionViews(this.saved, this.play, now, this.gameRunning),
    }
  }

  /**
   * O app checa de tempos em tempos se o jogo está aberto. Quando ele fecha, a
   * sessão aberta termina agora e fica guardada. Devolve true se havia sessão.
   */
  setGameRunning(running: boolean | null): boolean {
    const was = this.gameRunning
    this.gameRunning = running
    if (was !== true || running !== false) {
      if (was !== running) this.schedulePush()
      return false
    }
    const open = openSession(this.play)
    if (!open) {
      this.schedulePush()
      return false
    }
    this.play = closeSession(this.play, Date.now())
    const closed = this.play.sessions[this.play.sessions.length - 1]!
    this.saved = [...this.saved.filter((s) => s.startedAt !== closed.startedAt), closed].slice(-MAX_SAVED_SESSIONS)
    this.save()
    this.schedulePush()
    return true
  }

  /** Liga ou desliga conforme as configurações. */
  apply(enabled: boolean): void {
    if (enabled) this.watcher.start()
    else this.watcher.stop()
  }

  stop(): void {
    this.watcher.stop()
    if (this.pushTimer) clearTimeout(this.pushTimer)
  }

  async setPath(path: string | null): Promise<TrackerPayload> {
    await this.settings.update({ tracker: { ...this.settings.get().tracker, logPath: path } })
    return this.reload()
  }

  async chooseFile(parent: BrowserWindow | null): Promise<TrackerPayload> {
    const options = { properties: ['openFile' as const], filters: [{ name: 'Client.txt', extensions: ['txt'] }] }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const file = result.filePaths[0]
    if (result.canceled || !file || !isAllowedLogPath(file)) return this.payload()
    return this.setPath(file)
  }

  async reload(): Promise<TrackerPayload> {
    this.state = initialTrackerState()
    this.play = initialSessions()
    this.watcher.setPath(this.settings.get().tracker.logPath)
    await this.watcher.poll()
    return this.payload()
  }

  private loadSaved(): PlaySession[] {
    if (!this.sessionsFile) return []
    try {
      const raw = JSON.parse(readFileSync(this.sessionsFile, 'utf8')) as unknown
      return Array.isArray(raw) ? raw.filter(isPlaySession).slice(-MAX_SAVED_SESSIONS) : []
    } catch {
      return []
    }
  }

  private save(): void {
    if (!this.sessionsFile) return
    try {
      writeFileSync(this.sessionsFile, JSON.stringify(this.saved))
    } catch {
      // Sem disco: a sessão continua na tela até fechar o app.
    }
  }

  private schedulePush(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      this.onPayload(this.payload())
    }, PUSH_DELAY_MS)
  }
}
