// Fila de checagens de preço na trade para o modo lista.
//
// Requisito do usuário: nunca "timeout"/erro por excesso de itens. A GGG
// limita as buscas por IP e estourar dá bloqueio temporário, então:
// - uma checagem por vez (o RateLimiter do cliente já espera o necessário);
// - nada é descartado: limite atingido (429) devolve o item para a frente da
//   fila e espera o Retry-After; falhas de rede tentam de novo com espera;
// - prioridade 'high' (checagem unitária da sobreposição) passa na frente
//   de todos os itens 'low' (lista);
// - progresso com itens pendentes e estimativa de tempo.
//
// A função de precificação é injetada (no app: MarketService.priceCheck).

import type { Clock } from '../http/rateLimiter'
import { systemClock } from '../http/rateLimiter'
import type { PriceCheckResult } from '../pricecheck'

export type QueuePriority = 'high' | 'low'

/** Precificação padrão de um texto de item (no app: MarketService.priceCheck, sem ajustes). */
export type PriceFn = (text: string) => Promise<PriceCheckResult>

export interface QueueProgress {
  /** Itens aguardando + o que está em andamento. */
  pending: number
  /** Estimativa (s) para esvaziar a fila. */
  etaSeconds: number
  /** Espera imposta pelo servidor (s), já incluída no ETA. */
  blockedSeconds: number
}

export type QueueOutcome = { status: 'done'; result: PriceCheckResult } | { status: 'cancelled' }

export interface QueueJobInput {
  /** Identifica o trabalho; pedidos com a mesma chave pendente são unidos. */
  key: string
  text: string
  priority?: QueuePriority
  /**
   * Execução própria deste trabalho (ex.: checagem unitária com filtros
   * ajustados na sobreposição). Sem ela, usa price(text).
   */
  run?: () => Promise<PriceCheckResult>
}

export interface PriceQueueOptions {
  price: PriceFn
  clock?: Clock
  /** Estimativa inicial por item (s) antes de medir; 5 buscas / 10 s ≈ 2 s. */
  initialSecondsPerJob?: number
  /** Tentativas extras em falhas passageiras (rede, timeout, erro HTTP). */
  maxTransientRetries?: number
  /** Espera (s) quando o 429 vem sem Retry-After. */
  fallbackRetryAfterSec?: number
  /** Espera extra informada por fora (ex.: TradeClient.searchCooldown), só para o ETA. */
  cooldownSeconds?: () => number
  onProgress?: (progress: QueueProgress) => void
  /** Chamado quando um trabalho começa a rodar (a lista marca "buscando"). */
  onStart?: (key: string) => void
}

interface Job {
  key: string
  text: string
  run: (() => Promise<PriceCheckResult>) | undefined
  priority: QueuePriority
  transientAttempts: number
  /** Já resolvido (concluído ou cancelado). */
  settled: boolean
  resolvers: Array<(outcome: QueueOutcome) => void>
}

const TRANSIENT_CODES: ReadonlySet<string> = new Set(['network', 'timeout', 'http'])
const TRANSIENT_BASE_DELAY_MS = 2000

export class PriceQueue {
  private readonly high: Job[] = []
  private readonly low: Job[] = []
  private running: Job | null = null
  private runningSince = 0
  private blockedUntil = 0
  private avgJobMs: number
  private loop: Promise<void> | null = null
  private disposed = false
  private readonly clock: Clock
  private readonly maxTransientRetries: number
  private readonly fallbackRetryAfterSec: number

  constructor(private readonly options: PriceQueueOptions) {
    this.clock = options.clock ?? systemClock
    this.avgJobMs = (options.initialSecondsPerJob ?? 2) * 1000
    this.maxTransientRetries = options.maxTransientRetries ?? 3
    this.fallbackRetryAfterSec = options.fallbackRetryAfterSec ?? 10
  }

  /** Coloca um item na fila. A promessa nunca rejeita. */
  enqueue(input: QueueJobInput): Promise<QueueOutcome> {
    if (this.disposed) return Promise.resolve({ status: 'cancelled' })
    const priority = input.priority ?? 'low'
    // Checagem do usuário com a trade bloqueada: responde na hora quanto falta, sem girar.
    const blockedMs = this.blockedUntil - this.clock.now()
    if (priority === 'high' && blockedMs > 0) {
      return Promise.resolve({ status: 'done', result: { kind: 'error', code: 'rate-limited', retryAfterSec: Math.ceil(blockedMs / 1000) } })
    }
    return new Promise<QueueOutcome>((resolve) => {
      const existing = this.findPending(input.key)
      if (existing) {
        existing.resolvers.push(resolve)
        // Uma checagem unitária do mesmo item promove o trabalho da lista.
        if (priority === 'high' && existing.priority === 'low' && existing !== this.running) {
          this.low.splice(this.low.indexOf(existing), 1)
          existing.priority = 'high'
          this.high.push(existing)
        }
      } else {
        const job: Job = {
          key: input.key,
          text: input.text,
          run: input.run,
          priority,
          transientAttempts: 0,
          settled: false,
          resolvers: [resolve],
        }
        ;(priority === 'high' ? this.high : this.low).push(job)
      }
      this.emit()
      this.start()
    })
  }

  private findPending(key: string): Job | null {
    if (this.running && !this.running.settled && this.running.key === key) return this.running
    return this.high.find((j) => j.key === key) ?? this.low.find((j) => j.key === key) ?? null
  }

