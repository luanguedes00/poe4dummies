// Estado que sobrevive à troca de aba: o que o usuário mexeu (sub-aba, busca,
// campos) continua lá quando ele volta. Com `persist`, também sobrevive a
// fechar o app (localStorage; só para valores simples em JSON).

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

const memory = new Map<string, unknown>()
const PREFIX = 'sticky:'

function readSaved<T>(key: string): { ok: true; value: T } | { ok: false } {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw !== null) return { ok: true, value: JSON.parse(raw) as T }
  } catch {
    // Armazenamento indisponível ou valor corrompido: usa o padrão.
  }
  return { ok: false }
}

/** `valid`: descarta valor salvo que não vale mais (ex.: aba que deixou de existir). */
export function useSticky<T>(key: string, initial: T | (() => T), options: { persist?: boolean; valid?: (v: unknown) => boolean } = {}): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (memory.has(key)) return memory.get(key) as T
    if (options.persist) {
      const saved = readSaved<T>(key)
      if (saved.ok && (options.valid?.(saved.value) ?? true)) return saved.value
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) =>
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        memory.set(key, resolved)
        if (options.persist) {
          try {
            localStorage.setItem(PREFIX + key, JSON.stringify(resolved))
          } catch {
            // Sem espaço ou bloqueado: fica só na memória.
          }
        }
        return resolved
      }),
    [key, options.persist],
  )
  return [value, set]
}
