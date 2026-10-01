import { mkdtemp, rm, truncate, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lineTimestamp, parseLine, parseLines, type LogEvent } from '../src/core/log/clientLog'
import { defaultGameDirs, isAllowedLogPath, logCandidates, LogWatcher, parseSteamLibraries } from '../src/main/logWatcher'

// Horário local, igual ao que o jogo grava.
const at = (h: number, m: number, s: number) => new Date(2025, 0, 10, h, m, s).getTime()

// Trecho no formato do Client.txt do PoE2 (linhas reais anonimizadas + variações).
const SAMPLE = [
  '2025/01/10 20:00:00 ***** LOG FILE OPENING *****',
  '2025/01/10 20:00:01 1906 d7e4b6a2 [INFO Client 4412] [ENGINE] Init',
  '2025/01/10 20:00:30 31200 ca3a9d4 [DEBUG Client 4412] Generating level 15 area "G1_town" with seed 1',
  '2025/01/10 20:00:31 32410 cffb0734 [INFO Client 4412] [SCENE] Set Source [(null)]',
  '2025/01/10 20:00:31 32411 cffb0734 [INFO Client 4412] [SCENE] Set Source [Clearfell Encampment]',
  '2025/01/10 20:01:05 66120 ca3a9d4 [DEBUG Client 4412] Generating level 2 area "G1_2" with seed 2984410187',
  '2025/01/10 20:01:06 67000 cffb0734 [INFO Client 4412] [SCENE] Set Source [Clearfell]',
  '2025/01/10 20:03:10 191000 5c3b58e2 [INFO Client 4412] : Tavinho_BR (Warrior) is now level 3',
  '2025/01/10 20:04:00 241000 3ef2336d [INFO Client 4412] #Globaleiro: Tavinho_BR (Warrior) is now level 99',
  '2025/01/10 20:04:10 251000 3ef2336d [INFO Client 4412] @From Amigo: : Tavinho_BR has been slain.',
  '2025/01/10 20:05:00 301000 5c3b58e2 [INFO Client 4412] : Tavinho_BR has been slain.',
  '2025/01/10 20:05:30 331000 5c3b58e2 [INFO Client 4412] : You have entered Clearfell Encampment.',
  '2025/01/10 20:06:00 361000 5c3b58e2 [INFO Client 4412] : Tavinho_BR (Blood Mage) is now level 61',
].join('\r\n')

describe('parseLine', () => {
  it('lê abertura do log, geração de área, cena, nível e morte', () => {
    const events = parseLines(SAMPLE)
    const expected: LogEvent[] = [
      { type: 'log-opened', at: at(20, 0, 0) },
      { type: 'area-generated', at: at(20, 0, 30), level: 15, areaId: 'G1_town', seed: '1' },
      { type: 'area-entered', at: at(20, 0, 31), name: 'Clearfell Encampment' },
      { type: 'area-generated', at: at(20, 1, 5), level: 2, areaId: 'G1_2', seed: '2984410187' },
      { type: 'area-entered', at: at(20, 1, 6), name: 'Clearfell' },
      { type: 'level-up', at: at(20, 3, 10), character: 'Tavinho_BR', className: 'Warrior', level: 3 },
      { type: 'death', at: at(20, 5, 0), character: 'Tavinho_BR' },
      { type: 'area-entered', at: at(20, 5, 30), name: 'Clearfell Encampment' },
      { type: 'level-up', at: at(20, 6, 0), character: 'Tavinho_BR', className: 'Blood Mage', level: 61 },
    ]
    expect(events).toEqual(expected)
  })

  it('não aceita mensagens de chat que imitam eventos', () => {
    expect(parseLine('2025/01/10 20:04:00 241000 3ef2336d [INFO Client 4412] #Globaleiro: Fulano (Warrior) is now level 99')).toBeNull()
    expect(parseLine('2025/01/10 20:04:00 241000 3ef2336d [INFO Client 4412] Fulano: [SCENE] Set Source [Hideout]')).toBeNull()
    expect(parseLine('2025/01/10 20:04:00 241000 3ef2336d [INFO Client 4412] $Vendedor: Generating level 80 area "MapX" with seed 1')).toBeNull()
  })

  it('ignora linhas desconhecidas, vazias e malformadas', () => {
    expect(parseLine('')).toBeNull()
    expect(parseLine('Generating level 5 area "G1_1" with seed 1')).toBeNull() // sem data
    expect(parseLine('2025/13/40 20:00:00 1 a [DEBUG Client 1] Generating level 5 area "G1_1" with seed 1')).toBeNull()
    expect(parseLine('2025/01/10 20:00:00 1 a [INFO Client 1] : Fulano (Warrior) is now level 101')).toBeNull()
    expect(parseLine('2025/01/10 20:00:00 1 a [INFO Client 1] Connecting to instance server at 1.2.3.4:6112')).toBeNull()
    expect(parseLine('2025/01/10 20:00:00 1 a [INFO Client 1] : ' + 'x'.repeat(5000))).toBeNull()
  })

  it('tolera cabeçalho sem contador ou id', () => {
    expect(parseLine('2025/01/10 21:00:00 [DEBUG Client 99] Generating level 79 area "MapAzmerianRanges" with seed 42')).toEqual({
      type: 'area-generated',
      at: at(21, 0, 0),
      level: 79,
      areaId: 'MapAzmerianRanges',
      seed: '42',
    })
  })

  it('lê o horário de qualquer linha com data', () => {
    expect(lineTimestamp('2025/01/10 20:00:01 1906 d7e4b6a2 [INFO Client 4412] [ENGINE] Init')).toBe(at(20, 0, 1))
    expect(lineTimestamp('lixo')).toBeNull()
  })
})

