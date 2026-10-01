import { describe, expect, it } from 'vitest'
import { CAMPAIGN_GUIDE, zoneGuide } from '../src/core/campaign/guide'

describe('guia da campanha por área', () => {
  it('acha a área pelo nome do log (com ou sem "The", maiúsculas)', () => {
    expect(zoneGuide('Clearfell')?.act).toBe('1')
    expect(zoneGuide('the hunting grounds')?.tasks.some((t) => t.key && /\+2 pontos de passiva/.test(t.text))).toBe(true)
    expect(zoneGuide('Valley of the Titans')).toBe(zoneGuide('The Valley of the Titans'))
    expect(zoneGuide("Jiquani's Machinarium")?.act).toBe('3')
    // Nome real do log do usuário (Interlúdio 2, área P2_5).
    expect(zoneGuide('The Galai Gates')?.tasks[0]?.text).toMatch(/Vornas/)
  })

  it('área desconhecida (mapa, cidade fora do guia) não mostra nada', () => {
    expect(zoneGuide('Hideout Felled')).toBeNull()
    expect(zoneGuide(null)).toBeNull()
  })

  it('bônus permanentes e passivas estão marcados como importantes', () => {
    const keys = CAMPAIGN_GUIDE.flatMap((z) => z.tasks.filter((t) => t.key))
    expect(keys.length).toBeGreaterThan(20)
    // Nenhum nome aponta para duas áreas diferentes (apelidos da mesma área podem repetir).
    const owner = new Map<string, number>()
    CAMPAIGN_GUIDE.forEach((z, i) =>
      z.names.forEach((n) => {
        const key = n.toLowerCase().replace(/^the\s+/, '')
        expect(owner.get(key) ?? i, n).toBe(i)
        owner.set(key, i)
      }),
    )
  })
})

describe('rota das ilhas (Ato 4)', () => {
  it('Kingsmarch mostra a ordem, com Ngakanu por último', () => {
    const route = zoneGuide('Kingsmarch')!.tasks.map((t) => t.text)
    expect(route[1]).toMatch(/Whakapanu/)
    expect(route[route.length - 1]).toMatch(/Ngakanu/)
  })
})
