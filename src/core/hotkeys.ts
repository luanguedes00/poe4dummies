// Atalhos globais do app: formato, normalização e conflitos conhecidos.
// Lógica pura (sem Electron e sem DOM): roda no processo principal e na interface.

export const HOTKEY_SLOTS = ['dashboard', 'collection', 'overlay'] as const
export type HotkeySlot = (typeof HOTKEY_SLOTS)[number]

/** Cópia simulada pelo atalho da sobreposição: simples (Ctrl+C) ou avançada (Ctrl+Alt+C, com tiers). */
export const COPY_MODES = ['simple', 'advanced'] as const
export type CopyMode = (typeof COPY_MODES)[number]

/**
 * Padrões. Alt+Shift+letra não existe no PoE2 (o jogo usa Ctrl+clique, Alt para itens no chão,
 * Shift para atacar parado, números e letras soltas) nem nos atalhos comuns do Windows,
 * navegadores, Discord, Steam e drivers de vídeo. D = Dashboard; C = Coleta (fica ao lado do
 * Ctrl+C usado em seguida). Ctrl+Shift ficou de fora porque navegadores e o driver da AMD o usam.
 * A sobreposição usa por padrão a cópia do próprio jogo (null = Ctrl+C / Ctrl+Alt+C, sem atalho global).
 */
export const DEFAULT_HOTKEYS: Record<HotkeySlot, string | null> = {
  dashboard: 'Alt+Shift+D',
  collection: 'Alt+Shift+C',
  overlay: null,
}

/** Atalhos aceitos pelo Electron, restritos a combinações simples e seguras. */
export const ACCELERATOR = /^(?:(?:CommandOrControl|Ctrl|Alt|Shift)\+){1,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$|^F(?:[1-9]|1[0-2])$/

const MODIFIER_ALIASES: Record<string, 'Ctrl' | 'Alt' | 'Shift'> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
}
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift'] as const
const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/

/**
 * Forma canônica: "Ctrl+Alt+Shift+Tecla" (modificadores nessa ordem, sem repetição, tecla em maiúscula).
 * Devolve null se não for um atalho aceito.
 */
