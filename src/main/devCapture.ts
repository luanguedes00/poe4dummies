// Só em desenvolvimento: tira fotos das janelas para revisar o visual sem
// abrir o jogo. Ativado por ORACULO_CAPTURE=<pasta>. Nunca roda no app empacotado.

import { app, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { encodePobCode } from '../core/build/pob'
import { zoneGuide } from '../core/campaign/guide'
import type { TierOption } from '../core/item/tiers'
import type { PriceCheckResult, PricedListing } from '../core/pricecheck'
import type { StatFilter } from '../core/trade/query'
import { EVENTS } from '../shared/ipc'
import { createCampaignWindow, showCampaignWindow } from './windows'

const SAMPLE_ITEM = `Item Class: Rings
Rarity: Rare
Gale Coil
Sapphire Ring
--------
Requires: Level 54
--------
Item Level: 81
--------
{ Implicit Modifier — Elemental, Cold, Resistance }
+23(20-30)% to Cold Resistance (implicit)
--------
{ Prefix Modifier "Virile" (Tier: 3) — Life }
+78(70-84) to maximum Life
{ Prefix Modifier "Mazarine" (Tier: 5) — Mana }
+41(35-44) to maximum Mana
{ Suffix Modifier "of the Furnace" (Tier: 2) — Elemental, Fire, Resistance }
+32(31-35)% to Fire Resistance
{ Suffix Modifier "of the Squall" (Tier: 6) — Elemental, Lightning, Resistance }
+19(16-20)% to Lightning Resistance
`

export function captureDir(): string | null {
  if (app.isPackaged) return null
  return process.env['ORACULO_CAPTURE'] ?? null
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function shot(win: BrowserWindow, dir: string, name: string): Promise<void> {
  const image = await win.webContents.capturePage()
  await fs.writeFile(join(dir, `${name}.png`), image.toPNG())
}

/** Busca com mods e tier escolhido no seletor (preenche mín e máx da faixa do tier). */
async function captureTierSearch(dashboard: BrowserWindow, dir: string, click: (js: string) => Promise<unknown>): Promise<void> {
  const addMod = async (text: string, pattern: string) => {
    await click(`document.querySelector('.stat-group.primary input.input')?.focus()`)
    dashboard.webContents.insertText(text)
    await wait(700)
    await click(`[...document.querySelectorAll('.suggest-list li')].find((li) => new RegExp(${JSON.stringify(pattern)}).test(li.firstChild?.textContent ?? ''))?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    await wait(3000)
  }
  // Troca o valor do <select> de um jeito que o React percebe.
  const pickTier = (index: number, value: string) =>
    click(`(() => {
      const s = document.querySelectorAll('.stat-group.primary .tier-select')[${index}]
      if (!s) return false
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)})
      s.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)

  await click(`[...document.querySelectorAll('.nav button')][3]?.click()`)
  await wait(2500)
  await click(`document.getElementById('search-item')?.focus()`)
  dashboard.webContents.insertText('Sapphire Ring')
  await wait(600)
  await click(`document.querySelector('.suggest-list li')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await wait(300)
  await addMod('to maximum Life', '^N to maximum Life$')
  await addMod('Fire Resistance', '^N% to Fire Resistance$')
  await pickTier(0, 't2')
  await pickTier(1, 't1')
  await wait(500)
  await shot(dashboard, dir, '5c-busca-tier-escolhido')
  await click(`document.querySelector('.form-card button[type=submit]')?.click()`)
  await wait(6000)
  await shot(dashboard, dir, '6c-busca-tier-resultado')
}

/**
 * Importa a build de exemplo dos testes, fotografa "Minha build" e a sobreposição
 * com o anel de exemplo, e remove a build no fim (não deixa lixo nas configurações).
 */
async function captureBuild(
  dashboard: BrowserWindow,
  dir: string,
  click: (js: string) => Promise<unknown>,
  getOverlay: () => BrowserWindow | null,
  priceCheck: (text: string) => Promise<void>,
): Promise<void> {
  const guide = await fs.readFile(join(app.getAppPath(), 'tests', 'fixtures', 'pob-showcase.xml'), 'utf8')
  // "Minha build" de exemplo: o guia com o que costuma faltar (resistência, vida, gemas, botas).
  const mine = guide
    .replace('stat="FireResist" value="75"', 'stat="FireResist" value="58"')
    .replace('stat="Life" value="3120"', 'stat="Life" value="2240"')
    .replace('stat="CombinedDPS" value="1843000"', 'stat="CombinedDPS" value="790000"')
    .replace('level="92"', 'level="84"')
    .replace(/\s*<Gem nameSpec="Magnified Area I"[^>]*\/>/, '')
    .replace('<Gem nameSpec="Fireball" skillId="FireballPlayer" gemId="Metadata/Items/Gems/SkillGemFireball" level="20"', '<Gem nameSpec="Fireball" skillId="FireballPlayer" gemId="Metadata/Items/Gems/SkillGemFireball" level="17"')
    .replace(/\s*<Slot name="Boots" itemId="6"\/>/, '')
    .replace('<Slot name="Amulet" itemId="7"/>', '')
  const importAs = (xml: string, kind: 'guide' | 'mine') => click(`window.oraculo.importBuild(${JSON.stringify(encodePobCode(xml))}, '${kind}').then((r) => r.ok)`)
  // ORACULO_CAPTURE_BUILD_LINK: fotografa um personagem real (link do poe.ninja/pobb.in) como "Minha build".
  const link = process.env['ORACULO_CAPTURE_BUILD_LINK']
  if (link) console.log('[capture] link importado?', await click(`window.oraculo.importBuild(${JSON.stringify(link)}, 'mine').then((r) => r.ok || r.code)`))
  else console.log('[capture] builds importadas?', await importAs(guide, 'guide'), await importAs(mine, 'mine'))
  // ORACULO_CAPTURE_ONLY=plan: só a aba Comparar e plano (sem ícones nem price check: não usa a trade).
  if (process.env['ORACULO_CAPTURE_ONLY'] === 'plan') {
    try {
      await click(`[...document.querySelectorAll('.nav button')].find((b) => /Builds/.test(b.textContent ?? ''))?.click()`)
      await wait(800)
      await click(`[...document.querySelectorAll('[role=tab]')][2]?.click()`)
      await wait(1500)
      await shot(dashboard, dir, '13-comparar-plano')
      await click(`document.querySelector('.plan-group.gems')?.scrollIntoView({ block: 'start' })`)
      await wait(400)
      await shot(dashboard, dir, '13b-plano-gemas')
    } finally {
      await click(`window.oraculo.clearBuild('guide').then(() => window.oraculo.clearBuild('mine'))`)
    }
    return
  }
  try {
    await click(`[...document.querySelectorAll('.nav button')].find((b) => /Builds/.test(b.textContent ?? ''))?.click()`)
    await wait(800)
    // Vitrine: a aba do guia tem a build completa. Link real: a aba "Minha build".
    await click(`[...document.querySelectorAll('[role=tab]')][${link ? 0 : 1}]?.click()`)
    await wait(800)
    await shot(dashboard, dir, '12-minha-build')
    await click(`document.querySelector('.equip')?.scrollIntoView({ block: 'center' })`)
    // Ícones: únicos pelo poe.ninja; bases e gemas pela trade (fila com o limite da GGG).
    const started = Date.now()
    let last = -1
    let stableSince = Date.now()
    for (let i = 0; i < 150; i++) {
      const loaded = Number(await click(`document.querySelectorAll('.doll-slot img').length + document.querySelectorAll('.gem-icon').length`))
      if (loaded !== last) {
        last = loaded
        stableSince = Date.now()
      }
      // Para quando tudo chegou ou quando nada novo chega há 25 s (nomes que a trade não conhece).
      if (loaded >= 27 || Date.now() - stableSince > 25_000) break
      await wait(1000)
    }
    console.log('[capture] ícones carregados em', Math.round((Date.now() - started) / 1000), 's:', await click(`document.querySelectorAll('.doll-slot img').length + ' itens, ' + document.querySelectorAll('.gem-icon').length + ' gemas'`))
    // Fixa o card do peitoral (o mesmo que aparece ao passar o mouse).
    await click(`document.querySelector('.doll-slot[style*="grid-area: body"]')?.click()`)
    await wait(400)
    await shot(dashboard, dir, '12b-minha-build-itens')
    await click(`document.querySelector('.skill-list')?.scrollIntoView({ block: 'start' })`)
    await wait(400)
    await shot(dashboard, dir, '12d-minha-build-skills')
    await click(`document.querySelector('.equip')?.scrollIntoView({ block: 'center' })`)
    await wait(300)
    await click(`[...document.querySelectorAll('.weapon-sets button')][1]?.click()`)
    await wait(3000)
    await shot(dashboard, dir, '12c-minha-build-set2')
    await click(`[...document.querySelectorAll('[role=tab]')][2]?.click()`)
    await wait(800)
    await click(`window.scrollTo(0, 0); document.querySelector('.main')?.scrollTo(0, 0)`)
    await wait(300)
    await shot(dashboard, dir, '13-comparar-plano')
    await Promise.race([priceCheck(SAMPLE_ITEM), wait(30_000)])
    await wait(1000)
    const overlay = getOverlay()
    if (overlay) {
      overlay.showInactive()
      await wait(500)
      await Promise.race([shot(overlay, dir, '4c-sobreposicao-upgrade'), wait(10_000)])
    }
  } finally {
    await click(`window.oraculo.clearBuild('guide').then(() => window.oraculo.clearBuild('mine'))`)
  }
}

const SAMPLE_DIVINE = `Item Class: Stackable Currency
Rarity: Currency
Divine Orb
--------
Stack Size: 3/20
--------
Randomises the numeric values of the random modifiers on an item
`

/**
 * Desempenho: em cada tela, rola a página por 3 s medindo quadros por segundo e
 * tarefas longas (>50 ms, travam a tela); depois mede CPU de cada processo parado.
 * Resultado em perf.json.
 */
async function measurePerf(dashboard: BrowserWindow, dir: string, click: (js: string) => Promise<unknown>): Promise<void> {
  const report: Record<string, unknown> = {}
  const probe = `(async () => {
    const longs = []
    const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longs.push(Math.round(e.duration))))
    po.observe({ type: 'longtask', buffered: false })
    const scroller = document.querySelector('.drawer-body') ?? document.querySelector('.main') ?? document.scrollingElement
    let dir = 1
    const sc = setInterval(() => { scroller?.scrollBy(0, 40 * dir); if (Math.random() < 0.05) dir = -dir }, 16)
    let frames = 0
    const t0 = performance.now()
    await new Promise((r) => { const f = () => { frames++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : r() }; requestAnimationFrame(f) })
    clearInterval(sc)
    po.disconnect()
    return { fps: Math.round(frames / 3), longTasks: longs.length, worstMs: Math.max(0, ...longs), nodes: document.getElementsByTagName('*').length }
  })()`
  const measure = async (name: string) => {
    await wait(1500)
    report[name] = await click(probe)
    console.log('[perf]', name, JSON.stringify(report[name]))
  }
  const nav = (label: string) => click(`[...document.querySelectorAll('.nav button')].find((b) => (b.textContent ?? '').includes(${JSON.stringify(label)}))?.click()`)
  // Espera a tabela do mercado aparecer.
  for (let i = 0; i < 30 && Number(await click(`document.querySelectorAll('tbody tr').length`)) < 5; i++) await wait(500)
  report['gpu'] = app.getGPUFeatureStatus()
  await measure('mercado')
  await click(`document.querySelector('tbody tr:nth-child(1)')?.click()`)
  await wait(2500)
  console.log('[perf] drawer aberto?', await click(`!!document.querySelector('.drawer')`))
  await measure('mercado-item-aberto')
  dashboard.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  await wait(500)
  for (const page of ['Oportunidades', 'Buscar preço', 'Lista', 'Campanha', 'Farm', 'Builds']) {
    await nav(page)
    await measure(page)
  }
  // CPU parado: 5 s sem mexer em nada.
  await nav('Mercado')
  app.getAppMetrics()
  await wait(5000)
  report['cpu-parado'] = app.getAppMetrics().map((m) => ({ type: m.type, cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10, memMB: Math.round(m.memory.workingSetSize / 1024) }))
  console.log('[perf] cpu', JSON.stringify(report['cpu-parado']))
  await fs.writeFile(join(dir, 'perf.json'), JSON.stringify(report, null, 2))
}

/** Só o Farm: mapa montado (barato e completo) e o mercado de tablets. */
async function captureFarm(dashboard: BrowserWindow, dir: string, click: (js: string) => Promise<unknown>): Promise<void> {
  await click(`[...document.querySelectorAll('.nav button')].find((b) => /Farm/.test(b.textContent ?? ''))?.click()`)
  await wait(1500)
  // O app lembra a última aba: volta para "Por mecânica" antes das fotos.
  await click(`[...document.querySelectorAll('[role=tab]')].find((b) => /Por mecânica|By mechanic/.test(b.textContent ?? ''))?.click()`)
  await wait(8000)
  await shot(dashboard, dir, 'f1-farm-topo')
  await click(`document.querySelector('.setup-card')?.scrollIntoView({ block: 'start' })`)
  await wait(400)
  await shot(dashboard, dir, 'f2-farm-mapa-barato')
  await click(`[...document.querySelectorAll('.setup-card .seg button')].find((b) => /Completo|Full/.test(b.textContent ?? ''))?.click()`)
  await click(`[...document.querySelectorAll('.setup-card .seg button')].find((b) => /^4/.test(b.textContent ?? ''))?.click()`)
  await wait(600)
  await shot(dashboard, dir, 'f3-farm-mapa-completo-4')
  await click(`document.querySelector('.market-top')?.scrollIntoView({ block: 'center' })`)
  await wait(400)
  await shot(dashboard, dir, 'f3b-farm-mais-caros')
  await click(`[...document.querySelectorAll('[role=tab]')].find((b) => /Mercado de tablets|Tablet market/.test(b.textContent ?? ''))?.click()`)
  await wait(800)
  await click(`window.scrollTo(0, 0); document.querySelector('.main')?.scrollTo(0, 0)`)
  await shot(dashboard, dir, 'f4-farm-tablets')
}

/** Só a sobreposição: raro (mods inteligentes, resistência total aberta) e uma currency. */
async function captureOverlay(dir: string, getOverlay: () => BrowserWindow | null, priceCheck: (text: string) => Promise<void>): Promise<void> {
  const snap = async (name: string) => {
    const overlay = getOverlay()
    if (!overlay) return
    overlay.showInactive()
    await wait(600)
    await Promise.race([shot(overlay, dir, name), wait(10_000)])
  }
  await Promise.race([priceCheck(SAMPLE_ITEM), wait(30_000)])
  await wait(1500)
  await snap('o1-raro')
  await getOverlay()?.webContents.executeJavaScript(`document.querySelector('.mod-expand')?.click()`)
  await snap('o2-raro-resistencias-abertas')
  // Shift sobre o primeiro anúncio: item do vendedor para comparar.
  await getOverlay()?.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('.listings > div')
    row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }))
    setTimeout(() => document.querySelector('.seller-item')?.scrollIntoView({ block: 'center' }), 100)
  })()`)
  await snap('o4-comparar-vendedor')
  await Promise.race([priceCheck(SAMPLE_DIVINE), wait(30_000)])
  await wait(1500)
  await snap('o3-divine')
  await captureCampaign(dir)
}

