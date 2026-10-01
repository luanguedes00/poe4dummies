// Leitura das linhas do log local do Path of Exile 2 (`logs/Client.txt`).
// Parser PURO: recebe texto e devolve eventos tipados. Não lê arquivo, não usa
// Electron nem DOM. Linhas desconhecidas são ignoradas (retornam null).
//
// Formato de uma linha (não há especificação oficial da GGG; o formato vem da
// comunidade e pode mudar entre patches):
//   2025/01/10 20:15:32 123456789 cffb0734 [INFO Client 1234] : Mensagem
//   data e hora locais | ms desde a abertura do cliente | id hex | [nível Client pid] | mensagem
//
// Mensagens reconhecidas:
//   [DEBUG Client 1] Generating level 15 area "G1_town" with seed 1
//   [INFO Client 1] [SCENE] Set Source [Clearfell Encampment]
//   [INFO Client 1] : You have entered Clearfell Encampment.      (PoE1 e versões antigas)
//   [INFO Client 1] : Fulano (Warrior) is now level 12
//   [INFO Client 1] : Fulano has been slain.
//   [INFO Client 1] : AFK mode is now ON. Autoreply "This player is AFK."
//   ***** LOG FILE OPENING *****                                  (cliente aberto)
//
// Segurança: mensagens de sistema começam com ": " logo após o colchete. Linhas
// de chat não têm esse prefixo (ex.: "#Fulano: texto"), então um jogador não
// consegue forjar um "is now level" digitando no chat.

/** Evento extraído de uma linha do log. `at` é o horário local da linha, em ms (epoch). */
export type LogEvent =
  | { type: 'log-opened'; at: number }
  | { type: 'area-generated'; at: number; level: number; areaId: string; seed: string }
  | { type: 'area-entered'; at: number; name: string }
  | { type: 'level-up'; at: number; character: string; className: string; level: number }
  | { type: 'death'; at: number; character: string }
  | { type: 'afk'; at: number; on: boolean }

export type LogEventType = LogEvent['type']

/** Estado do leitor do log, compartilhado entre o processo principal e a interface. */
export interface LogSourceStatus {
  /** off: desligado | searching: procurando o arquivo | missing: não encontrado | watching: lendo | error: falha de leitura */
  state: 'off' | 'searching' | 'missing' | 'watching' | 'error'
  /** Caminho em uso (ou o configurado, se ainda não existir). */
  path: string | null
  /** Horário (ms) da última linha com data válida lida do arquivo. Indica se o jogo está aberto. */
  lastLineAt: number | null
  /** Mensagem técnica curta quando `state` é "error". */
  error: string | null
}

/** Tamanho máximo de linha considerado. Linhas maiores são ignoradas (proteção contra arquivo corrompido). */
export const MAX_LINE_LENGTH = 4096

const PREFIX = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})(?: (.*))?$/
// Depois da data: contador de ms e id hex opcionais, depois "[NIVEL Client pid]" opcional.
const HEADER = /^(?:\d+ )?(?:[0-9a-fA-F]+ )?(?:\[[A-Z]+(?: [^\]]*)?\] ?)?(.*)$/

const GENERATING = /^Generating level (\d{1,3}) area "([^"\r\n]{1,120})" with seed (\d{1,20})\s*$/
const SCENE = /^\[SCENE\] Set Source \[(.{1,120})\]\s*$/
const ENTERED = /^: You have entered (.{1,120}?)\.\s*$/
// Nomes de personagem não têm espaços. Classe pode ter espaço (ex.: ascendência).
const LEVEL_UP = /^: ([^\s:()#@]{1,40}) \(([^()\r\n]{1,40})\) is now level (\d{1,3})\s*$/
const SLAIN = /^: ([^\s:()#@]{1,40}) has been slain\.\s*$/
// O jogo liga o modo AFK sozinho depois de um tempo sem mexer (visto no log real, 30/09/2026).
const AFK = /^: AFK mode is now (ON|OFF)\b/
const OPENING = /^\*{3,} LOG FILE OPENING \*{3,}\s*$/

/** Converte a data local do log em ms. Retorna null se a data for inválida. */
function toTimestamp(parts: string[]): number | null {
  const [y, mo, d, h, mi, s] = parts.map(Number) as [number, number, number, number, number, number]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null
  const date = new Date(y, mo - 1, d, h, mi, s)
  const at = date.getTime()
  return Number.isFinite(at) ? at : null
}

/** Horário (ms) da linha, ou null se a linha não começar com a data do log. */
export function lineTimestamp(line: string): number | null {
  const m = PREFIX.exec(line.length > MAX_LINE_LENGTH ? line.slice(0, 32) : line)
  if (!m) return null
  return toTimestamp(m.slice(1, 7))
}

/** Nome da cena é ignorado quando é um marcador interno do cliente. */
function isPlaceholderScene(name: string): boolean {
  return /^\(.*\)$/.test(name.trim()) || name.trim() === ''
}

/** Lê uma linha do log. Linhas desconhecidas, de chat ou malformadas retornam null. */
export function parseLine(rawLine: string): LogEvent | null {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
  if (line.length === 0 || line.length > MAX_LINE_LENGTH) return null
  const m = PREFIX.exec(line)
  if (!m) return null
  const at = toTimestamp(m.slice(1, 7))
  if (at === null) return null
  const rest = m[7] ?? ''

  if (OPENING.test(rest)) return { type: 'log-opened', at }

  const header = HEADER.exec(rest)
  const message = header?.[1] ?? ''

  let g = GENERATING.exec(message)
  if (g) {
    const level = Number(g[1])
    if (level > 200) return null
    return { type: 'area-generated', at, level, areaId: g[2]!, seed: g[3]! }
  }

  g = SCENE.exec(message)
  if (g) {
    const name = g[1]!.trim()
    return isPlaceholderScene(name) ? null : { type: 'area-entered', at, name }
  }

  g = ENTERED.exec(message)
  if (g) return { type: 'area-entered', at, name: g[1]!.trim() }

  g = LEVEL_UP.exec(message)
  if (g) {
    const level = Number(g[3])
    if (level < 1 || level > 100) return null
    return { type: 'level-up', at, character: g[1]!, className: g[2]!.trim(), level }
  }

  g = SLAIN.exec(message)
  if (g) return { type: 'death', at, character: g[1]! }

  g = AFK.exec(message)
  if (g) return { type: 'afk', at, on: g[1] === 'ON' }

  return null
}

/** Lê um bloco de texto (várias linhas) e devolve os eventos na ordem do arquivo. */
export function parseLines(text: string): LogEvent[] {
  const events: LogEvent[] = []
  for (const line of text.split('\n')) {
    const event = parseLine(line)
    if (event) events.push(event)
  }
  return events
}
