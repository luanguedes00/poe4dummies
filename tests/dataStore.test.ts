import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../src/core/http/client'
import { DataStore } from '../src/main/dataStore'

const dirs: string[] = []
const newDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const isNums = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number')

describe('DataStore', () => {
  it('baixa uma vez; ao abrir de novo o app, lê do disco sem rede', async () => {
    const dir = newDir()
    let calls = 0
    const spec = { name: 'ligas', ttlMs: 60_000, validate: isNums, load: async () => [++calls] }
    expect(await new DataStore(dir).get(spec)).toEqual([1])
    // "Reabrir o app": outro DataStore, mesma pasta.
    expect(await new DataStore(dir).get(spec)).toEqual([1])
    expect(calls).toBe(1)
  })

  it('chamadas ao mesmo tempo viram uma requisição só', async () => {
    let calls = 0
    const spec = { name: 'x', ttlMs: 60_000, validate: isNums, load: async () => [++calls] }
    const store = new DataStore(newDir())
    await Promise.all([store.get(spec), store.get(spec), store.get(spec)])
    expect(calls).toBe(1)
  })

  it('vencido: responde o antigo na hora e atualiza por trás', async () => {
    const dir = newDir()
    let calls = 0
    const spec = { name: 'v', ttlMs: 0, validate: isNums, load: async () => [++calls] }
    await new DataStore(dir).get(spec)
    const store = new DataStore(dir)
    expect(await store.get(spec)).toEqual([1])
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toBe(2)
  })

  it('ao abrir, pedidos simultâneos esperam a mesma leitura do disco (sem ir à rede)', async () => {
    const dir = newDir()
    let calls = 0
    const spec = { name: 'frio', ttlMs: 60_000, validate: isNums, load: async () => [++calls] }
    await new DataStore(dir).get(spec)
    const store = new DataStore(dir)
    expect(await Promise.all([store.get(spec), store.get(spec), store.peek(spec)])).toEqual([[1], [1], expect.objectContaining({ value: [1] })])
    expect(calls).toBe(1)
  })

  it('durante a pausa devolve o erro original (sem internet não vira "limite da GGG")', async () => {
    const store = new DataStore(newDir())
    const spec = { name: 'off', ttlMs: 60_000, validate: isNums, load: async (): Promise<number[]> => { throw new ApiError('network') } }
    await expect(store.refresh(spec)).rejects.toMatchObject({ code: 'network' })
    await expect(store.refresh(spec)).rejects.toMatchObject({ code: 'network' })
    const limited = { ...spec, name: 'lim', load: async (): Promise<number[]> => { throw new ApiError('rate-limited', 429, 60) } }
    await expect(store.refresh(limited)).rejects.toMatchObject({ code: 'rate-limited' })
    const again = await store.refresh(limited).catch((e: unknown) => e)
    expect(again).toMatchObject({ code: 'rate-limited' })
    expect((again as ApiError).retryAfterSec).toBeGreaterThan(55)
  })

  it('bloqueio da GGG: usa o guardado e não insiste até passar a pausa', async () => {
    const dir = newDir()
    let calls = 0
    const ok = { name: 'b', ttlMs: 0, validate: isNums, load: async () => [++calls] }
    await new DataStore(dir).get(ok)
    const store = new DataStore(dir)
    const blocked = { ...ok, load: async () => { calls++; throw new ApiError('rate-limited', 429, 60) } }
    expect(await store.get(blocked)).toEqual([1])
    await new Promise((r) => setTimeout(r, 10))
    expect(await store.get(blocked)).toEqual([1])
    await expect(store.refresh(blocked)).rejects.toThrow()
    expect(calls).toBe(2)
  })
})
