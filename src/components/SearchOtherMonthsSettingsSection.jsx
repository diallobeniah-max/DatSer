import React, { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  Filter,
  Info,
  Layers,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  UserX,
  X
} from 'lucide-react'
import { toast } from 'react-toastify'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import {
  DEFAULT_HISTORICAL_SEARCH_SETTINGS,
  formatHistoricalScopeDetail,
  formatHistoricalScopeSummary,
  formatMonthTableLabel,
  normalizeHistoricalSearchSettings,
  parseMonthTable,
  resolveHistoricalSearchTables
} from '../utils/historicalSearchSettings'

const ALL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const SearchOtherMonthsSettingsSection = ({ getSettingTargetClass }) => {
  const { user, preferences, saveWorkspacePreferences } = useAuth()
  const {
    monthlyTables,
    currentTable,
    isCollaborator,
    isAdminCollaborator,
    dataOwnerId,
    saveHistoricalSearchSettings
  } = useApp()

  const hasAdminAccess = !isCollaborator || isAdminCollaborator
  const ownerId = dataOwnerId || user?.id

  // Load saved preferences from database or fallback to default
  const savedSettings = useMemo(() => {
    const raw = preferences?.historical_search_settings
    return normalizeHistoricalSearchSettings(raw)
  }, [preferences?.historical_search_settings])

  // Local draft state for settings editing
  const [draftSettings, setDraftSettings] = useState(savedSettings)
  const [isSaving, setIsSaving] = useState(false)
  const [monthSearchQuery, setMonthSearchQuery] = useState('')
  const [testScopeReport, setTestScopeReport] = useState(null)

  // Sync draft with saved preference when preference changes externally
  useEffect(() => {
    setDraftSettings(savedSettings)
  }, [savedSettings])

  const isDirty = useMemo(() => {
    return JSON.stringify(draftSettings) !== JSON.stringify(savedSettings)
  }, [draftSettings, savedSettings])

  // Resolve tables available for selection (all user_month_tables except currentTable)
  const availablePreviousTables = useMemo(() => {
    return (monthlyTables || []).filter((t) => typeof t === 'string' && t.length > 0 && t !== currentTable)
  }, [monthlyTables, currentTable])

  // Parse all monthly tables (including currentTable) grouped by year
  const tablesByYear = useMemo(() => {
    const map = new Map()

    ;(monthlyTables || []).forEach((t) => {
      const parsed = parseMonthTable(t)
      if (!parsed) return
      const list = map.get(parsed.year) || []
      list.push(parsed)
      map.set(parsed.year, list)
    })

    // Sort years descending (newest year first)
    const sortedYears = Array.from(map.keys()).sort((a, b) => b - a)
    const result = []

    sortedYears.forEach((year) => {
      const list = map.get(year).sort((a, b) => a.monthIndex - b.monthIndex)
      result.push({ year, months: list })
    })

    return result
  }, [monthlyTables])

  // Check custom selection count
  const customSelectedCount = useMemo(() => {
    const set = new Set(draftSettings.selected_tables)
    return availablePreviousTables.filter((t) => set.has(t)).length
  }, [draftSettings.selected_tables, availablePreviousTables])

  // Detect any saved table that no longer exists in monthlyTables
  const unavailableTables = useMemo(() => {
    const allTableSet = new Set(monthlyTables || [])
    return draftSettings.selected_tables.filter((t) => !allTableSet.has(t) && t !== currentTable)
  }, [draftSettings.selected_tables, monthlyTables, currentTable])

  // Resolved tables for current draft mode
  const resolvedDraftTables = useMemo(() => {
    return resolveHistoricalSearchTables({
      settings: draftSettings,
      monthlyTables,
      currentTable
    })
  }, [draftSettings, monthlyTables, currentTable])

  // Disable save if in custom mode with 0 valid selected tables
  const isSaveDisabled = useMemo(() => {
    if (isSaving) return true
    if (!hasAdminAccess) return true
    if (draftSettings.mode === 'custom' && customSelectedCount === 0) return true
    return !isDirty
  }, [isSaving, hasAdminAccess, draftSettings.mode, customSelectedCount, isDirty])

  // Mode Handlers
  const handleSetMode = (mode) => {
    setDraftSettings((prev) => ({ ...prev, mode }))
    setTestScopeReport(null)
  }

  const handleSetRecentMonths = (recent_months) => {
    setDraftSettings((prev) => ({ ...prev, mode: 'recent', recent_months }))
    setTestScopeReport(null)
  }

  const handleToggleIncludeDeleted = (include_deleted) => {
    setDraftSettings((prev) => ({ ...prev, include_deleted }))
    setTestScopeReport(null)
  }

  const handleToggleTable = (tableName) => {
    if (tableName === currentTable) return
    setDraftSettings((prev) => {
      const set = new Set(prev.selected_tables)
      if (set.has(tableName)) {
        set.delete(tableName)
      } else {
        set.add(tableName)
      }
      return {
        ...prev,
        mode: 'custom',
        selected_tables: Array.from(set)
      }
    })
    setTestScopeReport(null)
  }

  const handleSelectAllCustom = () => {
    setDraftSettings((prev) => ({
      ...prev,
      mode: 'custom',
      selected_tables: [...availablePreviousTables]
    }))
    setTestScopeReport(null)
  }

  const handleClearAllCustom = () => {
    setDraftSettings((prev) => ({
      ...prev,
      mode: 'custom',
      selected_tables: []
    }))
    setTestScopeReport(null)
  }

  const handleSelectYear = (year) => {
    const yearTables = (monthlyTables || []).filter((t) => {
      const parsed = parseMonthTable(t)
      return parsed && parsed.year === year && t !== currentTable
    })
    setDraftSettings((prev) => {
      const set = new Set(prev.selected_tables)
      yearTables.forEach((t) => set.add(t))
      return {
        ...prev,
        mode: 'custom',
        selected_tables: Array.from(set)
      }
    })
    setTestScopeReport(null)
  }

  const handleClearYear = (year) => {
    const yearTables = new Set((monthlyTables || []).filter((t) => {
      const parsed = parseMonthTable(t)
      return parsed && parsed.year === year
    }))
    setDraftSettings((prev) => ({
      ...prev,
      mode: 'custom',
      selected_tables: prev.selected_tables.filter((t) => !yearTables.has(t))
    }))
    setTestScopeReport(null)
  }

  const handleRemoveUnavailableTable = (tableName) => {
    setDraftSettings((prev) => ({
      ...prev,
      selected_tables: prev.selected_tables.filter((t) => t !== tableName)
    }))
  }

  const handleResetToAllPrevious = () => {
    setDraftSettings({
      ...DEFAULT_HISTORICAL_SEARCH_SETTINGS
    })
    setTestScopeReport(null)
    toast.info('Reset draft settings to All Previous Months.')
  }

  const handleTestSearchScope = () => {
    const count = resolvedDraftTables.length
    const currentLabel = formatMonthTableLabel(currentTable)
    const summary = formatHistoricalScopeSummary({
      settings: draftSettings,
      monthlyTables,
      currentTable
    })
    const detail = formatHistoricalScopeDetail({
      settings: draftSettings,
      monthlyTables,
      currentTable
    })

    setTestScopeReport({
      summary,
      count,
      detail,
      currentLabel,
      unavailableCount: unavailableTables.length
    })
  }

  const handleSaveSettings = async () => {
    if (isSaveDisabled) return
    if (!hasAdminAccess) {
      toast.error('Only workspace owners or permitted admins can save workspace search settings.')
      return
    }

    if (draftSettings.mode === 'custom' && customSelectedCount === 0) {
      toast.error('Select at least one previous month before saving custom mode.')
      return
    }

    setIsSaving(true)
    try {
      const cleanedSettings = normalizeHistoricalSearchSettings(draftSettings)
      let ok = false

      if (saveHistoricalSearchSettings) {
        ok = await saveHistoricalSearchSettings(cleanedSettings)
      } else if (saveWorkspacePreferences) {
        ok = await saveWorkspacePreferences(ownerId, {
          historical_search_settings: cleanedSettings
        })
      }

      if (ok) {
        toast.success('Historical search settings saved.')
        setTestScopeReport(null)
      } else {
        toast.error('The search settings could not be saved. Your previous settings are still active.')
        // Keep draft state intact on failure as required by spec
      }
    } catch (err) {
      console.error('Error saving historical search settings:', err)
      toast.error('The search settings could not be saved. Your previous settings are still active.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
          <Database className="w-5 h-5 text-orange-500" />
          Search Other Months
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Choose which previous months DatSer should check when a member is not found in the current month.
        </p>
      </div>

      {/* Non-admin notice */}
      {!hasAdminAccess && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <p className="font-semibold flex items-center gap-1.5">
            <Info className="w-4 h-4" />
            Workspace Default View
          </p>
          <p className="mt-1 text-xs">
            You are viewing the active workspace search settings configured by the workspace owner.
          </p>
        </div>
      )}

      {/* Mode Selection Cards */}
      <div
        data-setting-id="search_other_months_mode"
        tabIndex={-1}
        className={`space-y-3 ${getSettingTargetClass?.('search_other_months_mode') || ''}`}
      >
        <label className="block text-sm font-semibold text-gray-900 dark:text-white">
          Search Scope Mode
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Card 1: All Previous */}
          <button
            type="button"
            onClick={() => handleSetMode('all_previous')}
            className={`p-4 rounded-2xl border text-left transition-all ${
              draftSettings.mode === 'all_previous'
                ? 'border-orange-500 bg-orange-50/80 ring-2 ring-orange-500/20 dark:bg-orange-950/30 dark:border-orange-500'
                : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/80 dark:hover:border-gray-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-gray-900 dark:text-white">All previous months</span>
              {draftSettings.mode === 'all_previous' && (
                <div className="w-4 h-4 rounded-full bg-orange-600 grid place-items-center text-white">
                  <Check className="w-3 h-3 stroke-[3]" />
                </div>
              )}
            </div>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Search every authorized workspace month except the currently open month.
            </p>
          </button>

          {/* Card 2: Recent */}
          <button
            type="button"
            onClick={() => handleSetMode('recent')}
            className={`p-4 rounded-2xl border text-left transition-all ${
              draftSettings.mode === 'recent'
                ? 'border-orange-500 bg-orange-50/80 ring-2 ring-orange-500/20 dark:bg-orange-950/30 dark:border-orange-500'
                : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/80 dark:hover:border-gray-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-gray-900 dark:text-white">Recent months</span>
              {draftSettings.mode === 'recent' && (
                <div className="w-4 h-4 rounded-full bg-orange-600 grid place-items-center text-white">
                  <Check className="w-3 h-3 stroke-[3]" />
                </div>
              )}
            </div>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Search the most recent 3, 6, or 12 previous months.
            </p>
          </button>

          {/* Card 3: Custom */}
          <button
            type="button"
            onClick={() => handleSetMode('custom')}
            className={`p-4 rounded-2xl border text-left transition-all ${
              draftSettings.mode === 'custom'
                ? 'border-orange-500 bg-orange-50/80 ring-2 ring-orange-500/20 dark:bg-orange-950/30 dark:border-orange-500'
                : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/80 dark:hover:border-gray-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-gray-900 dark:text-white">Choose specific months</span>
              {draftSettings.mode === 'custom' && (
                <div className="w-4 h-4 rounded-full bg-orange-600 grid place-items-center text-white">
                  <Check className="w-3 h-3 stroke-[3]" />
                </div>
              )}
            </div>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Hand-pick exact month tables grouped by year.
            </p>
          </button>
        </div>
      </div>

      {/* Recent Months Options */}
      {draftSettings.mode === 'recent' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 space-y-3">
          <label className="block text-sm font-semibold text-gray-900 dark:text-white">
            Number of recent months
          </label>
          <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-900">
            {[3, 6, 12].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handleSetRecentMonths(num)}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${
                  draftSettings.recent_months === num
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                }`}
              >
                Previous {num} months
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Custom Month Picker */}
      {draftSettings.mode === 'custom' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 pb-3">
            <div>
              <h4 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-orange-500" />
                Select Month Tables
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {customSelectedCount === 0 ? (
                  <span className="text-red-500 font-semibold">Select at least one previous month.</span>
                ) : (
                  <span>{customSelectedCount} months selected</span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllCustom}
                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={handleClearAllCustom}
                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Month Search Filter if many months exist */}
          {(monthlyTables || []).length > 6 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Filter months..."
                value={monthSearchQuery}
                onChange={(e) => setMonthSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-xs font-medium text-gray-900 outline-none focus:border-orange-500 focus:bg-white dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:border-orange-500"
              />
              {monthSearchQuery && (
                <button
                  type="button"
                  onClick={() => setMonthSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Grouped Years */}
          <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
            {tablesByYear.map(({ year, months }) => {
              const filteredMonths = monthSearchQuery
                ? months.filter((m) => m.label.toLowerCase().includes(monthSearchQuery.toLowerCase()))
                : months

              if (filteredMonths.length === 0) return null

              const yearAvailable = months.filter((m) => m.tableName !== currentTable)
              const yearSelectedCount = yearAvailable.filter((m) => draftSettings.selected_tables.includes(m.tableName)).length
              const allYearSelected = yearAvailable.length > 0 && yearSelectedCount === yearAvailable.length

              return (
                <div key={year} className="rounded-xl border border-gray-200/80 bg-gray-50/50 p-3 dark:border-gray-700/80 dark:bg-gray-900/30 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                      {year}
                    </span>
                    <button
                      type="button"
                      onClick={() => (allYearSelected ? handleClearYear(year) : handleSelectYear(year))}
                      className="text-[11px] font-semibold text-gray-500 hover:text-orange-600 dark:text-gray-400 dark:hover:text-orange-300 transition-colors"
                    >
                      {allYearSelected ? `Clear ${year}` : `Select ${year}`}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {filteredMonths.map((m) => {
                      const isCurrent = m.tableName === currentTable
                      const isChecked = draftSettings.selected_tables.includes(m.tableName)

                      if (isCurrent) {
                        return (
                          <div
                            key={m.tableName}
                            className="p-2.5 rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800/50 text-gray-400 dark:text-gray-500 flex flex-col justify-between cursor-not-allowed select-none opacity-75"
                            title="Current open month — searched locally by default"
                          >
                            <span className="text-xs font-bold line-through">{m.monthName}</span>
                            <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 mt-1">
                              Current month — already searched locally
                            </span>
                          </div>
                        )
                      }

                      return (
                        <button
                          key={m.tableName}
                          type="button"
                          onClick={() => handleToggleTable(m.tableName)}
                          className={`p-2.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                            isChecked
                              ? 'border-orange-500 bg-orange-50 text-orange-950 font-bold dark:bg-orange-950/40 dark:border-orange-500 dark:text-orange-100'
                              : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <span className="text-xs font-semibold">{m.monthName}</span>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}} // Handled by button onClick
                            className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 pointer-events-none"
                          />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Unavailable Saved Tables Notice */}
      {unavailableTables.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-900/20 text-xs text-red-800 dark:text-red-300 space-y-2">
          <p className="font-bold flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-red-500" />
            {unavailableTables.length} previously selected {unavailableTables.length === 1 ? 'month is' : 'months are'} no longer available.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unavailableTables.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 font-semibold">
                {formatMonthTableLabel(t)}
                {hasAdminAccess && (
                  <button
                    type="button"
                    onClick={() => handleRemoveUnavailableTable(t)}
                    className="hover:text-red-900 dark:hover:text-red-100"
                    title="Remove from saved selection"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Advanced Settings */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-bold text-gray-900 dark:text-white">
              Include deleted historical members
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Include members that were deleted in previous months. Off by default.
            </p>
          </div>
          <input
            type="checkbox"
            checked={draftSettings.include_deleted}
            onChange={(e) => handleToggleIncludeDeleted(e.target.checked)}
            className="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
          />
        </div>
        {draftSettings.include_deleted && (
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2.5 rounded-xl border border-amber-200 dark:border-amber-900/40">
            Deleted historical members will be clearly labeled with a deleted badge and cannot be marked Present or Absent until explicitly restored.
          </p>
        )}
      </div>

      {/* Summary Box */}
      <div className="rounded-2xl border border-orange-200/80 bg-orange-50/60 p-4 dark:border-orange-900/40 dark:bg-orange-950/20 space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-orange-700 dark:text-orange-300 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" />
          Active Scope Summary
        </h4>
        <p className="text-sm font-bold text-gray-900 dark:text-white">
          {formatHistoricalScopeSummary({ settings: draftSettings, monthlyTables, currentTable })}
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
          {formatHistoricalScopeDetail({ settings: draftSettings, monthlyTables, currentTable })}
        </p>
        <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 pt-1">
          Current month ({formatMonthTableLabel(currentTable)}) is always excluded from historical searches because it is already searched locally.
        </p>
      </div>

      {/* Test Scope Report */}
      {testScopeReport && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-950/30 text-xs text-blue-950 dark:text-blue-200 space-y-2">
          <p className="font-bold flex items-center gap-1.5 text-sm">
            <Check className="w-4 h-4 text-blue-600" />
            Scope Test Report
          </p>
          <p className="font-semibold text-blue-900 dark:text-blue-100">
            Ready to search {testScopeReport.count} previous {testScopeReport.count === 1 ? 'month' : 'months'}.
          </p>
          <p className="text-blue-800 dark:text-blue-300">
            Months included: {testScopeReport.detail}
          </p>
          <p className="text-blue-700 dark:text-blue-400">
            Excluded current month: {testScopeReport.currentLabel}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetToAllPrevious}
            className="px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to All Previous
          </button>
          <button
            type="button"
            onClick={handleTestSearchScope}
            className="px-3.5 py-2.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-xs font-semibold text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors flex items-center gap-1.5"
          >
            <Filter className="w-3.5 h-3.5" />
            Test Search Scope
          </button>
        </div>

        {hasAdminAccess && (
          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={isSaveDisabled}
            className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 disabled:cursor-not-allowed text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save Search Settings'}
          </button>
        )}
      </div>
    </div>
  )
}

export default React.memo(SearchOtherMonthsSettingsSection)
