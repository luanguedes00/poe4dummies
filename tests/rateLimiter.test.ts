import { describe, expect, it } from 'vitest'
import { parseRules, parseState, PolicyState, RateLimiter, type Clock, type HeaderReader } from '../src/core/http/rateLimiter'

function headers(map: Record<string, string>): HeaderReader {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name) => lower[name.toLowerCase()] ?? null }
}

class FakeClock implements Clock {
  t = 1_000_000
  slept: number[] = []
  now = () => this.t
  sleep = async (ms: number) => {
    this.slept.push(ms)
    this.t += ms
  }
}

const GGG = {
  'X-Rate-Limit-Rules': 'Ip',
  'X-Rate-Limit-Ip': '5:10:60,15:60:300',
  'X-Rate-Limit-Ip-State': '1:10:0,1:60:0',
}

describe('cabeçalhos', () => {
  it('lê regras e estado', () => {
    expect(parseRules('5:10:60,15:60:300')).toEqual([
      { max: 5, periodSec: 10, penaltySec: 60 },
      { max: 15, periodSec: 60, penaltySec: 300 },
    ])
    expect(parseState('2:10:0,3:60:120')[1]).toEqual({ hits: 3, periodSec: 60, activePenaltySec: 120 })
    expect(parseRules('lixo,1:2')).toEqual([])
  })
})

describe('PolicyState', () => {
  it('espera quando a janela enche', () => {
    const p = new PolicyState()
    const now = 0
    p.update(headers(GGG), 200, now)
    for (let i = 0; i < 5; i++) p.record(now + i)
    expect(p.delayMs(now + 5)).toBeGreaterThan(9_000)
    expect(p.delayMs(now + 11_000)).toBe(0)
  })

  it('contagem alta numa janela longa não bloqueia as janelas curtas (caso real)', () => {
    // Cabeçalhos reais de 29/09/2026: 65 buscas em 6 h, bem abaixo de 600.
    const p = new PolicyState()
    p.record(0)
    p.update(
      headers({
        'X-Rate-Limit-Rules': 'Ip',
        'X-Rate-Limit-Ip': '5:10:60,15:60:300,30:300:1800,600:21600:3600',
        'X-Rate-Limit-Ip-State': '1:10:0,1:60:0,2:300:0,65:21600:0',
      }),
      200,
      0,
    )
    expect(p.delayMs(10)).toBe(0)
  })

  it('espera quando o servidor diz que a janela está cheia', () => {
    const p = new PolicyState()
    p.update(headers({ ...GGG, 'X-Rate-Limit-Ip-State': '5:10:0,5:60:0' }), 200, 0)
    expect(p.delayMs(0)).toBeGreaterThan(9_000)
    expect(p.delayMs(10_500)).toBe(0)
  })

  it('respeita penalidade ativa e 429', () => {
    const p = new PolicyState()
    p.update(headers({ ...GGG, 'X-Rate-Limit-Ip-State': '6:10:60' }), 200, 0)
    expect(p.delayMs(0)).toBe(60_000)
    const q = new PolicyState()
    q.update(headers({ 'Retry-After': '30' }), 429, 0)
    expect(q.delayMs(0)).toBe(30_000)
    expect(q.blockedFor(10_000)).toBe(20)
  })
})

describe('RateLimiter', () => {
  it('nunca passa de 5 buscas em 10 segundos', async () => {
    const clock = new FakeClock()
    const limiter = new RateLimiter(clock)
    const sentAt: number[] = []
    const task = async () => {
      sentAt.push(clock.t)
      return { status: 200, headers: headers(GGG) }
    }
    await Promise.all(Array.from({ length: 12 }, () => limiter.run('search', task)))
    expect(sentAt).toHaveLength(12)
    for (let i = 0; i < sentAt.length; i++) {
      const inWindow = sentAt.filter((t) => t > sentAt[i]! - 10_000 && t <= sentAt[i]!)
      expect(inWindow.length).toBeLessThanOrEqual(5)
    }
  })

  it('tarefa de fundo espera o usuário e deixa folga no limite', async () => {
    const clock = new FakeClock()
    const limiter = new RateLimiter(clock)
    const order: string[] = []
    const task = (name: string) => async () => {
      order.push(name)
      return { status: 200, headers: headers(GGG) }
    }
    // Aprende o limite (5 em 10 s) e usa 3 das 5 vagas.
    for (let i = 0; i < 3; i++) await limiter.run('search', task(`u${i}`))
    const background = limiter.runBackground('search', task('icone'))
    const user = limiter.run('search', task('price-check'))
    await Promise.all([background, user])
    // O price check sai primeiro; o ícone só depois que a janela abre folga de novo.
    expect(order).toEqual(['u0', 'u1', 'u2', 'price-check', 'icone'])
    expect(clock.slept.some((ms) => ms >= 1000)).toBe(true)
  })

  it('429 em uma política bloqueia todas (o bloqueio da GGG é por IP)', async () => {
    const clock = new FakeClock()
    const limiter = new RateLimiter(clock)
    await limiter.run('search', async () => ({ status: 200, headers: headers({}) }))
    await limiter.run('data', async () => ({ status: 429, headers: headers({ 'Retry-After': '69' }) }))
    expect(limiter.policy('search').blockedFor(clock.now())).toBe(69)
    // Política criada depois também herda o bloqueio.
    expect(limiter.policy('fetch').blockedFor(clock.now())).toBe(69)
  })

  it('libera a fila mesmo quando a requisição falha', async () => {
    const limiter = new RateLimiter(new FakeClock())
    await expect(limiter.run('x', async () => Promise.reject(new Error('rede')))).rejects.toThrow('rede')
    const ok = await limiter.run('x', async () => ({ status: 200, headers: headers({}) }))
    expect(ok.status).toBe(200)
  })
})

describe('bloqueio longo', () => {
  it('requisição do usuário não fica girando: avisa na hora quanto falta', async () => {
    const clock = new FakeClock()
    const limiter = new RateLimiter(clock)
    await limiter.run('search', async () => ({ status: 429, headers: headers({ 'Retry-After': '60' }) }))
    await expect(limiter.run('search', async () => ({ status: 200, headers: headers({}) }))).rejects.toMatchObject({ retryAfterSec: 60 })
    expect(clock.slept).toEqual([])
  })
})
