import React, { useEffect, useState } from 'react'
import { Type, MousePointer2, Command, CheckCircle, CalendarDays, BellRing } from 'lucide-react'
import CombinedDatePicker from './CombinedDatePicker'

const AccessibilitySettingsSection = ({
    preferences,
    updatePreferences,
    offlineSaveNoticeThreshold = 10,
    setOfflineSaveNoticeThreshold,
    getSettingTargetClass
}) => {
    const [previewDateOfBirth, setPreviewDateOfBirth] = useState('')
    const [customSaveThreshold, setCustomSaveThreshold] = useState(String(offlineSaveNoticeThreshold || 10))

    useEffect(() => {
        setCustomSaveThreshold(String(offlineSaveNoticeThreshold || 10))
    }, [offlineSaveNoticeThreshold])

    const handleToggleCmdMenu = () => {
        updatePreferences({
            show_command_menu_button: !preferences?.show_command_menu_button
        })
    }

    const dateOfBirthMode = preferences?.date_of_birth_picker_mode || 'combined'
    const setDateOfBirthMode = (mode) => {
        updatePreferences({
            date_of_birth_picker_mode: mode
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Accessibility</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Make DatSer work better for your needs</p>
            </div>

            <div
                data-setting-id="command_menu_button"
                tabIndex={-1}
                className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 ${getSettingTargetClass('command_menu_button')}`}
            >
                <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                            <Command className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div>
                            <p className="font-semibold text-gray-900 dark:text-white">Floating Command Button</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Show a quick-access button for the command menu</p>
                        </div>
                    </div>
                    <button
                        onClick={handleToggleCmdMenu}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${
                            preferences?.show_command_menu_button ? 'bg-orange-600' : 'bg-gray-200 dark:bg-gray-700'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                preferences?.show_command_menu_button ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                            <MousePointer2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <p className="font-semibold text-gray-900 dark:text-white">Touch Vibrations</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Provide haptic feedback on button presses</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-400 dark:text-gray-500 mr-2">Auto-detected</span>
                        <div className="h-6 w-11 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                            <CheckCircle className="w-4 h-4 text-emerald-600" />
                        </div>
                    </div>
                </div>

                <div className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                            <CalendarDays className="w-5 h-5 text-indigo-700 dark:text-indigo-300" />
                        </div>
                        <div>
                            <p className="font-semibold text-gray-900 dark:text-white">Date of Birth Picker</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Choose how the date of birth selector opens in member forms</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setDateOfBirthMode('month-year-first')}
                            className={`px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                                dateOfBirthMode === 'month-year-first'
                                    ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:border-indigo-400 dark:bg-indigo-500/15 dark:text-indigo-200'
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'
                            }`}
                        >
                            Month/year first
                        </button>
                        <button
                            type="button"
                            onClick={() => setDateOfBirthMode('combined')}
                            className={`px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                                dateOfBirthMode === 'combined'
                                    ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:border-indigo-400 dark:bg-indigo-500/15 dark:text-indigo-200'
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'
                            }`}
                        >
                            Day + month + year
                        </button>
                    </div>
                    <div className="mt-4 rounded-2xl border border-orange-200/80 bg-orange-50/60 p-3 shadow-lg shadow-orange-500/10 dark:border-orange-500/25 dark:bg-[#2F3030] dark:shadow-black/30">
                        <p className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300 mb-2">Preview</p>
                        <CombinedDatePicker
                            name="date_of_birth_preview"
                            label="Date of Birth"
                            value={previewDateOfBirth}
                            onChange={(event) => setPreviewDateOfBirth(event.target.value)}
                            placeholder="Tap to preview"
                            birthDateMode={dateOfBirthMode}
                        />
                    </div>
                </div>

                <div className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                            <BellRing className="w-5 h-5 text-orange-600 dark:text-orange-300" />
                        </div>
                        <div>
                            <p className="font-semibold text-gray-900 dark:text-white">Offline Save Notifications</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Only show sync/sync-failed popups while offline after this many saved changes</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {[5, 10, 20].map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setOfflineSaveNoticeThreshold?.(value)}
                                className={`min-h-[40px] rounded-xl border px-4 text-sm font-semibold transition-colors ${
                                    Number(offlineSaveNoticeThreshold) === value
                                        ? 'border-orange-500 bg-orange-50 text-orange-700 dark:border-orange-400 dark:bg-orange-500/15 dark:text-orange-200'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'
                                }`}
                            >
                                {value} saves
                            </button>
                        ))}
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                            type="number"
                            min="1"
                            max="99"
                            value={customSaveThreshold}
                            onChange={(event) => setCustomSaveThreshold(event.target.value)}
                            className="min-h-[42px] flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-gray-700 dark:bg-gray-900/40 dark:text-white"
                            placeholder="Custom number"
                        />
                        <button
                            type="button"
                            onClick={() => setOfflineSaveNoticeThreshold?.(customSaveThreshold)}
                            className="min-h-[42px] rounded-xl bg-orange-600 px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700"
                        >
                            Apply
                        </button>
                    </div>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        Current setting: after {offlineSaveNoticeThreshold || 10} offline save{Number(offlineSaveNoticeThreshold) === 1 ? '' : 's'}.
                    </p>
                </div>
            </div>

            {/* Keyboard Shortcuts Notice */}
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
                <h4 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <Type className="w-4 h-4" />
                    Keyboard Shortcuts
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                        { key: 'Cmd + K', desc: 'Open Command Menu' },
                        { key: 'Cmd + /', desc: 'Toggle Sidebar' },
                        { key: 'Cmd + S', desc: 'Open Settings' },
                        { key: 'Esc', desc: 'Close any modal' }
                    ].map((item) => (
                        <div key={item.key} className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                            <span className="text-xs text-gray-500 dark:text-gray-400">{item.desc}</span>
                            <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[10px] font-mono font-bold text-gray-600 dark:text-gray-300 border-b-2 border-gray-300 dark:border-gray-600">
                                {item.key}
                            </kbd>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default React.memo(AccessibilitySettingsSection)
