// Acompanha o log local do Path of Exile 2 (`logs/Client.txt`) e entrega os
// eventos novos. Só LÊ o arquivo que o próprio jogo escreve: sem login, sem
// rede e sem ler a memória do jogo (o que os termos da GGG proíbem).
//
// - Lê só o que foi acrescentado (o arquivo passa de centenas de MB).
// - Na primeira leitura começa do fim; `backfillLines` processa as últimas N
//   linhas para recuperar personagem, área e mapas recentes.
// - Tolera o arquivo não existir (jogo não instalado ou caminho errado) e ser
//   trocado ou truncado (o jogo pode recriar o arquivo).
// - Usa só node:fs com polling: fs.watch no Windows perde eventos quando outro
//   processo mantém o arquivo aberto para escrita.

import { open, readFile, stat, type FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, win32 } from 'node:path'
import { z } from 'zod'
import { lineTimestamp, MAX_LINE_LENGTH, parseLines, type LogEvent, type LogSourceStatus } from '../core/log/clientLog'

const LOG_FILE_NAMES = ['Client.txt', 'LatestClient.txt'] as const
const GAME_FOLDER = 'Path of Exile 2'

/** Só aceita arquivos de log do jogo, com caminho absoluto. Evita que a interface peça para ler outro arquivo. */
export function isAllowedLogPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1024 &&
    !path.includes('\0') &&
    (isAbsolute(path) || win32.isAbsolute(path)) &&
    /^(?:Latest|Kakao)?Client\.txt$/i.test(basename(path.replace(/\\/g, '/')))
  )
}

/** Validação do caminho vindo da interface (null = procurar o caminho padrão). */
export const logPathSchema = z.string().trim().min(1).max(1024).refine(isAllowedLogPath).nullable()

/** Pastas de instalação conhecidas do PoE2 (Steam e cliente próprio da GGG). */
export function defaultGameDirs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') {
    const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const pf = env.ProgramFiles ?? 'C:\\Program Files'
    const dirs = [
      win32.join(pf86, 'Grinding Gear Games', GAME_FOLDER),
      win32.join(pf86, 'Steam', 'steamapps', 'common', GAME_FOLDER),
      win32.join(pf, 'Grinding Gear Games', GAME_FOLDER),
      win32.join(pf, 'Steam', 'steamapps', 'common', GAME_FOLDER),
      win32.join(pf, 'Epic Games', 'PathOfExile2'),
    ]
    // Bibliotecas da Steam e instalações em outros discos (caminhos mais comuns).
    for (const drive of ['C', 'D', 'E', 'F', 'G', 'H']) {
      dirs.push(
        `${drive}:\\SteamLibrary\\steamapps\\common\\${GAME_FOLDER}`,
        `${drive}:\\Steam\\steamapps\\common\\${GAME_FOLDER}`,
        `${drive}:\\Games\\${GAME_FOLDER}`,
        `${drive}:\\Grinding Gear Games\\${GAME_FOLDER}`,
        `${drive}:\\${GAME_FOLDER}`,
      )
    }
    return [...new Set(dirs)]
  }
  const home = env.HOME ?? homedir()
  if (platform === 'darwin') return [join(home, 'Library', 'Caches', 'com.GGG.PathOfExile2')]
  return [
    join(home, '.steam', 'steam', 'steamapps', 'common', GAME_FOLDER),
    join(home, '.local', 'share', 'Steam', 'steamapps', 'common', GAME_FOLDER),
  ]
}

/** Arquivos de log candidatos dentro das pastas do jogo. */
export function logCandidates(gameDirs: string[], platform: NodeJS.Platform = process.platform): string[] {
  const joiner = platform === 'win32' ? win32.join : join
  const logsDir = platform === 'darwin' ? 'Logs' : 'logs'
  return gameDirs.flatMap((dir) => LOG_FILE_NAMES.map((name) => joiner(dir, logsDir, name)))
}

/** Lê as bibliotecas extras da Steam no `libraryfolders.vdf` (formato texto da Steam). */
export function parseSteamLibraries(vdf: string): string[] {
  const paths: string[] = []
  for (const m of vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
    paths.push(m[1]!.replace(/\\\\/g, '\\'))
  }
  return paths
}

async function steamLibraryGameDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string[]> {
  if (platform !== 'win32') return []
  const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  try {
    const vdf = await readFile(win32.join(pf86, 'Steam', 'steamapps', 'libraryfolders.vdf'), 'utf8')
    return parseSteamLibraries(vdf).map((lib) => win32.join(lib, 'steamapps', 'common', GAME_FOLDER))
  } catch {
    return []
  }
}

/**
 * Procura o log do PoE2. Entre os que existem, escolhe o modificado mais
 * recentemente (empate de até 5 s fica com a ordem da lista: Client.txt antes).
 */
