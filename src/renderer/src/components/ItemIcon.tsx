import { useState } from 'react'

const HOSTS: Array<[string, string]> = [
  ['https://web.poecdn.com/', 'poe-icon://cdn/'],
  ['https://repoe-fork.github.io/poe2/', 'poe-icon://repoe/'],
]

/** Imagem via cache em disco do app (baixa uma vez, depois lê local). */
export function iconSrc(url: string): string {
  for (const [from, to] of HOSTS) if (url.startsWith(from)) return to + url.slice(from.length)
  return url
}

/** Ícone oficial do item (CDN da GGG) com iniciais como reserva. */
export function ItemIcon({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  if (url && !failed) {
    return <img className="icon" src={iconSrc(url)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  }
  const initials = name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
  return <span className="icon-fallback" aria-hidden="true">{initials}</span>
}
