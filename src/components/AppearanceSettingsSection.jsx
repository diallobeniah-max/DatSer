import React, { useCallback, useEffect, useState } from 'react'
import { Sun, Moon, Monitor, Sparkles, CheckCircle, VolumeX, LayoutDashboard, Minimize2, ScanSearch, Type } from 'lucide-react'
import { toast } from 'react-toastify'
import { normalizeMemberNameStyle } from '../utils/memberNameStyle'

const AppearanceSettingsSection = ({
    themeMode,
    setThemeMode,
    preferences,
    updatePreferences,
    isCollaborator,
    canManageWorkspace = !isCollaborator,
    getSettingTargetClass
}) => {
    const themeOptions = [
        { id: 'light', name: 'Light', icon: Sun, color: 'text-orange-500', bg: 'bg-orange-50' },
        { id: 'dark', name: 'Dark', icon: Moon, color: 'text-purple-500', bg: 'bg-purple-50' },
        { id: 'system', name: 'System', icon: Monitor, color: 'text-blue-500', bg: 'bg-blue-50' }
    ]
    const motionAndSoundsEnabled = preferences?.motion_and_sounds_enabled !== false
    const mobileDashboardStatusEnabled = preferences?.mobile_dashboard_status_enabled === true
    const compactUiEnabled = preferences?.compact_ui_enabled === true
    const smartCompactPromptEnabled = preferences?.smart_compact_prompt_enabled !== false
    const memberNameStyle = normalizeMemberNameStyle(preferences?.member_name_style)
    const [optimisticCompactUiEnabled, setOptimisticCompactUiEnabled] = useState(compactUiEnabled)
    const [isSavingCompactUi, setIsSavingCompactUi] = useState(false)
    const [isSavingMemberNameStyle, setIsSavingMemberNameStyle] = useState(false)

    useEffect(() => {
        setOptimisticCompactUiEnabled(compactUiEnabled)
    }, [compactUiEnabled])

    const applyCompactUiClass = useCallback((enabled) => {
        if (typeof document === 'undefined') return
        document.documentElement.classList.toggle('compact-ui', enabled)
        document.body.classList.toggle('compact-ui', enabled)
        document.querySelector('.app-shell')?.classList?.toggle('compact-ui', enabled)
    }, [])

    const handleCompactUiToggle = useCallback(async () => {
        const nextValue = !optimisticCompactUiEnabled
        setOptimisticCompactUiEnabled(nextValue)
        applyCompactUiClass(nextValue)
        setIsSavingCompactUi(true)
        try {
            await updatePreferences?.({ compact_ui_enabled: nextValue })
        } catch (error) {
            console.error('Failed to save Compact UI preference:', error)
            setOptimisticCompactUiEnabled(compactUiEnabled)
            applyCompactUiClass(compactUiEnabled)
        } finally {
            setIsSavingCompactUi(false)
        }
    }, [applyCompactUiClass, compactUiEnabled, optimisticCompactUiEnabled, updatePreferences])

    const handleMemberNameStyleChange = useCallback(async (nextStyle) => {
        if (!canManageWorkspace || isSavingMemberNameStyle || nextStyle === memberNameStyle) return
        setIsSavingMemberNameStyle(true)
        try {
            // SettingsPage removes its optimistic value once the RPC settles.
            // Keeping the RPC silent here guarantees this interaction emits only
            // one clear error when the server rejects the shared preference.
            const saved = await updatePreferences?.({ member_name_style: nextStyle }, { silent: true })
            if (saved !== true) {
                toast.error('Member name style could not be saved. Your previous saved style is still active.')
            }
        } catch (error) {
            console.error('Failed to save member name style:', error)
            toast.error('Member name style could not be saved. Your previous saved style is still active.')
        } finally {
            setIsSavingMemberNameStyle(false)
        }
    }, [canManageWorkspace, isSavingMemberNameStyle, memberNameStyle, updatePreferences])

    const ToggleRow = ({ icon: Icon, title, description, checked, onChange, settingId, disabled = false }) => (
        <div
            data-setting-id={settingId}
            tabIndex={-1}
            className={`flex items-center justify-between gap-4 p-4 ${getSettingTargetClass(settingId)}`}
        >
            <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300">
                    <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white">{title}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
                </div>
            </div>
            <button
                type="button"
                onClick={onChange}
                disabled={disabled}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                    checked ? 'bg-orange-600' : 'bg-gray-200 dark:bg-gray-700'
                } ${disabled ? 'cursor-wait opacity-75' : ''}`}
                aria-pressed={checked}
            >
                <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-300 ease-out ${
                        checked ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
            </button>
        </div>
    )

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Appearance</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Customize how DatSer looks on your device</p>
            </div>

            {/* Theme Mode */}
            <div
                data-setting-id="theme_mode"
                tabIndex={-1}
                className={`space-y-3 ${getSettingTargetClass('theme_mode')}`}
            >
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Theme Mode</h4>
                <div className="grid grid-cols-3 gap-3">
                    {themeOptions.map((option) => {
                        const Icon = option.icon
                        const isActive = themeMode === option.id
                        return (
                            <button
                                key={option.id}
                                onClick={() => setThemeMode(option.id)}
                                className={`relative flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${
                                    isActive
                                        ? 'border-orange-500 bg-orange-50/50 dark:bg-orange-900/20'
                                        : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                                }`}
                            >
                                <Icon className={`w-6 h-6 mb-2 ${isActive ? 'text-orange-600' : 'text-gray-400'}`} />
                                <span className={`text-sm font-semibold ${isActive ? 'text-orange-900 dark:text-orange-100' : 'text-gray-500'}`}>
                                    {option.name}
                                </span>
                                {isActive && (
                                    <div className="absolute top-2 right-2">
                                        <CheckCircle className="w-4 h-4 text-orange-500" />
                                    </div>
                                )}
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Motion and layout */}
            <div
                data-setting-id="member_name_style"
                tabIndex={-1}
                className={`overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white dark:border-emerald-900/60 dark:from-emerald-950/30 dark:to-gray-800 ${getSettingTargetClass('member_name_style')}`}
            >
                <div className="flex gap-3 p-4 sm:p-5">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                        <Type className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <p className="font-semibold text-gray-900 dark:text-white">Member name style</p>
                        <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">Choose how member names appear throughout this workspace. Stored names and matching stay unchanged.</p>
                    </div>
                </div>
                <div className="grid gap-2 px-4 pb-4 sm:grid-cols-3 sm:px-5 sm:pb-5">
                    {[
                        { id: 'lower', token: 'aa', sample: 'john edem adae' },
                        { id: 'title', token: 'Ab', sample: 'John Edem Adae' },
                        { id: 'upper', token: 'AA', sample: 'JOHN EDEM ADAE' }
                    ].map((option) => {
                        const selected = memberNameStyle === option.id
                        return (
                            <button
                                key={option.id}
                                type="button"
                                disabled={!canManageWorkspace || isSavingMemberNameStyle}
                                onClick={() => handleMemberNameStyleChange(option.id)}
                                className={`relative flex min-h-16 items-center gap-3 rounded-xl border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 ${selected
                                    ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm shadow-emerald-500/30'
                                    : 'border-gray-200 bg-white text-gray-800 hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-emerald-700'}`}
                            >
                                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-black ${selected ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>{option.token}</span>
                                <span className="min-w-0">
                                    <span className="block text-xs font-semibold uppercase tracking-wide opacity-80">{option.id}</span>
                                    <span className="block truncate text-sm font-semibold">{option.sample}</span>
                                </span>
                                {selected && <CheckCircle className="ml-auto h-4 w-4 shrink-0" aria-hidden="true" />}
                            </button>
                        )
                    })}
                </div>
                {!canManageWorkspace && <p className="px-4 pb-4 text-xs text-gray-500 dark:text-gray-400 sm:px-5">Only the workspace owner or an admin collaborator can change this shared setting.</p>}
            </div>

            {/* Motion and layout */}
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:divide-gray-700">
                <ToggleRow
                    icon={VolumeX}
                    title="Animations & Sounds"
                    description="Control app motion, transitions, haptics, and click sounds."
                    checked={motionAndSoundsEnabled}
                    settingId="motion_and_sounds"
                    onChange={() => updatePreferences?.({ motion_and_sounds_enabled: !motionAndSoundsEnabled })}
                />
                <ToggleRow
                    icon={LayoutDashboard}
                    title="Phone Dashboard Status Bar"
                    description="Show Recent, date, total, month, and online status on phones. Desktop and tablet always keep this bar visible."
                    checked={mobileDashboardStatusEnabled}
                    settingId="mobile_dashboard_status"
                    onChange={() => updatePreferences?.({ mobile_dashboard_status_enabled: !mobileDashboardStatusEnabled })}
                />
                <ToggleRow
                    icon={Minimize2}
                    title="Compact UI"
                    description="Tighten spacing across DatSer so more information fits on screen."
                    checked={optimisticCompactUiEnabled}
                    settingId="compact_ui"
                    disabled={isSavingCompactUi}
                    onChange={handleCompactUiToggle}
                />
                <ToggleRow
                    icon={ScanSearch}
                    title="Smart Compact Suggestion"
                    description="Suggest Compact UI when the screen or text size may make panels feel crowded."
                    checked={smartCompactPromptEnabled}
                    settingId="smart_compact_prompt"
                    onChange={() => updatePreferences?.({ smart_compact_prompt_enabled: !smartCompactPromptEnabled })}
                />
            </div>

            {/* Premium Aesthetics Notice */}
            <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-2xl p-5 text-white shadow-lg shadow-orange-500/20">
                <div className="flex items-start gap-4">
                    <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
                        <Sparkles className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h4 className="font-bold text-lg">Dynamic Visuals</h4>
                        <p className="text-orange-50/90 text-sm mt-1 leading-relaxed">
                            We've optimized every animation and transition to feel fluid and responsive on all devices. Your theme choices are applied instantly across the entire application.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default React.memo(AppearanceSettingsSection)