export function normalizeAccelerator(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null
  const parts = raw.split('+').map((p) => p.trim())
  if (parts.some((p) => p === '')) return null
  const key = parts.pop()!.toUpperCase()
  if (!KEY.test(key)) return null
  const mods = new Set<string>()
  for (const part of parts) {
    const mod = MODIFIER_ALIASES[part.toLowerCase()]
    if (!mod || mods.has(mod)) return null
    mods.add(mod)
  }
  const out = [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join('+')
  return ACCELERATOR.test(out) ? out : null
}

/** Tecla apertada no campo de captura (campos de um KeyboardEvent, sem depender do DOM). */
export interface KeyPress {
  /** `KeyboardEvent.code`: independe do layout do teclado (ABNT2, US...). */
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export type CaptureStep =
  | { kind: 'cancel' }
  /** Só modificadores apertados até agora (ex.: "Alt+Shift+…"). */
  | { kind: 'partial'; label: string }
  | { kind: 'combo'; accelerator: string }
  | { kind: 'unsupported' }

const MODIFIER_CODES = /^(?:Control|Alt|Shift|Meta|OS)(?:Left|Right)?$/

/** Converte uma tecla apertada no formato de atalho do Electron. */
export function captureKey(press: KeyPress): CaptureStep {
  if (press.code === 'Escape') return { kind: 'cancel' }
  const mods = [press.ctrlKey && 'Ctrl', press.altKey && 'Alt', press.shiftKey && 'Shift'].filter(Boolean) as string[]
  if (MODIFIER_CODES.test(press.code)) return { kind: 'partial', label: mods.length ? `${mods.join('+')}+…` : '…' }
  // A tecla Windows não é aceita: o sistema reserva quase todas as combinações com ela.
  if (press.metaKey) return { kind: 'unsupported' }
  let key: string | null = null
  const letter = /^Key([A-Z])$/.exec(press.code)
  const digit = /^Digit([0-9])$/.exec(press.code)
  const fn = /^F([1-9]|1[0-2])$/.exec(press.code)
  if (letter) key = letter[1]!
  else if (digit) key = digit[1]!
  else if (fn) key = press.code
  if (!key) return { kind: 'unsupported' }
  const accelerator = normalizeAccelerator([...mods, key].join('+'))
  return accelerator ? { kind: 'combo', accelerator } : { kind: 'unsupported' }
}

export type HotkeyIssueCode =
  /** Fora do formato aceito. */
  | 'invalid'
  /** Ctrl+C / Ctrl+Alt+C: cópia de item do jogo (registrar como atalho global quebraria a cópia). */
  | 'reserved'
  /** Shift + letra/número: bloquearia letras maiúsculas e símbolos em todos os programas. */
  | 'shift-only'
  /** Já usado por outro atalho do app. */
  | 'app-conflict'
  /** Avisos (não impedem salvar). */
  | 'game-search'
  | 'close-window'
  | 'other-tool'
  | 'text-editing'
  | 'no-modifier'

/** Problemas que impedem salvar. */
export type HotkeyErrorCode = Extract<HotkeyIssueCode, 'invalid' | 'reserved' | 'shift-only' | 'app-conflict'>

/** Atalhos em uso, lidos das configurações. */
export function currentHotkeys(s: { dashboardHotkey: string; collectionHotkey: string; overlay: { hotkey: string | null } }): Record<HotkeySlot, string | null> {
  return { dashboard: s.dashboardHotkey, collection: s.collectionHotkey, overlay: s.overlay.hotkey }
}

export interface HotkeyIssue {
  code: HotkeyIssueCode
  /** Em 'app-conflict': qual atalho do app já usa a combinação. */
  slot?: HotkeySlot
}

export interface HotkeyCheck {
  /** Forma canônica; null com `errors` vazio = cópia do próprio jogo (só na sobreposição). */
  accelerator: string | null
  errors: HotkeyIssue[]
  warnings: HotkeyIssue[]
}

/** Cópia de item do jogo: nunca vira atalho global. */
const RESERVED = new Set(['Ctrl+C', 'Ctrl+Alt+C'])

/** Combinações conhecidas do jogo, do Windows e de ferramentas comuns entre jogadores. */
const KNOWN: Record<string, HotkeyIssueCode> = {
  'Ctrl+F': 'game-search', // busca no baú e no inventário
  'Alt+F4': 'close-window',
  'Ctrl+D': 'other-tool', // price check do Exiled Exchange 2 / Awakened PoE Trade
  'Ctrl+Alt+D': 'other-tool',
}

/** Atalhos de edição de texto que deixariam de funcionar em outros programas. */
const TEXT_EDITING = new Set(['Ctrl+A', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+S'])

/**
 * Valida um atalho para um slot. `current` são os atalhos em uso (para achar colisões).
 * Na sobreposição, Ctrl+C e null significam "cópia do próprio jogo" (o padrão).
 */
export function checkHotkey(slot: HotkeySlot, raw: string | null, current: Record<HotkeySlot, string | null>): HotkeyCheck {
  if (raw === null) {
    if (slot === 'overlay') return { accelerator: null, errors: [], warnings: [] }
    return { accelerator: null, errors: [{ code: 'invalid' }], warnings: [] }
  }
  const accelerator = normalizeAccelerator(raw)
  if (!accelerator) return { accelerator: null, errors: [{ code: 'invalid' }], warnings: [] }
  if (slot === 'overlay' && accelerator === 'Ctrl+C') return { accelerator: null, errors: [], warnings: [] }

  const errors: HotkeyIssue[] = []
  const warnings: HotkeyIssue[] = []
  if (RESERVED.has(accelerator)) errors.push({ code: 'reserved' })
  if (/^Shift\+[A-Z0-9]$/.test(accelerator)) errors.push({ code: 'shift-only' })
  for (const other of HOTKEY_SLOTS) {
    if (other !== slot && current[other] !== null && normalizeAccelerator(current[other]!) === accelerator) {
      errors.push({ code: 'app-conflict', slot: other })
    }
  }
  const known = KNOWN[accelerator]
  if (known) warnings.push({ code: known })
  if (TEXT_EDITING.has(accelerator)) warnings.push({ code: 'text-editing' })
  if (!accelerator.includes('+')) warnings.push({ code: 'no-modifier' })
  return { accelerator, errors, warnings }
}

export type CopyKey = 'ctrl' | 'alt' | 'shift' | 'c'
export interface CopyKeyEvent {
  key: CopyKey
  down: boolean
}

/**
 * Teclas para simular a cópia do jogo logo depois do atalho da sobreposição.
 * Os modificadores do próprio atalho ainda estão apertados: Shift é solto (Ctrl+Shift+C não copia);
 * Alt é solto na cópia simples e mantido na avançada. Ctrl desce primeiro para que soltar o Alt
 * não abra o menu da janela.
 */
export function copyKeySequence(accelerator: string, mode: CopyMode): CopyKeyEvent[] {
  const held = new Set(accelerator.split('+').slice(0, -1))
  const seq: CopyKeyEvent[] = [{ key: 'ctrl', down: true }]
  if (held.has('Shift')) seq.push({ key: 'shift', down: false })
  const pressAlt = mode === 'advanced' && !held.has('Alt')
  if (mode === 'simple' && held.has('Alt')) seq.push({ key: 'alt', down: false })
  if (pressAlt) seq.push({ key: 'alt', down: true })
  seq.push({ key: 'c', down: true }, { key: 'c', down: false })
  if (pressAlt) seq.push({ key: 'alt', down: false })
  if (!held.has('Ctrl')) seq.push({ key: 'ctrl', down: false })
  return seq
}
