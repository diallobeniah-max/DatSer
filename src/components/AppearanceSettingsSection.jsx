import React from 'react'
import { Sun, Moon, Monitor, Layout, Sparkles, CheckCircle } from 'lucide-react'

const AppearanceSettingsSection = ({
    themeMode,
    setThemeMode,
    compactMode,
    toggleCompactMode,
    isCollaborator,
    getSettingTargetClass
}) => {
    const themeOptions = [
        { id: 'light', name: 'Light', icon: Sun, color: 'text-orange-500', bg: 'bg-orange-50' },
        { id: 'dark', name: 'Dark', icon: Moon, color: 'text-purple-500', bg: 'bg-purple-50' },
        { id: 'system', name: 'System', icon: Monitor, color: 'text-blue-500', bg: 'bg-blue-50' }
    ]

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

            {/* Layout Options */}
            <div
                data-setting-id="compact_mode"
                tabIndex={-1}
                className={`space-y-3 ${getSettingTargetClass('compact_mode')}`}
            >
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Layout & Density</h4>
                <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                    <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                                <Layout className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                                <p className="font-semibold text-gray-900 dark:text-white">Compact Mode</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Reduce padding and text size to show more content</p>
                            </div>
                        </div>
                        <button
                            onClick={toggleCompactMode}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${
                                compactMode ? 'bg-orange-600' : 'bg-gray-200 dark:bg-gray-700'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    compactMode ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                </div>
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
