// Campo "clique e aperte a combinação" para os atalhos globais.
// Formato e conflitos vêm de core/hotkeys; o processo principal confirma o registro no Windows.

import { useEffect, useRef, useState } from 'react'
import { captureKey, checkHotkey, DEFAULT_HOTKEYS, type HotkeySlot } from '../../../core/hotkeys'
import type { MessageKey } from '../../../shared/i18n'
import { api, useApp } from '../lib/app'

const SLOT_LABEL: Record<HotkeySlot, MessageKey> = {
  dashboard: 'settings.hotkey',
  collection: 'settings.collectionHotkey',
  overlay: 'settings.overlayHotkey',
}

interface Props {
  slot: HotkeySlot
  /** Valor salvo; null = cópia do próprio jogo (só na sobreposição). */
  value: string | null
  /** Atalhos em uso no app, para avisar colisões. */
  current: Record<HotkeySlot, string | null>
  /** false = o Windows recusou o registro do valor salvo. */
  registered: boolean
  hint?: string
  /** Aviso extra mostrado junto com os do atalho. */
  extraWarning?: string | null
  onSaved: () => void
}

export function HotkeyField({ slot, value, current, registered, hint, extraWarning, onSaved }: Props) {
  const { t } = useApp()
  const [capturing, setCapturing] = useState(false)
  const [partial, setPartial] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const capturingRef = useRef(false)

  const setCapture = (on: boolean) => {
    if (capturingRef.current === on) return
    capturingRef.current = on
    setCapturing(on)
    setPartial(null)
    // Enquanto captura, os atalhos do app ficam soltos para a combinação chegar ao campo.
    void api.suspendHotkeys(on).catch(() => undefined)
  }

  // Sair da tela no meio da captura não pode deixar os atalhos soltos.
  useEffect(() => () => {
    if (capturingRef.current) void api.suspendHotkeys(false).catch(() => undefined)
  }, [])

  const save = async (accelerator: string | null) => {
    setBusy(true)
    try {
      const result = await api.setHotkey(slot, accelerator)
      if (result.ok) {
        setError(null)
        onSaved()
      } else {
        const other = result.code === 'app-conflict' ? checkHotkey(slot, accelerator ?? DEFAULT_HOTKEYS[slot], current).errors[0]?.slot : undefined
        setError(t(`hotkey.error.${result.code}`, { name: other ? t(SLOT_LABEL[other]) : '' }))
      }
    } catch {
      setError(t('settings.invalid'))
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!capturing) return
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey) return setCapture(false)
    e.preventDefault()
    e.stopPropagation()
    const step = captureKey({ code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey })
    if (step.kind === 'cancel') return setCapture(false)
    if (step.kind === 'partial') return setPartial(step.label)
    setCapture(false)
    if (step.kind === 'unsupported') return setError(t('hotkey.error.invalid'))
    const check = checkHotkey(slot, step.accelerator, current)
    const problem = check.errors[0]
    if (problem) {
      return setError(t(`hotkey.error.${problem.code}` as MessageKey, { name: problem.slot ? t(SLOT_LABEL[problem.slot]) : '' }))
    }
    if (check.accelerator === value) return setError(null)
    void save(check.accelerator)
  }

  const onKeyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!capturing) return
    e.preventDefault()
    const step = captureKey({ code: 'ShiftLeft', ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: false })
    setPartial(step.kind === 'partial' && step.label !== '…' ? step.label : null)
  }

  const isDefault = value === DEFAULT_HOTKEYS[slot]
  const warnings = value === null ? [] : checkHotkey(slot, value, current).warnings
  const display = capturing ? (partial ?? t('hotkey.capturing')) : (value ?? t('hotkey.gameCopy'))
  const inactive = !registered && value !== null && !error

  return (
    <div className="field">
      <span>{t(SLOT_LABEL[slot])}</span>
      <div className="hotkey-row">
        <button
          type="button"
          className={`input hotkey-input${capturing ? ' capturing' : ''}`}
          aria-label={t(SLOT_LABEL[slot])}
          disabled={busy}
          onClick={() => {
            setError(null)
            setCapture(!capturing)
          }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={() => setCapture(false)}
        >
          {display}
        </button>
        <button type="button" className="btn ghost small" disabled={busy || isDefault} onClick={() => void save(null)}>
          {t('hotkey.reset')}
        </button>
      </div>
      {error && <small className="hotkey-msg error">{error}</small>}
      {inactive && <small className="hotkey-msg error">{t('hotkey.error.inactive', { key: value })}</small>}
      {warnings.map((w) => (
        <small key={w.code} className="hotkey-msg warn">
          {t(`hotkey.warn.${w.code}` as MessageKey)}
        </small>
      ))}
      {extraWarning && <small className="hotkey-msg warn">{extraWarning}</small>}
      {hint && <small>{hint}</small>}
    </div>
  )
}
