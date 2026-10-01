// Armazenamento de tudo que o app baixa (ligas, stats e catálogo da trade,
// preços do poe.ninja...). Regra: disco primeiro, rede só quando precisa.
//   - dentro da validade: usa o que tem, sem requisição;
//   - vencido: devolve o antigo NA HORA e atualiza em segundo plano (uma requisição);
//   - falhou (bloqueio, sem internet): continua com o antigo e só tenta de novo depois de uma pausa.

import { join } from 'node:path'
import { ApiError } from '../core/http/client'
import { DiskCache } from './diskCache'

interface Entry<T> {
  value: T
  at: number
}

export interface StoreSpec<T> {
  /** Nome do arquivo (sem extensão); letras, números, ponto e hífen. */
  name: string
  /** Depois disso, atualiza em segundo plano (o antigo continua valendo). */
  ttlMs: number
  validate: (value: unknown) => value is T
  load: () => Promise<T>
}

/** Pausa depois de uma falha: bloqueio da GGG usa o tempo que ela pediu. */
function pauseAfter(error: unknown): number {
  if (error instanceof ApiError && error.code === 'rate-limited') return (error.retryAfterSec ?? 60) * 1000
  return 60_000
}

/**
 * Erro devolvido durante a pausa: o mesmo da falha original (sem internet continua
 * "sem internet"); só o bloqueio da GGG ganha o tempo que ainda falta.
 */
function pausedError(error: unknown, until: number): unknown {
  if (error instanceof ApiError && error.code === 'rate-limited') return new ApiError('rate-limited', 429, Math.ceil((until - Date.now()) / 1000))
  return error
}

export class DataStore {
  private readonly memory = new Map<string, Entry<unknown>>()
  /** Leitura do disco em andamento ou feita: chamadas simultâneas esperam a mesma (sem isso, a segunda ia à rede). */
  private readonly diskReads = new Map<string, Promise<Entry<unknown> | null>>()
  private readonly loading = new Map<string, Promise<unknown>>()
  private readonly paused = new Map<string, { until: number; error: unknown }>()

  constructor(private readonly dir: string) {}

  private disk<T>(spec: StoreSpec<T>): DiskCache<Entry<T>> {
    if (!/^[A-Za-z0-9.\-]+$/.test(spec.name)) throw new Error(`nome inválido: ${spec.name}`)
    return new DiskCache<Entry<T>>(join(this.dir, `${spec.name}.json`), Number.POSITIVE_INFINITY, (v): v is Entry<T> => {
      const e = v as Partial<Entry<unknown>> | null
      return typeof e === 'object' && e !== null && typeof e.at === 'number' && spec.validate(e.value)
    })
  }

  /** O que já está guardado (memória ou disco), sem rede. */
  async peek<T>(spec: StoreSpec<T>): Promise<Entry<T> | null> {
    const inMemory = this.memory.get(spec.name) as Entry<T> | undefined
    if (inMemory) return inMemory
    let reading = this.diskReads.get(spec.name) as Promise<Entry<T> | null> | undefined
    if (!reading) {
      reading = this.disk(spec)
        .read()
        .then((saved) => {
          // O que chegou da rede enquanto o disco era lido vale mais.
          if (saved && !this.memory.has(spec.name)) this.memory.set(spec.name, saved)
          return saved
        })
      this.diskReads.set(spec.name, reading)
    }
    await reading
    return (this.memory.get(spec.name) as Entry<T> | undefined) ?? null
  }

  async get<T>(spec: StoreSpec<T>): Promise<T> {
    const saved = await this.peek(spec)
    if (saved && Date.now() - saved.at < spec.ttlMs) return saved.value
    if (saved) {
      // Vencido: responde com o antigo e atualiza por trás.
      this.refresh(spec).catch(() => undefined)
      return saved.value
    }
    return this.refresh(spec)
  }

  /** Busca na rede agora (uma requisição por vez por nome; respeita a pausa após falha). */
  refresh<T>(spec: StoreSpec<T>): Promise<T> {
    const pending = this.loading.get(spec.name) as Promise<T> | undefined
    if (pending) return pending
    const paused = this.paused.get(spec.name)
    if (paused && paused.until > Date.now()) return Promise.reject(pausedError(paused.error, paused.until))
    const run = spec
      .load()
      .then(async (value) => {
        const entry = { value, at: Date.now() }
        this.memory.set(spec.name, entry)
        await this.disk(spec).write(entry)
        return value
      })
      .catch((error: unknown) => {
        this.paused.set(spec.name, { until: Date.now() + pauseAfter(error), error })
        throw error
      })
      .finally(() => this.loading.delete(spec.name))
    this.loading.set(spec.name, run)
    return run
  }
}