export async function findClientLog(candidates?: string[]): Promise<string | null> {
  const list =
    candidates ??
    logCandidates([...(await steamLibraryGameDirs(process.env, process.platform)), ...defaultGameDirs()], process.platform)
  let best: { path: string; mtimeMs: number } | null = null
  for (const path of [...new Set(list)]) {
    try {
      const s = await stat(path)
      if (!s.isFile()) continue
      if (!best || s.mtimeMs > best.mtimeMs + 5_000) best = { path, mtimeMs: s.mtimeMs }
    } catch {
      // Não existe ou sem permissão: ignora.
    }
  }
  return best?.path ?? null
}

export interface LogWatcherOptions {
  /** Caminho configurado pelo usuário. null/ausente = procurar o caminho padrão. */
  path?: string | null
  /** Intervalo entre leituras (padrão 1 s). */
  pollMs?: number
  /** Linhas finais do arquivo processadas na primeira leitura (padrão 0 = só o que vier depois). */
  backfillLines?: number
  /** Limite de bytes lidos para o backfill (padrão 16 MB). */
  maxBackfillBytes?: number
  /** Limite de bytes lidos por ciclo; o resto fica para o próximo (padrão 4 MB). */
  maxReadBytes?: number
  /** Candidatos para a busca automática (testes). */
  candidates?: string[]
  /**
   * Eventos novos, na ordem do arquivo. `backfill` = true quando vêm do
   * histórico (primeira leitura ou arquivo trocado); o consumidor deve
   * recomeçar o estado antes de aplicar.
   */
  onEvents: (events: LogEvent[], meta: { backfill: boolean }) => void
  onStatus?: (status: LogSourceStatus) => void
}

interface OpenFile {
  path: string
  offset: number
  ino: number
  birthtimeMs: number
}

const NEWLINE = 0x0a
const SEARCH_EVERY_POLLS = 10

export class LogWatcher {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private busy = false
  private file: OpenFile | null = null
  private remainder: Buffer = Buffer.alloc(0)
  private configuredPath: string | null
  private backfillPending: boolean
  private missingPolls = 0
  private current: LogSourceStatus = { state: 'off', path: null, lastLineAt: null, error: null }

  constructor(private readonly options: LogWatcherOptions) {
    this.configuredPath = options.path ?? null
    this.backfillPending = (options.backfillLines ?? 0) > 0
  }

  get status(): LogSourceStatus {
    return this.current
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.setStatus({ ...this.current, state: 'searching', error: null })
    void this.loop()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.file = null
    this.remainder = Buffer.alloc(0)
    this.setStatus({ state: 'off', path: null, lastLineAt: this.current.lastLineAt, error: null })
  }

  /** Troca o caminho (null = automático). Reprocessa o backfill no arquivo novo. */
  setPath(path: string | null): void {
    this.configuredPath = path
    this.file = null
    this.remainder = Buffer.alloc(0)
    this.missingPolls = 0
    this.backfillPending = (this.options.backfillLines ?? 0) > 0
    if (this.running) this.setStatus({ state: 'searching', path, lastLineAt: null, error: null })
  }

