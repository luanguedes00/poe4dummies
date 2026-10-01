import { describe, expect, it } from 'vitest'
import { applySettingsPatch, CLOSE_REMEMBER_DAYS, DEFAULT_SETTINGS, effectiveCloseAction, readSettings } from '../src/core/settings'

const DAY = 24 * 60 * 60 * 1000
const t0 = Date.UTC(2026, 9, 1, 22, 0)

describe('ao fechar a janela: "não perguntar de novo" vale por 15 dias', () => {
  it('escolha da janela de fechar volta a perguntar depois de 15 dias', () => {
    const s = { closeAction: 'tray' as const, closeActionRememberedAt: t0 }
    expect(CLOSE_REMEMBER_DAYS).toBe(15)
    expect(effectiveCloseAction(s, t0 + 14 * DAY)).toBe('tray')
    expect(effectiveCloseAction(s, t0 + 15 * DAY)).toBe('ask')
    expect(effectiveCloseAction({ closeAction: 'quit', closeActionRememberedAt: t0 }, t0 + 30 * DAY)).toBe('ask')
  })

  it('escolha feita em Configurações não expira', () => {
    expect(effectiveCloseAction({ closeAction: 'tray', closeActionRememberedAt: null }, t0 + 365 * DAY)).toBe('tray')
  })

  it('configuração antiga sem a data continua valendo e o padrão é perguntar', () => {
    const { closeActionRememberedAt: _, ...old } = { ...DEFAULT_SETTINGS, closeAction: 'quit' as const }
    expect(readSettings(old)).toMatchObject({ closeAction: 'quit', closeActionRememberedAt: null })
    expect(DEFAULT_SETTINGS.closeAction).toBe('ask')
  })

  it('a interface pode salvar a escolha com ou sem prazo', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { closeAction: 'tray', closeActionRememberedAt: t0 })).toMatchObject({ closeAction: 'tray', closeActionRememberedAt: t0 })
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { closeActionRememberedAt: -1 })).toThrow()
  })
})
