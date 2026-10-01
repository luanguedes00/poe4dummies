import { describe, expect, it } from 'vitest'
import { captureKey, checkHotkey, copyKeySequence, currentHotkeys, DEFAULT_HOTKEYS, normalizeAccelerator, type KeyPress } from '../src/core/hotkeys'
import { applySettingsPatch, DEFAULT_SETTINGS, readSettings } from '../src/core/settings'

const press = (code: string, mods: Partial<KeyPress> = {}): KeyPress => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods })
const inUse = currentHotkeys(DEFAULT_SETTINGS)

describe('normalização de atalhos', () => {
  it('põe os modificadores na ordem Ctrl, Alt, Shift e a tecla em maiúscula', () => {
    expect(normalizeAccelerator('Shift+Alt+d')).toBe('Alt+Shift+D')
    expect(normalizeAccelerator('shift + ctrl + f5')).toBe('Ctrl+Shift+F5')
    expect(normalizeAccelerator('CommandOrControl+Shift+K')).toBe('Ctrl+Shift+K')
    expect(normalizeAccelerator('F8')).toBe('F8')
  })

  it('recusa formatos fora do padrão', () => {
    for (const bad of ['', 'D', 'Ctrl+', 'Ctrl+Ctrl+D', 'Super+D', 'Ctrl+Alt+Delete', 'Alt+Shift+Space', 'F13', 'Ctrl++', 'Ctrl+Alt+Shift+Meta+D']) {
      expect(normalizeAccelerator(bad), bad).toBeNull()
    }
  })
})