  /** Um ciclo de leitura. Público para testes; em uso normal o `start` chama sozinho. */
  async poll(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.readOnce()
    } catch (err) {
      this.file = null
      this.setStatus({ ...this.current, state: 'error', error: err instanceof Error ? err.message.slice(0, 200) : 'erro' })
    } finally {
      this.busy = false
    }
  }

  private async loop(): Promise<void> {
    if (!this.running) return
    await this.poll()
    if (!this.running) return
    this.timer = setTimeout(() => void this.loop(), this.options.pollMs ?? 1000)
    this.timer.unref?.()
  }

  private setStatus(status: LogSourceStatus): void {
    const prev = this.current
    this.current = status
    if (
      prev.state !== status.state ||
      prev.path !== status.path ||
      prev.error !== status.error ||
      prev.lastLineAt !== status.lastLineAt
    ) {
      this.options.onStatus?.(status)
    }
  }

  private async resolvePath(): Promise<string | null> {
    if (this.configuredPath) return this.configuredPath
    if (this.file) return this.file.path
    // A busca faz dezenas de `stat`; quando nada é achado, repete só de vez em quando.
    if (this.missingPolls > 0 && this.missingPolls % SEARCH_EVERY_POLLS !== 0) return null
    return findClientLog(this.options.candidates)
  }

  private async readOnce(): Promise<void> {
    const path = await this.resolvePath()
    if (!path) {
      this.missingPolls++
      this.setStatus({ ...this.current, state: 'missing', path: this.configuredPath, error: null })
      return
    }

    let info
    try {
      info = await stat(path)
    } catch {
      this.file = null
      this.missingPolls++
      this.setStatus({ ...this.current, state: 'missing', path, error: null })
      return
    }
    if (!info.isFile()) {
      this.file = null
      this.setStatus({ ...this.current, state: 'missing', path, error: null })
      return
    }
    this.missingPolls = 0

    const size = info.size
    const sameFile =
      this.file !== null &&
      this.file.path === path &&
      (this.file.ino === 0 || info.ino === 0 || this.file.ino === info.ino) &&
      Math.abs(this.file.birthtimeMs - info.birthtimeMs) < 1
    const handle = await open(path, 'r')
    try {
      if (!sameFile || !this.file) {
        const rotated = this.file !== null && this.file.path === path
        this.remainder = Buffer.alloc(0)
        if (rotated) {
          // Arquivo recriado: tudo nele é novo.
          this.file = { path, offset: 0, ino: info.ino, birthtimeMs: info.birthtimeMs }
        } else {
          const { offset, text } = await this.readTail(handle, size)
          this.file = { path, offset, ino: info.ino, birthtimeMs: info.birthtimeMs }
          if (text !== null) this.emit(text, true)
        }
      } else if (size < this.file.offset) {
        // Truncado: recomeça do início.
        this.file = { ...this.file, offset: 0 }
        this.remainder = Buffer.alloc(0)
      }

      this.setStatus({ ...this.current, state: 'watching', path, error: null })

      const file = this.file
      if (size > file.offset) {
        const length = Math.min(size - file.offset, this.options.maxReadBytes ?? 4 * 1024 * 1024)
        const chunk = Buffer.alloc(length)
        const { bytesRead } = await handle.read(chunk, 0, length, file.offset)
        this.file = { ...file, offset: file.offset + bytesRead }
        this.consume(chunk.subarray(0, bytesRead))
      }
    } finally {
      await handle.close()
    }
  }

  /**
   * Primeira leitura: acha o fim da última linha completa (para não começar no
   * meio de uma linha) e, se pedido, devolve as últimas N linhas.
   */
  private async readTail(handle: FileHandle, size: number): Promise<{ offset: number; text: string | null }> {
    const wanted = this.backfillPending ? (this.options.backfillLines ?? 0) : 0
    this.backfillPending = false
    const maxBytes = wanted > 0 ? (this.options.maxBackfillBytes ?? 16 * 1024 * 1024) : 64 * 1024
    const step = 64 * 1024
    const parts: Buffer[] = []
    let position = size
    let newlines = 0
    let lastNewline = -1
    while (position > 0 && size - position < maxBytes) {
      const length = Math.min(step, position, maxBytes - (size - position))
      position -= length
      const buf = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buf, 0, length, position)
      const piece = buf.subarray(0, bytesRead)
      parts.unshift(piece)
      for (let i = piece.length - 1; i >= 0; i--) {
        if (piece[i] !== NEWLINE) continue
        if (lastNewline < 0) lastNewline = position + i
        newlines++
      }
      if (lastNewline >= 0 && newlines > wanted) break
    }
    const offset = lastNewline >= 0 ? lastNewline + 1 : position === 0 ? 0 : size
    if (wanted === 0) return { offset, text: null }
    const all = Buffer.concat(parts)
    const end = offset - position
    let text = all.subarray(0, Math.max(end, 0)).toString('utf8')
    const lines = text.split('\n')
    // A primeira linha pode estar cortada se não começamos do início do arquivo.
    if (position > 0) lines.shift()
    if (lines[lines.length - 1] === '') lines.pop()
    text = lines.slice(-wanted).join('\n')
    return { offset, text }
  }

  private consume(chunk: Buffer): void {
    const buffer = this.remainder.length > 0 ? Buffer.concat([this.remainder, chunk]) : chunk
    const last = buffer.lastIndexOf(NEWLINE)
    if (last < 0) {
      // Linha ainda sendo escrita. Descarta se passar do tamanho máximo (arquivo estranho).
      this.remainder = buffer.length > MAX_LINE_LENGTH * 4 ? Buffer.alloc(0) : Buffer.from(buffer)
      return
    }
    const rest = buffer.subarray(last + 1)
    this.remainder = rest.length > MAX_LINE_LENGTH * 4 ? Buffer.alloc(0) : Buffer.from(rest)
    this.emit(buffer.subarray(0, last + 1).toString('utf8'), false)
  }

  private emit(text: string, backfill: boolean): void {
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const at = lineTimestamp(lines[i]!)
      if (at !== null) {
        if (this.current.lastLineAt === null || at > this.current.lastLineAt) this.setStatus({ ...this.current, lastLineAt: at })
        break
      }
    }
    const events = parseLines(text)
    if (events.length > 0 || backfill) this.options.onEvents(events, { backfill })
  }
}
