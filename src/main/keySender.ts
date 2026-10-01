// Simula teclas no Windows (user32 keybd_event via koffi) para o atalho próprio da sobreposição:
// aperta a cópia do jogo (Ctrl+C ou Ctrl+Alt+C) no lugar do usuário. Uma ação por tecla do
// usuário, só com o PoE2 em foco (quem chama confere). Nada além de Ctrl, Alt, Shift e C.

import type koffiType from 'koffi'
import type { CopyKey, CopyKeyEvent } from '../core/hotkeys'

const VK: Record<CopyKey, number> = { ctrl: 0x11, alt: 0x12, shift: 0x10, c: 0x43 }
const KEYEVENTF_KEYUP = 0x0002
const MAPVK_VK_TO_VSC = 0

interface User32 {
  keybdEvent: (vk: number, scan: number, flags: number, extra: number) => void
  mapVirtualKey: (code: number, mapType: number) => number
}

let user32: User32 | null | undefined

function load(): User32 | null {
  if (user32 !== undefined) return user32
  user32 = null
  if (process.platform !== 'win32') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof koffiType
    const lib = koffi.load('user32.dll')
    user32 = {
      keybdEvent: lib.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)'),
      mapVirtualKey: lib.func('uint32 __stdcall MapVirtualKeyW(uint32 code, uint32 mapType)'),
    }
  } catch {
    user32 = null
  }
  return user32
}

/** Envia a sequência de teclas. false se não for possível (outro SO ou falha da biblioteca). */
export function sendKeys(sequence: CopyKeyEvent[]): boolean {
  const api = load()
  if (!api) return false
  try {
    for (const { key, down } of sequence) {
      const vk = VK[key]
      // Com o código de varredura junto, jogos que leem o teclado em nível baixo também recebem a tecla.
      api.keybdEvent(vk, api.mapVirtualKey(vk, MAPVK_VK_TO_VSC) & 0xff, down ? 0 : KEYEVENTF_KEYUP, 0)
    }
    return true
  } catch {
    return false
  }
}