/** Farm → Regex: aba vazia, depois o combo Reroll + Defer aplicado. Não usa a trade. */
async function captureRegex(dashboard: BrowserWindow, dir: string, click: (js: string) => Promise<unknown>): Promise<void> {
  await click(`[...document.querySelectorAll('.nav button')].find((b) => /Farm/.test(b.textContent ?? ''))?.click()`)
  await wait(1200)
  await click(`[...document.querySelectorAll('[role=tab]')].find((b) => /^Regex$/.test((b.textContent ?? '').trim()))?.click()`)
  for (let i = 0; i < 40 && !(await click(`!!document.querySelector('.regex-add')`)); i++) await wait(500)
  await click(`[...document.querySelectorAll('.regex-presets .chip')].find((b) => /Ritual/.test(b.textContent ?? '') && /Reroll/.test(b.textContent ?? ''))?.click()`)
  await wait(500)
  await shot(dashboard, dir, 'r1-regex-ritual')
}

/** Campanha e mapas → resumo da sessão de jogo (lido do Client.txt real). Não usa a trade. */
async function captureSession(dashboard: BrowserWindow, dir: string, click: (js: string) => Promise<unknown>): Promise<void> {
  await click(`[...document.querySelectorAll('.nav button')].find((b) => /Campanha|Campaign/.test(b.textContent ?? ''))?.click()`)
  for (let i = 0; i < 40 && !(await click(`!!document.querySelector('.play-groups')`)); i++) await wait(500)
  await click(`document.querySelector('.play-groups')?.closest('.card')?.querySelector('details')?.setAttribute('open', '')`)
  await wait(400)
  await shot(dashboard, dir, 's1-sessao')
}

