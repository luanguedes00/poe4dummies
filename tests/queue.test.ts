import { describe, expect, it, vi } from 'vitest'
import { PriceQueue, type QueueProgress } from '../src/core/collection/queue'
import type { Clock } from '../src/core/http/rateLimiter'
import type { PriceCheckResult } from '../src/core/pricecheck'

class FakeClock implements Clock {
  t = 1_000_000
  slept: number[] = []
  now = () => this.t
  sleep = async (ms: number) => {
    this.slept.push(ms)
    this.t += ms
  }
}

const ERROR = (code: 'rate-limited' | 'network' | 'not-an-item', retryAfterSec: number | null = null): PriceCheckResult => ({
  kind: 'error',
  code,
  retryAfterSec,
})

/** Resultado "ok" qualquer, marcado pelo texto para conferir a ordem. */
function ok(text: string): PriceCheckResult {
  return { kind: 'error', code: 'unknown-base-type', retryAfterSec: text.length }
}

function setup(script: (text: string, call: number) => PriceCheckResult = ok, msPerJob = 2000) {
  const clock = new FakeClock()
  const calls: string[] = []
  const progress: QueueProgress[] = []
  const started: string[] = []
  const price = vi.fn(async (text: string) => {
    calls.push(text)
    await Promise.resolve()
    clock.t += msPerJob
    return script(text, calls.filter((c) => c === text).length)
  })
  const queue = new PriceQueue({ price, clock, onProgress: (p) => progress.push(p), onStart: (k) => started.push(k) })
  return { clock, calls, progress, started, price, queue }
}