  has(key: string): boolean {
    return this.findPending(key) !== null
  }

  /** Cancela um trabalho (pendente ou em andamento; o resultado deste é ignorado). */
  cancel(key: string): boolean {
    const job = this.findPending(key)
    if (!job) return false
    this.finish(job, { status: 'cancelled' })
    this.emit()
    return true
  }

  /** Cancela todos os trabalhos (ou só os de uma prioridade). */
  cancelAll(priority?: QueuePriority): number {
    const jobs = [...this.high, ...this.low]
    if (this.running && !this.running.settled) jobs.push(this.running)
    let count = 0
    for (const job of jobs) {
      if (priority && job.priority !== priority) continue
      this.finish(job, { status: 'cancelled' })
      count++
    }
    if (count > 0) this.emit()
    return count
  }

  /** Encerra a fila (ao fechar o app). */
  dispose(): void {
    this.cancelAll()
    this.disposed = true
  }

  /** Posição de cada chave: 0 = em andamento, 1 = próxima... */
  positions(): Map<string, number> {
    const out = new Map<string, number>()
    if (this.running && !this.running.settled) out.set(this.running.key, 0)
    let n = 1
    for (const job of [...this.high, ...this.low]) out.set(job.key, n++)
    return out
  }

  progress(): QueueProgress {
    const now = this.clock.now()
    const waiting = this.high.length + this.low.length
    const running = this.running && !this.running.settled ? 1 : 0
    const external = this.options.cooldownSeconds?.() ?? 0
    const blockedMs = Math.max(0, this.blockedUntil - now, external * 1000)
    const runningLeft = running ? Math.max(0, this.avgJobMs - (now - this.runningSince)) : 0
    const pending = waiting + running
    const etaMs = pending === 0 ? 0 : blockedMs + runningLeft + waiting * this.avgJobMs
    return { pending, etaSeconds: Math.ceil(etaMs / 1000), blockedSeconds: Math.ceil(blockedMs / 1000) }
  }

  /** Resolve quando a fila esvaziar (útil em testes). */
  async idle(): Promise<void> {
    while (this.loop) await this.loop
  }

  private emit(): void {
    this.options.onProgress?.(this.progress())
  }

  private finish(job: Job, outcome: QueueOutcome): void {
    if (job.settled) return
    job.settled = true
    const high = this.high.indexOf(job)
    if (high >= 0) this.high.splice(high, 1)
    const low = this.low.indexOf(job)
    if (low >= 0) this.low.splice(low, 1)
    const resolvers = job.resolvers
    job.resolvers = []
    for (const resolve of resolvers) resolve(outcome)
  }

  private start(): void {
    if (this.loop || this.disposed) return
    this.loop = this.run().finally(() => {
      this.loop = null
      this.emit()
      // Pode ter chegado trabalho no último instante.
      if (this.high.length + this.low.length > 0) this.start()
    })
  }

  private async run(): Promise<void> {
    for (;;) {
      const wait = this.blockedUntil - this.clock.now()
      if (wait > 0) {
        // Checagens do usuário não esperam em silêncio: respondem "espere X s" na hora.
        for (const job of [...this.high]) {
          this.finish(job, { status: 'done', result: { kind: 'error', code: 'rate-limited', retryAfterSec: Math.ceil(wait / 1000) } })
        }
        this.emit()
        if (this.low.length === 0) return
        await this.clock.sleep(wait)
      }
      const job = this.high.shift() ?? this.low.shift()
      if (!job) return
      if (job.settled) continue

      this.running = job
      this.runningSince = this.clock.now()
      this.options.onStart?.(job.key)
      this.emit()

      let result: PriceCheckResult
      try {
        result = await (job.run ? job.run() : this.options.price(job.text))
      } catch {
        // A função do app não deveria lançar; se lançar, tratamos como falha passageira.
        result = { kind: 'error', code: 'network', retryAfterSec: null }
      }
      const elapsed = this.clock.now() - this.runningSince
      this.running = null
      if (job.settled) continue

      if (result.kind === 'error' && result.code === 'rate-limited') {
        const seconds = result.retryAfterSec && result.retryAfterSec > 0 ? result.retryAfterSec : this.fallbackRetryAfterSec
        this.blockedUntil = Math.max(this.blockedUntil, this.clock.now() + seconds * 1000)
        // Checagem do usuário (sobreposição): responde na hora "espere X s", sem girar em silêncio.
        if (job.priority === 'high') {
          this.finish(job, { status: 'done', result: { ...result, retryAfterSec: seconds } })
          this.emit()
          continue
        }
        // Modo lista: volta para a frente da fila e espera o que o servidor pediu.
        this.requeueFront(job)
        continue
      }
      if (result.kind === 'error' && TRANSIENT_CODES.has(result.code) && job.transientAttempts < this.maxTransientRetries) {
        job.transientAttempts++
        const delay = TRANSIENT_BASE_DELAY_MS * 2 ** (job.transientAttempts - 1)
        this.blockedUntil = Math.max(this.blockedUntil, this.clock.now() + delay)
        this.requeueFront(job)
        continue
      }

      // Média móvel do tempo real por item (inclui as esperas do rate limiter).
      this.avgJobMs = this.avgJobMs * 0.7 + elapsed * 0.3
      this.finish(job, { status: 'done', result })
      this.emit()
    }
  }

  private requeueFront(job: Job): void {
    ;(job.priority === 'high' ? this.high : this.low).unshift(job)
    this.emit()
  }
}
