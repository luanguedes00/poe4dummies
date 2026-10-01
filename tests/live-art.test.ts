// Teste real (LIVE=1): o catálogo de ícones do RePoE cobre bases, gemas, únicos e tablets.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HttpClient } from '../src/core/http/client'
import { RepoeClient } from '../src/core/sources/repoe'

const live = process.env['LIVE'] === '1'

describe.skipIf(!live)('catálogo de ícones (RePoE)', () => {
  it('acha os ícones sem usar a trade', async () => {
    const catalog = await new RepoeClient(new HttpClient({ userAgent: 'PoE4Dummies/test' })).artCatalog()
    const find = (n: string) => catalog[n] ?? catalog[n.replace(/\s[IVX]+$/, '')] ?? catalog[`${n} I`]
    for (const name of ['Linen Wraps', 'Druidic Circlet', 'Chaos Orb', 'Ritual Tablet', 'Twister', 'Fire Penetration I', 'Bramblejack']) {
      expect(find(name), name).toBeTruthy()
    }
    // Build salva do usuário (se existir): quantos itens/gemas o catálogo cobre.
    const file = join(process.env['APPDATA'] ?? '', 'PoE4Dummies II', 'builds.json')
    if (existsSync(file)) {
      const pair = JSON.parse(readFileSync(file, 'utf8')).value as Record<string, { items: Array<{ name: string | null; baseType: string; rarity: string }>; skills: Array<{ gems: Array<{ name: string }> }> } | null>
      for (const build of Object.values(pair)) {
        if (!build) continue
        const names = [...build.items.map((i) => (i.rarity === 'Unique' && i.name ? i.name : i.baseType)), ...build.skills.flatMap((s) => s.gems.map((g) => g.name))]
        const missing = [...new Set(names)].filter((n) => !find(n))
        console.log(`cobertura: ${names.length - missing.length}/${names.length}; faltando: ${missing.join(', ') || 'nenhum'}`)
      }
    }
  }, 60_000)
})
