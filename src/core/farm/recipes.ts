// Receitas de tablet → busca na trade e custo por mapa dos setups.

import type { TabletPrice } from '../sources/ninja'
import type { ListingStatus, TradeQuery } from '../trade/query'
import type { MechanicGuide, MechanicSetup, TabletRecipe } from './mechanics'

const VARIANT: Record<TabletRecipe['rarity'], string | null> = { rare: 'Rare', magic: 'Magic', unique: null }

/** Tablet comum sempre com os 10 usos: ninguém compra tablet gasto. Únicos têm menos usos (ex.: 5) e ficam de fora. */
export const FULL_USES_FILTER = { id: 'pseudo.pseudo_number_of_uses_remaining', value: { min: 10 }, disabled: false }

/** Busca da trade para uma receita: tipo, raridade e os mods com mín/máx. */
export function recipeQuery(recipe: TabletRecipe, status: ListingStatus): TradeQuery {
  const query: TradeQuery['query'] = {
    status: { option: status },
    type: recipe.baseType,
    stats: [
      {
        type: 'and',
        filters: [
          ...recipe.mods.map((m) => {
            const value: { min?: number; max?: number } = {}
            if (m.min !== undefined) value.min = m.min
            if (m.max !== undefined) value.max = m.max
            return { id: m.statId, value, disabled: false }
          }),
          // Só no filtro (não aparece na descrição): todo mundo assume 10 usos.
          ...(recipe.rarity === 'unique' ? [] : [FULL_USES_FILTER]),
        ],
      },
    ],
    filters: { type_filters: { filters: { rarity: { option: recipe.rarity } } } },
  }
  if (recipe.rarity === 'unique' && recipe.unique) query.name = recipe.unique
  return { query, sort: { price: 'asc' } }
}

/**
 * Preço de referência do poe.ninja: exato para único; média do tipo + raridade
 * para comuns (não considera os mods pedidos, então tende a subestimar).
 */
export function recipeReferencePrice(recipe: TabletRecipe, prices: readonly TabletPrice[]): number | null {
  if (recipe.rarity === 'unique') return prices.find((p) => p.unique && p.name === recipe.unique)?.valueDivine ?? null
  return prices.find((p) => !p.unique && p.baseType === recipe.baseType && p.variant === VARIANT[recipe.rarity])?.valueDivine ?? null
}

export interface SetupCost {
  perMap: number
  total: number
  missing: number
}

/** Custo do setup com os preços do poe.ninja (referência). */
export function setupCost(guide: MechanicGuide, setup: MechanicSetup, prices: readonly TabletPrice[]): SetupCost {
  return setupCostWith(guide, setup, (recipe) => recipeReferencePrice(recipe, prices))
}

/**
 * Custo do setup: total comprado e custo por mapa (preço ÷ usos).
 * `priceOf` permite usar o preço real da trade quando já foi buscado.
 */
export function setupCostWith(guide: MechanicGuide, setup: MechanicSetup, priceOf: (recipe: TabletRecipe) => number | null): SetupCost {
  let perMap = 0
  let total = 0
  let missing = 0
  for (const item of setup.items) {
    const recipe = guide.recipes.find((r) => r.id === item.recipeId)
    const price = recipe ? priceOf(recipe) : null
    if (!recipe || price === null) {
      missing += item.count
      continue
    }
    total += price * item.count
    perMap += (price / Math.max(1, recipe.uses)) * item.count
  }
  return { perMap, total, missing }
}
