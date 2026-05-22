import React from 'react'
import { Type, MousePointer2, Command, Shield, CheckCircle } from 'lucide-react'

const AccessibilitySettingsSection = ({
    preferences,
    updatePreferences,
    getSettingTargetClass
}) => {
    const handleToggleCmdMenu = () => {
        updatePreferences({
            show_command_menu_button: !preferences?.show_command_menu_button
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
