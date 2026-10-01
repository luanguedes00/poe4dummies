import { useEffect, useState } from 'react'
import type { PricedListing } from '../../../core/pricecheck'
import type { DisplayCurrency } from '../../../core/types'
import { timeAgo, useApp } from '../lib/app'

function currencyUnit(id: string | null): DisplayCurrency | null {
  return id === 'exalted' || id === 'divine' || id === 'chaos' ? id : null
}

export function PriceSummary({ cheapest, median, count, total }: { cheapest: number | null; median: number | null; count: number; total: number }) {
  const { t, price, amount } = useApp()
  return (
    <div className="pc-sum">
      <div>
        <span className="label">{t('pc.cheapest')}</span>
        <b>{cheapest === null ? '–' : price(cheapest)}</b>
      </div>
      <div>
        <span className="label">{t('pc.median', { n: count })}</span>
        <b>{median === null ? '–' : price(median)}</b>
      </div>
      <div>
        <span className="label">{t('pc.listed')}</span>
        <b>{amount(total)}</b>
      </div>
    </div>
  )
}

/** Mesmo mod com outro número: "+78 to maximum Life" ~ "+92 to maximum Life". */
const template = (line: string) => line.replace(/[+-]?\d+(?:\.\d+)?/g, '#').toLowerCase()

/** Shift pressionado (para mostrar o item do vendedor ao passar o mouse). */
function useShift(): boolean {
  const [down, setDown] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Shift' && setDown(e.type === 'keydown')
    const off = () => setDown(false)
    window.addEventListener('keydown', on)
    window.addEventListener('keyup', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', on)
      window.removeEventListener('keyup', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  return down
}

/** Item do vendedor; ✓ nos mods que o seu item também tem. */
function SellerItem({ listing, own }: { listing: PricedListing; own: ReadonlySet<string> }) {
  const { t } = useApp()
  return (
    <div className="seller-item">
      <b>{[listing.name, listing.typeLine].filter(Boolean).join(' · ')}</b>
      {listing.itemLevel !== null && <small className="muted"> · {t('pc.ilvl', { n: listing.itemLevel })}</small>}
      {(listing.properties ?? []).map((p) => (
        <small key={p} className="muted seller-prop">
          {p}
        </small>
      ))}
      <ul>
        {(listing.mods ?? []).map((m, i) => {
          const same = own.has(template(m.text))
          return (
            <li key={i} className={`${m.kind} ${same ? 'same' : ''}`}>
              <span aria-hidden="true">{same ? '✓' : '·'}</span> {m.text}
              {m.tier && <small className="seller-tier"> {m.tier}</small>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Anúncios mais baratos. Segurando Shift sobre um anúncio, aparece o item do
 * vendedor para comparar com o seu (os dados já vieram na busca: sem requisição a mais).
 */
export function ListingList({ listings, ownMods = [] }: { listings: readonly PricedListing[]; ownMods?: readonly string[] }) {
  const { t, price, amount, unit: displayUnit } = useApp()
  const shift = useShift()
  const [hovered, setHovered] = useState<string | null>(null)
  const own = new Set(ownMods.map(template))
  const comparable = listings.some((l) => (l.mods ?? []).length > 0)
  return (
    <div className="listings">
      {listings.length === 0 && <div className="pc-note">{t('pc.noListings')}</div>}
      {comparable && <small className="muted listings-tip">{t('pc.compareTip')}</small>}
      {listings.map((l) => {
        const unit = currencyUnit(l.currency)
        const asked = l.amount === null ? t('pc.priceUnknown') : `${amount(l.amount)} ${unit ? t(`unit.${unit}`) : (l.currency ?? '')}`
        return (
          <div key={l.id} onMouseEnter={() => setHovered(l.id)} onMouseLeave={() => setHovered((h) => (h === l.id ? null : h))}>
            <div className={`lrow ${shift && hovered === l.id ? 'on' : ''}`}>
              <span className="num">
                {asked}
                {l.divine !== null && unit !== displayUnit && <small className="muted"> ≈ {price(l.divine)}</small>}
              </span>
              <span className="who">{[l.indexedAt ? timeAgo(l.indexedAt, t) : null, l.seller].filter(Boolean).join(' · ')}</span>
            </div>
            {shift && hovered === l.id && (l.mods ?? []).length > 0 && <SellerItem listing={l} own={own} />}
          </div>
        )
      })}
    </div>
  )
}
