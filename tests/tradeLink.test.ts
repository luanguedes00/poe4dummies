import { describe, expect, it } from 'vitest'
import { findRecipe } from '../src/core/farm/mechanics'
import { recipeQuery } from '../src/core/farm/recipes'
import { tradeLinkUrl } from '../src/core/sources/trade'

describe('link da trade com a busca na URL (sem API)', () => {
  it('leva o filtro inteiro no ?q=', () => {
    const recipe = findRecipe('ritual', 'ritual-omen-defer')!
    const url = tradeLinkUrl('Forbidden Rites', recipeQuery(recipe, 'securable'))!
    console.log(url)
    expect(url.startsWith('https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites?q=')).toBe(true)
    const q = JSON.parse(decodeURIComponent(url.split('?q=')[1]!))
    expect(q.query.status.option).toBe('securable')
    expect(q.query.type).toBe('Ritual Tablet')
  })
})