describe('PriceQueue', () => {
  it('processa um por vez, na ordem, e a checagem unitária fura a fila', async () => {
    const { queue, calls, started } = setup()
    const a = queue.enqueue({ key: 'a', text: 'A' })
    void queue.enqueue({ key: 'b', text: 'B' })
    void queue.enqueue({ key: 'c', text: 'C' })
    void queue.enqueue({ key: 'h', text: 'H', priority: 'high' })
    await queue.idle()
    expect(calls).toEqual(['A', 'H', 'B', 'C'])
    expect(started).toEqual(['a', 'h', 'b', 'c'])
    expect(await a).toEqual({ status: 'done', result: ok('A') })
  })

  it('limite da GGG (429): volta para a fila, espera o Retry-After e não vira erro', async () => {
    const { queue, clock, calls } = setup((text, n) => (text === 'A' && n === 1 ? ERROR('rate-limited', 30) : ok(text)))
    const a = queue.enqueue({ key: 'a', text: 'A' })
    const b = queue.enqueue({ key: 'b', text: 'B' })
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toEqual({ status: 'done', result: ok('A') })
    expect(rb).toEqual({ status: 'done', result: ok('B') })
    // "A" volta para a frente: ordem A (429), A, B.
    expect(calls).toEqual(['A', 'A', 'B'])
    expect(clock.slept.some((ms) => ms >= 30_000)).toBe(true)
  })

  it('429 repetido nunca descarta o item', async () => {
    const { queue, calls } = setup((text, n) => (n <= 5 ? ERROR('rate-limited', null) : ok(text)))
    const r = await queue.enqueue({ key: 'a', text: 'A' })
    expect(r.status).toBe('done')
    expect(calls).toHaveLength(6)
  })

  it('falha de rede tenta de novo com espera e desiste depois de 3 tentativas', async () => {
    const flaky = setup((text, n) => (n <= 2 ? ERROR('network') : ok(text)))
    expect(await flaky.queue.enqueue({ key: 'a', text: 'A' })).toEqual({ status: 'done', result: ok('A') })
    expect(flaky.clock.slept).toEqual([2000, 4000])

    const down = setup(() => ERROR('network'))
    expect(await down.queue.enqueue({ key: 'a', text: 'A' })).toEqual({ status: 'done', result: ERROR('network') })
    expect(down.calls).toHaveLength(4)
  })

  it('erro definitivo (ex.: texto inválido) não é repetido', async () => {
    const { queue, calls } = setup(() => ERROR('not-an-item'))
    expect(await queue.enqueue({ key: 'a', text: 'A' })).toEqual({ status: 'done', result: ERROR('not-an-item') })
    expect(calls).toHaveLength(1)
  })

  it('une pedidos com a mesma chave e promove para alta prioridade', async () => {
    const { queue, calls } = setup()
    void queue.enqueue({ key: 'a', text: 'A' })
    const b1 = queue.enqueue({ key: 'b', text: 'B' })
    void queue.enqueue({ key: 'c', text: 'C' })
    const b2 = queue.enqueue({ key: 'b', text: 'B', priority: 'high' })
    await queue.idle()
    expect(calls).toEqual(['A', 'B', 'C'])
    expect(await b1).toEqual(await b2)
  })

  it('cancela itens pendentes e ignora o resultado do que já estava rodando', async () => {
    const { queue, calls } = setup()
    const a = queue.enqueue({ key: 'a', text: 'A' })
    const b = queue.enqueue({ key: 'b', text: 'B' })
    const c = queue.enqueue({ key: 'c', text: 'C' })
    expect(queue.cancel('b')).toBe(true)
    expect(queue.cancel('a')).toBe(true) // em andamento
    expect(queue.cancel('x')).toBe(false)
    expect(await a).toEqual({ status: 'cancelled' })
    expect(await b).toEqual({ status: 'cancelled' })
    expect((await c).status).toBe('done')
    expect(calls).toEqual(['A', 'C'])
  })

  it('cancelAll por prioridade preserva as checagens unitárias', async () => {
    const { queue, calls } = setup()
    void queue.enqueue({ key: 'a', text: 'A' })
    void queue.enqueue({ key: 'b', text: 'B' })
    const h = queue.enqueue({ key: 'h', text: 'H', priority: 'high' })
    expect(queue.cancelAll('low')).toBe(2)
    expect((await h).status).toBe('done')
    await queue.idle()
    expect(calls).toEqual(['A', 'H'])
  })

  it('informa posições, pendentes e tempo estimado', async () => {
    const { queue, progress } = setup()
    for (const k of ['a', 'b', 'c', 'd']) void queue.enqueue({ key: k, text: k.toUpperCase() })
    expect(Object.fromEntries(queue.positions())).toEqual({ a: 0, b: 1, c: 2, d: 3 })
    const p = queue.progress()
    expect(p.pending).toBe(4)
    // ~2 s por item: o atual + 3 na fila.
    expect(p.etaSeconds).toBe(8)
    await queue.idle()
    expect(progress.at(-1)).toEqual({ pending: 0, etaSeconds: 0, blockedSeconds: 0 })
  })

  it('o ETA inclui a espera do bloqueio e aprende com a duração real', async () => {
    const { queue, progress } = setup((text, n) => (text === 'A' && n === 1 ? ERROR('rate-limited', 60) : ok(text)), 10_000)
    void queue.enqueue({ key: 'a', text: 'A' })
    void queue.enqueue({ key: 'b', text: 'B' })
    await queue.idle()
    expect(progress.some((p) => p.blockedSeconds >= 60 && p.etaSeconds >= 60 && p.pending === 2)).toBe(true)
    void queue.enqueue({ key: 'c', text: 'C' })
    void queue.enqueue({ key: 'd', text: 'D' })
    // A média móvel subiu de 2 s para perto dos 10 s reais.
    expect(queue.progress().etaSeconds).toBeGreaterThan(8)
    await queue.idle()
  })

  it('trabalho com execução própria (checagem unitária com filtros ajustados)', async () => {
    const { queue, price } = setup()
    const custom = vi.fn(async () => ok('custom'))
    const r = await queue.enqueue({ key: 'u1', text: 'X', priority: 'high', run: custom })
    expect(r).toEqual({ status: 'done', result: ok('custom') })
    expect(custom).toHaveBeenCalledTimes(1)
    expect(price).not.toHaveBeenCalled()
  })

  it('depois de encerrada, não aceita novos itens', async () => {
    const { queue, price } = setup()
    queue.dispose()
    expect(await queue.enqueue({ key: 'a', text: 'A' })).toEqual({ status: 'cancelled' })
    expect(price).not.toHaveBeenCalled()
  })
})

describe('checagem do usuário com a trade bloqueada', () => {
  it('responde na hora "espere X s" em vez de girar', async () => {
    const clock = new FakeClock()
    let calls = 0
    const queue = new PriceQueue({
      clock,
      price: async () => {
        calls++
        return { kind: 'error', code: 'rate-limited', retryAfterSec: 60 }
      },
    })
    const first = await queue.enqueue({ key: 'a', text: 'x', priority: 'high' })
    expect(first).toMatchObject({ status: 'done', result: { kind: 'error', code: 'rate-limited', retryAfterSec: 60 } })
    // Segunda checagem durante o bloqueio: nem chama a trade.
    const second = await queue.enqueue({ key: 'b', text: 'y', priority: 'high' })
    expect(second).toMatchObject({ status: 'done', result: { code: 'rate-limited' } })
    expect(calls).toBe(1)
    queue.dispose()
  })
})
