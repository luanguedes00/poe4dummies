// Página "Minha build", no estilo do poe.ninja: cabeçalho, defesa | inventário | ataque,
// skills, joias e notas do guia.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Build, BuildGem, BuildItem, BuildKind, BuildSite, BuildSkillGroup, GemDetail } from '../../../core/build/model'
import { buildPlan, nextStep, stepImpact, type PlanStep } from '../../../core/build/plan'
import { BetaBadge, BetaNote } from '../components/Beta'
import type { TierReport } from '../../../core/build/tierReport'
import type { MessageKey } from '../../../shared/i18n'
import type { BuildItemInfo } from '../../../shared/ipc'
import { iconSrc } from '../components/ItemIcon'
import { api, errorKey, timeAgo, useApp } from '../lib/app'
import { useSticky } from '../lib/sticky'
import { ArrowSquareOut } from '@phosphor-icons/react'

// Respostas já buscadas nesta sessão: voltar para a página não pede nada de novo.
const itemInfoMemo = new Map<string, BuildItemInfo | null>()
const gemIconMemo = new Map<string, string | null>()
const itemKey = (build: Build, kind: BuildKind, slot: string) => `${kind}|${build.importedAt}|${slot}`

const SITE_NAMES: Record<BuildSite, string> = { pobbin: 'pobb.in', poeninja: 'poe.ninja', 'poeninja-character': 'poe.ninja', maxroll: 'maxroll', poe2db: 'poe2db' }

// ---------------------------------------------------------------- importar

function ImportForm({ kind, onDone, onCancel }: { kind: BuildKind; onDone: () => void; onCancel?: () => void }) {
  const { t } = useApp()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)

  const submit = async () => {
    if (!input.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.importBuild(input.trim(), kind)
      if (result.ok) {
        setInput('')
        onDone()
      } else setError(`build.error.${result.code}`)
    } catch {
      setError('build.error.invalid-code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="card build-import"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <label className="label" htmlFor={`build-code-${kind}`}>
        {t('build.input')}
      </label>
      <p className="fine" style={{ margin: '4px 0 8px' }}>
        {t(`build.import.${kind}`)}
      </p>
      <textarea id={`build-code-${kind}`} spellCheck={false} placeholder={t('build.placeholder')} value={input} onChange={(e) => setInput(e.target.value)} />
      {error && (
        <div className="banner" role="alert">
          {t(error)}
        </div>
      )}
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>
          {busy ? t('build.importing') : t('build.import')}
        </button>
        {onCancel && (
          <button className="btn ghost" type="button" onClick={onCancel}>
            {t('build.cancel')}
          </button>
        )}
      </div>
      <details className="more" style={{ marginTop: 8 }}>
        <summary>{t('build.howTo')}</summary>
        <p className="fine">{t('build.howTo.pob')}</p>
        <p className="fine">{t('build.howTo.sites')}</p>
      </details>
    </form>
  )
}

/** Busca na trade um item parecido com o do slot e abre o site com o mesmo filtro. */
function TradeButton({ kind, slot }: { kind: BuildKind; slot: string }) {
  const { t } = useApp()
  const [state, setState] = useState<{ kind: 'idle' | 'busy' } | { kind: 'done'; total: number } | { kind: 'error'; code: string }>({ kind: 'idle' })
  const busy = state.kind === 'busy'
  return (
    <div className="build-trade">
      <button
        className="btn small"
        type="button"
        title={t('build.trade.hint')}
        disabled={busy}
        onClick={() => {
          setState({ kind: 'busy' })
          api
            .openBuildItemTrade(kind, slot)
            .then((r) => setState(r.ok ? { kind: 'idle' } : { kind: 'error', code: r.code }))
            .catch(() => setState({ kind: 'error', code: 'unexpected' }))
        }}
      >
        {busy ? t('build.trade.busy') : <>{t('build.trade')} <ArrowSquareOut className="ico" size={14} aria-hidden="true" /></>}
      </button>
      {state.kind === 'error' && <small className="down">{t(errorKey(state.code), { seconds: 60 })}</small>}
    </div>
  )
}

// ---------------------------------------------------------------- stats

/** Formatos do PoB: "mult" = fração em % (crit 2.5 → 250%); "mod" = multiplicador (1.3 → +30%). */
type Fmt = 'int' | 'big' | 'pct' | 'pct2' | 'dec1' | 'dec2' | 'mult' | 'mod'
interface StatRow {
  stat: string
  label: MessageKey
  fmt: Fmt
  tone?: string
  hideZero?: boolean
  /** Stat secundário mostrado ao lado, ex.: redução de dano física junto da armadura. */
  sub?: { stat: string; fmt: Fmt }
}

/** Recursos no topo da coluna das skills, como no painel do personagem. */
const RESOURCES: StatRow[] = [
  { stat: 'Life', label: 'stat.life', fmt: 'int', tone: 'life' },
  { stat: 'EnergyShield', label: 'stat.energyShield', fmt: 'int', tone: 'es', hideZero: true },
  { stat: 'Mana', label: 'stat.mana', fmt: 'int', tone: 'mana' },
  { stat: 'Spirit', label: 'stat.spirit', fmt: 'int', tone: 'spirit', hideZero: true, sub: { stat: 'SpiritUnreserved', fmt: 'int' } },
]
const DEFENCE: StatRow[] = [
  { stat: 'TotalEHP', label: 'build.stat.ehp', fmt: 'big' },
  { stat: 'Armour', label: 'stat.armour', fmt: 'int', hideZero: true, sub: { stat: 'PhysicalDamageReduction', fmt: 'pct' } },
  { stat: 'Evasion', label: 'stat.evasion', fmt: 'int', tone: 'evasion', hideZero: true, sub: { stat: 'EvadeChance', fmt: 'pct' } },
  { stat: 'EffectiveBlockChance', label: 'build.stat.block', fmt: 'pct', hideZero: true },
  { stat: 'DeflectChance', label: 'build.stat.deflect', fmt: 'pct', hideZero: true },
  { stat: 'LifeRegenRecovery', label: 'build.stat.lifeRegen', fmt: 'dec1', tone: 'life', hideZero: true },
  { stat: 'EffectiveMovementSpeedMod', label: 'stat.moveSpeed', fmt: 'mod' },
]
const RESISTANCES: StatRow[] = [
  { stat: 'FireResist', label: 'stat.fireRes', fmt: 'pct', tone: 'fire' },
  { stat: 'ColdResist', label: 'stat.coldRes', fmt: 'pct', tone: 'cold' },
  { stat: 'LightningResist', label: 'stat.lightningRes', fmt: 'pct', tone: 'lightning' },
  { stat: 'ChaosResist', label: 'stat.chaosRes', fmt: 'pct', tone: 'chaos' },
]
const MAX_HIT: StatRow[] = [
  { stat: 'PhysicalMaximumHitTaken', label: 'dmg.physical', fmt: 'big' },
  { stat: 'FireMaximumHitTaken', label: 'dmg.fire', fmt: 'big', tone: 'fire' },
  { stat: 'ColdMaximumHitTaken', label: 'dmg.cold', fmt: 'big', tone: 'cold' },
  { stat: 'LightningMaximumHitTaken', label: 'dmg.lightning', fmt: 'big', tone: 'lightning' },
  { stat: 'ChaosMaximumHitTaken', label: 'dmg.chaos', fmt: 'big', tone: 'chaos' },
]
const OFFENCE: StatRow[] = [
  { stat: 'CombinedDPS', label: 'build.dps', fmt: 'big', tone: 'gold', hideZero: true },
  { stat: 'TotalDPS', label: 'build.stat.hitDps', fmt: 'big', hideZero: true },
  { stat: 'TotalDot', label: 'build.stat.dotDps', fmt: 'big', hideZero: true },
  { stat: 'AverageHit', label: 'build.stat.avgHit', fmt: 'big', hideZero: true },
  { stat: 'Speed', label: 'build.stat.speed', fmt: 'dec2', hideZero: true },
  { stat: 'CritChance', label: 'build.stat.critChance', fmt: 'pct2', hideZero: true },
  { stat: 'CritMultiplier', label: 'build.stat.critMulti', fmt: 'mult', hideZero: true },
  { stat: 'HitChance', label: 'build.stat.hitChance', fmt: 'pct', hideZero: true },
  { stat: 'ManaCost', label: 'build.stat.manaCost', fmt: 'int', tone: 'mana', hideZero: true },
]
/** Dentro do card da skill principal o rótulo "DPS total" basta. */
const SKILL_OFFENCE: StatRow[] = OFFENCE.map((r) => (r.stat === 'CombinedDPS' ? { ...r, label: 'build.stat.totalDps' } : r))
const ATTRIBUTES = [
  { stat: 'Str', req: 'ReqStr', label: 'stat.str', tone: 'str' },
  { stat: 'Dex', req: 'ReqDex', label: 'stat.dex', tone: 'dex' },
  { stat: 'Int', req: 'ReqInt', label: 'stat.int', tone: 'int' },
] as const

function useFormat() {
  const { amount, locale } = useApp()
  const fixed = (v: number, d: number) => v.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d })
  return (v: number, fmt: Fmt): string => {
    switch (fmt) {
      case 'int':
        return amount(Math.round(v))
      case 'big':
        // Número inteiro, sem "mil"/"mi": 1.843.000 de DPS impressiona mais que "1,84 mi".
        return Math.round(v).toLocaleString(locale)
      case 'pct':
        return `${Math.round(v)}%`
      case 'pct2':
        return `${fixed(v, 2)}%`
      case 'dec1':
        return fixed(v, 1)
      case 'dec2':
        return fixed(v, 2)
      case 'mult':
        return `${Math.round(v * 100)}%`
      case 'mod': {
        const pct = (v - 1) * 100
        return `${pct >= 0 ? '+' : ''}${fixed(pct, 1)}%`
      }
    }
  }
}

