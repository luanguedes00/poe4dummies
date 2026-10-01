// Teste real (LIVE=1): gerador de regex com os 135 mods de tablet do RePoE.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MECHANICS } from '../src/core/farm/mechanics'
import { buildPresets, buildRegex, parseTabletMods, termFor, uniqueToken } from '../src/core/farm/regex'

describe.skipIf(process.env['LIVE'] !== '1')('regex de tablets com dados reais', () => {
  it('cada mod tem trecho único e o regex reconhece linhas reais', async () => {
    const raw = (await (await fetch('https://repoe-fork.github.io/poe2/mods.min.json', { headers: { 'User-Agent': 'PoE4Dummies/test' } })).json()) as Record<string, unknown>
    const mods = parseTabletMods(raw)
    console.log('mods de tablet (agrupados):', mods.length)
    const missing = mods.filter((m) => !uniqueToken(m, mods))
    console.log('sem trecho único:', missing.map((m) => m.text).join(' || ') || 'nenhum')
    for (const m of mods.slice(0, 8)) console.log(JSON.stringify(uniqueToken(m, mods)?.token), '←', m.text)

    // Linhas reais vistas na loja (30/09): o regex de cada mod tem que bater na linha certa e não nas outras.
    const lines = [
      'Ritual Altars in Map allow rerolling Favours 3 additional times',
      'Deferring Favours at Ritual Altars in Map costs 26% reduced Tribute',
      'Ritual Favours in Map have 62% increased chance to be Omens',
    ]
    const find = (part: string) => mods.find((m) => m.text.includes(part))!
    const reroll = find('allow rerolling Favours')
    const defer = find('Deferring Favours')
    const omen = find('chance to be Omens')
    const test = (term: string, line: string) => new RegExp(term, 'i').test(line)
    for (const [mod, line] of [[reroll, lines[0]!], [defer, lines[1]!], [omen, lines[2]!]] as const) {
      const term = termFor(mod, mods, null)!
      expect(test(term, line), `${term} ~ ${line}`).toBe(true)
      for (const other of lines.filter((l) => l !== line)) expect(test(term, other), `${term} !~ ${other}`).toBe(false)
    }
    // Número mínimo: Omens 60%+ bate em 62% e não em 45%.
    const omen60 = termFor(omen, mods, 60)!
    console.log('omens 60+:', omen60)
    expect(test(omen60, lines[2]!)).toBe(true)
    expect(test(omen60, 'Ritual Favours in Map have 45% increased chance to be Omens')).toBe(false)

    const result = buildRegex(
      [
        { key: reroll.key, mode: 'all', min: 2 },
        { key: defer.key, mode: 'all', min: 20 },
      ],
      mods,
    )
    console.log('Reroll + Defer:', result.text, `(${result.length} caracteres)`)
    expect(result.tooLong).toBe(false)
    expect(missing.length).toBe(0)

    // Combos prontos: receitas das mecânicas → mods do item (lista da trade guardada no disco, sem rede).
    const statsFile = join(process.env['APPDATA'] ?? '', 'PoE4Dummies', 'cache', 'data', 'trade-stats.json')
    if (existsSync(statsFile)) {
      const entries = JSON.parse(readFileSync(statsFile, 'utf8')).value.value as Array<{ id: string; text: string }>
      const texts = new Map(entries.map((e) => [e.id, e.text]))
      const presets = buildPresets(MECHANICS, mods, (id) => texts.get(id) ?? null)
      const recipes = MECHANICS.flatMap((m) => m.recipes.filter((r) => r.rarity !== 'unique' && r.mods.length > 0).map((r) => `${m.id}:${r.id}`))
      console.log(`combos: ${presets.length}/${recipes.length}; faltando: ${recipes.filter((id) => !presets.some((p) => p.id === id)).join(', ') || 'nenhum'}`)
      const rd = presets.find((p) => p.id === 'ritual:ritual-reroll-defer')
      expect(rd?.selection.map((s) => s.min)).toEqual([2, 20])
      console.log('combo Reroll + Defer:', buildRegex(rd!.selection, mods).text)
      for (const p of presets) console.log(`combo ${p.id}: ${buildRegex(p.selection, mods).text} (${buildRegex(p.selection, mods).length})`)
      // Todo combo pronto cabe na caixa de busca do PoE2.
      expect(presets.filter((p) => buildRegex(p.selection, mods).tooLong).map((p) => p.id)).toEqual([])
    }
  }, 60_000)
})