/** Janela da campanha (separada do price check), como ao entrar em The Galai Gates. Não usa a trade. */
async function captureCampaign(dir: string): Promise<void> {
  const campaign = createCampaignWindow()
  await new Promise<void>((resolve) => campaign.webContents.once('did-finish-load', () => resolve()))
  await wait(1000)
  campaign.webContents.send(EVENTS.campaign, {
    area: 'The Galai Gates',
    zone: zoneGuide('The Galai Gates'),
    act: { kind: 'interlude', number: 2 },
    areaLevel: 64,
    charLevel: 62,
    gap: { diff: -2, direction: 'under', safeZone: 5, status: 'ok', xpMultiplier: 1 },
  })
  showCampaignWindow(campaign)
  await wait(800)
  await Promise.race([shot(campaign, dir, 'o5-campanha-area'), wait(10_000)])
  campaign.destroy()
}

/** Resultado de exemplo da sobreposição (sem rede): anel raro com tiers e anúncios. */
function sampleTradeResult(): PriceCheckResult {
  const tiers = (top: number, step: number): TierOption[] =>
    [1, 2, 3, 4, 5].map((tier) => ({ tier, affix: `T${tier}`, itemLevel: 80 - tier * 8, ranges: [[top - tier * step, top - (tier - 1) * step - 1]], min: top - tier * step, strictMin: top - tier * step }))
  const filter = (f: Partial<StatFilter> & Pick<StatFilter, 'statId' | 'modText'>): StatFilter => ({
    statText: f.modText,
    kind: 'explicit',
    affix: null,
    tier: null,
    value: null,
    min: null,
    max: null,
    enabled: true,
    ...f,
  })
  const listing = (i: number, divine: number, seller: string): PricedListing => ({
    id: `l${i}`,
    amount: Math.round(divine * 660),
    currency: 'exalted',
    seller,
    indexedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    iconUrl: null,
    itemLevel: 80,
    divine,
  })
  return {
    kind: 'trade',
    item: { name: 'Gale Coil', baseLine: 'Sapphire Ring', baseType: 'Sapphire Ring', rarity: 'Rare', itemClass: 'Rings', itemLevel: 81, corrupted: false, stackSize: null },
    league: 'Forbidden Rites',
    filters: [
      filter({ statId: 'pseudo.pseudo_total_elemental_resistance', modText: '+74% total Elemental Resistance', kind: 'pseudo', value: 74, min: 66 }),
      filter({ statId: 'explicit.stat_fire', modText: '+32% to Fire Resistance', affix: 'suffix', tier: 2, value: 32, min: 28, group: 'pseudo.pseudo_total_elemental_resistance', tiers: tiers(46, 5), rolledTier: 2 }),
      filter({ statId: 'explicit.stat_light', modText: '+19% to Lightning Resistance', affix: 'suffix', tier: 6, value: 19, min: 17, group: 'pseudo.pseudo_total_elemental_resistance', tiers: tiers(46, 5), rolledTier: 6 }),
      filter({ statId: 'explicit.stat_life', modText: '+78 to maximum Life', affix: 'prefix', tier: 3, value: 78, min: 70, tiers: tiers(110, 12), rolledTier: 1 }),
      filter({ statId: 'explicit.stat_mana', modText: '+41 to maximum Mana', affix: 'prefix', tier: 5, value: 41, min: null, enabled: false, tiers: tiers(80, 9), rolledTier: 4 }),
      filter({ statId: 'implicit.stat_cold', modText: '+23% to Cold Resistance', kind: 'implicit', value: 23, enabled: false }),
    ],
    siteFilters: {},
    status: 'securable',
    unmatched: [],
    queryId: 'exemplo',
    total: 37,
    listings: [listing(1, 0.42, 'Sombra_Azul'), listing(2, 0.45, 'xXRangerXx'), listing(3, 0.5, 'TradeGoblin'), listing(4, 0.61, 'Wraeclast_BR'), listing(5, 0.75, 'MapDevice')],
    cheapestDivine: 0.42,
    medianDivine: 0.5,
    rates: { exaltedPerDivine: 660, chaosPerDivine: 11.4 },
  }
}