function StatList({ build, rows, overcap = false }: { build: Build; rows: StatRow[]; overcap?: boolean }) {
  const { t } = useApp()
  const format = useFormat()
  const shown = rows.filter((r) => build.stats[r.stat] !== undefined && !(r.hideZero && build.stats[r.stat] === 0))
  if (shown.length === 0) return null
  return (
    <dl className="stat-list">
      {shown.map((r) => {
        const value = build.stats[r.stat]!
        const sub = r.sub ? build.stats[r.sub.stat] : undefined
        const over = overcap ? (build.stats[`${r.stat}OverCap`] ?? 0) : 0
        return (
          <div key={r.stat}>
            <dt>{t(r.label)}</dt>
            <dd className={r.tone ? `tone-${r.tone}` : undefined}>
              {format(value, r.fmt)}
              {sub !== undefined && r.sub && <small> · {format(sub, r.sub.fmt)}</small>}
              {over > 0 && <small> (+{Math.round(over)})</small>}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function Attributes({ build }: { build: Build }) {
  const { t, amount } = useApp()
  const rows = ATTRIBUTES.filter((a) => build.stats[a.stat] !== undefined)
  if (rows.length === 0) return null
  return (
    <dl className="stat-list">
      {rows.map((a) => {
        const have = build.stats[a.stat]!
        const need = build.stats[a.req]
        const short = need !== undefined && need > have
        return (
          <div key={a.stat}>
            <dt>{t(a.label)}</dt>
            <dd className={short ? 'down' : `tone-${a.tone}`} title={need !== undefined ? t('build.stat.required', { n: amount(Math.round(need)) }) : undefined}>
              {amount(Math.round(have))}
              {need !== undefined && need > 0 && <small> / {amount(Math.round(need))}</small>}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

// ---------------------------------------------------------------- inventário

// Posição de cada slot no inventário do PoE2 (armas vêm do set escolhido em I/II).
const DOLL_AREA: Record<string, string> = {
  Helmet: 'helm',
  'Body Armour': 'body',
  Gloves: 'glv',
  Boots: 'bts',
  Amulet: 'amu',
  'Ring 1': 'r1',
  'Ring 2': 'r2',
  'Ring 3': 'r3',
  Belt: 'belt',
}
const BELT_ROW = ['Flask 1', 'Charm 1', 'Charm 2', 'Charm 3', 'Flask 2']
/** Largura do card flutuante (igual ao CSS de .item-pop). */
const POP_WIDTH = 340

interface Popup {
  slot: string
  at: { left: number; top: number }
}

/** Posição (na janela) do card: à direita do elemento; se não couber, à esquerda. */
function placeBeside(el: HTMLElement): Popup['at'] {
  const box = el.getBoundingClientRect()
  const right = box.right + 10
  const left = right + POP_WIDTH <= window.innerWidth - 8 ? right : box.left - POP_WIDTH - 10
  return { left: Math.max(8, left), top: box.top }
}

function rarityClass(rarity: string): string {
  return rarity === 'Unique' ? 'unique' : rarity === 'Rare' ? 'rare' : rarity === 'Magic' ? 'magic' : 'normal'
}

/** Ícone do item; enquanto o link ainda está sendo buscado mostra um brilho, não o nome. */
function DollIcon({ url, label, pending = false }: { url: string | null | undefined; label: string; pending?: boolean }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [url])
  if (url && !failed) {
    return (
      <>
        {!loaded && <span className="icon-loading" aria-hidden="true" />}
        <img src={iconSrc(url)} alt="" referrerPolicy="no-referrer" className={loaded ? '' : 'loading'} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      </>
    )
  }
  if (pending) return <span className="icon-loading" aria-hidden="true" />
  return <span className="doll-text">{label}</span>
}

/** Ícones que já vieram com a build (poe.ninja): aparecem na hora, sem esperar a trade. */
function initialInfo(build: Build, kind: BuildKind): Record<string, BuildItemInfo> {
  const out: Record<string, BuildItemInfo> = {}
  for (const [slot, iconUrl] of Object.entries(build.extras?.itemIcons ?? {})) out[slot] = { iconUrl, priceDivine: null, twoHanded: false }
  for (const item of build.items) {
    const known = itemInfoMemo.get(itemKey(build, kind, item.slot))
    if (known) out[item.slot] = { ...known, iconUrl: known.iconUrl ?? out[item.slot]?.iconUrl ?? null }
  }
  return out
}

function initialDone(build: Build, kind: BuildKind): Set<string> {
  return new Set(build.items.filter((i) => itemInfoMemo.has(itemKey(build, kind, i.slot))).map((i) => i.slot))
}

/** Card flutuante ao lado da peça; se passar da borda de baixo da janela, sobe. */
function PopCard({ popup, pinned, children }: { popup: Popup; pinned: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(popup.at.top)
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0
    setTop(Math.max(8, Math.min(popup.at.top, window.innerHeight - height - 8)))
  }, [popup])
  return (
    <div ref={ref} className={`item-pop ${pinned ? 'pinned' : ''}`} style={{ left: popup.at.left, top }}>
      {children}
    </div>
  )
}

/** Inventário com ícones; o card do item aparece ao passar o mouse e fica fixo com clique. */
function Equipment({ build, kind }: { build: Build; kind: BuildKind }) {
  const { t } = useApp()
  const [info, setInfo] = useState<Record<string, BuildItemInfo>>(() => initialInfo(build, kind))
  /** Slots cuja informação completa (preço, duas mãos) já chegou. */
  const [done, setDone] = useState<ReadonlySet<string>>(() => initialDone(build, kind))
  const [weaponSet, setWeaponSet] = useState<1 | 2>(build.activeWeaponSet)
  const [hovered, setHovered] = useState<Popup | null>(null)
  const [pinned, setPinned] = useState<Popup | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const bySlot = useMemo(() => new Map(build.items.map((i) => [i.slot, i])), [build])

  const place = placeBeside
  const show = (name: string, el: HTMLElement) => setHovered({ slot: name, at: place(el) })

  // Esc, clique fora ou rolar a página solta o card fixado.
  useEffect(() => {
    if (!pinned) return
    const close = () => setPinned(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target?.closest('.item-pop') && !wrapRef.current?.contains(target)) close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', close, true)
    }
  }, [pinned])

  useEffect(() => {
    let alive = true
    setInfo(initialInfo(build, kind))
    setDone(initialDone(build, kind))
    setWeaponSet(build.activeWeaponSet)
    setHovered(null)
    setPinned(null)
    // Um item por vez: cada ícone aparece assim que chega. Únicos primeiro (poe.ninja, rápido);
    // bases novas passam pela fila da trade.
    const order = [...build.items]
      .filter((i) => !itemInfoMemo.has(itemKey(build, kind, i.slot)))
      .sort((a, b) => Number(b.rarity === 'Unique') - Number(a.rarity === 'Unique'))
    void (async () => {
      for (const item of order) {
        if (!alive) return
        const result = await api.buildItemInfo(kind, item.slot).catch(() => null)
        // Guarda mesmo se a página já fechou: a próxima visita usa na hora.
        if (result) itemInfoMemo.set(itemKey(build, kind, item.slot), result)
        if (!alive) return
        if (result) setInfo((all) => ({ ...all, [item.slot]: { ...result, iconUrl: result.iconUrl ?? all[item.slot]?.iconUrl ?? null } }))
        setDone((all) => new Set(all).add(item.slot))
      }
    })()
    return () => {
      alive = false
    }
  }, [build, kind])

  const slot = (name: string, area?: string) => {
    const item = bySlot.get(name)
    const label = t(`slot.${name}` as MessageKey)
    if (!item) {
      return (
        <div key={name} className="doll-slot empty" style={area ? { gridArea: area } : undefined} aria-label={label}>
          <span className="doll-text">{label}</span>
        </div>
      )
    }
    return (
      <button
        key={name}
        type="button"
        className={`doll-slot ${rarityClass(item.rarity)} ${pinned?.slot === name ? 'on' : ''} ${name.startsWith('Flask') ? 'tall' : ''}`}
        style={area ? { gridArea: area } : undefined}
        aria-label={`${label}: ${item.name ?? item.baseType}`}
        aria-pressed={pinned?.slot === name}
        onMouseEnter={(e) => show(name, e.currentTarget)}
        onMouseLeave={() => setHovered(null)}
        onFocus={(e) => show(name, e.currentTarget)}
        onBlur={() => setHovered(null)}
        onClick={(e) => {
          // Clique fixa o card (para usar o "Buscar no mercado"); outro clique solta.
          const at = place(e.currentTarget)
          setPinned((p) => (p?.slot === name ? null : { slot: name, at }))
        }}
      >
        <DollIcon url={info[name]?.iconUrl} label={item.name ?? item.baseType} pending={!done.has(name)} />
      </button>
    )
  }

  const shown = hovered ?? pinned
  const current = shown ? bySlot.get(shown.slot) : undefined
  const mainHand = weaponSet === 2 ? 'Weapon 1 Swap' : 'Weapon 1'
  const offHand = weaponSet === 2 ? 'Weapon 2 Swap' : 'Weapon 2'
  const main = bySlot.get(mainHand)
  // Arma de duas mãos sem nada na outra mão: o espaço da direita mostra a mesma arma, apagada.
  const ghost = main && !bySlot.has(offHand) && info[mainHand]?.twoHanded
  return (
    <div className="equip" ref={wrapRef}>
      <div className="doll">
        <div className="weapon-sets" role="group" aria-label={t('build.weaponSet')}>
          {([1, 2] as const).map((n) => (
            <button
              key={n}
              type="button"
              className={weaponSet === n ? 'on' : ''}
              aria-pressed={weaponSet === n}
              title={n === build.activeWeaponSet ? t('build.weaponSet.active', { n: n === 1 ? 'I' : 'II' }) : undefined}
              onClick={() => {
                setWeaponSet(n)
                setPinned(null)
              }}
            >
              {n === 1 ? 'I' : 'II'}
              {n === build.activeWeaponSet && <i aria-hidden="true" />}
            </button>
          ))}
        </div>
        {slot(mainHand, 'w1')}
        {ghost ? (
          <div className="doll-slot ghost" style={{ gridArea: 'w2' }} aria-hidden="true">
            <DollIcon url={info[mainHand]?.iconUrl} label={main.name ?? main.baseType} pending={!done.has(mainHand)} />
          </div>
        ) : (
          slot(offHand, 'w2')
        )}
        {Object.entries(DOLL_AREA)
          .filter(([name]) => name !== 'Ring 3' || bySlot.has(name))
          .map(([name, area]) => slot(name, area))}
      </div>
      {BELT_ROW.some((s) => bySlot.has(s)) && <div className="doll-row">{BELT_ROW.filter((s) => bySlot.has(s) || s.startsWith('Flask')).map((s) => slot(s))}</div>}
      <p className="fine equip-hint">{t('build.equipHint')}</p>
      {current && shown && (
        <PopCard popup={shown} pinned={shown === pinned}>
          <ItemCard item={current} price={info[current.slot]?.priceDivine ?? null} tradeKind={kind} />
        </PopCard>
      )}
    </div>
  )
}

/** Card no estilo da dica do jogo: nome, base, defesas, implícitos, mods e ações. */
function ItemCard({
  item,
  price: priceDivine = null,
  tradeKind,
  icon,
}: {
  item: BuildItem
  price?: number | null
  tradeKind?: BuildKind
  icon?: string
}) {
  const { t, amount, price } = useApp()
  const props = [
    ['stat.armour', item.properties.armour],
    ['stat.evasion', item.properties.evasion],
    ['stat.energyShield', item.properties.energyShield],
    ['stat.spirit', item.properties.spirit],
  ] as const
  const implicits = item.mods.slice(0, item.implicits)
  const explicits = item.mods.slice(item.implicits)
  return (
    <article className={`item-card ${rarityClass(item.rarity)}`}>
      <header>
        {icon && <img className="item-card-icon" src={iconSrc(icon)} alt="" referrerPolicy="no-referrer" />}
        <span className="label">{t(`slot.${item.slot}` as MessageKey)}</span>
        <b>{item.name ?? item.baseType}</b>
        {item.name && <span>{item.baseType}</span>}
      </header>
      {props.some(([, v]) => v > 0) && (
        <div className="item-card-sec">
          {props
            .filter(([, v]) => v > 0)
            .map(([key, v]) => (
              <div key={key} className="muted">
                {t(key)}: <b className="num">{amount(v)}</b>
              </div>
            ))}
        </div>
      )}
      {implicits.length > 0 && (
        <div className="item-card-sec mods">
          {implicits.map((m, i) => (
            <div key={`i${i}`}>{m}</div>
          ))}
        </div>
      )}
      {explicits.length > 0 && (
        <div className="item-card-sec mods">
          {explicits.map((m, i) => (
            <div key={`e${i}`}>{m}</div>
          ))}
        </div>
      )}
      {(tradeKind || priceDivine !== null) && (
        <footer>
          {priceDivine !== null && (
            <span className="muted">
              {t('build.uniquePrice')} <b className="num">{price(priceDivine)}</b>
            </span>
          )}
          {tradeKind && <TradeButton kind={tradeKind} slot={item.slot} />}
        </footer>
      )}
    </article>
  )
}

// ---------------------------------------------------------------- skills, joias, notas

interface GemIcons {
  icons: Record<string, string>
  /** Gemas cuja busca de ícone já terminou (com ou sem ícone). */
  done: ReadonlySet<string>
}

/**
 * Ícones oficiais das gemas. Os que vieram com a build (poe.ninja) aparecem na hora;
 * os outros são buscados um por vez na trade (cache em disco depois da primeira vez).
 */
function useGemIcons(build: Build): GemIcons {
  const initial = () => {
    const icons: Record<string, string> = {}
    for (const [name, detail] of Object.entries(build.extras?.gems ?? {})) if (detail.icon) icons[name] = detail.icon
    for (const g of build.skills.flatMap((s) => s.gems)) {
      const known = gemIconMemo.get(g.name)
      if (known && !icons[g.name]) icons[g.name] = known
    }
    return icons
  }
  const [icons, setIcons] = useState<Record<string, string>>(initial)
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set(Object.keys(initial())))
  useEffect(() => {
    let alive = true
    const start = initial()
    setIcons(start)
    setDone(new Set(Object.keys(start)))
    // Skill principal primeiro, depois as outras ativas, depois supports.
    const ordered = [...build.skills].sort((a, b) => Number(b.main) - Number(a.main)).flatMap((g) => g.gems)
    const names = [...new Set([...ordered.filter((g) => !g.support), ...ordered.filter((g) => g.support)].map((g) => g.name))].filter((n) => !start[n])
    void (async () => {
      for (const name of names) {
        if (!alive) return
        const url = await api.buildGemIcon(name).catch(() => null)
        if (url) gemIconMemo.set(name, url)
        if (!alive) return
        if (url) setIcons((all) => ({ ...all, [name]: url }))
        setDone((all) => new Set(all).add(name))
      }
    })()
    return () => {
      alive = false
    }
  }, [build])
  return { icons, done }
}

function GemIcon({ name, gems }: { name: string; gems: GemIcons }) {
  const url = gems.icons[name]
  const [failed, setFailed] = useState(false)
  if (url && !failed) return <img className="gem-icon" src={iconSrc(url)} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  // Ainda buscando: brilho do tamanho do ícone (a linha não pula quando ele chega).
  if (!gems.done.has(name)) return <span className="gem-icon icon-loading" aria-hidden="true" />
  return <span className="gem-icon gem-dot" aria-hidden="true" />
}

/** Dica da gema como no jogo: tags, propriedades e os textos de cada aba. */
function GemCard({ gem, detail, icon }: { gem: BuildGem; detail: GemDetail | undefined; icon: string | undefined }) {
  const { t } = useApp()
  return (
    <article className={`item-card gem-card ${gem.support ? 'support' : 'active'}`}>
      <header>
        {icon && <img className="gem-card-icon" src={iconSrc(icon)} alt="" referrerPolicy="no-referrer" />}
        <b>{gem.name}</b>
        {detail?.tags && <span className="muted">{detail.tags}</span>}
      </header>
      <div className="item-card-sec">
        {detail && detail.properties.length > 0 ? (
          detail.properties.map((p, i) => (
            <div key={i} className="muted">
              {p.label ? (
                <>
                  {p.label}: <b className="num">{p.value}</b>
                </>
              ) : (
                p.value
              )}
            </div>
          ))
        ) : (
          <div className="muted">
            {t('gem.level')}: <b className="num">{gem.level}</b>
            {gem.quality > 0 && (
              <>
                {' '}
                · {t('gem.quality')}: <b className="num">+{gem.quality}%</b>
              </>
            )}
          </div>
        )}
      </div>
      {detail?.pages.map((page, i) => (
        <div key={i} className="item-card-sec mods">
          {page.title && detail.pages.length > 1 && <div className="gem-page-title">{page.title}</div>}
          {page.stats.map((s, j) => (
            <div key={j}>{s}</div>
          ))}
        </div>
      ))}
      {!detail && <p className="fine gem-card-note">{t('gem.noDetails')}</p>}
    </article>
  )
}

/** Grupo de skill: gema ativa e supports; a principal traz o DPS e os detalhes de ataque do PoB. */
function SkillGroup({
  group,
  build,
  gems,
  onGem,
}: {
  group: BuildSkillGroup
  build: Build
  gems: GemIcons
  onGem: (gem: BuildGem | null, el?: HTMLElement) => void
}) {
  const { t } = useApp()
  const title = group.label ?? group.gems.find((g) => !g.support)?.name ?? group.gems[0]?.name ?? ''
  return (
    <article className={`skill-group ${group.main ? 'main' : ''} ${group.enabled ? '' : 'off'}`}>
      <header>
        <b>{title}</b>
        {group.main && <span className="skill-main">{t('build.skills.main')}</span>}
      </header>
      <ul>
        {group.gems.map((g, i) => (
          <li
            key={`${i}-${g.name}`}
            className={`${g.support ? 'support' : 'active'} ${g.enabled ? '' : 'off'}`}
            tabIndex={0}
            onMouseEnter={(e) => onGem(g, e.currentTarget)}
            onMouseLeave={() => onGem(null)}
            onFocus={(e) => onGem(g, e.currentTarget)}
            onBlur={() => onGem(null)}
          >
            <GemIcon name={g.name} gems={gems} />
            <span className="gem-name">{g.name}</span>
            <small className="num muted">
              {g.level}
              {g.quality > 0 ? `/${g.quality}` : ''}
            </small>
          </li>
        ))}
      </ul>
      {group.main && (
        <div className="skill-stats">
          <StatList build={build} rows={SKILL_OFFENCE} />
        </div>
      )}
    </article>
  )
}

// ---------------------------------------------------------------- página

function BuildSummary({ build, kind, onReplace }: { build: Build; kind: BuildKind; onReplace: () => void }) {
  const { t } = useApp()
  const format = useFormat()
  const gemIcons = useGemIcons(build)
  const [gemPop, setGemPop] = useState<{ gem: BuildGem; popup: Popup } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const onGem = (gem: BuildGem | null, el?: HTMLElement) => setGemPop(gem && el ? { gem, popup: { slot: gem.name, at: placeBeside(el) } } : null)
  const source = build.source.kind === 'link' ? SITE_NAMES[build.source.site] : t('build.source.code')
  const dps = build.stats.CombinedDPS ?? build.stats.TotalDPS
  // Skills ativas primeiro; grupos desligados no fim.
  const skills = [...build.skills].sort((a, b) => Number(b.main) - Number(a.main) || Number(b.enabled) - Number(a.enabled))

  return (
    <>
      <header className="card build-hero">
        <div className="build-hero-main">
          <span className="label">{build.className}</span>
          <h3>{build.ascendancy ?? build.className}</h3>
          <div className="build-hero-facts">
            <span>{t('build.level', { n: build.level })}</span>
            {build.mainSkill && (
              <span>
                <span className="label">{t('build.mainSkill')}</span> <b>{build.mainSkill}</b>
              </span>
            )}
            {build.passives !== null && <span>{t('build.passives', { n: build.passives })}</span>}
          </div>
          <p className="fine">{t('build.source', { time: timeAgo(build.importedAt, t), source })}</p>
        </div>
        {dps !== undefined && dps > 0 && (
          <div className="build-hero-dps">
            <span className="label">{t('build.dps')}</span>
            <b className="num">{format(dps, 'big')}</b>
          </div>
        )}
        <div className="build-hero-actions">
          <button className="btn small" type="button" onClick={onReplace}>
            {t('build.replace')}
          </button>
          <button
            className={`btn small ${confirmClear ? 'danger' : 'ghost'}`}
            type="button"
            onClick={() => (confirmClear ? void api.clearBuild(kind) : setConfirmClear(true))}
            onBlur={() => setConfirmClear(false)}
          >
            {confirmClear ? `${t('build.clear')}?` : t('build.clear')}
          </button>
        </div>
      </header>

      <div className="build-layout">
        {/* Esquerda, como no poe.ninja: vida/ES/mana e, embaixo, as skills com supports e o DPS. */}
        <section className="card build-col" aria-label={t('build.section.skills')}>
          <StatList build={build} rows={RESOURCES} />
          {skills.length > 0 ? (
            <>
              <h4 className="label">{t('build.section.skills')}</h4>
              <div className="skill-list">
                {skills.map((g, i) => (
                  <SkillGroup key={i} group={g} build={build} gems={gemIcons} onGem={onGem} />
                ))}
              </div>
            </>
          ) : (
            <>
              <h4 className="label">{t('build.section.offence')}</h4>
              <StatList build={build} rows={OFFENCE} />
            </>
          )}
        </section>
        <section className="card build-center" aria-label={t('build.items')}>
          {build.items.length === 0 ? <p className="fine">{t('build.noItems')}</p> : <Equipment build={build} kind={kind} />}
        </section>
        <section className="card build-col" aria-label={t('build.section.defence')}>
          <h4 className="label">{t('build.section.defence')}</h4>
          <StatList build={build} rows={DEFENCE} />
          <h4 className="label">{t('build.section.resist')}</h4>
          <StatList build={build} rows={RESISTANCES} overcap />
          {MAX_HIT.some((r) => build.stats[r.stat] !== undefined) && (
            <>
              <h4 className="label">{t('build.section.maxHit')}</h4>
              <StatList build={build} rows={MAX_HIT} />
            </>
          )}
          <h4 className="label">{t('build.section.attributes')}</h4>
          <Attributes build={build} />
        </section>
      </div>

      {build.jewels.length > 0 && (
        <section className="card">
          <h4 className="label section-title">{t('build.section.jewels', { n: build.jewels.length })}</h4>
          <div className="jewel-grid">
            {build.jewels.map((j, i) => (
              <ItemCard key={i} item={j} icon={build.extras?.jewelIcons[j.name ?? j.baseType] ?? build.extras?.jewelIcons[j.baseType]} />
            ))}
          </div>
        </section>
      )}

      {build.notes && (
        <section className="card">
          <details className="build-notes" open={build.notes.length < 1200}>
            <summary className="label section-title">{t('build.section.notes')}</summary>
            <p>{build.notes}</p>
          </details>
        </section>
      )}

      {gemPop && (
        <PopCard popup={gemPop.popup} pinned={false}>
          <GemCard gem={gemPop.gem} detail={build.extras?.gems[gemPop.gem.name]} icon={gemIcons.icons[gemPop.gem.name]} />
        </PopCard>
      )}
    </>
  )
}

// ---------------------------------------------------------------- comparar e plano

const COMPARE_ROWS: Array<{ stat: string; label: MessageKey; fmt: Fmt; tone?: string }> = [
  { stat: 'Life', label: 'stat.life', fmt: 'int', tone: 'life' },
  { stat: 'EnergyShield', label: 'stat.energyShield', fmt: 'int', tone: 'es' },
  { stat: 'Mana', label: 'stat.mana', fmt: 'int', tone: 'mana' },
  { stat: 'Spirit', label: 'stat.spirit', fmt: 'int', tone: 'spirit' },
  { stat: 'TotalEHP', label: 'build.stat.ehp', fmt: 'big' },
  { stat: 'FireResist', label: 'stat.fireRes', fmt: 'pct', tone: 'fire' },
  { stat: 'ColdResist', label: 'stat.coldRes', fmt: 'pct', tone: 'cold' },
  { stat: 'LightningResist', label: 'stat.lightningRes', fmt: 'pct', tone: 'lightning' },
  { stat: 'ChaosResist', label: 'stat.chaosRes', fmt: 'pct', tone: 'chaos' },
  { stat: 'CombinedDPS', label: 'build.stat.totalDps', fmt: 'big', tone: 'gold' },
]
const ELEMENT_KEY = { fireRes: 'stat.fireRes', coldRes: 'stat.coldRes', lightningRes: 'stat.lightningRes' } as const
const ATTR_KEY = { str: 'stat.str', dex: 'stat.dex', int: 'stat.int' } as const

/** Grupo de cada passo do plano, na ordem em que aparecem. */
function stepGroup(step: PlanStep): 'urgent' | 'gear' | 'gems' | 'damage' {
  if (step.kind === 'resist' || step.kind === 'attribute' || step.kind === 'chaos') return 'urgent'
  if (step.kind === 'unique' || step.kind === 'item' || step.kind === 'boots' || step.kind === 'tier') return 'gear'
  if (step.kind === 'dps') return 'damage'
  return 'gems'
}

/** Por que o passo importa (uma linha, sem jargão). */
function whyKey(step: PlanStep): MessageKey | null {
  switch (step.kind) {
    case 'resist':
      return 'plan.why.resist'
    case 'attribute':
      return 'plan.why.attribute'
    case 'chaos':
      return 'plan.why.chaos'
    case 'boots':
      return 'plan.why.boots'
    case 'tier':
      return 'plan.why.tier'
    case 'unique':
      return 'plan.why.unique'
    case 'item':
      return step.empty ? 'plan.why.empty' : step.slot.startsWith('Weapon') ? 'plan.why.weapon' : 'plan.why.item'
    case 'skill':
      return 'plan.why.skill'
    case 'support':
      return 'plan.why.support'
    case 'gem-level':
      return 'plan.why.gemLevel'
    case 'dps':
      return null
  }
}

/** Passo com selo de impacto e a linha do porquê. */
function PlanStepFull({ step, showWhy = true }: { step: PlanStep; showWhy?: boolean }) {
  const { t } = useApp()
  const impact = stepImpact(step)
  const why = showWhy ? whyKey(step) : null
  return (
    <div className="plan-step">
      <span className={`impact ${impact}`}>{t(`plan.impact.${impact}`)}</span>
      <div className="plan-step-body">
        <PlanStepView step={step} />
        {why && <small className="plan-why">{t(why)}</small>}
      </div>
    </div>
  )
}

function PlanStepView({ step }: { step: PlanStep }) {
  const { t, amount } = useApp()
  const format = useFormat()
  const slot = (s: string) => t(`slot.${s}` as MessageKey)
  switch (step.kind) {
    case 'resist':
      return (
        <span>
          {t('plan.resist', { el: t(ELEMENT_KEY[step.key]), n: step.missing })}
          {step.slots.length > 0 && <small className="muted"> {t('plan.where', { slots: step.slots.map(slot).join(', ') })}</small>}
        </span>
      )
    case 'attribute':
      return <>{t('plan.attribute', { n: step.missing, attr: t(ATTR_KEY[step.key]) })}</>
    case 'chaos':
      return <>{step.guide === null ? t('plan.chaos', { mine: step.mine }) : t('plan.chaos.guide', { mine: step.mine, guide: step.guide })}</>
    case 'boots':
      return <>{t('plan.boots', { mine: step.mine })}</>
    case 'tier':
      return (
        <div className="plan-item">
          <span>
            {t('plan.tier', { slot: slot(step.slot) })}
            {step.mods.map((m) => (
              <small key={m.statId} className="plan-tier">
                <span className="tier-badge low">
                  T{m.tier}/{m.tiers}
                </span>{' '}
                {m.text}
              </small>
            ))}
          </span>
        </div>
      )
    case 'unique':
      return (
        <div className="plan-item">
          <span>{t('plan.unique', { name: step.name, slot: slot(step.slot) })}</span>
          <TradeButton kind="guide" slot={step.slot} />
        </div>
      )
    case 'item': {
      const gaps = step.gaps.map((g) => `${t(`stat.${g.key}` as MessageKey)} +${amount(Math.round(g.guide - g.mine))}${g.key.endsWith('Res') || g.key === 'moveSpeed' ? '%' : ''}`).join(', ')
      return (
        <div className="plan-item">
          <span>
            {step.empty ? t('plan.item.empty', { slot: slot(step.slot) }) : t('plan.item', { slot: slot(step.slot) })}
            {gaps && <small className="muted"> {t('plan.item.gaps', { gaps })}</small>}
            {step.missingMods.length > 0 && <small className="muted"> {t('plan.item.mods', { mods: step.missingMods.join(' · ') })}</small>}
          </span>
          <TradeButton kind="guide" slot={step.slot} />
        </div>
      )
    }
    case 'skill':
      return <>{step.supports.length > 0 ? t('plan.skill.with', { skill: step.skill, supports: step.supports.join(', ') }) : t('plan.skill', { skill: step.skill })}</>
    case 'support':
      return <>{t('plan.support', { support: step.support, skill: step.skill })}</>
    case 'gem-level':
      return <>{t('plan.gemLevel', { gem: step.gem, mine: step.mine, guide: step.guide })}</>
    case 'dps':
      return <>{t('plan.dps', { pct: Math.round((step.mine / step.guide) * 100), mine: format(step.mine, 'big'), guide: format(step.guide, 'big') })}</>
  }
}

function ComparePanel({ mine, guide }: { mine: Build; guide: Build }) {
  const { t } = useApp()
  const format = useFormat()
  // Tier real de cada mod das suas peças (dados do jogo guardados no app; sem busca na trade).
  const [tiers, setTiers] = useState<TierReport | null>(null)
  useEffect(() => {
    let alive = true
    api.buildTiers('mine').then((r) => alive && setTiers(r)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [mine])
  const plan = useMemo(() => buildPlan(mine, guide, tiers), [mine, guide, tiers])
  const next = useMemo(() => nextStep(plan), [plan])
  const highCount = plan.filter((s) => stepImpact(s) === 'high').length
  const rows = COMPARE_ROWS.filter((r) => mine.stats[r.stat] !== undefined || guide.stats[r.stat] !== undefined)
  // Dentro de cada grupo, impacto alto primeiro (ordem do plano como desempate).
  const rank = { high: 0, medium: 1, low: 2 } as const
  const groups = (['urgent', 'gear', 'gems', 'damage'] as const)
    .map((g) => ({ id: g, steps: plan.filter((s) => stepGroup(s) === g).sort((a, b) => rank[stepImpact(a)] - rank[stepImpact(b)]) }))
    .filter((g) => g.steps.length > 0)
  // O porquê aparece uma vez por tipo de passo (não repete em cada peça).
  const firstWhy = new Set<PlanStep>()
  const seenWhy = new Set<string>()
  for (const g of groups)
    for (const s of g.steps) {
      const key = whyKey(s)
      if (key && !seenWhy.has(key)) {
        seenWhy.add(key)
        firstWhy.add(s)
      }
    }

  return (
    <div className="compare">
      {/* Linha inteira acima das duas colunas (plano | lado a lado). */}
      <div style={{ gridColumn: '1 / -1' }}>
        <BetaNote />
      </div>
      <section className="card">
        <h4 className="label section-title">{t('plan.title')}</h4>
        <p className="fine" style={{ marginTop: -4 }}>
          {t('plan.intro', { guide: guide.ascendancy ?? guide.className })}
        </p>
        {plan.length === 0 ? (
          <div className="banner info">{t('plan.empty')}</div>
        ) : (
          <>
            {next && (
              <div className="plan-next">
                <div className="label">{t('plan.next')}</div>
                <PlanStepFull step={next} />
              </div>
            )}
            <p className="fine">{t('plan.summary', { n: plan.length, high: highCount })}</p>
            <div className="plan">
              {groups.map((g) => (
                <div key={g.id} className={`plan-group ${g.id}`}>
                  <h5>{t(`plan.group.${g.id}`)}</h5>
                  <ol>
                    {g.steps.map((s, i) => (
                      <li key={i}>
                        <PlanStepFull step={s} showWhy={firstWhy.has(s) && s !== next} />
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h4 className="label section-title">{t('compare.title')}</h4>
        <table className="compare-table">
          <thead>
            <tr>
              <th />
              <th className="r">{t('build.tab.mine')}</th>
              <th className="r">{t('build.tab.guide')}</th>
              <th className="r">{t('compare.diff')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('compare.level')}</td>
              <td className="r num">{mine.level}</td>
              <td className="r num">{guide.level}</td>
              <td className={`r num ${mine.level >= guide.level ? 'up' : 'down'}`}>{mine.level - guide.level}</td>
            </tr>
            {rows.map((r) => {
              const a = mine.stats[r.stat]
              const b = guide.stats[r.stat]
              const diff = a !== undefined && b !== undefined ? a - b : null
              return (
                <tr key={r.stat}>
                  <td>{t(r.label)}</td>
                  <td className={`r num ${r.tone ? `tone-${r.tone}` : ''}`}>{a === undefined ? '–' : format(a, r.fmt)}</td>
                  <td className={`r num ${r.tone ? `tone-${r.tone}` : ''}`}>{b === undefined ? '–' : format(b, r.fmt)}</td>
                  <td className={`r num ${diff === null || diff === 0 ? 'muted' : diff > 0 ? 'up' : 'down'}`}>
                    {diff === null ? '–' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${format(Math.abs(diff), r.fmt)}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- página

type Tab = BuildKind | 'compare'

function BuildTab({ kind }: { kind: BuildKind }) {
  const { builds } = useApp()
  const build = builds[kind]
  const [replacing, setReplacing] = useState(false)
  useEffect(() => setReplacing(false), [kind])
  return (
    <>
      {(!build || replacing) && <ImportForm kind={kind} onDone={() => setReplacing(false)} onCancel={build ? () => setReplacing(false) : undefined} />}
      {build && <BuildSummary build={build} kind={kind} onReplace={() => setReplacing(true)} />}
    </>
  )
}

export function BuildPage() {
  const { t, builds } = useApp()
  const [tab, setTab] = useSticky<Tab>('build.tab', () => (builds.mine ? 'mine' : builds.guide ? 'guide' : 'mine'), { persist: true })
  const tabs: Tab[] = ['mine', 'guide', 'compare']

  return (
    <div className="build-page">
      <div>
        <h2 className="page-title">{t('build.title')}</h2>
      </div>
      <div className="chips" role="tablist" aria-label={t('build.title')}>
        {tabs.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`chip ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
            {t(`build.tab.${id}`)}
            {id !== 'compare' && builds[id] && <span className="tab-dot" aria-hidden="true" />}
            {id === 'compare' && <BetaBadge />}
          </button>
        ))}
      </div>
      {tab === 'compare' ? (
        builds.mine && builds.guide ? (
          <ComparePanel mine={builds.mine} guide={builds.guide} />
        ) : (
          <div className="banner info">{t('plan.needBoth')}</div>
        )
      ) : (
        <BuildTab kind={tab} />
      )}
      <div className="card">
        <h4 className="label" style={{ margin: '0 0 6px' }}>
          {t('build.howItWorks')}
        </h4>
        <p className="fine">{t('build.howItWorks.body')}</p>
      </div>
    </div>
  )
}
