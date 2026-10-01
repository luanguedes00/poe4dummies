// Testa contra a trade real (LIVE=1) que as receitas de tablet são buscas válidas.
import { describe, expect, it } from 'vitest'
import { MECHANICS } from '../src/core/farm/mechanics'
import { recipeQuery } from '../src/core/farm/recipes'
import { HttpClient } from '../src/core/http/client'
import { pickDefaultLeague, TradeClient } from '../src/core/sources/trade'

describe.skipIf(!process.env['LIVE'])('receitas de tablet na trade real', () => {
  it('todas as receitas com mods são aceitas pela trade', async () => {
    const trade = new TradeClient(new HttpClient({ userAgent: 'PoE4Dummies/0.1 (tests)' }))
    const league = pickDefaultLeague(await trade.leagues())
    // Uma receita com mods por mecânica, para respeitar o limite de buscas.
    for (const g of MECHANICS.filter((m) => !process.env['ONLY'] || m.id === process.env['ONLY'])) {
      const recipe = g.recipes.find((r) => r.mods.length > 0)!
      const result = await trade.search(league, recipeQuery(recipe, 'any'))
      console.log(`${g.id}/${recipe.id}: ${result.total} anúncios`)
      expect(result.id.length).toBeGreaterThan(0)
    }
  }, 180_000)
})
