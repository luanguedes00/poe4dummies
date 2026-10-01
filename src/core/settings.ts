// Configurações do usuário. Dois modos de leitura:
// - `readSettings`: tolerante (arquivo em disco). Campo inválido volta ao padrão.
// - `applySettingsPatch`: estrito (vindo da interface). Qualquer campo inválido rejeita tudo.

import { z } from 'zod'
import { COPY_MODES, DEFAULT_HOTKEYS, normalizeAccelerator } from './hotkeys'
import { NINJA_CATEGORIES } from './sources/ninja'

export const LANGUAGES = ['pt-BR', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

// Atalho no formato do Electron, guardado sempre na forma canônica (ver core/hotkeys.ts).
const hotkeySchema = z
  .string()
  .max(40)
  .transform((value, ctx) => {
    const normalized = normalizeAccelerator(value)
    if (normalized === null) {
      ctx.addIssue({ code: 'custom', message: 'invalid accelerator' })
      return z.NEVER
    }
    return normalized
  })

export const watchEntrySchema = z.object({
  itemId: z.string().min(1).max(100),
  category: z.enum(NINJA_CATEGORIES),
  name: z.string().min(1).max(200),
  addedAt: z.iso.datetime(),
  baselineDivine: z.number().positive().finite(),
  baselineExaltedPerDivine: z.number().positive().finite(),
  baselineChaosPerDivine: z.number().positive().finite(),
  alertPercent: z.number().min(1).max(1000),
  lastAlert: z.enum(['up', 'down']).nullable(),
  /** Liga do preço de referência: os alertas só comparam com o mercado dessa liga. Ausente em listas antigas. */
  league: z.string().min(1).max(64).optional(),
})

export type WatchEntry = z.infer<typeof watchEntrySchema>

export const overlaySettingsSchema = z.object({
  enabled: z.boolean(),
  /** Abre a sobreposição quando um item é copiado no jogo (Ctrl+C / Ctrl+Alt+C). */
  clipboardTrigger: z.boolean(),
  /** Mínimo de cada filtro, em % do valor rolado no item. */
  minModPercent: z.number().int().min(50).max(100),
  listingStatus: z.enum(['online', 'securable', 'any']),
  /** Só reage a Ctrl+C com o Path of Exile 2 em foco (ignora navegador, Discord etc.). */
  requireGameFocus: z.boolean(),
  /** Veredito: abaixo deste valor (em Exalted) o item não compensa anunciar. */
  minSellExalted: z.number().min(0).max(100_000),
  /** Atalho da sobreposição. null = cópia do próprio jogo (Ctrl+C / Ctrl+Alt+C), sem atalho global. */
  hotkey: hotkeySchema.nullable(),
  /** Com atalho próprio: qual cópia do jogo simular (avançada traz os tiers dos mods). */
  copyMode: z.enum(COPY_MODES),
})

// Caminho absoluto do log do jogo (Client.txt). Sem node:path: este arquivo também roda na interface.
const LOG_PATH = /^(?:[A-Za-z]:\\|\\\\|\/).{0,1000}[\\/](?:Latest|Kakao)?Client\.txt$/i

export const trackerSettingsSchema = z.object({
  enabled: z.boolean(),
  /** null = procurar o log automaticamente. */
  logPath: z.string().max(1024).regex(LOG_PATH).nullable(),
})

/** Versão do arquivo: permite migrar padrões que mudaram (ver `readSettings`). */
export const SETTINGS_VERSION = 2

export const settingsSchema = z.object({
  version: z.number().int().min(0),
  language: z.enum(LANGUAGES),
  /** null = sempre a liga mais recente. */
  league: z.string().min(1).max(64).nullable(),
  displayCurrency: z.enum(['exalted', 'divine', 'chaos']),
  refreshMinutes: z.number().int().min(5).max(120),
  notifications: z.boolean(),
  dashboardHotkey: hotkeySchema,
  /** Liga/desliga o modo lista (vários itens seguidos). */
  collectionHotkey: hotkeySchema,
  /** Adiciona o item sob o mouse à lista (só com o jogo em foco). */
  collectionAddHotkey: hotkeySchema,
  overlay: overlaySettingsSchema,
  watchlist: z.array(watchEntrySchema).max(200),
  tracker: trackerSettingsSchema,
  /** O que o X da janela faz: perguntar, continuar na bandeja (sobreposição segue ativa) ou fechar o app. */
  closeAction: z.enum(['ask', 'tray', 'quit']),
  /**
   * Quando a escolha veio do "Não perguntar de novo" da janela de fechar (ms). Depois de 15 dias o
   * app volta a perguntar, sem aviso (pedido do usuário). null = escolhida em Configurações (não expira).
   */
  closeActionRememberedAt: z.number().int().nonnegative().nullable(),
})

export type Settings = z.infer<typeof settingsSchema>
export type OverlaySettings = z.infer<typeof overlaySettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  language: 'pt-BR',
  league: null,
  displayCurrency: 'exalted',
  refreshMinutes: 10,
  notifications: true,
  // Padrões explicados em core/hotkeys.ts. Valor salvo pelo usuário sempre vale mais que o padrão.
  dashboardHotkey: DEFAULT_HOTKEYS.dashboard!,
  collectionHotkey: DEFAULT_HOTKEYS.collection!,
  collectionAddHotkey: DEFAULT_HOTKEYS.collectionAdd!,
  tracker: { enabled: true, logPath: null },
  closeAction: 'ask',
  closeActionRememberedAt: null,
  overlay: {
    enabled: true,
    clipboardTrigger: true,
    minModPercent: 90,
    // Compra instantânea (lojinha): é o que dá para comprar na hora; "online" inclui quem só vende por whisper.
    listingStatus: 'securable',
    requireGameFocus: true,
    minSellExalted: 5,
    hotkey: DEFAULT_HOTKEYS.overlay,
    copyMode: 'simple',
  },
  watchlist: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Lê configurações do disco sem nunca falhar: o que estiver inválido volta ao padrão. */
export function readSettings(raw: unknown): Settings {
  const source = isRecord(raw) ? raw : {}
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(settingsSchema.shape) as Array<keyof Settings>) {
    const fallback = DEFAULT_SETTINGS[key]
    if (key === 'overlay') {
      const overlaySource = isRecord(source.overlay) ? source.overlay : {}
      const overlay: Record<string, unknown> = {}
      for (const k of Object.keys(overlaySettingsSchema.shape) as Array<keyof OverlaySettings>) {
        const parsed = overlaySettingsSchema.shape[k].safeParse(overlaySource[k])
        overlay[k] = parsed.success ? parsed.data : DEFAULT_SETTINGS.overlay[k]
      }
      result.overlay = overlay
    } else if (key === 'watchlist') {
      // Mantém as entradas válidas em vez de descartar a lista inteira.
      const list = Array.isArray(source.watchlist) ? source.watchlist : []
      result.watchlist = list
        .map((e) => watchEntrySchema.safeParse(e))
        .filter((p) => p.success)
        .map((p) => p.data)
        .slice(0, 200)
    } else {
      const parsed = settingsSchema.shape[key].safeParse(source[key])
      result[key] = parsed.success ? parsed.data : fallback
    }
  }
  // v2: padrão de anúncios passou de "online" para "compra instantânea". Quem estava no padrão antigo migra.
  const version = typeof source.version === 'number' ? source.version : 0
  const overlay = result.overlay as OverlaySettings
  if (version < 2 && overlay.listingStatus === 'online') overlay.listingStatus = 'securable'
  result.version = SETTINGS_VERSION
  return settingsSchema.parse(result)
}

