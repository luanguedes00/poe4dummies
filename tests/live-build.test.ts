// Busca de itens da build contra a trade real. Não roda por padrão.
// Para rodar: $env:LIVE='1'; npx vitest run tests/live-build.test.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importPobCode, encodePobCode } from '../src/core/build/pob'
import { buildItemSearch } from '../src/core/build/trade'
import { HttpClient } from '../src/core/http/client'
import { StatIndex } from '../src/core/item/statMatcher'
import { buildManualQuery } from '../src/core/trade/manual'
import { pickDefaultLeague, TradeClient } from '../src/core/sources/trade'

const trade = new TradeClient(new HttpClient({ userAgent: 'PoE4Dummies/0.1.0 (tests)' }))

describe.skipIf(!process.env['LIVE'])('build na trade real', () => {
  it('a trade aceita a busca de cada item da build de exemplo', async () => {
    const xml = readFileSync(join(__dirname, 'fixtures', 'pob-sample.xml'), 'utf8')
    const build = importPobCode(encodePobCode(xml), { kind: 'code' })
    const league = pickDefaultLeague(await trade.leagues())
    const index = new StatIndex(await trade.stats())
    const catalog = await trade.catalog()
    const names = { baseTypes: catalog.bases.map((b) => b.type), uniques: catalog.uniques.map((u) => u.name) }
    // Troca os nomes inventados do exemplo por nomes reais do catálogo (único e cinto mágico).
    const uniqueRing = catalog.uniques.find((u) => u.type.endsWith('Ring'))!
    const belt = catalog.bases.find((b) => b.type.endsWith('Belt'))!.type
    const items = build.items.map((i) =>
      i.slot === 'Ring 2' ? { ...i, name: uniqueRing.name, baseType: uniqueRing.type } : i.slot === 'Belt' ? { ...i, baseType: `Hale ${belt} of the Fox` } : i,
    )
    let searched = 0
    for (const item of items) {
      const built = buildItemSearch(item, index, names, 80)
      // A build de exemplo tem nomes inventados: esses ficam de fora, como no app.
      if (!built) {
        console.log(item.slot, item.name ?? item.baseType, '→ fora do catálogo, sem busca')
        continue
      }
      const result = await trade.search(league, buildManualQuery(built.search, 'any'))
      console.log(item.slot, built.search.type, `${built.required}/${built.mods} mods`, '→', result.total, 'anúncios')
      expect(result.id.length).toBeGreaterThan(3)
      searched++
    }
    expect(searched).toBe(3)
  }, 120_000)
})
