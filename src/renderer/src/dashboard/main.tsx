import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CURRENCY_SHORT } from '../../../core/money'
import type { DisplayCurrency, MarketItem } from '../../../core/types'
import type { MessageKey } from '../../../shared/i18n'
import { api, AppProvider, errorKey, timeAgo, useApp } from '../lib/app'
import { useSticky } from '../lib/sticky'
import '../fonts'
import '../styles.css'
import { CloseDialog } from '../components/CloseDialog'
import { ItemDrawerProvider } from './ItemDrawer'
import { MarketPage } from './MarketPage'
import { MarketSearchPage } from './MarketSearchPage'
import { OpportunitiesPage, SettingsPage, WatchlistPage } from './pages'
import { CollectionRoute, TrackerRoute } from './routes'
import { FarmPage } from './FarmPage'
import { BuildPage } from './BuildPage'
import { BetaBadge } from '../components/Beta'
import { iconSrc } from '../components/ItemIcon'
import { LeagueSelect } from '../components/LeagueSelect'
// Ícone do app na faixa do topo (a mesma arte do ícone da barra de tarefas).
import divineIcon from '../../../../build/divine.png'
import { ArrowClockwise } from '@phosphor-icons/react'

type Page = 'market' | 'opportunities' | 'watchlist' | 'pricecheck' | 'collection' | 'tracker' | 'farm' | 'build' | 'settings'

const PAGES: Array<{ id: Page; label: MessageKey }> = [
  { id: 'market', label: 'nav.market' },
  { id: 'opportunities', label: 'nav.opportunities' },
  { id: 'watchlist', label: 'nav.watchlist' },
  { id: 'pricecheck', label: 'nav.pricecheck' },
  { id: 'collection', label: 'nav.collection' },
  { id: 'tracker', label: 'nav.tracker' },
  { id: 'farm', label: 'nav.farm' },
  { id: 'build', label: 'nav.build' },
]

const UNITS: DisplayCurrency[] = ['exalted', 'divine', 'chaos']

/** Nome da moeda como no jogo (para leitor de tela e dica ao passar o mouse). */
const CURRENCY_NAME: Record<DisplayCurrency, string> = { exalted: 'Exalted Orb', divine: 'Divine Orb', chaos: 'Chaos Orb' }

/** Ícone da moeda (cache de imagens do app); sem ícone, a sigla de sempre ("Ex"). */
function CurrencyMark({ currency, item }: { currency: DisplayCurrency; item: MarketItem | undefined }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const name = item?.name ?? CURRENCY_NAME[currency]
  const url = item?.iconUrl ?? null
  if (url && url !== failedUrl) {
    return <img className="rate-icon" src={iconSrc(url)} alt={name} title={name} referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
  }
  return <abbr title={name}>{CURRENCY_SHORT[currency]}</abbr>
}

function Shell() {
  const { t, market, settings, updateSettings, amount } = useApp()
  const [page, setPage] = useSticky<Page>('page', 'market', { persist: true, valid: (v) => v === 'settings' || PAGES.some((p) => p.id === v) })
  const rates = market.snapshot?.rates
  // Ícones das moedas da cotação: vêm com os preços do poe.ninja (sem outra consulta).
  const currencies = useMemo(() => {
    const map = new Map<DisplayCurrency, MarketItem>()
    for (const item of market.snapshot?.items ?? []) {
      if (item.category === 'Currency' && UNITS.includes(item.id as DisplayCurrency)) map.set(item.id as DisplayCurrency, item)
    }
    return map
  }, [market.snapshot])
  // Botão de configurações do quadro da campanha abre o painel direto na página.
  useEffect(() => api.onNavigate((p) => (p === 'tracker' ? setPage('tracker') : undefined)), [setPage])

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <img className="brand-icon" src={divineIcon} alt="" />
          PoE4Dummies II
        </span>
        <label className="league-pick">
          <span className="label">{t('top.league')}</span>
          <LeagueSelect className="select compact" autoKey="top.leagueAuto" aria-label={t('top.league')} onPick={(league) => void updateSettings({ league })} />
        </label>
        <span className="seg-wrap">
          <span className="label">{t('top.showIn')}</span>
          <span className="seg" role="group" aria-label={t('top.showIn')}>
            {UNITS.map((u) => (
              <button
                key={u}
                type="button"
                className={settings.displayCurrency === u ? 'on' : ''}
                aria-pressed={settings.displayCurrency === u}
                onClick={() => void updateSettings({ displayCurrency: u })}
              >
                {CURRENCY_SHORT[u]}
              </button>
            ))}
          </span>
        </span>
        <span className="rates">
          {rates && (
            <>
              <b className="rate num">
                <CurrencyMark currency="divine" item={currencies.get('divine')} /> 1 = {amount(rates.exaltedPerDivine)}{' '}
                <CurrencyMark currency="exalted" item={currencies.get('exalted')} />
              </b>
              <b className="rate num">
                <CurrencyMark currency="divine" item={currencies.get('divine')} /> 1 = {amount(rates.chaosPerDivine)}{' '}
                <CurrencyMark currency="chaos" item={currencies.get('chaos')} />
              </b>
            </>
          )}
          {/* "Atualizado há X" fica no botão (passar o mouse): a faixa do topo cabe numa linha só. */}
          <button
            className="btn small"
            type="button"
            disabled={market.loading}
            onClick={() => void api.refreshMarket()}
            title={market.loading ? t('top.updating') : market.snapshot ? t('top.updatedAgo', { time: timeAgo(market.snapshot.fetchedAt, t) }) : undefined}
          >
            <span className={market.loading ? 'spin' : ''} aria-hidden="true">
              <ArrowClockwise className="ico" size={14} aria-hidden="true" />
            </span>{' '}
            {t('top.refreshShort')}
          </button>
        </span>
      </header>
      <div className="body">
        <nav className="nav">
          {PAGES.map((p) => (
            <button key={p.id} type="button" className={page === p.id ? 'on' : ''} aria-current={page === p.id ? 'page' : undefined} onClick={() => setPage(p.id)}>
              {t(p.label)}
              {p.id === 'farm' && <BetaBadge />}
            </button>
          ))}
          <span className="spacer" />
          <button type="button" className={page === 'settings' ? 'on' : ''} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => setPage('settings')}>
            {t('nav.settings')}
          </button>
        </nav>
        <main className="main">
          {market.error && (
            <div className="banner" role="alert">
              <span>{t(errorKey(market.error), { seconds: 60 })}</span>
              <button className="btn small" type="button" onClick={() => void api.refreshMarket()}>
                {t('top.retry')}
              </button>
            </div>
          )}
          {page === 'market' && <MarketPage />}
          {page === 'opportunities' && <OpportunitiesPage />}
          {page === 'watchlist' && <WatchlistPage onGoMarket={() => setPage('market')} />}
          {page === 'pricecheck' && <MarketSearchPage />}
          {page === 'collection' && <CollectionRoute />}
          {page === 'tracker' && <TrackerRoute />}
          {page === 'farm' && <FarmPage />}
          {page === 'build' && <BuildPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <ItemDrawerProvider>
        <Shell />
        <CloseDialog />
      </ItemDrawerProvider>
    </AppProvider>
  </StrictMode>,
)
