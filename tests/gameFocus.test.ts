import { describe, expect, it } from 'vitest'
import { isGameExe } from '../src/main/gameFocus'

describe('isGameExe', () => {
  it('reconhece os executáveis do PoE', () => {
    for (const exe of ['PathOfExile.exe', 'PathOfExileSteam.exe', 'PathOfExile_x64.exe', 'PathOfExile_x64Steam.exe', 'PathOfExile_KG.exe', 'pathofexile.EXE']) {
      expect(isGameExe(exe)).toBe(true)
    }
  })
  it('ignora outros programas', () => {
    for (const exe of ['chrome.exe', 'Discord.exe', 'claude.exe', 'PathOfBuilding.exe', 'NotPathOfExile.exe']) expect(isGameExe(exe)).toBe(false)
    expect(isGameExe(null)).toBe(false)
  })
})
