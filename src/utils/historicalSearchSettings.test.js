import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HISTORICAL_SEARCH_SETTINGS,
  formatHistoricalScopeDetail,
  formatHistoricalScopeSummary,
  formatMonthTableLabel,
  normalizeHistoricalSearchSettings,
  parseMonthTable,
  resolveHistoricalSearchTables
} from './historicalSearchSettings'

describe('historicalSearchSettings helper module', () => {
  const monthlyTables = [
    'August_2026',
    'July_2026',
    'June_2026',
    'May_2026',
    'April_2026',
    'March_2026',
    'February_2026',
    'January_2026',
    'December_2025',
    'November_2025',
    'October_2025',
    'September_2025',
    'August_2025'
  ]
  const currentTable = 'August_2026'

  it('normalizes empty or invalid raw settings to defaults', () => {
    const normalized = normalizeHistoricalSearchSettings(null)
    expect(normalized).toEqual(DEFAULT_HISTORICAL_SEARCH_SETTINGS)

    const invalid = normalizeHistoricalSearchSettings({
      mode: 'invalid',
      recent_months: 99,
      selected_tables: 'not-an-array',
      include_deleted: 'truthy'
    })
    expect(invalid.mode).toBe('all_previous')
    expect(invalid.recent_months).toBe(6)
    expect(invalid.selected_tables).toEqual([])
    expect(invalid.include_deleted).toBe(true)
  })

  it('resolves All Previous Months excluding current month', () => {
    const settings = { mode: 'all_previous' }
    const resolved = resolveHistoricalSearchTables({ settings, monthlyTables, currentTable })
    expect(resolved).not.toContain('August_2026')
    expect(resolved.length).toBe(12)
    expect(resolved[0]).toBe('July_2026')
  })

  it('resolves Recent 3, 6, and 12 months correctly', () => {
    const r3 = resolveHistoricalSearchTables({
      settings: { mode: 'recent', recent_months: 3 },
      monthlyTables,
      currentTable
    })
    expect(r3).toEqual(['July_2026', 'June_2026', 'May_2026'])

    const r6 = resolveHistoricalSearchTables({
      settings: { mode: 'recent', recent_months: 6 },
      monthlyTables,
      currentTable
    })
    expect(r6).toEqual(['July_2026', 'June_2026', 'May_2026', 'April_2026', 'March_2026', 'February_2026'])

    const r12 = resolveHistoricalSearchTables({
      settings: { mode: 'recent', recent_months: 12 },
      monthlyTables,
      currentTable
    })
    expect(r12.length).toBe(12)
    expect(r12).not.toContain('August_2026')
  })

  it('resolves Custom mode searching only selected tables and excluding current month', () => {
    const settings = {
      mode: 'custom',
      selected_tables: ['July_2026', 'January_2026', 'August_2026', 'December_2025']
    }
    const resolved = resolveHistoricalSearchTables({ settings, monthlyTables, currentTable })
    expect(resolved).toEqual(['July_2026', 'January_2026', 'December_2025'])
    expect(resolved).not.toContain('August_2026')
  })

  it('yields empty array for custom mode with zero selected tables', () => {
    const settings = { mode: 'custom', selected_tables: [] }
    const resolved = resolveHistoricalSearchTables({ settings, monthlyTables, currentTable })
    expect(resolved).toEqual([])
  })

  it('formats month table labels properly without raw underscores', () => {
    expect(formatMonthTableLabel('August_2026')).toBe('August 2026')
    expect(formatMonthTableLabel('December_2025')).toBe('December 2025')
    expect(parseMonthTable('August_2026')).toEqual({
      tableName: 'August_2026',
      monthName: 'August',
      year: 2026,
      monthIndex: 7,
      label: 'August 2026'
    })
  })

  it('formats human-readable scope summaries and detailed month lists', () => {
    expect(formatHistoricalScopeSummary({
      settings: { mode: 'all_previous' },
      monthlyTables,
      currentTable
    })).toBe('Search scope: All previous months')

    expect(formatHistoricalScopeSummary({
      settings: { mode: 'recent', recent_months: 6 },
      monthlyTables,
      currentTable
    })).toBe('Search scope: Previous 6 months')

    const customSettings = {
      mode: 'custom',
      selected_tables: ['January_2026', 'February_2026', 'April_2026', 'June_2026', 'July_2026']
    }

    expect(formatHistoricalScopeSummary({
      settings: customSettings,
      monthlyTables,
      currentTable
    })).toBe('Search scope: 5 selected months')

    expect(formatHistoricalScopeDetail({
      settings: customSettings,
      monthlyTables,
      currentTable
    })).toBe('July 2026, June 2026, April 2026, February 2026 and January 2026')
  })
})
