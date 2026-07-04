import React from 'react'
import { Building2, ChevronDown, CheckCircle, RefreshCw, Calendar, Sparkles } from 'lucide-react'
import MonthPickerPopup from './MonthPickerPopup'

const WorkspaceSettingsSection = ({
    preferences,
    isCollaborator,
    isAdminCollaborator,
    currentTable,
    selectedAttendanceDate,
    lockedDefaultDate,
    monthlyTables,
    isOverrideSaving,
    handleEnableOverride,
    handleDisableOverride,
    handleOverrideSundaySelect,
    toggleWorkspacePanel,
    workspacePanels,
    getSettingTargetClass,
    showOverridePicker,
    setShowOverridePicker,
    overrideButtonRef,
    isLiveNow,
    liveMonthExists,
    liveSundayDateKey,
    getMonthDisplayName,
    handleQuickCreateMonth
}) => {
    const hasAdminAccess = !isCollaborator || isAdminCollaborator
    const isOverrideActive = Boolean(lockedDefaultDate)

    const renderWorkspacePanel = (panelKey, title, description, iconClassName, icon, children) => {
        const Icon = icon
        const panelSettingIds = {
            overview: 'workspace_stats',
            controls: 'auto_all_dates',
            months: 'current_month'
        }
        const panelSettingId = panelSettingIds[panelKey]

        return (
            <div
                data-setting-id={panelSettingId}
                tabIndex={-1}
                className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden ${getSettingTargetClass(panelSettingId)}`}
            >
                <button
                    type="button"
                    onClick={() => toggleWorkspacePanel(panelKey)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${iconClassName}`}>
                            <Icon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                            <h4 className="font-semibold text-gray-900 dark:text-white">{title}</h4>
                            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1">{description}</p>
                        </div>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${workspacePanels[panelKey] ? 'rotate-180' : ''}`} />
                </button>
                {workspacePanels[panelKey] && (
                    <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 animate-in slide-in-from-top-2 duration-200">
                        {children}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Workspace Settings</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Configure your ministry workspace and calendar behavior</p>
            </div>

            {/* Header / Info */}
            <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 dark:from-orange-500/5 dark:to-transparent rounded-2xl border border-orange-200/50 dark:border-orange-900/30 p-5">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                        <Building2 className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div>
                        <h4 className="font-bold text-gray-900 dark:text-white text-lg">
                            {preferences?.workspace_name || 'TMH Teen Ministry'}
                        </h4>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">
                                {isCollaborator ? 'Collaborator' : 'Owner'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Controls Panel */}
            <div className="space-y-4">
                {renderWorkspacePanel(
                    'controls',
                    'Attendance Controls',
                    'Manage global overrides and schedule settings',
                    'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
                    Building2,
                    <div className="pt-4 space-y-4">
                        {/* Global Override (Admin only) */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                        Override All Collaborators
                                        {isOverrideActive && <span className="flex h-2 w-2 rounded-full bg-orange-500 animate-pulse" />}
                                    </p>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        Force every collaborator to use a specific month and Sunday date.
                                    </p>
                                </div>
                                <div className="flex-shrink-0">
                                    {!hasAdminAccess ? (
                                        <div className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs text-gray-500">Admin only</div>
                                    ) : isOverrideActive ? (
                                        <button
                                            onClick={handleDisableOverride}
                                            disabled={isOverrideSaving}
                                            className="btn-press px-3 py-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-all duration-150 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isOverrideSaving ? 'Saving...' : 'Disable'}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleEnableOverride()}
                                            disabled={isOverrideSaving}
                                            className="btn-press px-3 py-1.5 rounded-lg bg-orange-600 text-white hover:bg-orange-700 transition-all duration-150 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isOverrideSaving ? 'Saving...' : 'Enable'}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {isOverrideActive && hasAdminAccess && (
                                <div className="p-3 rounded-xl bg-orange-50 dark:bg-orange-950/30 border border-orange-100 dark:border-orange-900/50 space-y-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2 text-sm">
                                            <Calendar className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                                            <span className="text-gray-700 dark:text-gray-300">
                                                Locked to: <span className="font-bold text-gray-900 dark:text-white">
                                                    {getMonthDisplayName(currentTable)} ({selectedAttendanceDate?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})
                                                </span>
                                            </span>
                                        </div>
                                        <div className="relative" ref={overrideButtonRef}>
                                            <button
                                                onClick={() => setShowOverridePicker(!showOverridePicker)}
                                                className="px-2.5 py-1 rounded-md border border-orange-200 dark:border-orange-800 bg-white dark:bg-gray-900 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:bg-orange-50 transition-colors flex items-center gap-1.5"
                                            >
                                                Change
                                                <ChevronDown className="w-3 h-3" />
                                            </button>

                                            {showOverridePicker && (
                                                <div className="absolute top-full right-0 mt-2 z-[60]">
                                                    <MonthPickerPopup
                                                        onClose={() => setShowOverridePicker(false)}
                                                        onSelect={handleOverrideSundaySelect}
                                                        monthlyTables={monthlyTables}
                                                        currentTable={currentTable}
                                                        selectedDate={selectedAttendanceDate}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="h-px bg-gray-100 dark:bg-gray-700" />

                        {/* Status Check */}
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold text-gray-900 dark:text-white">Calendar Mode</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {isOverrideActive ? 'Locked to admin override' : isLiveNow ? 'Live: following real-time Sunday' : 'Custom: manual navigation active'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {isLiveNow && !isOverrideActive ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold uppercase tracking-wider">
                                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        Live
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-bold uppercase tracking-wider">
                                        {isOverrideActive ? 'Override' : 'Custom'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default React.memo(WorkspaceSettingsSection)