/** Prazo do "Não perguntar" da janela de fechar (pedido do usuário: voltar a perguntar depois de um tempo). */
export const CLOSE_REMEMBER_DAYS = 15
const DAY_MS = 24 * 60 * 60 * 1000

/** Quando volta a perguntar (ms), ou null se a escolha não expira. */
export function closeChoiceExpiresAt(s: Pick<Settings, 'closeAction' | 'closeActionRememberedAt'>): number | null {
  if (s.closeAction === 'ask' || s.closeActionRememberedAt === null) return null
  return s.closeActionRememberedAt + CLOSE_REMEMBER_DAYS * DAY_MS
}

/** O que o X da janela faz agora: a escolha salva, ou "perguntar" se o prazo do "não perguntar" venceu. */
export function effectiveCloseAction(s: Pick<Settings, 'closeAction' | 'closeActionRememberedAt'>, now: number): Settings['closeAction'] {
  const expires = closeChoiceExpiresAt(s)
  return expires !== null && now >= expires ? 'ask' : s.closeAction
}

export const settingsPatchSchema = settingsSchema
  .omit({ overlay: true, version: true })
  .partial()
  .extend({ overlay: overlaySettingsSchema.partial().optional() })
  .strict()

export type SettingsPatch = z.infer<typeof settingsPatchSchema>

/** Aplica uma alteração vinda da interface. Lança erro se algo for inválido. */
export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  const parsed = settingsPatchSchema.parse(patch)
  const { overlay, ...rest } = parsed
  const merged = { ...current, ...rest, overlay: { ...current.overlay, ...(overlay ?? {}) } }
  return settingsSchema.parse(merged)
}
