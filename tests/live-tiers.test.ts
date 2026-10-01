// Teste local (LIVE=1): relatório de tiers com a build salva do usuário e os
// dados que o app já guardou no disco (sem rede).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BuildPair } from '../src/core/build/model'
import { buildTierReport } from '../src/core/build/tierReport'
import { StatIndex } from '../src/core/item/statMatcher'
import { buildTierTable } from '../src/core/item/tiers'

const dir = join(process.env['APPDATA'] ?? '', 'PoE4Dummies II')
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')).value
const ready = process.env['LIVE'] === '1' && ['builds.json', 'cache/repoe.json', 'cache/data/trade-stats.json', 'cache/data/trade-items.json'].every((f) => existsSync(join(dir, f)))

describe.skipIf(!ready)('tiers da build salva', () => {
  it('lê o tier de cada mod das peças', () => {
    const pair = read('builds.json') as BuildPair
    const repoe = read('cache/repoe.json')
    const index = new StatIndex(read('cache/data/trade-stats.json').value)
    const bases = (read('cache/data/trade-items.json').value.bases as Array<{ type: string }>).map((b) => b.type)
    const context = { table: buildTierTable(repoe, index), baseTags: repoe.baseTags }
    for (const build of [pair.mine, pair.guide]) {
      if (!build) continue
      const report = buildTierReport(build, index, bases, context)
      for (const [slot, mods] of Object.entries(report)) console.log(slot.padEnd(14), mods.map((m) => `T${m.tier}/${m.tiers} ${m.text}`).join(' | '))
      expect(Object.keys(report).length).toBeGreaterThan(0)
    }
  })
})
