import React, { useState, useMemo } from 'react'
import { Calendar, Check, Database, Save, Search, X } from 'lucide-react'
import { toast } from 'react-toastify'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import {
  formatHistoricalScopeDetail,
  formatHistoricalScopeSummary,
  formatMonthTableLabel,
  normalizeHistoricalSearchSettings,
  parseMonthTable,
  resolveHistoricalSearchTables
} from '../utils/historicalSearchSettings'

const SearchScopeModal = ({
  isOpen,
  onClose,
  activeScopeSettings,
  onApplyTemporaryScope
}) => {
  const { user, preferences } = useAuth()
  const {
    monthlyTables,
    currentTable,
    isCollaborator,
    isAdminCollaborator,
    saveHistoricalSearchSettings
  } = useApp()

  const hasAdminAccess = !isCollaborator || isAdminCollaborator
  const [modalSettings, setModalSettings] = useState(() => normalizeHistoricalSearchSettings(activeScopeSettings))
  const [isSavingDefault, setIsSavingDefault] = useState(false)

  // Sync state when opened
  React.useEffect(() => {
    if (isOpen) {
      setModalSettings(normalizeHistoricalSearchSettings(activeScopeSettings))
    }
  }, [isOpen, activeScopeSettings])

  const availablePreviousTables = useMemo(() => {
    return (monthlyTables || []).filter((t) => typeof t === 'string' && t.length > 0 && t !== currentTable)
  }, [monthlyTables, currentTable])

  const tablesByYear = useMemo(() => {
    const map = new Map()
    ;(monthlyTables || []).forEach((t) => {
      const parsed = parseMonthTable(t)
      if (!parsed) return
      const list = map.get(parsed.year) || []
      list.push(parsed)
      map.set(parsed.year, list)
    })

    const sortedYears = Array.from(map.keys()).sort((a, b) => b - a)
    return sortedYears.map((year) => ({
      year,
      months: map.get(year).sort((a, b) => a.monthIndex - b.monthIndex)
    }))
  }, [monthlyTables])

  if (!isOpen) return null

  const handleToggleTable = (tableName) => {
    if (tableName === currentTable) return
    setModalSettings((prev) => {
      const set = new Set(prev.selected_tables)
      if (set.has(tableName)) set.delete(tableName)
      else set.add(tableName)
      return {
        ...prev,
        mode: 'custom',
        selected_tables: Array.from(set)
      }
    })
  }

  const handleApplyTemporary = () => {
    if (modalSettings.mode === 'custom' && modalSettings.selected_tables.length === 0) {
      toast.error('Select at least one previous month.')
      return
    }
    onApplyTemporaryScope?.(modalSettings)
    onClose()
    toast.info('Applied temporary search scope for this search.')
  }

  const handleSaveAsDefault = async () => {
    if (!hasAdminAccess) return
    if (modalSettings.mode === 'custom' && modalSettings.selected_tables.length === 0) {
      toast.error('Select at least one previous month before saving.')
      return
    }

    setIsSavingDefault(true)
    try {
      const cleaned = normalizeHistoricalSearchSettings(modalSettings)
      const ok = await saveHistoricalSearchSettings(cleaned)
      if (ok) {
        toast.success('Saved as workspace default scope.')
        onApplyTemporaryScope?.(cleaned)
        onClose()
      } else {
        toast.error('Could not save workspace default search scope.')
      }
    } catch (err) {
      toast.error('Error saving workspace default search scope.')
    } finally {
      setIsSavingDefault(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 grid place-items-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white">Quick Search Scope</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Change which months to search for this request</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full grid place-items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Mode Selector */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'all_previous', label: 'All Previous' },
              { id: 'recent', label: 'Recent' },
              { id: 'custom', label: 'Custom' }
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModalSettings((prev) => ({ ...prev, mode: m.id }))}
                className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all ${
                  modalSettings.mode === m.id
                    ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-200'
                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Recent selector */}
          {modalSettings.mode === 'recent' && (
            <div className="flex items-center gap-2 pt-1">
              {[3, 6, 12].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setModalSettings((prev) => ({ ...prev, mode: 'recent', recent_months: num }))}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                    modalSettings.recent_months === num
                      ? 'border-orange-500 bg-orange-600 text-white'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300'
                  }`}
                >
                  {num} months
                </button>
              ))}
            </div>
          )}

          {/* Custom picker */}
          {modalSettings.mode === 'custom' && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-gray-700 dark:text-gray-300">Select months:</span>
                <span className="text-gray-500">{modalSettings.selected_tables.length} selected</span>
              </div>
              <div className="space-y-3 max-h-[30vh] overflow-y-auto pr-1">
                {tablesByYear.map(({ year, months }) => (
                  <div key={year} className="space-y-1.5">
                    <span className="text-[11px] font-bold text-orange-600 dark:text-orange-400">{year}</span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {months.map((m) => {
                        const isCurrent = m.tableName === currentTable
                        const isChecked = modalSettings.selected_tables.includes(m.tableName)
                        if (isCurrent) return null
                        return (
                          <button
                            key={m.tableName}
                            type="button"
                            onClick={() => handleToggleTable(m.tableName)}
                            className={`p-2 text-left rounded-lg border text-xs font-medium transition-all ${
                              isChecked
                                ? 'border-orange-500 bg-orange-50 text-orange-950 font-bold dark:bg-orange-950/40 dark:text-orange-200'
                                : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                            }`}
                          >
                            {m.monthName}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Scope Summary */}
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3 border border-gray-200/80 dark:border-gray-700/80 text-xs space-y-1">
            <p className="font-bold text-gray-900 dark:text-white">
              {formatHistoricalScopeSummary({ settings: modalSettings, monthlyTables, currentTable })}
            </p>
            <p className="text-gray-500 dark:text-gray-400">
              {formatHistoricalScopeDetail({ settings: modalSettings, monthlyTables, currentTable })}
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-2 bg-gray-50/50 dark:bg-gray-900/50">
          {hasAdminAccess ? (
            <button
              type="button"
              onClick={handleSaveAsDefault}
              disabled={isSavingDefault}
              className="w-full sm:w-auto px-3.5 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:text-orange-600 dark:hover:text-orange-400 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Save as workspace default
            </button>
          ) : (
            <div />
          )}

          <div className="w-full sm:w-auto flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyTemporary}
              className="px-4 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-xl transition-colors shadow-sm"
            >
              Use for this search
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(SearchScopeModal)
