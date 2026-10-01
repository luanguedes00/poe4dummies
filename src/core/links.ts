// Links externos que o app pode abrir. Nenhuma URL vem pronta da interface:
// ela manda só o destino e os dados, e a URL é montada e validada aqui.

import { STRATEGIES } from './farm/strategies'
import { tradeSiteUrl } from './sources/trade'

export type ExternalTarget =
  | { kind: 'trade'; league: string; queryId: string }
  | { kind: 'poe2db'; name: string }
  | { kind: 'ninja'; league: string }
  /** Guia curado de uma estratégia de farm (a URL vem do arquivo de dados, não da interface). */
  | { kind: 'guide'; strategyId: string; index: number }

const ALLOWED_HOSTS = new Set(['www.pathofexile.com', 'poe2db.tw', 'poe.ninja', 'maxroll.gg', 'www.aoeah.com'])

export function poe2dbUrl(name: string): string | null {
  const slug = name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_'-]/g, '')
  if (slug.length === 0 || slug.length > 120) return null
  return `https://poe2db.tw/us/${encodeURIComponent(slug)}`
}

export function ninjaUrl(league: string): string | null {
  const slug = league.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (slug.length === 0 || slug.length > 64) return null
  return `https://poe.ninja/poe2/economy/${slug}/currency`
}

export function externalUrl(target: ExternalTarget): string | null {
  let url: string | null
  switch (target.kind) {
    case 'trade':
      url = tradeSiteUrl(target.league, target.queryId)
      break
    case 'poe2db':
      url = poe2dbUrl(target.name)
      break
    case 'ninja':
      url = ninjaUrl(target.league)
      break
    case 'guide':
      url = STRATEGIES.find((s) => s.id === target.strategyId)?.sources[target.index]?.url ?? null
      break
  }
  return url !== null && isAllowedExternalUrl(url) ? url : null
}

/** Última barreira antes de abrir qualquer coisa no navegador do usuário. */
export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && ALLOWED_HOSTS.has(parsed.hostname) && parsed.username === '' && parsed.password === ''
  } catch {
    return false
  }
}
