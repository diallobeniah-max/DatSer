export const DEFAULT_HISTORICAL_SEARCH_SETTINGS = {
  mode: 'all_previous', // 'all_previous' | 'recent' | 'custom'
  recent_months: 6,      // 3 | 6 | 12
  selected_tables: [],   // Array of table names
  include_deleted: false
}

export const normalizeHistoricalSearchSettings = (raw = {}) => {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_HISTORICAL_SEARCH_SETTINGS }
  }

  let mode = raw.mode
  if (!['all_previous', 'recent', 'custom'].includes(mode)) {
    mode = 'all_previous'
  }

  let recent_months = Number(raw.recent_months)
  if (![3, 6, 12].includes(recent_months)) {
    recent_months = 6
  }

  const selected_tables = Array.isArray(raw.selected_tables)
    ? raw.selected_tables.filter((t) => typeof t === 'string' && t.trim().length > 0)
    : []

  const include_deleted = Boolean(raw.include_deleted)

  return {
    mode,
    recent_months,
    selected_tables,
    include_deleted
  }
}

export const parseMonthTable = (tableName = '') => {
  if (!tableName || typeof tableName !== 'string') return null
  const parts = tableName.split('_')
  if (parts.length !== 2) return null
  const monthName = parts[0]
  const year = parseInt(parts[1], 10)
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
  const monthIndex = months.indexOf(monthName)
  if (monthIndex === -1 || Number.isNaN(year)) return null

  return {
    tableName,
    monthName,
    year,
    monthIndex,
    label: `${monthName} ${year}`
  }
}

export const formatMonthTableLabel = (tableName = '') => {
  const parsed = parseMonthTable(tableName)
  if (parsed) return parsed.label
  return String(tableName).replace('_', ' ')
}

export const resolveHistoricalSearchTables = ({ settings = {}, monthlyTables = [], currentTable = '' }) => {
  const normalized = normalizeHistoricalSearchSettings(settings)
  const validTables = (monthlyTables || []).filter((t) => typeof t === 'string' && t.length > 0)
  const availablePrevious = validTables.filter((t) => t !== currentTable)

  if (normalized.mode === 'all_previous') {
    return availablePrevious
  }

  if (normalized.mode === 'recent') {
    return availablePrevious.slice(0, normalized.recent_months)
  }

  if (normalized.mode === 'custom') {
    const selectedSet = new Set(normalized.selected_tables)
    return availablePrevious.filter((t) => selectedSet.has(t))
  }

  return availablePrevious
}

export const formatHistoricalScopeSummary = ({ settings = {}, monthlyTables = [], currentTable = '' }) => {
  const normalized = normalizeHistoricalSearchSettings(settings)
  if (normalized.mode === 'all_previous') {
    return 'Search scope: All previous months'
  }
  if (normalized.mode === 'recent') {
    return `Search scope: Previous ${normalized.recent_months} months`
  }
  if (normalized.mode === 'custom') {
    const resolved = resolveHistoricalSearchTables({ settings, monthlyTables, currentTable })
    return `Search scope: ${resolved.length} selected ${resolved.length === 1 ? 'month' : 'months'}`
  }
  return 'Search scope: All previous months'
}

export const formatHistoricalScopeDetail = ({ settings = {}, monthlyTables = [], currentTable = '' }) => {
  const resolved = resolveHistoricalSearchTables({ settings, monthlyTables, currentTable })
  if (resolved.length === 0) {
    return 'No previous months selected'
  }
  const labels = resolved.map(formatMonthTableLabel)
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}
