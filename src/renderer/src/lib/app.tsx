// Estado compartilhado das janelas: configurações, mercado e tradução.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatAmount, formatPercent, fromDivine, otherUnits, smartPrice, CURRENCY_SHORT } from '../../../core/money'
import { buildForOverlay, type Build, type BuildPair } from '../../../core/build/model'
import type { Settings } from '../../../core/settings'
import type { DisplayCurrency } from '../../../core/types'
import { localeOf, translator, type MessageKey, type Translate } from '../../../shared/i18n'
import type { MarketState } from '../../../shared/ipc'

export const api = window.oraculo

interface AppContextValue {
  settings: Settings
  market: MarketState
  /** Builds importadas do PoB2: a do guia e a do jogador. */
  builds: BuildPair
  /** Build usada no "é upgrade?": a do jogador; sem ela, a do guia. */
  build: Build | null
  t: Translate
  locale: string
  unit: DisplayCurrency
  unitLabel: string
  /** Valor em Divine → texto na moeda de exibição. */
  price: (valueDivine: number, unit?: DisplayCurrency) => string
  /** Valor na moeda mais legível para ele (sobreposição): "3 Div", "45 Ex". */
  smart: (valueDivine: number, exclude?: DisplayCurrency) => string
  /** Valor nas outras moedas (currency não aparece na própria). */
  others: (valueDivine: number, self: DisplayCurrency | null) => string[]
  amount: (value: number) => string
  percent: (value: number | null) => string
  updateSettings: (patch: Parameters<typeof api.updateSettings>[0]) => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

const EMPTY_MARKET: MarketState = { league: null, snapshot: null, loading: true, error: null }

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [market, setMarket] = useState<MarketState>(EMPTY_MARKET)
  const [builds, setBuilds] = useState<BuildPair>({ guide: null, mine: null })

  useEffect(() => {
    let alive = true
    void api.getSettings().then((s) => alive && setSettings(s))
    void api.getMarket().then((m) => alive && setMarket(m))
    void api.getBuilds().then((b) => alive && setBuilds(b))
    const offSettings = api.onSettings(setSettings)
    const offMarket = api.onMarket(setMarket)
    const offBuild = api.onBuilds(setBuilds)
    return () => {
      alive = false
      offSettings()
      offMarket()
      offBuild()
    }
  }, [])

  const value = useMemo<AppContextValue | null>(() => {
    if (!settings) return null
    const t = translator(settings.language)
    const locale = localeOf(settings.language)
    const unit = settings.displayCurrency
    const rates = market.snapshot?.rates
    return {
      settings,
      market,
      builds,
      build: buildForOverlay(builds),
      t,
      locale,
      unit,
      unitLabel: CURRENCY_SHORT[unit],
      price: (valueDivine, target = unit) =>
        rates ? `${formatAmount(fromDivine(valueDivine, target, rates), locale)} ${CURRENCY_SHORT[target]}` : '–',
      smart: (valueDivine, exclude) => (rates ? smartPrice(valueDivine, rates, locale, exclude) : '–'),
      others: (valueDivine, self) => (rates ? otherUnits(valueDivine, rates, self, locale) : []),
      amount: (v) => formatAmount(v, locale),
      percent: (v) => formatPercent(v, locale),
      updateSettings: async (patch) => {
        setSettings(await api.updateSettings(patch))
      },
    }
  }, [settings, market, builds])

  useEffect(() => {
    if (settings) document.documentElement.lang = settings.language
  }, [settings])

  if (!value) return null
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp fora do AppProvider')
  return ctx
}

export function errorKey(code: string): MessageKey {
  const known: readonly string[] = [
    'not-an-item', 'missing-name', 'unknown-base-type', 'network', 'timeout', 'rate-limited', 'http', 'invalid-response',
  ]
  return (known.includes(code) ? `error.${code}` : 'error.unexpected') as MessageKey
}

export function timeAgo(iso: string, t: Translate, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return t('time.now')
  if (minutes < 60) return t('time.minutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('time.hours', { n: hours })
  return t('time.days', { n: Math.floor(hours / 24) })
}
