// Modo lista (coleta) no processo principal: guarda a lista, a fila de
// checagens e o cache de preços. Não conhece janelas: avisa por callbacks.
// (Copiar para src/main/collectionService.ts.)

import {
  acknowledgeChanges,
  addItem,
  applyResult,
  clearCollection,
  collectionView,
  emptyCollection,
  findStackItem,
  markSearching,
  refreshStackPrices,
  removeEntry,
  type AddOutcome,
  type CollectionEntry,
  type CollectionState,
  type CollectionView,
} from '../core/collection/collection'
import { PriceCache, type PriceCacheJSON, type RareKeyContext } from '../core/collection/priceCache'
import { PriceQueue } from '../core/collection/queue'
import { parseItemText } from '../core/item/parser'
import type { PriceCheckResult } from '../core/pricecheck'
import type { DisplayCurrency, MarketSnapshot } from '../core/types'
import type { DiskCache } from './diskCache'

/** O que o serviço usa do MarketService (acoplamento mínimo). */
export interface CollectionMarket {
  getState(): { league: string | null; snapshot: MarketSnapshot | null }
  priceCheck(text: string): Promise<PriceCheckResult>
  /** Só o que já está em memória, sem rede: a estimativa precisa ser instantânea. */
  rareKeyContextCached(): RareKeyContext | null
  searchCooldown(): number
}

export interface CollectionEvents {
  /** Estado novo para as janelas (agrupado: no máximo um envio a cada 150 ms). */
  view(view: CollectionView): void
  /** Item entrou na lista (aviso "+1 item · total"). */
  added(entry: CollectionEntry, merged: boolean, view: CollectionView): void
  /** Confirmações fora da margem (notificação discreta). */
  changed(entries: CollectionEntry[]): void
}

const EMIT_MS = 150
const TICK_MS = 1000
const SAVE_MS = 5000

export class CollectionService {
  private state: CollectionState = emptyCollection()
  private enabled = false
  private cache = new PriceCache()
  private readonly queue: PriceQueue
  private emitTimer: NodeJS.Timeout | null = null
  private tickTimer: NodeJS.Timeout | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private unitSeq = 0
  private lastClipboardKey: string | null = null

  constructor(
    private readonly market: CollectionMarket,
    private readonly disk: DiskCache<PriceCacheJSON>,
    private readonly unit: () => DisplayCurrency,
    private readonly events: CollectionEvents,
  ) {
    this.queue = new PriceQueue({
      price: (text) => market.priceCheck(text),
      cooldownSeconds: () => market.searchCooldown(),
      onStart: (key) => {
        this.state = markSearching(this.state, key)
        this.emit()
      },
      onProgress: () => this.emit(),
    })
  }

  /** Lê o cache de preços do disco (chamar uma vez ao abrir o app). */
  async load(): Promise<void> {
    const raw = await this.disk.read()
    if (raw) this.cache = PriceCache.fromJSON(raw)
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): CollectionView {
    this.enabled = enabled
    this.emit()
    return this.view()
  }

  view(): CollectionView {
    return collectionView(this.state, {
      enabled: this.enabled,
      unit: this.unit(),
      rates: this.market.getState().snapshot?.rates ?? null,
      progress: this.queue.progress(),
      positions: this.queue.positions(),
    })
  }

  /** Item copiado com o modo lista ligado (ou colado no painel). Síncrono: não espera rede. */
  add(text: string): AddOutcome {
    const { league, snapshot } = this.market.getState()
    const out = addItem(this.state, text, {
      snapshot: snapshot && snapshot.league === league ? snapshot : null,
      cache: this.cache,
      league,
      now: Date.now(),
      rareKey: this.market.rareKeyContextCached(),
    })
    if (!out.ok) return out
    this.state = out.state
    if (out.search) void this.confirm(out.search.key, out.search.text)
    this.events.added(out.entry, out.merged, this.view())
    this.emit()
    return out
  }

  private async confirm(key: string, text: string): Promise<void> {
    const outcome = await this.queue.enqueue({ key, text })
    if (outcome.status !== 'done') return
    const { state, changed } = applyResult(this.state, key, outcome.result, { cache: this.cache })
    this.state = state
    if (changed.length > 0) this.events.changed(changed)
    this.scheduleSave()
    this.emit()
  }

  remove(id: string): CollectionView {
    const { state, cancelKey } = removeEntry(this.state, id)
    this.state = state
    if (cancelKey) this.queue.cancel(cancelKey)
    this.emit()
    return this.view()
  }

  clear(): CollectionView {
    const { state, cancelKeys } = clearCollection(this.state)
    this.state = state
    for (const key of cancelKeys) this.queue.cancel(key)
    this.emit()
    return this.view()
  }

  acknowledge(id?: string): CollectionView {
    this.state = acknowledgeChanges(this.state, id)
    this.emit()
    return this.view()
  }

  /** Preços novos do poe.ninja: atualiza as pilhas. */
  onSnapshot(snapshot: MarketSnapshot): void {
    this.state = refreshStackPrices(this.state, snapshot)
    this.emit()
  }

  /**
   * Checagem unitária (sobreposição). Itens do poe.ninja respondem na hora,
   * sem fila; os demais furam a fila da lista. Com `replacePrevious` (Ctrl+C),
   * um item novo cancela o anterior ainda pendente, e o cancelado devolve null.
   */
  async priorityCheck(
    text: string,
    run: () => Promise<PriceCheckResult>,
    replacePrevious = false,
  ): Promise<PriceCheckResult | null> {
    if (this.isInstant(text)) return run()
    const key = `unit|${++this.unitSeq}`
    if (replacePrevious) {
      if (this.lastClipboardKey) this.queue.cancel(this.lastClipboardKey)
      this.lastClipboardKey = key
    }
    const outcome = await this.queue.enqueue({ key, text, priority: 'high', run })
    if (this.lastClipboardKey === key) this.lastClipboardKey = null
    return outcome.status === 'done' ? outcome.result : null
  }

  private isInstant(text: string): boolean {
    const snapshot = this.market.getState().snapshot
    if (!snapshot) return false
    try {
      return findStackItem(parseItemText(text), snapshot) !== null
    } catch {
      // Texto inválido: o priceCheck responde o erro na hora, sem rede.
      return true
    }
  }

  /** Grava o cache agora (ao fechar o app). */
  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    await this.disk.write(this.cache.toJSON())
  }

  dispose(): void {
    this.queue.dispose()
    for (const timer of [this.emitTimer, this.tickTimer, this.saveTimer]) if (timer) clearTimeout(timer)
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.disk.write(this.cache.toJSON())
    }, SAVE_MS)
  }

  private emit(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      const view = this.view()
      this.events.view(view)
      // Com fila ativa, reenvia a cada segundo para o ETA andar na tela.
      if (view.progress.pending > 0 && !this.tickTimer) {
        this.tickTimer = setTimeout(() => {
          this.tickTimer = null
          this.emit()
        }, TICK_MS)
      }
    }, EMIT_MS)
  }
}
