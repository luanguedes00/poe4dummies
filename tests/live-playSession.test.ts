// Teste real (LIVE=1): sessões de jogo a partir do Client.txt do usuário (só leitura).
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLines } from '../src/core/log/clientLog'
import { applySessionEvents, initialSessions, sessionViews } from '../src/core/log/playSession'
import { classifyArea, DEFAULT_TRACKER_OPTIONS } from '../src/core/log/tracker'
import { findClientLog } from '../src/main/logWatcher'

function logPath(): string | null {
  try {
    const settings = JSON.parse(readFileSync(join(process.env['APPDATA'] ?? '', 'PoE4Dummies II', 'settings.json'), 'utf8'))
    if (settings?.tracker?.logPath && existsSync(settings.tracker.logPath)) return settings.tracker.logPath
  } catch {
    // segue para os caminhos padrão
  }
  const candidates = [
    'C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt',
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

describe.skipIf(process.env['LIVE'] !== '1')('sessões com o log real', () => {
  it('monta as sessões do Client.txt', async () => {
    const path = logPath() ?? (await findClientLog())
    console.log('log:', path)
    if (!path) return
    // Só o fim do arquivo (pode passar de centenas de MB).
    const size = statSync(path).size
    const take = Math.min(size, 40 * 1024 * 1024)
    const buffer = Buffer.alloc(take)
    const fd = openSync(path, 'r')
    readSync(fd, buffer, 0, take, size - take)
    closeSync(fd)
    const lines = buffer.toString('utf8')
    const state = applySessionEvents(initialSessions(), parseLines(lines), DEFAULT_TRACKER_OPTIONS)
    const views = sessionViews([], state, Date.now(), false, 8)
    const m = (ms: number) => `${Math.round(ms / 60_000)}min`
    for (const v of views) {
      console.log(
        new Date(v.startedAt).toLocaleString('pt-BR'),
        `total ${m(v.total)} | mapas ${m(v.maps)} hideout ${m(v.hideout)} | campanha ${m(v.campaign)} cidade ${m(v.town)} | afk ${m(v.idle)} outros ${m(v.other)}`,
      )
    }
    // Detalhe da última sessão: tempo por área (id → tipo).
    const events = parseLines(lines)
    const lastOpen = events.map((e) => e.type).lastIndexOf('log-opened')
    const per = new Map<string, number>()
    let prev: { id: string; at: number } | null = null
    for (const e of events.slice(lastOpen)) {
      if (e.type !== 'area-generated') continue
      if (prev) per.set(prev.id, (per.get(prev.id) ?? 0) + e.at - prev.at)
      prev = { id: `${e.areaId} (${classifyArea(e.areaId, e.level)})`, at: e.at }
    }
    console.log([...per].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([id, ms]) => `${id}: ${m(ms)}`).join('\n'))
    console.log('último evento:', new Date(events[events.length - 1]!.at).toLocaleString('pt-BR'))
    expect(views.length).toBeGreaterThan(0)
  })
})
