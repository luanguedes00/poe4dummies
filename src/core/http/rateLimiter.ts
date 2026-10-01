// Respeita os limites informados pela GGG nos cabeçalhos X-Rate-Limit-*.
// Estourar o limite gera bloqueio temporário do IP do usuário, então as
// requisições de cada política são feitas uma de cada vez e esperam o que
// for preciso antes de sair.
//
// Formato dos cabeçalhos (exemplo real):
//   X-Rate-Limit-Rules: Ip
//   X-Rate-Limit-Ip: 5:10:60,15:60:300,30:300:1800
//   X-Rate-Limit-Ip-State: 1:10:0,1:60:0,1:300:0
// Cada item é "máximo:janela(s):penalidade(s)"; no estado, "usadas:janela:penalidade ativa".

export interface RateRule {
  max: number
  periodSec: number
  penaltySec: number
}

export interface HeaderReader {
  get(name: string): string | null
}

export interface LimitedResponse {
  status: number
  headers: HeaderReader
}

function parseTriples(header: string | null): Array<[number, number, number]> {
  if (!header) return []
  const out: Array<[number, number, number]> = []
  for (const part of header.split(',')) {
    const nums = part.trim().split(':').map(Number)
    if (nums.length === 3 && nums.every((n) => Number.isFinite(n) && n >= 0)) {
      out.push([nums[0]!, nums[1]!, nums[2]!])
    }
  }
  return out
}

export function parseRules(header: string | null): RateRule[] {
  return parseTriples(header).map(([max, periodSec, penaltySec]) => ({ max, periodSec, penaltySec }))
}

export interface RuleState {
  hits: number
  periodSec: number
  activePenaltySec: number
}

export function parseState(header: string | null): RuleState[] {
  return parseTriples(header).map(([hits, periodSec, activePenaltySec]) => ({ hits, periodSec, activePenaltySec }))
}

/** Pequena folga para diferenças de relógio entre o PC e o servidor. */
const SAFETY_MS = 250

export class PolicyState {
  private rules: RateRule[] = []
  private history: number[] = []
  private blockedUntil = 0
  /** Última contagem informada pelo servidor, por janela (segundos). */
  private readonly serverHits = new Map<number, { hits: number; at: number }>()
  tail: Promise<void> = Promise.resolve()

  /** Quanto esperar (ms) antes de poder enviar a próxima requisição. */
  delayMs(now: number): number {
    let wait = Math.max(0, this.blockedUntil - now)
    for (const rule of this.rules) {
      if (rule.max <= 0) continue
      const windowMs = rule.periodSec * 1000
      const inWindow = this.history.filter((t) => t > now - windowMs)
      if (inWindow.length >= rule.max) {
        const oldestThatMustExpire = inWindow[inWindow.length - rule.max]!
        wait = Math.max(wait, oldestThatMustExpire + windowMs - now + SAFETY_MS)
      }
      // O servidor pode ter contado mais (outro programa no mesmo IP). Cada
      // janela usa só a própria contagem; não sabemos quando cada requisição
      // dele expira, então esperamos a janela inteira a partir do relato.
      const server = this.serverHits.get(rule.periodSec)
      if (server && now - server.at < windowMs && server.hits >= rule.max) {
        wait = Math.max(wait, server.at + windowMs - now + SAFETY_MS)
      }
    }
    return wait
  }

  /** Quantas requisições ainda cabem agora na janela mais apertada. */
  headroom(now: number): number {
    let room = Number.POSITIVE_INFINITY
    for (const rule of this.rules) {
      if (rule.max <= 0) continue
      const windowMs = rule.periodSec * 1000
      let used = this.history.filter((t) => t > now - windowMs).length
      const server = this.serverHits.get(rule.periodSec)
      if (server && now - server.at < windowMs) used = Math.max(used, server.hits)
      room = Math.min(room, rule.max - used)
    }
    return room
  }

  record(at: number): void {
    this.history.push(at)
    const longest = Math.max(60, ...this.rules.map((r) => r.periodSec)) * 1000
    this.history = this.history.filter((t) => t > at - longest)
  }

  update(headers: HeaderReader, status: number, now: number): void {
    const ruleNames = (headers.get('x-rate-limit-rules') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const rules: RateRule[] = []
    for (const name of ruleNames) {
      rules.push(...parseRules(headers.get(`x-rate-limit-${name}`)))
      for (const state of parseState(headers.get(`x-rate-limit-${name}-state`))) {
        if (state.activePenaltySec > 0) {
          this.blockedUntil = Math.max(this.blockedUntil, now + state.activePenaltySec * 1000)
        }
        this.serverHits.set(state.periodSec, { hits: state.hits, at: now })
      }
    }
    if (rules.length > 0) this.rules = rules

    if (status === 429) {
      const retryAfter = Number(headers.get('retry-after'))
      const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60
      this.blockedUntil = Math.max(this.blockedUntil, now + seconds * 1000)
    }
  }

  blockUntil(at: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, at)
  }

