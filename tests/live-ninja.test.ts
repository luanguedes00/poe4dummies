// Importa um personagem real do poe.ninja (código do PoB2 gerado pelo site). Não roda por padrão.
// Para rodar: $env:LIVE='1'; $env:NINJA_LINK='https://poe.ninja/poe2/profile/<conta>/<liga>/character/<nome>'; npx vitest run tests/live-ninja.test.ts

import { describe, expect, it } from 'vitest'
import { isBuild, parseBuildLink } from '../src/core/build/model'
import { importPobCode } from '../src/core/build/pob'
import { ninjaCharacter } from '../src/core/build/ninja'
import { HttpClient } from '../src/core/http/client'

const http = new HttpClient({ userAgent: 'PoE4Dummies/0.1.0 (tests)' })
// Link de um personagem público do poe.ninja (fora do código: é a conta de alguém).
const LINK = process.env['NINJA_LINK'] ?? ''

describe.skipIf(!process.env['LIVE'] || !LINK)('personagem real do poe.ninja', () => {
  it('importa o perfil pelo link', async () => {
    const link = parseBuildLink(LINK)
    expect(link?.site).toBe('poeninja-character')
    const character = await ninjaCharacter(http, link!)
    const build = { ...importPobCode(character.code, { kind: 'link', site: link!.site, id: link!.id }), extras: character.extras ?? undefined }
    expect(isBuild(build)).toBe(true)
    const extras = character.extras!
    console.log('ícones de itens:', Object.keys(extras.itemIcons).join(', '))
    console.log('joias com ícone:', Object.keys(extras.jewelIcons).length, 'gemas com detalhes:', Object.keys(extras.gems).length, 'set 2?', character.useSecondWeaponSet)
    console.log('Twister:', JSON.stringify(extras.gems['Twister']).slice(0, 700))
    // Todo item equipado tem ícone oficial.
    for (const item of build.items) expect(extras.itemIcons[item.slot], item.slot).toMatch(/^https:\/\/web\.poecdn\.com\//)
    // Toda gema das skills tem detalhes e ícone.
    for (const gem of build.skills.flatMap((g) => g.gems)) expect(extras.gems[gem.name]?.icon, gem.name).toBeTruthy()
    console.log(build.className, build.ascendancy, build.level, 'skill:', build.mainSkill)
    console.log('itens:', build.items.map((i) => `${i.slot}=${i.name ?? i.baseType}(${i.mods.length})`).join(' | '))
    console.log('joias:', build.jewels.length, 'passivos:', build.passives, 'skills:', build.skills.length)
    console.log('stats:', Object.keys(build.stats).length, JSON.stringify(Object.fromEntries(Object.entries(build.stats).filter(([k]) => /^(Life|EnergyShield|Mana|Spirit|FireResist|ColdResist|LightningResist|ChaosResist|CombinedDPS|TotalDPS|TotalEHP|Str|Dex|Int)$/.test(k)))))
    console.log('grupos:', build.skills.slice(0, 6).map((g) => `${g.main ? '*' : ''}${g.gems.map((x) => x.name + (x.support ? '(s)' : '')).join('+')}`).join(' || '))
    expect(build.items.length).toBeGreaterThan(5)
    expect(build.skills.length).toBeGreaterThan(3)
  }, 60_000)
})
