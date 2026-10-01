// Farm por mecânica, pensado para quem nunca farmou: o que a mecânica dá, o
// que é obrigatório, e UM mapa montado (completo ou barato, 3 ou 4 tablets)
// com o preço de cada tablet e o custo por mapa. Clicar no tablet abre a loja
// já filtrada (link direto, sem gastar a cota da trade).

import { useEffect, useState } from 'react'
import { MECHANICS, type MechanicGuide, type MechanicId, type TabletRecipe } from '../../../core/farm/mechanics'
import { recipeReferencePrice, setupCostWith } from '../../../core/farm/recipes'
import type { TabletPrice } from '../../../core/sources/ninja'
import type { RecipePrice } from '../../../shared/ipc'
import type { TopTablets } from '../../../core/farm/market'
import { Hint } from '../components/ui'
import { api, errorKey, useApp } from '../lib/app'
import { useSticky } from '../lib/sticky'

type Kind = 'full' | 'budget'

export function MechanicsView({ tablets }: { tablets: TabletPrice[] }) {
  const { t, smart, market } = useApp()
  const [id, setId] = useSticky<MechanicId>('farm.mechanic', 'ritual', { persist: true, valid: (v) => MECHANICS.some((m) => m.id === v) })
  const [kind, setKind] = useSticky<Kind>('farm.setupKind', 'budget', { persist: true, valid: (v) => v === 'full' || v === 'budget' })
  const [slots, setSlots] = useSticky<3 | 4>('farm.setupSlots', 3, { persist: true, valid: (v) => v === 3 || v === 4 })
  const guide = MECHANICS.find((m) => m.id === id) as MechanicGuide
  // Preços reais por liga: trocar de liga não mostra a média da liga anterior.
  const league = market.league ?? ''
  const [realByLeague, setRealByLeague] = useSticky<Record<string, Record<string, RecipePrice | null>>>('farm.realPricesByLeague', {})
  const real = realByLeague[league] ?? {}

  // Média real da loja de cada tablet (tarefa de fundo, guardada por 3 h; nunca atrasa um price check).
  useEffect(() => {
    if (!league) return
    let alive = true
    const store = (key: string, price: RecipePrice | null) =>
      setRealByLeague((all) => ({ ...all, [league]: { ...all[league], [key]: price } }))
    void (async () => {
      for (const recipe of guide.recipes) {
        if (!alive) return
        const key = `${guide.id}:${recipe.id}`
        try {
          const price = await api.farmRecipePrice({ mechanicId: guide.id, recipeId: recipe.id })
          if (alive) store(key, price)
        } catch {
          if (alive) store(key, null)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [guide, league, setRealByLeague])

  const setup = guide.setups.find((s) => s.kind === kind && s.slots === slots) ?? guide.setups[0]!
  // Preço de montar cada opção, para mostrar no próprio botão.
  const totalOf = (k: Kind) => {
    const s = guide.setups.find((x) => x.kind === k && x.slots === slots)
    if (!s) return null
    // Só com o preço real da loja: a média genérica do poe.ninja não reflete combos caros (Completo sairia "mais barato").
    const prices = s.items.map((it) => {
      const recipe = guide.recipes.find((r) => r.id === it.recipeId)!
      const p = priceOf(recipe, tablets, real[`${guide.id}:${recipe.id}`])
      return recipe.rarity === 'unique' || p.source === 'store' ? p.divine : null
    })
    if (prices.some((p) => p === null)) return null
    return setupCostWith(guide, s, (recipe) => priceOf(recipe, tablets, real[`${guide.id}:${recipe.id}`]).divine).total
  }

  return (
    <>
      <div className="chips" role="tablist" aria-label={t('farm.mechanic')}>
        {MECHANICS.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={m.id === id} className={`chip ${m.id === id ? 'on' : ''}`} onClick={() => setId(m.id)}>
            {m.name}
          </button>
        ))}
      </div>
      <Guide guide={guide} tablets={tablets} />

      <section className="card setup-card">
        <header className="setup-head">
          <h3>{t('farm.yourMap')}</h3>
          <div className="seg-group">
            <div className="seg" role="group" aria-label={t('farm.pick.budgetLabel')}>
              {(['budget', 'full'] as const).map((k) => (
                <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {t(`farm.pick.${k}`)}
                  {(totalOf(k) ?? 0) > 0 && <span className="seg-price"> · {smart(totalOf(k)!)}</span>}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label={t('farm.pick.slotsLabel')}>
              {([3, 4] as const).map((n) => (
                <button key={n} type="button" className={slots === n ? 'on' : ''} aria-pressed={slots === n} onClick={() => setSlots(n)}>
                  {t('farm.pick.slots', { n })}
                </button>
              ))}
            </div>
            {slots === 4 && <Hint text={t('farm.slot4Hint')} align="right" />}
          </div>
        </header>
        <p className="muted setup-tip">{t('farm.clickHint')}</p>
        {setup.items.map((item) => {
          const recipe = guide.recipes.find((r) => r.id === item.recipeId)!
          return <RecipeRow key={item.recipeId} guide={guide} recipe={recipe} count={item.count} tablets={tablets} real={real[`${guide.id}:${recipe.id}`]} />
        })}
        <SetupTotals guide={guide} setup={setup} tablets={tablets} real={real} />
      </section>
      <MarketTop mechanicId={guide.id} />
      <p className="fine">{t('farm.refPriceNote')}</p>
    </>
  )
}

/** Mods que se repetem nos tablets mais caros à venda agora (descoberta pelo mercado, não pela lista). */
function MarketTop({ mechanicId }: { mechanicId: MechanicId }) {
  const { t, smart } = useApp()
  const [top, setTop] = useState<TopTablets | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    setTop(undefined)
    api.farmTopTablets(mechanicId).then((r) => alive && setTop(r)).catch(() => alive && setTop(null))
    return () => {
      alive = false
    }
  }, [mechanicId])
  if (top === null || (top && top.sample === 0)) return null
  return (
    <section className="card market-top">
      <h3>
        {t('farm.top.title')} <Hint text={t('farm.top.hint')} />
      </h3>
      {top === undefined ? (
        <p className="muted">{t('farm.top.loading')}</p>
      ) : (
        <>
          <p className="muted">
            {t('farm.top.range', { n: top.sample, type: top.baseType, low: top.lowDivine === null ? '–' : smart(top.lowDivine), high: top.highDivine === null ? '–' : smart(top.highDivine) })}
          </p>
          <ul className="market-top-mods">
            {top.mods.map((m) => (
              <li key={m.text}>
                <span className="num">{t('farm.top.count', { n: m.count, total: top.sample })}</span> {m.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function Guide({ guide, tablets }: { guide: MechanicGuide; tablets: TabletPrice[] }) {
  const { t, smart } = useApp()
  const uniquePrice = guide.unique ? tablets.find((p) => p.unique && p.name === guide.unique!.name)?.valueDivine : undefined
  return (
    <div className="card guide">
      <div>
        <h3>{guide.name}</h3>
        <p className="muted guide-summary">{guide.summary}</p>
      </div>
      <div className="must">
        <span className="label">{t('farm.must')}</span>
        <ul>
          {guide.requirements.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <div className="guide-cols">
        <div>
          <span className="label">{t('farm.priorities')}</span>
          <ol className="guide-list">
            {guide.priorities.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </div>
        <div>
          {guide.unique && (
            <>
              <span className="label">{t('farm.uniqueRec')}</span>
              <p className="guide-unique">
                <b className="unique-text">{guide.unique.name}</b>
                {uniquePrice !== undefined && <span className="num"> · {smart(uniquePrice)}</span>}
                <br />
                <span className="muted">{guide.unique.why}</span>
              </p>
            </>
          )}
          <span className="label">{t('farm.tips')}</span>
          <ul className="guide-list">
            {guide.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

/** Preço de um tablet: média real da loja quando já chegou; senão a estimativa do poe.ninja. */
function priceOf(recipe: TabletRecipe, tablets: TabletPrice[], real: RecipePrice | null | undefined): { divine: number | null; source: 'store' | 'estimate' | 'none' | 'loading' } {
  if (real?.medianDivine != null) return { divine: real.medianDivine, source: 'store' }
  const ref = recipeReferencePrice(recipe, tablets)
  if (real && real.total === 0) return { divine: ref, source: ref === null ? 'none' : 'estimate' }
  if (ref !== null) return { divine: ref, source: 'estimate' }
  return { divine: null, source: real === undefined ? 'loading' : 'none' }
}

function SetupTotals({ guide, setup, tablets, real }: { guide: MechanicGuide; setup: MechanicGuide['setups'][number]; tablets: TabletPrice[]; real: Record<string, RecipePrice | null> }) {
  const { t, smart } = useApp()
  const cost = setupCostWith(guide, setup, (recipe) => priceOf(recipe, tablets, real[`${guide.id}:${recipe.id}`]).divine)
  return (
    <div className="setup-totals">
      <div>
        <span className="label">
          {t('farm.costPerMap')} <Hint text={t('farm.costHint')} />
        </span>
        <b className="num">{smart(cost.perMap)}</b>
      </div>
      <div>
        <span className="label">{t('farm.setupTotal')}</span>
        <b className="num">{smart(cost.total)}</b>
      </div>
      {cost.missing > 0 && <p className="fine">{t('farm.calc.missing', { n: cost.missing })}</p>}
    </div>
  )
}

function RecipeRow({ guide, recipe, count, tablets, real }: { guide: MechanicGuide; recipe: TabletRecipe; count: number; tablets: TabletPrice[]; real: RecipePrice | null | undefined }) {
  const { t, smart } = useApp()
  const [error, setError] = useState<string | null>(null)
  const price = priceOf(recipe, tablets, real)

  // Link direto para a loja com o filtro do tablet (abre na hora; o site faz a busca).
  const open = async () => {
    setError(null)
    const r = await api.farmOpenRecipe({ mechanicId: guide.id, recipeId: recipe.id })
    if (!r.ok) setError(t(errorKey(r.code), { seconds: 60 }))
  }

  const priceTitle = price.source === 'store' && real ? t('farm.realPriceHint', { n: real.sample, total: real.total }) : t('farm.refPriceHint')
  return (
    <div className="recipe">
      <div className="recipe-top">
        <span className="recipe-count num">{count}×</span>
        <button type="button" className="link-btn recipe-name" onClick={() => void open()} title={t('farm.openTrade')}>
          {recipe.label} <span aria-hidden="true">↗</span>
        </button>
        <span className={`rarity-tag ${recipe.rarity}`}>{t(`farm.rarity.${recipe.rarity}`)}</span>
        <button type="button" className="link-btn recipe-price" onClick={() => void open()} title={priceTitle}>
          {price.divine === null ? (price.source === 'loading' ? '…' : t('farm.noListings')) : <b className="num">{smart(price.divine)}</b>}
          {price.divine !== null && <small className="muted"> {t(price.source === 'store' ? 'farm.price.store' : 'farm.price.estimate')}</small>}
        </button>
      </div>
      {recipe.mods.length > 0 && <div className="recipe-mods muted">{recipe.mods.map((m) => m.label).join(' · ')}</div>}
      {error && <small className="down">{error}</small>}
    </div>
  )
}