  /** Segundos até o fim de um bloqueio ativo (0 se não houver). */
  blockedFor(now: number): number {
    return Math.max(0, Math.ceil((this.blockedUntil - now) / 1000))
  }
}

export interface Clock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** Espera máxima em silêncio para uma requisição do usuário; acima disso, avisa na hora. */
const MAX_SILENT_WAIT_SEC = 5

/** A GGG bloqueou o IP por um tempo: quem chamou mostra "espere X s". */
export class RateLimitedError extends Error {
  override name = 'RateLimitedError'
  constructor(readonly retryAfterSec: number) {
    super(`rate-limited (${retryAfterSec}s)`)
  }
}

/** Vagas que as tarefas de fundo deixam livres para o usuário em cada janela. */
const BACKGROUND_HEADROOM = 2
const BACKGROUND_POLL_MS = 1000

export class RateLimiter {
  private readonly policies = new Map<string, PolicyState>()
  /** Requisições do usuário esperando ou em andamento, por política. */
  private readonly foreground = new Map<string, number>()
  /** Tarefas de fundo saem uma de cada vez, por política. */
  private readonly backgroundTail = new Map<string, Promise<void>>()

  constructor(private readonly clock: Clock = systemClock) {}

  policy(key: string): PolicyState {
    let policy = this.policies.get(key)
    if (!policy) {
      policy = new PolicyState()
      // Política nova herda um bloqueio já em curso.
      const now = this.clock.now()
      for (const other of this.policies.values()) policy.blockUntil(now + other.blockedFor(now) * 1000)
      this.policies.set(key, policy)
    }
    return policy
  }

  /** Executa `task` respeitando a política `key`. Requisições da mesma política saem em fila. */
  async run<R extends LimitedResponse>(key: string, task: () => Promise<R>): Promise<R> {
    // Bloqueio longo: responde na hora ("espere X s") em vez de deixar o botão girando em silêncio.
    const blocked = this.policy(key).blockedFor(this.clock.now())
    if (blocked > MAX_SILENT_WAIT_SEC) throw new RateLimitedError(blocked)
    this.foreground.set(key, (this.foreground.get(key) ?? 0) + 1)
    try {
      return await this.queued(key, task)
    } finally {
      this.foreground.set(key, (this.foreground.get(key) ?? 1) - 1)
    }
  }

  /**
   * Tarefa de fundo (ex.: buscar ícones): só sai quando nenhuma requisição do
   * usuário está esperando e ainda sobra folga no limite. Nunca atrasa um price check.
   */
  async runBackground<R extends LimitedResponse>(key: string, task: () => Promise<R>): Promise<R> {
    const previous = this.backgroundTail.get(key) ?? Promise.resolve()
    let release!: () => void
    this.backgroundTail.set(key, new Promise<void>((resolve) => (release = resolve)))
    try {
      await previous
      while (!this.idle(key)) await this.clock.sleep(BACKGROUND_POLL_MS)
      return await this.queued(key, task)
    } finally {
      release()
    }
  }

  private idle(key: string): boolean {
    const policy = this.policy(key)
    const now = this.clock.now()
    return (this.foreground.get(key) ?? 0) === 0 && policy.delayMs(now) === 0 && policy.headroom(now) >= BACKGROUND_HEADROOM
  }

  private async queued<R extends LimitedResponse>(key: string, task: () => Promise<R>): Promise<R> {
    const policy = this.policy(key)
    const previous = policy.tail
    let release!: () => void
    policy.tail = new Promise<void>((resolve) => (release = resolve))
    try {
      await previous
      const wait = policy.delayMs(this.clock.now())
      if (wait > 0) await this.clock.sleep(wait)
      policy.record(this.clock.now())
      const response = await task()
      const now = this.clock.now()
      policy.update(response.headers, response.status, now)
      // Bloqueio da GGG vale para o IP inteiro: todas as políticas esperam, não só a que levou o 429.
      if (response.status === 429) {
        const until = now + policy.blockedFor(now) * 1000
        for (const other of this.policies.values()) other.blockUntil(until)
      }
      return response
    } finally {
      release()
    }
  }
}
