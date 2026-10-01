import { describe, expect, it } from 'vitest'
import { externalUrl, isAllowedExternalUrl, poe2dbUrl } from '../src/core/links'
import { buildPriceIndex, formatAmount, fromDivine, median, toDivine } from '../src/core/money'
import { applySettingsPatch, DEFAULT_SETTINGS, readSettings } from '../src/core/settings'
import { createWatchEntry, evaluateWatchlist, performance } from '../src/core/market/watchlist'
import type { MarketItem, MarketSnapshot } from '../src/core/types'

describe('configurações', () => {
  it('arquivo corrompido volta ao padrão sem quebrar', () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(readSettings('lixo')).toEqual(DEFAULT_SETTINGS)
    const s = readSettings({ language: 'klingon', refreshMinutes: 15, overlay: { minModPercent: 5, enabled: false } })
    expect(s.language).toBe('pt-BR')
    expect(s.refreshMinutes).toBe(15)
    expect(s.overlay.minModPercent).toBe(90)
    expect(s.overlay.enabled).toBe(false)
  })

  it('mantém só as entradas válidas da lista de acompanhamento', () => {
    const good = {
      itemId: 'chaos', category: 'Currency', name: 'Chaos Orb', addedAt: '2026-09-29T00:00:00.000Z',
      baselineDivine: 0.1, baselineExaltedPerDivine: 585, baselineChaosPerDivine: 9.4, alertPercent: 15, lastAlert: null,
    }
    const s = readSettings({ watchlist: [good, { itemId: 'x' }, 42] })
    expect(s.watchlist).toEqual([good])
  })

  it('alterações da interface são estritas', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { displayCurrency: 'chaos' }).displayCurrency).toBe('chaos')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { overlay: { minModPercent: 80 } }).overlay).toMatchObject({ minModPercent: 80, enabled: true })
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { displayCurrency: 'gold' })).toThrow()
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { campoDesconhecido: 1 })).toThrow()
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { dashboardHotkey: 'Ctrl+Alt+Delete' })).toThrow()
    expect(applySettingsPatch(DEFAULT_SETTINGS, { dashboardHotkey: 'Ctrl+Shift+F5' }).dashboardHotkey).toBe('Ctrl+Shift+F5')
  })
})

describe('links externos', () => {
  it('monta só URLs permitidas', () => {
    expect(poe2dbUrl('Sapphire Ring')).toBe('https://poe2db.tw/us/Sapphire_Ring')
    expect(poe2dbUrl("Hinekora's Lock")).toBe("https://poe2db.tw/us/Hinekora's_Lock")
    expect(externalUrl({ kind: 'trade', league: 'Forbidden Rites', queryId: 'H4sIAAAA-_x' })).toBe(
      'https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites/H4sIAAAA-_x',
    )
    expect(externalUrl({ kind: 'trade', league: 'X', queryId: '../../evil' })).toBeNull()
    expect(externalUrl({ kind: 'ninja', league: 'Forbidden Rites' })).toBe('https://poe.ninja/poe2/economy/forbiddenrites/currency')
  })

  it('bloqueia outros hosts e protocolos', () => {
    expect(isAllowedExternalUrl('https://evil.com/')).toBe(false)
    expect(isAllowedExternalUrl('http://poe2db.tw/')).toBe(false)
    expect(isAllowedExternalUrl('file:///C:/Windows')).toBe(false)
    expect(isAllowedExternalUrl('https://user:pw@poe.ninja/')).toBe(false)
    expect(isAllowedExternalUrl('https://poe2db.tw.evil.com/')).toBe(false)
    expect(externalUrl({ kind: 'guide', strategyId: 'ritual', index: 0 })).toBe('https://maxroll.gg/poe2/resources/ritual')
    expect(externalUrl({ kind: 'guide', strategyId: 'nao-existe', index: 0 })).toBeNull()
    expect(externalUrl({ kind: 'guide', strategyId: 'ritual', index: 9 })).toBeNull()
  })
})

describe('moedas', () => {
  const rates = { exaltedPerDivine: 585.8, chaosPerDivine: 9.43 }
  it('converte e formata', () => {
    expect(fromDivine(1, 'exalted', rates)).toBe(585.8)
    expect(fromDivine(0.5, 'chaos', rates)).toBeCloseTo(4.715)
    expect(formatAmount(585.8)).toBe('586')
    expect(formatAmount(62.095)).toBe('62,1')
    expect(formatAmount(1.5)).toBe('1,5')
    expect(median([3, 1, 2])).toBe(2)
    expect(median([])).toBeNull()
  })

  it('converte preço de listagem usando o poe.ninja', () => {
    const items = [{ id: 'exalted', category: 'Currency', valueDivine: 1 / 585.8 }] as MarketItem[]
    const idx = buildPriceIndex(items)
    expect(toDivine(2, 'divine', idx)).toBe(2)
    expect(toDivine(585.8, 'exalted', idx)).toBeCloseTo(1)
    expect(toDivine(1, 'moeda-desconhecida', idx)).toBeNull()
  })
})

describe('lista de acompanhamento', () => {
  const chaos: MarketItem = {
    id: 'chaos', detailsId: 'chaos-orb', name: 'Chaos Orb', category: 'Currency', iconUrl: null,
    valueDivine: 0.1, volumeDivine: 1000, change7d: 0, sparkline: [],
  }
  const rates = { exaltedPerDivine: 500, chaosPerDivine: 10 }
  const entry = createWatchEntry(chaos, rates, new Date('2026-09-01T00:00:00Z'), 10)

  it('mede o desempenho na moeda escolhida', () => {
    // Chaos ficou igual em Divine, mas o Divine passou a valer mais Exalted.
    const now = { exaltedPerDivine: 600, chaosPerDivine: 10 }
    expect(performance(entry, chaos, 'divine', now)).toBeCloseTo(0)
    expect(performance(entry, chaos, 'exalted', now)).toBeCloseTo(20)
  })

  it('alerta uma vez ao cruzar o limite e rearma depois', () => {
    const snap = (value: number): MarketSnapshot => ({ league: 'X', fetchedAt: '', rates, items: [{ ...chaos, valueDivine: value }] })
    const first = evaluateWatchlist([entry], snap(0.115), 'divine')
    expect(first.alerts).toHaveLength(1)
    expect(first.alerts[0]!.direction).toBe('up')
    const second = evaluateWatchlist(first.entries, snap(0.12), 'divine')
    expect(second.alerts).toHaveLength(0)
    const calm = evaluateWatchlist(second.entries, snap(0.102), 'divine')
    expect(calm.entries[0]!.lastAlert).toBeNull()
    const drop = evaluateWatchlist(calm.entries, snap(0.08), 'divine')
    expect(drop.alerts[0]!.direction).toBe('down')
  })
})

describe('migração v2 (compra instantânea)', () => {
  it('quem estava no padrão antigo "online" passa para compra instantânea', () => {
    expect(readSettings({ overlay: { listingStatus: 'online' } }).overlay.listingStatus).toBe('securable')
  })
  it('escolha feita depois da v2 é respeitada', () => {
    expect(readSettings({ version: 2, overlay: { listingStatus: 'online' } }).overlay.listingStatus).toBe('online')
  })
})
