// Serve as telas do app por "app://bundle/..." em vez de file://.
// O .exe liga a trava de segurança `grantFileProtocolExtraPrivileges: false`:
// com ela, páginas abertas por file:// não carregam os próprios scripts
// (tela preta). Um protocolo próprio é o caminho recomendado pelo Electron.
// Só entrega arquivos de dentro da pasta do renderer (sem "..").

import { protocol } from 'electron'
import { promises as fs } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { ICON_SCHEME } from './iconCache'

export const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://bundle`

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

/** Registra os protocolos do app (telas e ícones). Chamar uma vez, antes do `app.whenReady()`. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: ICON_SCHEME, privileges: { standard: true, secure: true } },
  ])
}

export function installAppProtocol(rendererDir: string): void {
  const root = normalize(rendererDir) + sep
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'bundle') return new Response(null, { status: 404 })
    const file = normalize(join(root, decodeURIComponent(url.pathname)))
    const type = TYPES[extname(file).toLowerCase()]
    if (!file.startsWith(root) || !type) return new Response(null, { status: 404 })
    try {
      return new Response(new Uint8Array(await fs.readFile(file)), { headers: { 'content-type': type } })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
