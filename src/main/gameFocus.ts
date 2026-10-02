// Descobre se o Path of Exile 2 é a janela em foco no Windows, para a
// sobreposição só reagir a Ctrl+C feito dentro do jogo (e não no navegador,
// Discord etc.). Só lê o NOME do executável em foco; nada da memória do jogo.

import type koffiType from 'koffi'

/** Executáveis do PoE (standalone, Steam, Kakao; 32/64 bits). */
const GAME_EXE = /^PathOfExile[\w-]*\.exe$/i

export type FocusState = 'game' | 'other' | 'unknown'

interface Win32 {
  getClipboardSequenceNumber: () => number
  getForegroundWindow: () => unknown
  getWindowThreadProcessId: (hwnd: unknown, pid: number[]) => number
  openProcess: (access: number, inherit: boolean, pid: number) => unknown
  queryFullProcessImageName: (handle: unknown, flags: number, buffer: Buffer, size: number[]) => boolean
  closeHandle: (handle: unknown) => boolean
  findWindow: (className: string | null, title: string | null) => unknown
  getAsyncKeyState: (vKey: number) => number
  setForegroundWindow: (hwnd: unknown) => boolean
  getCursorPos: (pt: { x: number; y: number }) => boolean
  windowFromPoint: (pt: { x: number; y: number }) => unknown
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
let win32: Win32 | null | undefined

/** Carrega as funções do Windows uma vez. Se falhar (outro SO, erro), a checagem fica "unknown". */
function load(): Win32 | null {
  if (win32 !== undefined) return win32
  win32 = null
  if (process.platform !== 'win32') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof koffiType
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    koffi.struct('POINT', { x: 'long', y: 'long' })
    win32 = {
      getClipboardSequenceNumber: user32.func('uint32 __stdcall GetClipboardSequenceNumber()'),
      getForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
      getWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(void* hwnd, _Out_ uint32* pid)'),
      openProcess: kernel32.func('void* __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      queryFullProcessImageName: kernel32.func(
        'bool __stdcall QueryFullProcessImageNameW(void* process, uint32 flags, _Out_ uint16* name, _Inout_ uint32* size)',
      ),
      closeHandle: kernel32.func('bool __stdcall CloseHandle(void* handle)'),
      findWindow: user32.func('void* __stdcall FindWindowW(str16 className, str16 title)'),
      getAsyncKeyState: user32.func('int16 __stdcall GetAsyncKeyState(int vKey)'),
      setForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(void* hwnd)'),
      getCursorPos: user32.func('bool __stdcall GetCursorPos(_Out_ POINT *pt)'),
      windowFromPoint: user32.func('void* __stdcall WindowFromPoint(POINT pt)'),
    }
  } catch {
    win32 = null
  }
  return win32
}

/** Nome do executável da janela em foco (ex.: "PathOfExileSteam.exe"), ou null. */
export function foregroundExe(): string | null {
  const api = load()
  if (!api) return null
  try {
    return windowExe(api, api.getForegroundWindow())
  } catch {
    return null
  }
}

function windowExe(api: Win32, hwnd: unknown): string | null {
  try {
    if (!hwnd) return null
    const pid = [0]
    api.getWindowThreadProcessId(hwnd, pid)
    if (!pid[0]) return null
    const handle = api.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0])
    if (!handle) return null
    try {
      const buffer = Buffer.alloc(1024 * 2)
      const size = [1024]
      if (!api.queryFullProcessImageName(handle, 0, buffer, size)) return null
      const path = buffer.toString('utf16le', 0, (size[0] ?? 0) * 2)
      return path.split(/[\\/]/).pop() ?? null
    } finally {
      api.closeHandle(handle)
    }
  } catch {
    return null
  }
}

/**
 * Contador do Windows que muda a cada cópia, mesmo com texto igual. Permite
 * contar duas pilhas idênticas copiadas em seguida sem mexer na área de
 * transferência do usuário. null se indisponível.
 */
export function clipboardSequence(): number | null {
  const api = load()
  if (!api) return null
  try {
    return api.getClipboardSequenceNumber()
  } catch {
    return null
  }
}

export function isGameExe(exe: string | null): boolean {
  return exe !== null && GAME_EXE.test(exe)
}

/**
 * O jogo está aberto? Procura a janela do PoE (pela classe usada pelo cliente
 * e, como reserva, pelo título) e confere o executável dono dela. null quando
 * não dá para saber (outro SO, erro).
 */
export function gameRunning(): boolean | null {
  const api = load()
  if (!api) return null
  try {
    return gameWindow(api) !== null
  } catch {
    return null
  }
}

function gameWindow(api: Win32): unknown {
  for (const [cls, title] of [['POEWindowClass', null], [null, 'Path of Exile 2']] as const) {
    const hwnd = api.findWindow(cls, title)
    if (hwnd && isGameExe(windowExe(api, hwnd))) return hwnd
  }
  return null
}

/**
 * Devolve o foco ao jogo (ex.: depois de fechar a lista no ✕, para não precisar
 * clicar no jogo de novo). O Windows só permite porque o app está em primeiro plano.
 */
export function focusGame(): boolean {
  const api = load()
  if (!api) return false
  try {
    const hwnd = gameWindow(api)
    return hwnd ? api.setForegroundWindow(hwnd) : false
  } catch {
    return false
  }
}

const VK_LBUTTON = 0x01
const VK_RBUTTON = 0x02
const VK_MBUTTON = 0x04
const VK_ESCAPE = 0x1b

/**
 * Estado atual do mouse e do Esc (só "está apertado agora", sem ler o que foi
 * digitado). Serve para fechar o price check ao clicar fora dele. null = indisponível.
 */
export function pointerState(): { mouse: boolean; escape: boolean } | null {
  const api = load()
  if (!api) return null
  try {
    const down = (vk: number) => (api.getAsyncKeyState(vk) & 0x8000) !== 0
    return { mouse: down(VK_LBUTTON) || down(VK_RBUTTON) || down(VK_MBUTTON), escape: down(VK_ESCAPE) }
  } catch {
    return null
  }
}

/**
 * Executável da janela embaixo do mouse (ex.: a lista aberta de um <select> do app,
 * que pode passar da borda da sobreposição). null quando não dá para saber.
 */
export function exeUnderCursor(): string | null {
  const api = load()
  if (!api) return null
  try {
    const pt = { x: 0, y: 0 }
    if (!api.getCursorPos(pt)) return null
    return windowExe(api, api.windowFromPoint(pt))
  } catch {
    return null
  }
}

/** "unknown" quando não dá para saber: nesse caso o app não bloqueia nada. */
export function focusState(): FocusState {
  const exe = foregroundExe()
  if (exe === null) return 'unknown'
  return isGameExe(exe) ? 'game' : 'other'
}