/**
 * Telas que a auditoria não cobre, sem buscar na trade: Buscar preço (só o formulário),
 * Campanha, Builds, Configurações, detalhe do mercado e a sobreposição com um resultado de exemplo.
 */
async function captureUi(dashboard: BrowserWindow, dir: string, click: (js: string) => Promise<unknown>, getOverlay: () => BrowserWindow | null): Promise<void> {
  const nav = async (re: string) => {
    await click(`[...document.querySelectorAll('.nav button')].find((b) => new RegExp(${JSON.stringify(re)}).test(b.textContent ?? ''))?.click()`)
    await wait(1500)
  }
  await nav('Mercado|Market')
  await shot(dashboard, dir, 'ui-1-mercado')
  await click(`document.querySelector('tbody tr:nth-child(2)')?.click()`)
  await wait(2500)
  await shot(dashboard, dir, 'ui-2-detalhe')
  dashboard.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  await wait(400)
  await nav('Oportunidades|Opportunities')
  await shot(dashboard, dir, 'ui-3-oportunidades')
  await nav('Buscar|Price')
  await wait(1500)
  await click(`document.getElementById('search-item')?.focus()`)
  dashboard.webContents.insertText('Sapphire Ring')
  await wait(600)
  await click(`document.querySelector('.suggest-list li')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await wait(500)
  await click(`document.querySelectorAll('.filter-section > summary')[0]?.click()`)
  await wait(300)
  await shot(dashboard, dir, 'ui-4-buscar')
  await click(`document.querySelector('.filter-section')?.scrollIntoView({ block: 'start' })`)
  await wait(300)
  await shot(dashboard, dir, 'ui-4b-buscar-filtros')
  await nav('Campanha|Campaign')
  await shot(dashboard, dir, 'ui-5-campanha')
  await nav('Builds')
  await shot(dashboard, dir, 'ui-6-builds')
  await nav('Configura|Settings')
  await shot(dashboard, dir, 'ui-7-config')

  const overlay = getOverlay()
  if (overlay) {
    const event = { state: 'done', text: SAMPLE_ITEM, result: sampleTradeResult() }
    overlay.webContents.send(EVENTS.overlay, event)
    overlay.showInactive()
    await wait(1200)
    await Promise.race([shot(overlay, dir, 'ui-8-sobreposicao'), wait(10_000)])
    await overlay.webContents.executeJavaScript(`document.querySelector('.mod-expand')?.click()`)
    await overlay.webContents.executeJavaScript(`document.querySelector('.more-filters summary')?.click()`)
    await wait(1500)
    await overlay.webContents.executeJavaScript(`document.querySelector('.more-filters')?.scrollIntoView({ block: 'start' })`)
    await wait(300)
    await Promise.race([shot(overlay, dir, 'ui-8b-sobreposicao-filtros'), wait(10_000)])
  }
}

/**
 * Revisão visual: passa por todas as telas e conta imagens quebradas, ícones que caíram
 * nas iniciais de reserva e imagens que não terminaram de carregar. Tira foto de cada tela.
 */
async function auditVisuals(dashboard: BrowserWindow, dir: string, click: (js: string) => Promise<unknown>): Promise<void> {
  const report: Record<string, unknown> = {}
  // Força o carregamento das imagens "lazy" (fora da tela) e espera terminarem.
  const collect = async (name: string) => {
    await click(`document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager' })`)
    for (let i = 0; i < 20; i++) {
      const pending = Number(await click(`[...document.images].filter((i) => !i.complete).length`))
      if (pending === 0) break
      await wait(500)
    }
    const data = await click(`(() => {
      const imgs = [...document.images]
      const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(-60))
      const pending = imgs.filter((i) => !i.complete).length
      const fallbacks = [...document.querySelectorAll('.icon-fallback')].map((e) => e.closest('tr,li,.tick,.card')?.textContent?.trim().slice(0, 40) ?? '?')
      const dollText = [...document.querySelectorAll('.doll-slot:not(.empty) .doll-text')].map((e) => e.textContent)
      const gemDots = [...document.querySelectorAll('.gem-icon.gem-dot')].map((e) => e.parentElement?.textContent?.trim().slice(0, 40))
      const loading = document.querySelectorAll('.icon-loading').length
      return { images: imgs.length, broken, pending, fallbacks, dollText, gemDots, loading }
    })()`)
    report[name] = data
    await shot(dashboard, dir, `audit-${name}`)
  }
  const nav = async (re: string) => {
    await click(`[...document.querySelectorAll('.nav button')].find((b) => new RegExp(${JSON.stringify(re)}).test(b.textContent ?? ''))?.click()`)
    await wait(1500)
  }

  // Itens sem imagem no poe.ninja são completados pela trade em segundo plano.
  for (let i = 0; i < 90; i++) {
    const missing = Number(await click(`window.oraculo.getMarket().then((m) => (m.snapshot?.items ?? []).filter((x) => !x.iconUrl).length)`))
    if (i % 10 === 0) console.log('[audit] itens do mercado sem ícone:', missing)
    if (missing === 0) break
    await wait(1000)
  }
  await nav('Mercado|Market')
  const chips = Number(await click(`document.querySelectorAll('.chips .chip').length`))
  for (let i = 0; i < chips; i++) {
    const label = String(await click(`(() => { const c = document.querySelectorAll('.chips .chip')[${i}]; c?.click(); return (c?.textContent ?? '').replace(/\\d+/g, '').trim() })()`))
    await wait(700)
    await collect(`mercado-${i}-${label.replace(/[^\w]+/g, '_')}`)
  }
  for (const [re, name] of [
    ['Oportunidades|Opportunities', 'oportunidades'],
    ['Acompanhando|Watchlist', 'acompanhando'],
    ['Lista|List', 'lista'],
  ] as const) {
    await nav(re)
    await collect(name)
  }
  await nav('Farm')
  const farmTabs = Number(await click(`document.querySelectorAll('[role=tab]').length`))
  for (let i = 0; i < farmTabs; i++) {
    await click(`document.querySelectorAll('[role=tab]')[${i}]?.click()`)
    await wait(i === 0 ? 4000 : 1500)
    await collect(`farm-${i}`)
  }
  const link = process.env['ORACULO_CAPTURE_BUILD_LINK']
  if (link) {
    await click(`window.oraculo.importBuild(${JSON.stringify(link)}, 'mine')`)
    await nav('Builds')
    await click(`document.querySelectorAll('[role=tab]')[0]?.click()`)
    await wait(3000)
    await collect('builds-minha')
    // Dica da gema principal (passar o mouse).
    await click(`document.querySelector('.skill-group.main li')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
    await wait(600)
    await shot(dashboard, dir, 'audit-builds-gema')
    await click(`window.oraculo.clearBuild('mine')`)
  }
  await fs.writeFile(join(dir, 'audit.json'), JSON.stringify(report, null, 2))
  console.log('[audit] telas:', Object.keys(report).length)
}

export async function runCapture(
  dir: string,
  dashboard: BrowserWindow,
  getOverlay: () => BrowserWindow | null,
  priceCheck: (text: string) => Promise<void>,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  const click = (js: string) => dashboard.webContents.executeJavaScript(js)
  await wait(1500)
  // ORACULO_CAPTURE_ONLY=tier|build: só uma parte (foto rápida).
  const only = process.env['ORACULO_CAPTURE_ONLY']
  if (only === 'tier' || only === 'build' || only === 'audit' || only === 'overlay' || only === 'farm' || only === 'perf' || only === 'campaign' || only === 'ui' || only === 'regex' || only === 'session' || only === 'plan') {
    if (only === 'tier') await captureTierSearch(dashboard, dir, click)
    else if (only === 'ui') await captureUi(dashboard, dir, click, getOverlay)
    else if (only === 'overlay') await captureOverlay(dir, getOverlay, priceCheck)
    else if (only === 'farm') await captureFarm(dashboard, dir, click)
    else if (only === 'perf') await measurePerf(dashboard, dir, click)
    else if (only === 'campaign') await captureCampaign(dir)
    else if (only === 'regex') await captureRegex(dashboard, dir, click)
    else if (only === 'session') await captureSession(dashboard, dir, click)
    else if (only === 'audit') await auditVisuals(dashboard, dir, click)
    else await captureBuild(dashboard, dir, click, getOverlay, priceCheck)
    app.quit()
    return
  }
  await shot(dashboard, dir, '1-mercado')
  // Primeira linha (Mirror of Kalandra): confere o histórico e o painel lateral.
  await click(`document.querySelector('tbody tr:nth-child(1)')?.click()`)
  await wait(2500)
  await shot(dashboard, dir, '2-detalhe')
  await click(`document.querySelector('.more summary')?.click()`)
  await wait(300)
  await click(`document.querySelector('.drawer-body')?.scrollTo(0, 9999)`)
  await wait(300)
  await shot(dashboard, dir, '2b-detalhe-numeros')
  dashboard.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  await wait(400)
  await click(`[...document.querySelectorAll('.nav button')][1]?.click()`)
  await wait(800)
  await shot(dashboard, dir, '3-oportunidades')
  // Tela "Buscar preço": digita o item, escolhe a sugestão, adiciona vida total e busca.
  await click(`[...document.querySelectorAll('.nav button')][3]?.click()`)
  await wait(2500)
  await click(`document.getElementById('search-item')?.focus()`)
  dashboard.webContents.insertText('Sapphire Ring')
  await wait(600)
  await shot(dashboard, dir, '5-busca-sugestoes')
  await click(`document.querySelector('.suggest-list li')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await wait(300)
  // Adiciona "maximum Life" (explícito) pela busca de mods para mostrar os tiers da base.
  await click(`document.querySelector('.stat-group.primary input.input')?.focus()`)
  dashboard.webContents.insertText('to maximum Life')
  await wait(600)
  await click(`[...document.querySelectorAll('.suggest-list li')].find((li) => /^N to maximum Life$/.test(li.firstChild?.textContent ?? ''))?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  await wait(4000)
  await shot(dashboard, dir, '5b-busca-tiers')
  await click(`document.querySelector('.form-card button[type=submit]')?.click()`)
  await wait(6000)
  await shot(dashboard, dir, '6-busca-resultado')
  await click(`document.querySelector('.filter-section summary')?.scrollIntoView({ block: 'start' })`)
  await wait(400)
  await shot(dashboard, dir, '6b-busca-filtros')

  const nav = (label: string) => click(`[...document.querySelectorAll('.nav button')].find((b) => (b.textContent ?? '').includes(${JSON.stringify(label)}))?.click()`)
  const tab = (label: string) => click(`[...document.querySelectorAll('[role=tab]')].find((b) => (b.textContent ?? '').includes(${JSON.stringify(label)}))?.click()`)
  await nav('Farm')
  await wait(5000)
  await shot(dashboard, dir, '7-farm-mecanica')
  // Espera os preços reais da trade (várias buscas, respeitando o limite da GGG).
  await wait(30000)
  await click(`document.querySelector('.setup-grid')?.scrollIntoView({ block: 'start' })`)
  await wait(400)
  await shot(dashboard, dir, '7b-farm-setups')
  await tab('Estratégias')
  await wait(800)
  await shot(dashboard, dir, '7c-farm-estrategias')
  await tab('Calculadora')
  await wait(800)
  await shot(dashboard, dir, '7d-farm-calculadora')
  await tab('Mercado de tablets')
  await wait(800)
  await shot(dashboard, dir, '7e-farm-tablets')
  await nav('Acompanhando')
  await wait(800)
  await shot(dashboard, dir, '8-acompanhando')
  await nav('Lista')
  await wait(800)
  await shot(dashboard, dir, '9-lista')
  await nav('Campanha')
  await wait(1500)
  await shot(dashboard, dir, '10-campanha')
  await nav('Configurações')
  await wait(800)
  await shot(dashboard, dir, '11-configuracoes')

  console.log('[capture] checando preço')
  await Promise.race([priceCheck(SAMPLE_ITEM), wait(30_000).then(() => console.log('[capture] priceCheck demorou demais'))])
  await wait(1000)
  const overlay = getOverlay()
  console.log('[capture] overlay visível?', overlay?.isVisible())
  if (overlay) {
    overlay.showInactive()
    await Promise.race([shot(overlay, dir, '4-sobreposicao'), wait(10_000).then(() => console.log('[capture] foto da sobreposição travou'))])
    await overlay.webContents.executeJavaScript(`document.querySelector('.more-filters summary')?.click()`)
    await wait(2500)
    await overlay.webContents.executeJavaScript(`document.querySelector('.more-filters')?.scrollIntoView({ block: 'start' })`)
    await wait(300)
    await Promise.race([shot(overlay, dir, '4b-sobreposicao-filtros'), wait(10_000)])
  }
  app.quit()
}
