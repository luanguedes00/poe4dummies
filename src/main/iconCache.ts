// Cache em disco das imagens do CDN da GGG (ícones de itens, gemas, currencies).
// A interface pede "poe-icon://cdn/<caminho>" (web.poecdn.com) ou
// "poe-icon://repoe/Art/..." (artes do jogo no RePoE); a primeira vez baixa e
// grava em userData/cache/img, sem validade; depois lê só do disco.
// Só aceita essas duas origens, com tamanho máximo.

import { app, protocol } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const ICON_SCHEME = 'poe-icon'
/** Origens permitidas: CDN da GGG e as artes do jogo publicadas pelo RePoE. */
const ORIGINS: Record<string, { base: string; path: RegExp }> = {
  cdn: { base: 'https://web.poecdn.com', path: /^\/(gen\/)?image\/[A-Za-z0-9_\-./%=]+$/ },
  repoe: { base: 'https://repoe-fork.github.io/poe2', path: /^\/Art\/[A-Za-z0-9_\-./%]+\.png$/ },
}
const MAX_BYTES = 1024 * 1024
/** Sem validade: fica guardado até o usuário limpar. Teto só contra disco cheio (~20 mil ícones ≈ 200 MB). */
const MAX_FILES = 20_000
const MAX_PARALLEL = 4
const TIMEOUT_MS = 15_000
const TYPES: Record<string, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', gif: 'image/gif' }

// O registro do esquema fica em appProtocol.ts (registerSchemes): o Electron aceita uma chamada só.


export function installIconCache(userAgent: string): void {
  const dir = join(app.getPath('userData'), 'cache', 'img')
  const loading = new Map<string, Promise<{ body: Buffer; type: string } | null>>()
  let files: number | null = null
  let active = 0
  const waiters: Array<() => void> = []

  const slot = async () => {
    while (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiters.push(resolve))
    active++
  }
  const free = () => {
    active--
    waiters.shift()?.()
  }

  const fromDisk = async (hash: string) => {
    for (const [ext, type] of Object.entries(TYPES)) {
      const body = await fs.readFile(join(dir, `${hash}.${ext}`)).catch(() => null)
      if (body) return { body, type }
    }
    return null
  }

  const download = async (remote: string, hash: string) => {
    await slot()
    try {
      const response = await fetch(remote, { headers: { 'User-Agent': userAgent }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim()
      const ext = Object.keys(TYPES).find((k) => TYPES[k] === type)
      if (!response.ok || !ext) return null
      const body = Buffer.from(await response.arrayBuffer())
      if (body.length === 0 || body.length > MAX_BYTES) return null
      files ??= (await fs.readdir(dir).catch(() => [])).length
      if (files < MAX_FILES) {
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(join(dir, `${hash}.${ext}`), body)
        files++
      }
      return { body, type }
    } catch {
      return null
    } finally {
      free()
    }
  }

  protocol.handle(ICON_SCHEME, async (request) => {
    const url = new URL(request.url)
    const origin = ORIGINS[url.hostname]
    const safe = !!origin && origin.path.test(url.pathname) && !url.pathname.includes('..') && /^(\?[A-Za-z0-9=&._%-]*)?$/.test(url.search)
    if (!origin || !safe) return new Response(null, { status: 404 })
    const remote = `${origin.base}${url.pathname}${url.search}`
    const hash = createHash('sha256').update(remote).digest('hex').slice(0, 40)
    let pending = loading.get(hash)
    if (!pending) {
      pending = (async () => (await fromDisk(hash)) ?? (await download(remote, hash)))().finally(() => loading.delete(hash))
      loading.set(hash, pending)
    }
    const image = await pending
    if (!image) return new Response(null, { status: 404 })
    return new Response(new Uint8Array(image.body), {
      headers: { 'content-type': image.type, 'cache-control': 'public, max-age=31536000, immutable' },
    })
  })
}
