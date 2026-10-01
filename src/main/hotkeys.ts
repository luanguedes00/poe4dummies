// Registro dos atalhos globais do app (globalShortcut do Electron).
// Um atalho novo só substitui o antigo depois que o sistema aceitar o registro:
// se outro programa já usa a combinação, o antigo continua valendo e a interface recebe o erro.

import { globalShortcut } from 'electron'
import { HOTKEY_SLOTS, type HotkeySlot } from '../core/hotkeys'
import type { HotkeyStatus } from '../shared/ipc'

function register(accelerator: string, action: () => void): boolean {
  try {
    return globalShortcut.register(accelerator, action)
  } catch {
    return false
  }
}

export class HotkeyManager {
  /** O que a configuração pede. */
  private readonly wanted = new Map<HotkeySlot, string | null>()
  /** O que está de fato registrado no sistema. */
  private readonly bound = new Map<HotkeySlot, string>()
  private suspended = false
  private resumeTimer: NodeJS.Timeout | null = null

  constructor(private readonly actions: Record<HotkeySlot, () => void>) {}

  /** Aplica o valor das configurações (início do app e mudanças). */
  apply(slot: HotkeySlot, accelerator: string | null): void {
    this.wanted.set(slot, accelerator)
    if (this.suspended) return
    const previous = this.bound.get(slot)
    if (previous === accelerator) return
    if (previous) globalShortcut.unregister(previous)
    this.bound.delete(slot)
    if (accelerator && register(accelerator, this.actions[slot])) this.bound.set(slot, accelerator)
  }

  /**
   * Troca pedida pela interface: registra o novo antes de soltar o antigo.
   * false = o sistema recusou; nada muda.
   */
  trySet(slot: HotkeySlot, accelerator: string | null): boolean {
    if (this.suspended) this.resume()
    const previous = this.bound.get(slot)
    if (previous === accelerator) {
      this.wanted.set(slot, accelerator)
      return true
    }
    if (accelerator && !register(accelerator, this.actions[slot])) return false
    if (previous) globalShortcut.unregister(previous)
    if (accelerator) this.bound.set(slot, accelerator)
    else this.bound.delete(slot)
    this.wanted.set(slot, accelerator)
    return true
  }

  /**
   * Enquanto a interface captura uma combinação, os atalhos ficam soltos (senão o sistema
   * engole a combinação atual antes de ela chegar ao campo). Volta sozinho em 30 s.
   */
  suspend(on: boolean): void {
    if (!on) return this.resume()
    if (this.resumeTimer) clearTimeout(this.resumeTimer)
    this.resumeTimer = setTimeout(() => this.resume(), 30_000)
    if (this.suspended) return
    this.suspended = true
    for (const accelerator of this.bound.values()) globalShortcut.unregister(accelerator)
    this.bound.clear()
  }

  private resume(): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer)
    this.resumeTimer = null
    if (!this.suspended) return
    this.suspended = false
    for (const [slot, accelerator] of this.wanted) this.apply(slot, accelerator)
  }

  status(): HotkeyStatus {
    const out = {} as HotkeyStatus
    for (const slot of HOTKEY_SLOTS) {
      const accelerator = this.wanted.get(slot) ?? null
      out[slot] = { accelerator, registered: accelerator === null || this.suspended || this.bound.get(slot) === accelerator }
    }
    return out
  }
}