describe('caminhos do log', () => {
  it('aceita só arquivos de log do jogo com caminho absoluto', () => {
    expect(isAllowedLogPath('C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt')).toBe(true)
    expect(isAllowedLogPath('D:\\SteamLibrary\\steamapps\\common\\Path of Exile 2\\logs\\LatestClient.txt')).toBe(true)
    expect(isAllowedLogPath('C:\\Users\\x\\Documents\\senhas.txt')).toBe(false)
    expect(isAllowedLogPath('logs\\Client.txt')).toBe(false)
    expect(isAllowedLogPath('C:\\x\\Client.txt\0.exe')).toBe(false)
  })

  it('monta candidatos de Steam e do cliente da GGG', () => {
    const dirs = defaultGameDirs({ 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files' }, 'win32')
    const list = logCandidates(dirs, 'win32')
    expect(list).toContain('C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt')
    expect(list).toContain('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt')
    expect(list).toContain('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\LatestClient.txt')
  })

  it('lê bibliotecas extras da Steam', () => {
    const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}'
    expect(parseSteamLibraries(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary'])
  })
})

describe('LogWatcher', () => {
  let dir: string
  let file: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oraculo-log-'))
    file = join(dir, 'Client.txt')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const line = (s: number, msg: string) => `2025/01/10 20:00:${String(s).padStart(2, '0')} 1 abc [INFO Client 1] ${msg}\n`

  it('começa do fim, lê só o que foi acrescentado e junta linhas partidas', async () => {
    await writeFile(file, line(1, ': Antigo (Monk) is now level 5'))
    const batches: Array<{ events: LogEvent[]; backfill: boolean }> = []
    const watcher = new LogWatcher({ path: file, onEvents: (events, meta) => batches.push({ events, backfill: meta.backfill }) })
    await watcher.poll()
    expect(batches).toEqual([])
    expect(watcher.status.state).toBe('watching')

    const full = line(2, ': Novo (Monk) is now level 6')
    await appendFile(file, full.slice(0, 30))
    await watcher.poll()
    expect(batches).toEqual([])
    await appendFile(file, full.slice(30))
    await watcher.poll()
    expect(batches).toHaveLength(1)
    expect(batches[0]!.events[0]).toMatchObject({ type: 'level-up', character: 'Novo', level: 6 })
    expect(watcher.status.lastLineAt).toBe(at(20, 0, 2))
  })

  it('processa as últimas N linhas quando pedido', async () => {
    await writeFile(file, [1, 2, 3, 4].map((n) => line(n, `: P (Monk) is now level ${n + 1}`)).join(''))
    const got: LogEvent[][] = []
    const watcher = new LogWatcher({ path: file, backfillLines: 2, onEvents: (events, meta) => meta.backfill && got.push(events) })
    await watcher.poll()
    expect(got).toHaveLength(1)
    expect(got[0]!.map((e) => (e.type === 'level-up' ? e.level : 0))).toEqual([4, 5])
  })

  it('tolera arquivo ausente e arquivo truncado', async () => {
    const got: LogEvent[] = []
    const watcher = new LogWatcher({ path: file, onEvents: (events) => got.push(...events) })
    await watcher.poll()
    expect(watcher.status.state).toBe('missing')

    await writeFile(file, line(1, ': A (Monk) is now level 2'))
    await watcher.poll()
    expect(watcher.status.state).toBe('watching')
    await truncate(file, 0)
    await watcher.poll()
    await appendFile(file, line(5, ': A has been slain.'))
    await watcher.poll()
    expect(got).toEqual([{ type: 'death', at: at(20, 0, 5), character: 'A' }])
  })

  it('procura o arquivo entre os candidatos', async () => {
    await writeFile(file, '')
    const watcher = new LogWatcher({ candidates: [join(dir, 'nao-existe', 'Client.txt'), file], onEvents: () => {} })
    await watcher.poll()
    expect(watcher.status).toMatchObject({ state: 'watching', path: file })
  })
})
