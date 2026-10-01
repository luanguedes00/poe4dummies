import type { ReactNode } from 'react'

/** "?" com dica que aparece no hover e no foco do teclado. */
export function Hint({ text, align = 'center' }: { text: string; align?: 'center' | 'right' }) {
  return (
    <span className={`hint ${align}`} tabIndex={0} role="note" aria-label={text} data-tip={text} onClick={(e) => e.stopPropagation()}>
      ?
    </span>
  )
}

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ico" aria-hidden="true">
        {icon}
      </div>
      <b>{title}</b>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

export function TableSkeleton({ label, rows = 8 }: { label: string; rows?: number }) {
  return (
    <div className="table-wrap" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 44, margin: 4 }} />
      ))}
    </div>
  )
}

/** Classe de cor para variações: sem dado fica neutro (antes ficava verde). */
export function changeClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'muted'
  return value >= 0 ? 'up' : 'down'
}
