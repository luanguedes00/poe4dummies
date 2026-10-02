// Farm: estratégias da comunidade (curadas, com fonte e data), custo dos
// tablets por mapa com preços ao vivo, calculadora de lucro e mercado de tablets.

import { useEffect, useMemo, useState } from 'react'
import { priceForNeed, setupEconomics, strategyTabletCost } from '../../../core/farm/economics'
import { STRATEGIES, STRATEGIES_PATCH, STRATEGIES_UPDATED, type Strategy } from '../../../core/farm/strategies'
import type { TabletPrice } from '../../../core/sources/ninja'
import { BetaBadge, BetaNote } from '../components/Beta'
import { ItemIcon } from '../components/ItemIcon'
import { changeClass, Hint, TableSkeleton } from '../components/ui'
import { api, useApp } from '../lib/app'
import { useSticky } from '../lib/sticky'
import { MechanicsView } from './MechanicsView'
import { RegexView } from './RegexView'
import { toNumber } from './search/Suggest'
import { ArrowSquareOut } from '@phosphor-icons/react'

type Tab = 'mechanics' | 'strategies' | 'calculator' | 'tablets' | 'regex'

export function FarmPage() {
  const { t, market } = useApp()
  const [tab, setTab] = useSticky<Tab>('farm.tab', 'mechanics', { persist: true })
  const [tablets, setTablets] = useState<TabletPrice[] | null>(null)
  const [failed, setFailed] = useState(false)

  // Troca de liga: resposta da liga anterior que chegar atrasada é ignorada.
  useEffect(() => {
    let alive = true
    setFailed(false)
    api
      .farmTablets()
      .then((list) => alive && setTablets(list))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [market.league])

  return (
    <>
      <h2 className="page-title">
        {t('farm.title')} <BetaBadge />
      </h2>
      <p className="page-meta">{t('farm.meta', { patch: STRATEGIES_PATCH, date: STRATEGIES_UPDATED.split('-').reverse().join('/') })}</p>
      <BetaNote />
      <div className="chips" role="tablist">
        {(['mechanics', 'strategies', 'calculator', 'tablets', 'regex'] as Tab[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`chip ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
            {t(`farm.tab.${id}`)}
          </button>
        ))}
      </div>
      {/* Regex não depende dos preços: abre mesmo sem poe.ninja. */}
      {tab === 'regex' && <RegexView />}
      {tab !== 'regex' && failed && <div className="banner">{t('error.network')}</div>}
      {tab !== 'regex' && !tablets && !failed && <TableSkeleton label={t('market.loading')} rows={4} />}
      {tablets && tab === 'mechanics' && <MechanicsView tablets={tablets} />}
      {tablets && tab === 'strategies' && <Strategies tablets={tablets} />}
      {tablets && tab === 'calculator' && <Calculator tablets={tablets} />}
      {tablets && tab === 'tablets' && <TabletMarket tablets={tablets} />}
    </>
  )
}

function Strategies({ tablets }: { tablets: TabletPrice[] }) {
  const { t, smart: price, market } = useApp()
  const byName = useMemo(() => new Map((market.snapshot?.items ?? []).map((i) => [i.name, i])), [market.snapshot])

  return (
    <div className="farm-grid">
      {STRATEGIES.map((s) => {
        const cost = strategyTabletCost(s, tablets)
        return (
          <article key={s.id} className="card farm-card">
            <header className="farm-head">
              <span className={`tier-badge t${s.tier === 'S' ? 1 : s.tier === 'A' ? 2 : 3}`}>{s.tier}</span>
              <h3>{s.name}</h3>
              <span className={`sig ${s.investment === 'low' ? 'rising' : s.investment === 'medium' ? 'fading' : 'falling'}`}>{t(`farm.investment.${s.investment}`)}</span>
            </header>
            <p className="muted farm-mech">
              {s.mechanic} · {s.waystone}
            </p>

            <div className="farm-block">
              <span className="label">{t('farm.tablets')}</span>
              {s.tablets.map((need) => {
                const p = priceForNeed(need, tablets)
                return (
                  <div key={`${need.baseType}-${need.unique ?? need.variant}`} className="farm-row">
                    {/* Tablet único fora da lista do poe.ninja: usa o ícone do tablet base. */}
                    <ItemIcon
                      url={p?.iconUrl ?? tablets.find((x) => !x.unique && x.baseType === need.baseType && x.iconUrl)?.iconUrl ?? null}
                      name={need.unique ?? need.baseType}
                    />
                    <span className="farm-name">
                      {need.count}× {need.unique ?? `${need.baseType} (${need.variant})`}
                      {need.targetMods.length > 0 && <small className="muted">{need.targetMods.join(' · ')}</small>}
                    </span>
                    <span className="num">{p ? price(p.valueDivine) : '–'}</span>
                  </div>
                )
              })}
              <div className="farm-total">
                <span>
                  {t('farm.costPerMap')} <Hint text={t('farm.costHint')} />
                </span>
                <b className="num">{price(cost.tabletsPerMap)}</b>
              </div>
            </div>

            <div className="farm-block">
              <span className="label">{t('farm.loot')}</span>
              <div className="chips">
                {s.loot.map((name) => {
                  // Loot pode ser currency (poe.ninja exchange) ou tablet (preço do Normal, base limpa).
                  const value = byName.get(name)?.valueDivine ?? tablets.find((p) => !p.unique && p.name === name && p.variant === 'Normal')?.valueDivine
                  return (
                    <span key={name} className="chip static">
                      {name}
                      {value !== undefined && <span className="chip-n">{price(value)}</span>}
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="farm-block">
              <span className="label">{t('farm.atlas')}</span>
              <span className="muted farm-atlas">{s.atlas.join(' · ')}</span>
            </div>

            <footer className="farm-foot">
              {s.sources.map((src, i) => (
                <button key={src.url} type="button" className="btn ghost small" onClick={() => void api.openExternal({ kind: 'guide', strategyId: s.id, index: i })}>
                  {src.label} <ArrowSquareOut className="ico" size={14} aria-hidden="true" />
                </button>
              ))}
              {s.weakSource && <small className="muted">{t('farm.weakSource')}</small>}
            </footer>
          </article>
        )
      })}
    </div>
  )
}

function Calculator({ tablets }: { tablets: TabletPrice[] }) {
  const { t, smart: price, unit, unitLabel, market } = useApp()
  const rates = market.snapshot?.rates
  const [strategyId, setStrategyId] = useSticky<string>('farm.calc.strategy', STRATEGIES[0]!.id, { persist: true, valid: (v) => STRATEGIES.some((s) => s.id === v) })
  const [waystone, setWaystone] = useSticky('farm.calc.waystone', '', { persist: true })
  const [extras, setExtras] = useSticky('farm.calc.extras', '', { persist: true })
  const [ret, setRet] = useSticky('farm.calc.return', '', { persist: true })
  const [perHour, setPerHour] = useSticky('farm.calc.perHour', '', { persist: true })
  const strategy = STRATEGIES.find((s) => s.id === strategyId) as Strategy

  // "Usar minha sessão": retorno por mapa (loot da Lista ÷ mapas) e mapas/h (tracker).
  const [sessionNote, setSessionNote] = useState<string | null>(null)
  const fillFromSession = async () => {
    const [tracker, collection] = await Promise.all([api.getTracker(), api.getCollection()])
    const s = tracker.snapshot.session
    if (!s || s.maps === 0 || !rates) {
      setSessionNote(t('farm.calc.noSession'))
      return
    }
    const perMapDivine = collection.total.divine / s.maps
    const inUnit = unit === 'divine' ? perMapDivine : perMapDivine * (unit === 'exalted' ? rates.exaltedPerDivine : rates.chaosPerDivine)
    setRet(inUnit.toFixed(unit === 'divine' ? 3 : 1))
    if (s.mapsPerHour !== null) setPerHour(s.mapsPerHour.toFixed(1))
    setSessionNote(t('farm.calc.sessionUsed', { n: s.maps }))
  }

  // Entradas na moeda de exibição → Divine para a conta.
  const toDivine = (text: string): number | null => {
    const v = toNumber(text)
    if (v === null || !rates) return null
    return unit === 'divine' ? v : unit === 'exalted' ? v / rates.exaltedPerDivine : v / rates.chaosPerDivine
  }

  const econ = setupEconomics({
    tablets: strategy.tablets.map((need) => ({ priceDivine: priceForNeed(need, tablets)?.valueDivine ?? null, uses: need.uses, count: need.count })),
    waystoneDivine: toDivine(waystone) ?? 0,
    extrasDivine: toDivine(extras) ?? 0,
    returnDivine: toDivine(ret),
    mapsPerHour: toNumber(perHour),
  })

  const field = (id: string, label: string, value: string, set: (v: string) => void, suffix: string, hint?: string) => (
    <label className="field" htmlFor={id}>
      <span>
        {label} {hint && <Hint text={hint} />}
      </span>
      <span className="input-suffix">
        <input id={id} className="input num" inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} placeholder="0" />
        <span className="muted">{suffix}</span>
      </span>
    </label>
  )

  return (
    <div className="pc-page">
      <div className="card form-card">
        <label className="field" htmlFor="calc-strategy">
          <span>{t('farm.calc.strategy')}</span>
          <select id="calc-strategy" className="select" value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.tier} · {s.name}
              </option>
            ))}
          </select>
        </label>
        {field('calc-waystone', t('farm.calc.waystone'), waystone, setWaystone, unitLabel)}
        {field('calc-extras', t('farm.calc.extras'), extras, setExtras, unitLabel, t('farm.calc.extrasHint'))}
        {field('calc-return', t('farm.calc.return'), ret, setRet, unitLabel, t('farm.calc.returnHint'))}
        {field('calc-perhour', t('farm.calc.perHour'), perHour, setPerHour, t('farm.calc.mapsUnit'), t('farm.calc.perHourHint'))}
        <div className="actions">
          <button className="btn" type="button" onClick={() => void fillFromSession()}>
            {t('farm.calc.useSession')}
          </button>
          {sessionNote && <small className="muted">{sessionNote}</small>}
        </div>
      </div>
      <div className="card verdict">
        <span className="label">{t('farm.calc.result')}</span>
        <dl className="stats">
          <div>
            <dt>{t('farm.calc.tablets')}</dt>
            <dd>{price(econ.tabletsPerMap)}</dd>
          </div>
          <div>
            <dt>{t('farm.calc.cost')}</dt>
            <dd>{price(econ.costPerMap)}</dd>
          </div>
          <div>
            <dt>{t('farm.calc.profitMap')}</dt>
            <dd className={changeClass(econ.profitPerMap)}>{econ.profitPerMap === null ? '–' : price(econ.profitPerMap)}</dd>
          </div>
          <div>
            <dt>{t('farm.calc.profitHour')}</dt>
            <dd className={changeClass(econ.profitPerHour)}>{econ.profitPerHour === null ? '–' : price(econ.profitPerHour)}</dd>
          </div>
        </dl>
        {econ.missingPrices > 0 && <p className="fine">{t('farm.calc.missing', { n: econ.missingPrices })}</p>}
        <p className="fine">{t('farm.calc.disclaimer')}</p>
      </div>
    </div>
  )
}

function TabletMarket({ tablets }: { tablets: TabletPrice[] }) {
  const { t, smart: price, percent } = useApp()
  // Raridade em português; Normal = tablet sem nenhum mod.
  const variantLabel = (v: string | null) => (v === 'Rare' ? t('farm.rarity.rare') : v === 'Magic' ? t('farm.rarity.magic') : v === 'Normal' ? t('farm.rarity.normal') : (v ?? ''))
  const sorted = useMemo(() => [...tablets].sort((a, b) => b.valueDivine - a.valueDivine), [tablets])
  return (
    <>
      <p className="fine">{t('farm.tabletsNote')}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('market.col.item')}</th>
              <th>{t('farm.col.variant')}</th>
              <th className="r">
                {t('market.col.price', { unit: '' }).replace(/\(\s*\)/, '')} <Hint text={t('farm.tabletPriceHint')} align="right" />
              </th>
              <th className="r">{t('market.col.change')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={`${p.name}-${p.variant ?? 'u'}`}>
                <td>
                  <span className="item-cell">
                    <ItemIcon url={p.iconUrl} name={p.name} />
                    <span className={p.unique ? 'unique-text' : ''}>{p.name}</span>
                  </span>
                </td>
                <td className="muted">{p.unique ? t('farm.unique') : variantLabel(p.variant)}</td>
                <td className="r num">{price(p.valueDivine)}</td>
                <td className={`r num ${changeClass(p.change7d)}`}>{percent(p.change7d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
