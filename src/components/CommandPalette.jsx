import React, { useState, useEffect, useRef } from 'react'
import { ArrowRight, CheckCircle2, Download, ExternalLink, LogOut, Maximize2, Moon, Search, Settings, SlidersHorizontal, Sparkles, Sun, UserPlus, Zap } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import {
    APP_VIEWS,
    SETTINGS_SECTIONS,
    getVisibleSettingsSearchItems,
    searchSettingsIndex
} from '../config/navigation.js'

const CommandPalette = ({ setCurrentView, onAddMember, isExecutive = false, onNavigateToSettingsSection }) => {
    const [isOpen, setIsOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [quickLookOverrideId, setQuickLookOverrideId] = useState(null)
    const [splitPercent, setSplitPercent] = useState(() => {
        if (typeof window === 'undefined') return 46
        const saved = Number(window.localStorage.getItem('datser_command_palette_split_percent'))
        return Number.isFinite(saved) ? Math.min(62, Math.max(34, saved)) : 46
    })
    const paletteShellRef = useRef(null)
    const inputRef = useRef(null)

    const { isDarkMode, toggleTheme, themeMode, setThemeMode, commandKEnabled, setCommandKEnabled } = useTheme()
    const { signOut, preferences, saveUserPreferences } = useAuth()
    const settingsPreviewEnabled = preferences?.settings_search_quick_actions_enabled !== false
    const autoScanSettingsEnabled = preferences?.command_palette_auto_scan_settings !== false

    const updatePreferences = (patch) => {
        saveUserPreferences?.({
            ...(preferences || {}),
            ...patch
        })
    }

    // Toggle open on Ctrl+K or Cmd+K
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!commandKEnabled) return
            if ((e.ctrlKey || e.metaKey) && e.key?.toLowerCase() === 'k') {
                e.preventDefault()
                setIsOpen(prev => !prev)
            }
            if (e.key === 'Escape') {
                setIsOpen(false)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [commandKEnabled])

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 50)
        } else {
            setQuery('')
            setSelectedIndex(0)
            setQuickLookOverrideId(null)
        }
    }, [isOpen])

    useEffect(() => {
        if (typeof window === 'undefined') return
        window.localStorage.setItem('datser_command_palette_split_percent', String(Math.round(splitPercent)))
    }, [splitPercent])

    const defaultActions = [
        {
            id: 'add-member',
            label: 'Add New Member',
            icon: UserPlus,
            category: 'actions',
            shortcut: 'N',
            action: () => {
                if (onAddMember) onAddMember()
                setIsOpen(false)
            }
        },
        {
            id: 'export-data',
            label: 'Export Data',
            icon: Download,
            category: 'actions',
            shortcut: 'E',
            action: () => {
                setCurrentView('settings')
                if (onNavigateToSettingsSection) onNavigateToSettingsSection('data')
                setIsOpen(false)
            }
        },
        {
            id: 'theme',
            label: isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode',
            icon: isDarkMode ? Sun : Moon,
            category: 'theme',
            shortcut: 'T',
            action: () => {
                toggleTheme()
                setIsOpen(false)
            }
        },
        {
            id: 'logout',
            label: 'Log Out',
            icon: LogOut,
            category: 'account',
            shortcut: 'L',
            action: () => {
                signOut()
                setIsOpen(false)
            }
        }
    ]

    const navActions = APP_VIEWS.filter(view => {
        if (view.requiresExec && !isExecutive) return false
        return true
    }).map(view => ({
        id: view.id,
        label: `Go to ${view.label}`,
        icon: view.icon,
        category: 'navigation',
        action: () => {
            setCurrentView(view.id)
            setIsOpen(false)
        }
    }))

    const settingsSections = SETTINGS_SECTIONS.filter(section => !section.requiresDeveloper || import.meta.env.DEV)

    const settingsSectionActions = settingsSections.map(sec => ({
        id: 'settings-' + sec.id,
        label: 'Settings > ' + sec.label,
        icon: sec.icon,
        category: 'settings',
        type: 'setting-section',
        sectionId: sec.id,
        description: sec.content || '',
        aliases: (sec.keywords || '') + ' ' + (sec.content || ''),
        action: () => {
            setCurrentView('settings')
            if (onNavigateToSettingsSection) onNavigateToSettingsSection(sec.id)
            setIsOpen(false)
        }
    }))

    const settingsItemActions = autoScanSettingsEnabled ? getVisibleSettingsSearchItems(import.meta.env.DEV).map(item => {
        const section = settingsSections.find(candidate => candidate.id === item.section)
        return {
            id: 'setting-item-' + item.id,
            label: 'Settings > ' + item.label,
            icon: item.icon || section?.icon || Settings,
            category: 'settings',
            type: 'setting-item',
            sectionId: item.section,
            settingId: item.id,
            sectionLabel: section?.label,
            description: item.description,
            shortcut: item.shortcut,
            aliases: [
                item.keywords,
                item.description,
                item.shortcut,
                section?.label,
                section?.keywords,
                section?.content
            ].filter(Boolean).join(' '),
            action: () => {
                setCurrentView('settings')
                if (onNavigateToSettingsSection) {
                    onNavigateToSettingsSection({ section: item.section, settingId: item.id })
                }
                setIsOpen(false)
            }
        }
    }) : []

    const actions = [...navActions, ...settingsSectionActions, ...settingsItemActions, ...defaultActions]

    const filteredActions = query.trim()
        ? [
            ...actions.filter(action => {
                const target = (action.label + ' ' + (action.description || '') + ' ' + (action.aliases || '') + ' ' + (action.shortcut || '')).toLowerCase()
                return query.toLowerCase().split(/\s+/).filter(Boolean).every(token => target.includes(token))
            }),
            ...searchSettingsIndex(query, autoScanSettingsEnabled ? getVisibleSettingsSearchItems(import.meta.env.DEV) : [], settingsSections)
                .map(item => actions.find(action => action.id === 'setting-item-' + item.id))
                .filter(Boolean)
        ].filter((action, index, list) => list.findIndex(candidate => candidate.id === action.id) === index)
        : actions

    // Group actions by category
    const groupedActions = filteredActions.reduce((groups, action) => {
        if (!groups[action.category]) {
            groups[action.category] = []
        }
        groups[action.category].push(action)
        return groups
    }, {})
    
    const categoryTitles = {
        navigation: 'Navigation',
        settings: 'Settings',
        actions: 'Quick Actions',
        theme: 'Theme',
        help: 'Help',
        account: 'Account'
    }

    const openSettingAction = (action) => {
        if (!action) return
        setCurrentView('settings')
        if (onNavigateToSettingsSection) {
            if (action.type === 'setting-item') {
                onNavigateToSettingsSection({ section: action.sectionId, settingId: action.settingId })
            } else {
                onNavigateToSettingsSection(action.sectionId || action.id?.replace('settings-', ''))
            }
        }
        setIsOpen(false)
    }

    const handleSelect = (action) => {
        action.action()
        setIsOpen(false)
    }

    const handleResultClick = (action, globalIndex) => {
        setSelectedIndex(globalIndex)
        const canUsePreviewPane = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
        if (settingsPreviewEnabled && canUsePreviewPane && action.category === 'settings') return
        handleSelect(action)
    }

    const selectedAction = filteredActions[selectedIndex] || filteredActions[0]
    const showSettingsPreview = selectedAction?.category === 'settings' && (
        settingsPreviewEnabled || quickLookOverrideId === selectedAction.id
    )
    const SelectedIcon = selectedAction?.icon || Settings
    const selectedSectionId = selectedAction?.sectionId || selectedAction?.id?.replace('settings-', '')
    const selectedSection = settingsSections.find(section => section.id === selectedSectionId)
    const selectedSectionItems = autoScanSettingsEnabled
        ? getVisibleSettingsSearchItems(import.meta.env.DEV).filter(item => item.section === selectedSectionId)
        : []
    const selectedPath = selectedAction?.category === 'settings'
        ? ['Settings', selectedAction.sectionLabel || selectedSection?.label, selectedAction.type === 'setting-item' ? selectedAction.label.replace(/^Settings > /, '') : null]
            .filter(Boolean)
            .join(' / ')
        : ''

    const renderQuickControls = () => {
        if (!selectedAction || selectedAction.category !== 'settings') return null
        const settingId = selectedAction.settingId || selectedAction.sectionId
        if (['theme_light', 'theme_dark', 'theme_auto', 'appearance'].includes(settingId)) {
            const options = [
                { id: 'light', label: 'Light', icon: Sun },
                { id: 'dark', label: 'Dark', icon: Moon },
                { id: 'system', label: 'System', icon: Settings }
            ]
            return (
                <div className="grid grid-cols-3 gap-2">
                    {options.map(option => (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => setThemeMode(option.id)}
                            className={`rounded-xl border px-3 py-3 text-sm font-bold transition-colors ${
                                themeMode === option.id
                                    ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                                    : 'border-white/10 bg-white/5 text-gray-300 hover:border-orange-400/60'
                            }`}
                        >
                            <option.icon className="mx-auto mb-1 h-4 w-4" />
                            {option.label}
                        </button>
                    ))}
                </div>
            )
        }

        if (settingId === 'command_menu' || settingId === 'accessibility') {
            return (
                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={() => setCommandKEnabled(!commandKEnabled)}
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left"
                    >
                        <span>
                            <span className="block font-bold text-white">Command menu shortcut</span>
                            <span className="text-sm text-gray-400">Ctrl/Cmd + K</span>
                        </span>
                        <span className={`h-7 w-12 rounded-full p-1 transition-colors ${commandKEnabled ? 'bg-orange-600' : 'bg-gray-700'}`}>
                            <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${commandKEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => updatePreferences({ settings_search_quick_actions_enabled: !settingsPreviewEnabled })}
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left"
                    >
                        <span>
                            <span className="block font-bold text-white">Settings preview in search</span>
                            <span className="text-sm text-gray-400">Preview before opening full Settings</span>
                        </span>
                        <span className={`h-7 w-12 rounded-full p-1 transition-colors ${settingsPreviewEnabled ? 'bg-orange-600' : 'bg-gray-700'}`}>
                            <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${settingsPreviewEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => updatePreferences({ command_palette_auto_scan_settings: !autoScanSettingsEnabled })}
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left"
                    >
                        <span>
                            <span className="block font-bold text-white">Auto-scan new settings</span>
                            <span className="text-sm text-gray-400">Add new panels to search automatically</span>
                        </span>
                        <span className={`h-7 w-12 rounded-full p-1 transition-colors ${autoScanSettingsEnabled ? 'bg-orange-600' : 'bg-gray-700'}`}>
                            <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${autoScanSettingsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </span>
                    </button>
                </div>
            )
        }

        return (
            <div className="space-y-3">
                {selectedSectionItems.length > 0 ? (
                    selectedSectionItems.map(item => {
                        const ItemIcon = item.icon || selectedSection?.icon || Settings
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => openSettingAction({
                                    type: 'setting-item',
                                    sectionId: item.section,
                                    settingId: item.id
                                })}
                                className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition-colors hover:border-orange-400/50 hover:bg-orange-500/10"
                            >
                                <span className="flex min-w-0 items-center gap-3">
                                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/8 text-orange-200">
                                        <ItemIcon className="h-4 w-4" />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block truncate font-bold text-white">{item.label}</span>
                                        <span className="block truncate text-sm text-gray-400">{item.description}</span>
                                    </span>
                                </span>
                                <ArrowRight className="h-4 w-4 shrink-0 text-orange-300" />
                            </button>
                        )
                    })
                ) : (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
                        This panel is ready to open in Settings. More direct controls will appear here as panel actions are added to the search index.
                    </div>
                )}
            </div>
        )
    }

    const beginDividerDrag = (event) => {
        event.preventDefault()
        const pointerId = event.pointerId
        event.currentTarget.setPointerCapture?.(pointerId)
        const handlePointerMove = (moveEvent) => {
            const rect = paletteShellRef.current?.getBoundingClientRect()
            if (!rect) return
            const next = ((moveEvent.clientX - rect.left) / rect.width) * 100
            setSplitPercent(Math.min(62, Math.max(34, next)))
        }
        const cleanup = () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', cleanup)
            window.removeEventListener('pointercancel', cleanup)
        }
        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', cleanup)
        window.addEventListener('pointercancel', cleanup)
    }

    // Handle arrow navigation
    const handleInputKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (filteredActions.length > 0) {
                setSelectedIndex(prev => (prev + 1) % filteredActions.length)
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (filteredActions.length > 0) {
                setSelectedIndex(prev => (prev - 1 + filteredActions.length) % filteredActions.length)
            }
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if (filteredActions[selectedIndex]) {
                const action = filteredActions[selectedIndex]
                if ((e.ctrlKey || e.metaKey) && action.category === 'settings') {
                    setQuickLookOverrideId(action.id)
                    return
                }
                handleSelect(action)
            } else if (query.trim().toLowerCase().includes('setting')) {
                setCurrentView('settings')
                setIsOpen(false)
            }
        }
    }

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setIsOpen(false)}
        >
            <div
                className={`w-full ${showSettingsPreview ? 'max-w-5xl' : 'max-w-lg'} bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700 animate-in zoom-in-95 duration-200`}
                onClick={e => e.stopPropagation()}
                ref={paletteShellRef}
            >
                <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <Search className="w-5 h-5 text-gray-400 mr-3" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="flex-1 bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-lg h-10"
                        placeholder="Type a command or search..."
                        value={query}
                        onChange={e => {
                            setQuery(e.target.value)
                            setSelectedIndex(0)
                        }}
                        onKeyDown={handleInputKeyDown}
                    />
                    <button
                        onClick={() => setIsOpen(false)}
                        className="px-2 py-1 text-xs font-medium text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-400 rounded"
                    >
                        ESC
                    </button>
                </div>

                <div
                    className={showSettingsPreview ? 'grid max-h-[64vh]' : ''}
                    style={showSettingsPreview ? { gridTemplateColumns: `${splitPercent}% 12px minmax(320px, 1fr)` } : undefined}
                >
                    <div className="datser-command-scroll max-h-[60vh] overflow-y-auto py-2">
                        {filteredActions.length === 0 ? (
                            <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                                No results found.
                            </div>
                        ) : (
                            <div className="px-2">
                                {Object.entries(groupedActions).map(([category, categoryActions], categoryIndex) => {
                                    const categoryStartIndex = Object.values(groupedActions)
                                        .slice(0, categoryIndex)
                                        .reduce((sum, actions) => sum + actions.length, 0)

                                    return (
                                        <div key={category} className="mb-4">
                                            <div className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 py-2">
                                                {categoryTitles[category] || category}
                                            </div>
                                            {categoryActions.map((action, index) => {
                                                const globalIndex = categoryStartIndex + index
                                                return (
                                                    <button
                                                        key={action.id}
                                                        onClick={() => handleResultClick(action, globalIndex)}
                                                        className={`w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors text-left
                            ${globalIndex === selectedIndex
                                                                ? 'bg-primary-50 dark:bg-orange-900/30 text-primary-700 dark:text-orange-200'
                                                                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                                                            }`}
                                                    >
                                                        <div className="flex min-w-0 items-center gap-3">
                                                            <action.icon className={`w-5 h-5 shrink-0 ${globalIndex === selectedIndex ? 'text-primary-600 dark:text-orange-300' : 'text-gray-400'}`} />
                                                            <span className="truncate font-medium">{action.label}</span>
                                                        </div>
                                                        <div className="ml-3 flex items-center gap-2">
                                                            {action.shortcut && (
                                                                <span className={`text-xs px-1.5 py-0.5 rounded border
                              ${globalIndex === selectedIndex
                                                                        ? 'bg-white dark:bg-gray-800 border-primary-200 dark:border-orange-800 text-primary-600 dark:text-orange-300'
                                                                        : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500'
                                                                    }`}>
                                                                    {action.shortcut}
                                                                </span>
                                                            )}
                                                            {action.category === 'settings' && (
                                                                <span className="rounded-md border border-orange-400/30 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-orange-300">
                                                                    Ctrl Enter
                                                                </span>
                                                            )}
                                                        </div>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {showSettingsPreview && (
                        <>
                        <button
                            type="button"
                            aria-label="Resize command menu preview"
                            onPointerDown={beginDividerDrag}
                            className="hidden cursor-col-resize border-x border-white/5 bg-gray-900/80 transition-colors hover:bg-orange-500/20 md:flex md:items-center md:justify-center"
                        >
                            <span className="h-16 w-1 rounded-full bg-white/20 shadow-inner" />
                        </button>
                        <aside className="datser-command-scroll hidden overflow-y-auto bg-gray-950 p-5 text-white md:block">
                            <div className="mb-5 flex items-start justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-orange-500/15 text-orange-300 ring-1 ring-orange-400/30">
                                        <SelectedIcon className="h-6 w-6" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-black uppercase tracking-wide text-orange-300">Quick Look</p>
                                        <h3 className="truncate text-xl font-black">{selectedAction.label.replace(/^Settings > /, '')}</h3>
                                        <p className="truncate text-sm text-gray-400">{selectedPath}</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => openSettingAction(selectedAction)}
                                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-orange-400/40 bg-orange-500/10 text-orange-200 hover:bg-orange-500/20"
                                    aria-label="Open full setting page"
                                    title="Open full setting page"
                                >
                                    <Maximize2 className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                                <div className="mb-2 flex items-center gap-2 text-sm font-bold text-orange-200">
                                    <Sparkles className="h-4 w-4" />
                                    Quick preview
                                </div>
                                <p className="text-sm leading-6 text-gray-300">
                                    {selectedAction.description || 'Open this setting directly, or make quick changes here when available.'}
                                </p>
                            </div>

                            <div className="mb-5">
                                {renderQuickControls()}
                            </div>

                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => openSettingAction(selectedAction)}
                                    className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-black text-white hover:bg-orange-500"
                                >
                                    <ExternalLink className="h-4 w-4" />
                                    Open in Settings
                                </button>
                                <button
                                    type="button"
                                    onClick={() => updatePreferences({ command_palette_auto_scan_settings: !autoScanSettingsEnabled })}
                                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-gray-200 hover:border-orange-400/50"
                                    title="Toggle automatic settings discovery"
                                >
                                    {autoScanSettingsEnabled ? <CheckCircle2 className="h-4 w-4 text-orange-300" /> : <SlidersHorizontal className="h-4 w-4" />}
                                    Auto
                                </button>
                            </div>
                        </aside>
                        </>
                    )}
                </div>

                <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 flex justify-between">
                    <span>Use arrow keys to navigate - type to search settings and actions</span>
                    <span>DatSer v1.2</span>
                </div>
            </div>
        </div>
    )
}

export default CommandPalette