describe('captura de teclas', () => {
  it('usa o código físico da tecla (independe do layout)', () => {
    expect(captureKey(press('KeyD', { altKey: true, shiftKey: true }))).toEqual({ kind: 'combo', accelerator: 'Alt+Shift+D' })
    expect(captureKey(press('Digit1', { ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'combo', accelerator: 'Ctrl+Shift+1' })
    expect(captureKey(press('F9'))).toEqual({ kind: 'combo', accelerator: 'F9' })
  })

  it('Esc cancela; só modificadores ainda não formam atalho', () => {
    expect(captureKey(press('Escape', { altKey: true }))).toEqual({ kind: 'cancel' })
    expect(captureKey(press('AltLeft', { altKey: true, shiftKey: true }))).toEqual({ kind: 'partial', label: 'Alt+Shift+…' })
  })

  it('recusa teclas fora do formato e a tecla Windows', () => {
    expect(captureKey(press('Space', { altKey: true })).kind).toBe('unsupported')
    expect(captureKey(press('Numpad1', { ctrlKey: true })).kind).toBe('unsupported')
    expect(captureKey(press('KeyD', { metaKey: true })).kind).toBe('unsupported')
    expect(captureKey(press('KeyD')).kind).toBe('unsupported')
  })
})

describe('validação de atalhos', () => {
  it('padrões não colidem entre si nem com o jogo', () => {
    for (const slot of ['dashboard', 'collection', 'overlay'] as const) {
      const check = checkHotkey(slot, DEFAULT_HOTKEYS[slot], inUse)
      expect(check.errors, slot).toEqual([])
      expect(check.warnings, slot).toEqual([])
    }
  })

  it('bloqueia a cópia de item do jogo e Shift + letra', () => {
    expect(checkHotkey('dashboard', 'Ctrl+C', inUse).errors).toEqual([{ code: 'reserved' }])
    expect(checkHotkey('collection', 'Alt+Ctrl+C', inUse).errors).toEqual([{ code: 'reserved' }])
    expect(checkHotkey('dashboard', 'Shift+D', inUse).errors).toEqual([{ code: 'shift-only' }])
    expect(checkHotkey('dashboard', 'lixo', inUse).errors).toEqual([{ code: 'invalid' }])
    expect(checkHotkey('dashboard', null, inUse).errors).toEqual([{ code: 'invalid' }])
  })

  it('acusa colisão com o outro atalho do app', () => {
    expect(checkHotkey('dashboard', 'shift+alt+c', inUse).errors).toEqual([{ code: 'app-conflict', slot: 'collection' }])
    // O próprio valor não conta como colisão.
    expect(checkHotkey('dashboard', 'Alt+Shift+D', inUse).errors).toEqual([])
    const withOverlay = { ...inUse, overlay: 'Alt+D' }
    expect(checkHotkey('collection', 'Alt+D', withOverlay).errors).toEqual([{ code: 'app-conflict', slot: 'overlay' }])
  })

  it('avisa (sem bloquear) teclas conhecidas do jogo, do Windows e de outras ferramentas', () => {
    expect(checkHotkey('dashboard', 'Ctrl+F', inUse)).toMatchObject({ accelerator: 'Ctrl+F', errors: [], warnings: [{ code: 'game-search' }] })
    expect(checkHotkey('dashboard', 'Alt+F4', inUse).warnings).toEqual([{ code: 'close-window' }])
    expect(checkHotkey('overlay', 'Ctrl+D', inUse).warnings).toEqual([{ code: 'other-tool' }])
    expect(checkHotkey('dashboard', 'Ctrl+V', inUse).warnings).toEqual([{ code: 'text-editing' }])
    expect(checkHotkey('dashboard', 'F8', inUse).warnings).toEqual([{ code: 'no-modifier' }])
  })

  it('na sobreposição, Ctrl+C e null voltam para a cópia do próprio jogo', () => {
    expect(checkHotkey('overlay', 'Ctrl+C', inUse)).toEqual({ accelerator: null, errors: [], warnings: [] })
    expect(checkHotkey('overlay', null, inUse)).toEqual({ accelerator: null, errors: [], warnings: [] })
    expect(checkHotkey('overlay', 'Ctrl+Alt+C', inUse).errors).toEqual([{ code: 'reserved' }])
  })
})

describe('cópia simulada pelo atalho da sobreposição', () => {
  it('Alt+D simples: Ctrl desce antes de soltar o Alt (não abre o menu da janela)', () => {
    expect(copyKeySequence('Alt+D', 'simple')).toEqual([
      { key: 'ctrl', down: true },
      { key: 'alt', down: false },
      { key: 'c', down: true },
      { key: 'c', down: false },
      { key: 'ctrl', down: false },
    ])
  })

  it('Alt+D avançada mantém o Alt apertado pelo usuário', () => {
    expect(copyKeySequence('Alt+D', 'advanced')).toEqual([
      { key: 'ctrl', down: true },
      { key: 'c', down: true },
      { key: 'c', down: false },
      { key: 'ctrl', down: false },
    ])
  })

  it('F8 avançada aperta e solta Ctrl+Alt+C; Ctrl+Shift+Q solta o Shift e não solta o Ctrl do usuário', () => {
    expect(copyKeySequence('F8', 'advanced').map((e) => `${e.key}${e.down ? '↓' : '↑'}`).join(' ')).toBe('ctrl↓ alt↓ c↓ c↑ alt↑ ctrl↑')
    expect(copyKeySequence('Ctrl+Shift+Q', 'simple').map((e) => `${e.key}${e.down ? '↓' : '↑'}`).join(' ')).toBe('ctrl↓ shift↑ c↓ c↑')
  })
})

describe('atalhos nas configurações', () => {
  it('quem não tem os campos novos fica no padrão (cópia do jogo, modo simples)', () => {
    const s = readSettings({ version: 2, dashboardHotkey: 'Ctrl+Shift+F5', overlay: { enabled: true } })
    expect(s.dashboardHotkey).toBe('Ctrl+Shift+F5')
    expect(s.collectionHotkey).toBe('Alt+Shift+C')
    expect(s.overlay.hotkey).toBeNull()
    expect(s.overlay.copyMode).toBe('simple')
  })

  it('valor salvo é mantido e guardado na forma canônica; inválido volta ao padrão', () => {
    expect(readSettings({ dashboardHotkey: 'Shift+Alt+P' }).dashboardHotkey).toBe('Alt+Shift+P')
    expect(readSettings({ dashboardHotkey: 'Ctrl+Alt+Delete' }).dashboardHotkey).toBe('Alt+Shift+D')
    expect(readSettings({ overlay: { hotkey: 'Alt+D', copyMode: 'advanced' } }).overlay).toMatchObject({ hotkey: 'Alt+D', copyMode: 'advanced' })
    expect(readSettings({ overlay: { hotkey: 'Win+D', copyMode: 'turbo' } }).overlay).toMatchObject({ hotkey: null, copyMode: 'simple' })
  })

  it('alteração vinda da interface valida o atalho da sobreposição', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { overlay: { hotkey: 'alt+d' } }).overlay.hotkey).toBe('Alt+D')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { overlay: { hotkey: null } }).overlay.hotkey).toBeNull()
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { overlay: { hotkey: 'Alt+Space' } })).toThrow()
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { overlay: { copyMode: 'turbo' } })).toThrow()
  })
})

describe('adicionar à lista (tecla só no jogo)', () => {
  it('padrão F3, sem aviso de tecla solta (só vale com o jogo em foco)', () => {
    expect(DEFAULT_SETTINGS.collectionAddHotkey).toBe('F3')
    const check = checkHotkey('collectionAdd', 'F3', inUse)
    expect(check.errors).toEqual([])
    expect(check.warnings).toEqual([])
    // Em atalho global a mesma tecla solta continua com aviso.
    expect(checkHotkey('dashboard', 'F3', inUse).warnings.map((w) => w.code)).toContain('no-modifier')
  })

  it('não deixa repetir outro atalho do app nem usar Ctrl+C', () => {
    expect(checkHotkey('collectionAdd', 'Alt+Shift+D', inUse).errors).toEqual([{ code: 'app-conflict', slot: 'dashboard' }])
    expect(checkHotkey('collectionAdd', 'Ctrl+C', inUse).errors.map((e) => e.code)).toContain('reserved')
  })

  it('a cópia simulada pela tecla é um Ctrl+C simples', () => {
    expect(copyKeySequence('F3', 'simple')).toEqual([
      { key: 'ctrl', down: true },
      { key: 'c', down: true },
      { key: 'c', down: false },
      { key: 'ctrl', down: false },
    ])
  })

  it('configuração antiga sem a tecla volta ao padrão', () => {
    const { collectionAddHotkey: _, ...old } = DEFAULT_SETTINGS
    expect(readSettings(old).collectionAddHotkey).toBe('F3')
  })
})
