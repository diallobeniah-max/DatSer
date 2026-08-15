import React from 'react'
import { Download, Upload, RefreshCw, Trash2, Archive, ChevronLeft, Loader2 } from 'lucide-react'
import SearchOtherMonthsSettingsSection from './SearchOtherMonthsSettingsSection'
import OfflineSyncHealthSection from './OfflineSyncHealthSection'

const DataSettingsSection = ({
    offlineModeStatus,
    offlineMode,
    setOfflineMode,
    pendingSyncCount,
    offlineCacheMeta,
    isPreparingOffline,
    isSyncingOffline,
    prepareOfflineData,
    syncOfflineChanges,
    clearOfflineCacheData,
    isOnline,
    dataOwnerId,
    offlinePendingChanges,
    monthlyTables,
    currentTable,
    members,
    setShowExportCenter,
    setArchiveMonth,
    getSettingTargetClass
}) => {
    const offlineBadgeClass = offlineModeStatus === 'forced-offline'
        ? 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
        : offlineModeStatus === 'offline'
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
            : offlineModeStatus === 'online-unavailable'
                ? 'bg-red-100 text-red-800 dark:bg-red-900/35 dark:text-red-200'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    
    const offlineBadgeDotClass = offlineModeStatus === 'forced-offline'
        ? 'bg-slate-500'
        : offlineModeStatus === 'offline'
            ? 'bg-amber-600'
            : offlineModeStatus === 'online-unavailable'
                ? 'bg-red-500'
                : 'bg-emerald-500'

    const offlineBadgeLabel = offlineModeStatus === 'forced-offline'
        ? 'Forced Offline'
        : offlineModeStatus === 'offline'
            ? 'Offline'
            : offlineModeStatus === 'online-unavailable'
                ? 'Online unavailable'
                : 'Online'

    const offlineCardAccentClass = offlineMode === 'offline'
        ? 'border-amber-300/90 dark:border-amber-800/70'
        : 'border-orange-200/80 dark:border-orange-900/60'

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Search & Data Management</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Configure historical search scope, offline sync, exports, and databases</p>
            </div>

            <SearchOtherMonthsSettingsSection getSettingTargetClass={getSettingTargetClass} />

            <div
                data-setting-id="offline_mode"
                tabIndex={-1}
                className={`relative overflow-hidden rounded-2xl border ${offlineCardAccentClass} bg-white dark:bg-gray-800 shadow-sm ${getSettingTargetClass('offline_mode')}`}
            >
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-amber-400 to-orange-600" />
                <div className="p-4 sm:p-5">
                    <div className="flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-5">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-start">
                                <div className="min-w-0 w-full">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-semibold text-gray-900 dark:text-white">Offline Mode</p>
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${offlineBadgeClass}`}>
                                            <span className={`w-2 h-2 rounded-full ${offlineBadgeDotClass}`} />
                                            {offlineBadgeLabel}
                                        </span>
                                        {pendingSyncCount > 0 && (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                                                <RefreshCw className="w-3.5 h-3.5" />
                                                {pendingSyncCount} pending
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1.5 max-w-2xl">
                                        Cache members and attendance on this device, then keep attendance changes safe when the APK is offline.
                                    </p>
                                    <p className="mt-2 text-xs font-medium text-orange-700 dark:text-orange-300">
                                        Auto mode now prepares a fresh local copy after login and refreshes it when the device cache falls behind.
                                    </p>
                                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Mode:</span>
                                        <div className="inline-grid grid-cols-3 rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-900/50">
                                            {[
                                                { id: 'auto', label: 'Auto' },
                                                { id: 'online', label: 'Online' },
                                                { id: 'offline', label: 'Offline' }
                                            ].map((mode) => (
                                                <button
                                                    key={mode.id}
                                                    type="button"
                                                    onClick={() => setOfflineMode(mode.id)}
                                                    className={`min-h-[36px] rounded-lg px-3 text-sm font-semibold transition-colors ${
                                                        offlineMode === mode.id
                                                            ? 'bg-orange-600 text-white shadow-sm'
                                                            : 'text-gray-600 hover:bg-white hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                                                    }`}
                                                >
                                                    {mode.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                <div className="rounded-xl bg-orange-50/70 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/40 p-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300">Last cache</p>
                                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                                        {offlineCacheMeta?.cached_at ? new Date(offlineCacheMeta.cached_at).toLocaleString() : 'Not prepared yet'}
                                    </p>
                                </div>
                                <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 p-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Cached data</p>
                                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                                        {offlineCacheMeta ? `${offlineCacheMeta.member_count} members` : 'No local cache'}
                                    </p>
                                </div>
                                <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 p-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Sync status</p>
                                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                                        {isSyncingOffline ? 'Syncing now' : pendingSyncCount > 0 ? `${pendingSyncCount} waiting` : 'Up to date'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="w-full lg:w-[260px] flex-shrink-0 rounded-2xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 p-3">
                            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2">
                                <button
                                    type="button"
                                    onClick={prepareOfflineData}
                                    disabled={isPreparingOffline || !isOnline}
                                    className="min-h-[44px] px-3 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 disabled:text-white/80 disabled:cursor-not-allowed text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
                                >
                                    {isPreparingOffline ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                    {isPreparingOffline ? 'Refreshing...' : 'Refresh data'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => syncOfflineChanges({ manual: true })}
                                    disabled={isSyncingOffline || !isOnline || offlineMode === 'offline' || pendingSyncCount === 0}
                                    className="min-h-[44px] px-3 py-2 rounded-xl border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300 bg-white dark:bg-gray-900 hover:bg-orange-50 dark:hover:bg-orange-900/30 disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-500 disabled:border-gray-200 dark:disabled:border-gray-700 disabled:cursor-not-allowed text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                                >
                                    <RefreshCw className={`w-4 h-4 ${isSyncingOffline ? 'animate-spin' : ''}`} />
                                    {isSyncingOffline ? 'Syncing...' : 'Sync Now'}
                                </button>
                                <button
                                    type="button"
                                    onClick={clearOfflineCacheData}
                                    disabled={isPreparingOffline || isSyncingOffline}
                                    className="min-h-[44px] px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-500 disabled:cursor-not-allowed text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Clear Cache
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

<OfflineSyncHealthSection
                isOnline={isOnline}
                offlineModeStatus={offlineModeStatus}
                offlineCacheMeta={offlineCacheMeta}
                offlinePendingChanges={offlinePendingChanges}
            />

            {/* Export/Import/Archive */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                <button
                    onClick={() => setShowExportCenter?.(true)}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                            <Download className="w-5 h-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div className="text-left">
                            <p className="font-medium text-gray-900 dark:text-white">Export Center</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Select months, preview, and export CSV</p>
                        </div>
                    </div>
                    <ChevronLeft className="w-5 h-5 text-gray-400 rotate-180" />
                </button>

                {monthlyTables && monthlyTables.length > 0 && (
                    <div className="p-4">
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                            <Archive className="w-4 h-4 text-amber-500" />
                            Archive Months
                        </h4>
                        <div className="space-y-2">
                            {monthlyTables.map(table => (
                                <div key={table} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-900/40">
                                    <span className="text-sm text-gray-900 dark:text-white">{table.replace('_', ' ')}</span>
                                    <button
                                        onClick={() => setArchiveMonth(table)}
                                        className="text-xs font-semibold text-amber-600 hover:underline"
                                    >
                                        Archive
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default React.memo(DataSettingsSection)
