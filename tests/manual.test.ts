import { describe, expect, it } from 'vitest'
import { buildManualQuery, isSearchable, mergeFilters, readFilters } from '../src/core/trade/manual'

describe('buildManualQuery', () => {
  it('item + mods formam o grupo AND principal', () => {
    const q = buildManualQuery({ name: null, type: 'Sapphire Ring', stats: [{ id: 'explicit.stat_1', min: 70, max: null }] }, 'online')
    expect(q.query.type).toBe('Sapphire Ring')
    expect(q.query.status.option).toBe('online')
    expect(q.query.stats).toEqual([{ type: 'and', filters: [{ id: 'explicit.stat_1', value: { min: 70 }, disabled: false }] }])
    expect(q.query.filters).toBeUndefined()
  })

  it('monta filtros de todos os tipos no formato do site', () => {
    const q = buildManualQuery(
      {
        name: null,
        type: null,
        stats: [],
        status: 'securable',
        filters: {
          type_filters: { category: { option: 'armour.boots' }, rarity: { option: 'rare' }, ilvl: { min: 80, max: null } },
          equipment_filters: { ev: { min: 200 } },
          misc_filters: { corrupted: { option: 'false' } },
          trade_filters: { price: { max: 5, option: 'divine' }, account: { input: '  Fulano#1234 ' }, indexed: { option: null } },
          req_filters: { lvl: { min: null, max: null } },
          status_filters: { status: { option: 'any' } },
        },
      },
      'online',
    )
    expect(q.query.status.option).toBe('securable')
    expect(q.query.filters).toEqual({
      type_filters: { filters: { category: { option: 'armour.boots' }, rarity: { option: 'rare' }, ilvl: { min: 80 } } },
      equipment_filters: { filters: { ev: { min: 200 } } },
      misc_filters: { filters: { corrupted: { option: 'false' } } },
      trade_filters: { filters: { price: { max: 5, option: 'divine' }, account: { input: 'Fulano#1234' } } },
    })
  })

  it('grupos NOT e COUNT', () => {
    const q = buildManualQuery(
      {
        name: null,
        type: 'Sandals',
        stats: [],
        statGroups: [
          { type: 'not', min: null, max: null, filters: [{ id: 'explicit.stat_2', min: null, max: null }] },
          { type: 'count', min: 2, max: null, filters: [{ id: 'explicit.stat_3', min: 10, max: null }, { id: 'explicit.stat_4', min: null, max: null }] },
          { type: 'count', min: 1, max: null, filters: [] },
        ],
      },
      'online',
    )
    expect(q.query.stats).toHaveLength(3)
    expect(q.query.stats[1]).toEqual({ type: 'not', filters: [{ id: 'explicit.stat_2', value: {}, disabled: false }] })
    expect(q.query.stats[2]).toMatchObject({ type: 'count', value: { min: 2 } })
  })

  it('único mantém raridade unique junto com outros filtros de tipo', () => {
    const q = buildManualQuery({ name: 'Headhunter', type: 'Heavy Belt', stats: [], filters: { type_filters: { ilvl: { min: 80 } } } }, 'online')
    expect(q.query.filters?.['type_filters']).toEqual({ filters: { rarity: { option: 'unique' }, ilvl: { min: 80 } } })
  })
})

describe('mergeFilters / readFilters', () => {
  it('valor do usuário vence o padrão, vazio remove o padrão e a leitura devolve o formato editável', () => {
    const query = buildTradeQueryBase()
    mergeFilters(query, {
      misc_filters: { corrupted: { option: null }, quality: { min: 20 } },
      type_filters: { ilvl: { min: 82 } },
    })
    expect(query.filters).toEqual({
      type_filters: { filters: { rarity: { option: 'nonunique' }, ilvl: { min: 82 } } },
      misc_filters: { filters: { quality: { min: 20 } } },
    })
    expect(readFilters(query).type_filters?.['ilvl']).toEqual({ min: 82, max: null, option: null, input: null })
  })

  it('remove o grupo inteiro quando todos os filtros ficam vazios', () => {
    const query = buildTradeQueryBase()
    mergeFilters(query, { type_filters: { rarity: { option: null } }, misc_filters: { corrupted: { option: null } } })
    expect(query.filters).toBeUndefined()
  })
})

function buildTradeQueryBase() {
  return {
    status: { option: 'online' as const },
    stats: [{ type: 'and' as const, filters: [] }],
    filters: {
      type_filters: { filters: { rarity: { option: 'nonunique' } } as Record<string, unknown> },
      misc_filters: { filters: { corrupted: { option: 'true' } } as Record<string, unknown> },
    },
  }
}

describe('isSearchable', () => {
  it('exige algum critério', () => {
    expect(isSearchable({ name: null, type: null, stats: [] })).toBe(false)
    expect(isSearchable({ name: null, type: null, stats: [], filters: { status_filters: { status: { option: 'any' } } } })).toBe(false)
    expect(isSearchable({ name: null, type: null, stats: [], filters: { type_filters: { category: { option: 'armour.boots' } } } })).toBe(true)
    expect(isSearchable({ name: null, type: null, stats: [], statGroups: [{ type: 'not', min: null, max: null, filters: [{ id: 'x.y', min: null, max: null }] }] })).toBe(true)
  })
})
