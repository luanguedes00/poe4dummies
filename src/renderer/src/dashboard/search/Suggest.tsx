import { useEffect, useRef, useState } from 'react'

const MAX_SUGGESTIONS = 12

function matches(text: string, words: readonly string[]): boolean {
  const lower = text.toLowerCase()
  return words.every((w) => lower.includes(w))
}

/** Filtra e ordena sugestões: começa com o termo primeiro, depois as mais curtas. */
export function rank<T>(list: readonly T[], query: string, text: (x: T) => string): T[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const words = q.split(/\s+/)
  return list
    .filter((x) => matches(text(x), words))
    .sort((a, b) => {
      const sa = text(a).toLowerCase().startsWith(q) ? 0 : 1
      const sb = text(b).toLowerCase().startsWith(q) ? 0 : 1
      return sa - sb || text(a).length - text(b).length
    })
    .slice(0, MAX_SUGGESTIONS)
}

/** "+# total maximum Life" → "+N total maximum Life" (o "#" da API confunde iniciantes). */
export function readable(statText: string): string {
  return statText.replace(/#/g, 'N')
}

export function toNumber(text: string): number | null {
  if (text.trim() === '') return null
  const n = Number(text.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Campo com lista de sugestões navegável pelo teclado (setas, Enter, Esc). */
export function Suggest<T>({
  id,
  value,
  onChange,
  options,
  render,
  onPick,
  placeholder,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  options: T[]
  render: (o: T) => { main: string; detail?: string }
  onPick: (o: T) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setActive(0), [options])
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current)
  }, [])

  const pick = (o: T) => {
    onPick(o)
    setOpen(false)
  }

  return (
    <div className="suggest">
      <input
        id={id}
        className="input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={`${id}-list`}
        onFocus={() => setOpen(true)}
        onBlur={() => (blurTimer.current = setTimeout(() => setOpen(false), 150))}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (!open || options.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, options.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const o = options[active]
            if (o) pick(o)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && options.length > 0 && (
        <ul className="suggest-list" id={`${id}-list`} role="listbox">
          {options.map((o, i) => {
            const r = render(o)
            return (
              <li
                key={`${r.main}|${r.detail ?? ''}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'on' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
              >
                <span>{r.main}</span>
                {r.detail && <small className="muted">{r.detail}</small>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
