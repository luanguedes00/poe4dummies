// Categorias do poe.ninja (PoE2). Arquivo sem dependências para poder ir para a
// interface sem arrastar o cliente HTTP nem o zod.

export const NINJA_CATEGORIES = [
  'Currency',
  'Fragments',
  'Runes',
  'Essences',
  'SoulCores',
  'Omens',
  'Ritual',
  'Delirium',
  'Breach',
  'Abyss',
  'Expedition',
  'Idols',
  'UncutGems',
  'LineageSupportGems',
  'Distilled',
  'Catalysts',
] as const

export type NinjaCategory = (typeof NINJA_CATEGORIES)[number]

export function isNinjaCategory(value: string): value is NinjaCategory {
  return (NINJA_CATEGORIES as readonly string[]).includes(value)
}
