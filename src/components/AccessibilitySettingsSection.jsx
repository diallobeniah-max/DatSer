import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Type, MousePointer2, Command, BellRing, Clock3, Search, Share2, Copy, MessageCircle, Mail, QrCode, X, RefreshCw } from 'lucide-react'

const AccessibilitySettingsSection = ({
    preferences,
    updatePreferences,
    offlineSaveNoticeThreshold = 10,
    setOfflineSaveNoticeThreshold,
    notificationDurationMs = 6500,
    setNotificationDurationMs,
    searchSuggestionView = 'short',
    setSearchSuggestionView,
    getSettingTargetClass
}) => {
    const [customSaveThreshold, setCustomSaveThreshold] = useState(String(offlineSaveNoticeThreshold || 10))
    const [customDurationMs, setCustomDurationMs] = useState(String(notificationDurationMs || 6500))
    const [isQrExpanded, setIsQrExpanded] = useState(false)
    const hapticFeedbackEnabled = preferences?.haptic_feedback_enabled !== false
    const hapticFeedbackStrength = Number(preferences?.haptic_feedback_strength || 1)
    const settingsSearchQuickActionsEnabled = preferences?.settings_search_quick_actions_enabled !== false
    const commandPaletteAutoScanEnabled = preferences?.command_palette_auto_scan_settings !== false
    const appShareUrl = typeof window !== 'undefined' ? `${window.location.origin}${import.meta.env?.BASE_URL || '/'}` : ''
    const shareText = 'Open DatSer here:'
    const qrCodeUrl = appShareUrl
        ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(appShareUrl)}`
        : ''

    useEffect(() => {
        setCustomSaveThreshold(String(offlineSaveNoticeThreshold || 10))
    }, [offlineSaveNoticeThreshold])

    useEffect(() => {
        setCustomDurationMs(String(notificationDurationMs || 6500))
    }, [notificationDurationMs])

    const handleToggleCmdMenu = () => {
        updatePreferences({
            show_command_menu_button: !preferences?.show_command_menu_button
        })
    }

    const updateHapticPreference = (patch) => {
        if (typeof window !== 'undefined') {
            try {
                if (Object.prototype.hasOwnProperty.call(patch, 'haptic_feedback_enabled')) {
                    window.localStorage.setItem('datser_haptic_feedback_enabled', String(patch.haptic_feedback_enabled))
                }
                if (Object.prototype.hasOwnProperty.call(patch, 'haptic_feedback_strength')) {
                    window.localStorage.setItem('datser_haptic_feedback_strength', String(patch.haptic_feedback_strength))
                }
            } catch { }
        }
        updatePreferences?.(patch)
    }

    const copyShareLink = async () => {
        if (!appShareUrl || typeof navigator === 'undefined') return
        await navigator.clipboard?.writeText(appShareUrl)
    }

    const shareWebsite = async () => {
        if (!appShareUrl || typeof navigator === 'undefined') return
        if (navigator.share) {
            await navigator.share({
                title: 'DatSer',
                text: shareText,
                url: appShareUrl
            })
        } else {
            await copyShareLink()
        }
    }

    const openPresetShare = (type) => {
        if (!appShareUrl || typeof window === 'undefined') return
        const body = `${shareText} ${appShareUrl}`
        const encodedBody = encodeURIComponent(body)
        const encodedSubject = encodeURIComponent('DatSer website link')
        const targets = {
            whatsapp: `https://wa.me/?text=${encodedBody}`,
            sms: `sms:?&body=${encodedBody}`,
            email: `mailto:?subject=${encodedSubject}&body=${encodedBody}`
        }
        window.open(targets[type], '_blank', 'noopener,noreferrer')
    }

    return (
        <>
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
                <div className="p-4">
                    <div className="mb-4 flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                                <MousePointer2 className="w-5 h-5 text-orange-600 dark:text-orange-300" />
                            </div>
                            <div className="min-w-0">
                                <p className="font-semibold text-gray-900 dark:text-white">Touch Feedback</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Use haptics and tap sounds when controls are pressed</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => updateHapticPreference({ haptic_feedback_enabled: !hapticFeedbackEnabled })}
                            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                                hapticFeedbackEnabled ? 'bg-orange-600' : 'bg-gray-200 dark:bg-gray-700'
                            }`}
                            aria-pressed={hapticFeedbackEnabled}
                        >
                            <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-300 ease-out ${
                                    hapticFeedbackEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        {[
                            { value: 0.65, label: 'Soft' },
                            { value: 1, label: 'Normal' },
                            { value: 1.45, label: 'Strong' }
                        ].map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => updateHapticPreference({ haptic_feedback_strength: option.value })}
                                disabled={!hapticFeedbackEnabled}
                                className={`min-h-[42px] rounded-xl border px-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                                    Math.abs(hapticFeedbackStrength - option.value) < 0.01
                                        ? 'border-orange-500 bg-orange-50 text-orange-700 dark:border-orange-400 dark:bg-orange-500/15 dark:text-orange-200'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>

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
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${
                            preferences?.show_command_menu_button ? 'bg-orange-600' : 'bg-gray-200 dark:bg-gray-700'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ease-out ${
                                preferences?.show_command_menu_button ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                <div className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                            <Search className="w-5 h-5 text-orange-600 dark:text-orange-300" />
                        </div>
                        <div>
                            <p className="font-semibold text-gray-900 dark:text-white">Member Search View</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Choose whether typing opens the compact action tray or the full member list</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                            { value: 'short', label: 'Short tray', desc: '10 matches, 3 visible, scrollable' },
                            { value: 'full', label: 'Full list', desc: 'Show results in the main member view' }
                        ].map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setSearchSuggestionView?.(option.value)}
                                className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                                    searchSuggestionView === option.value
                                        ? 'border-orange-500 bg-orange-50 text-orange-800 dark:border-orange-400 dark:bg-orange-500/15 dark:text-orange-200'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'
                                }`}
                            >
                                <span className="block text-sm font-bold">{option.label}</span>
                                <span className="mt-0.5 block text-xs opacity-75">{option.desc}</span>
                            </button>
                        ))}
                    </div>
                    <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Preview</p>
                        {searchSuggestionView === 'full' ? (
                            <div className="space-y-2">
                                {['Beniah Opong Diallo', 'Beniah Yaw Dingo', 'Beniah12'].map((name) => (
                                    <div key={name} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-[#202121]">
                                        <div>
                                            <p className="text-sm font-bold text-gray-900 dark:text-white">{name}</p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Shown in full member list</p>
                                        </div>
                                        <span className="text-xs font-bold text-orange-600 dark:text-orange-300">Open</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-[#202121]">
                                <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                                    <p className="text-[11px] font-black uppercase tracking-wide text-orange-600 dark:text-orange-300">Search matches</p>
                                </div>
                                {['Beniah Opong Diallo', 'Beniah Yaw Dingo', 'Beniah12'].map((name) => (
                                    <div key={name} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-gray-100 px-3 py-2 last:border-b-0 dark:border-gray-800">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{name}</p>
                                            <p className="truncate text-xs text-gray-500 dark:text-gray-400">Tap to focus this member</p>
                                        </div>
                                        <span className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-white">Present</span>
                                        <span className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white">Absent</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                            <Search className="w-5 h-5 text-orange-600 dark:text-orange-300" />
                        </div>
                        <div className="min-w-0">
                            <p className="font-semibold text-gray-900 dark:text-white">Command Menu Quick Look</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Preview and adjust settings inside Ctrl K before opening Settings</p>
                            <p className="mt-1 text-xs font-bold text-orange-600 dark:text-orange-300">Shortcut: Ctrl/Cmd + Enter</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => updatePreferences?.({ settings_search_quick_actions_enabled: !settingsSearchQuickActionsEnabled })}
                        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                            settingsSearchQuickActionsEnabled ? 'bg-orange-600' : 'bg-gray-200 dark:bg-gray-700'
                        }`}
                        aria-pressed={settingsSearchQuickActionsEnabled}
                    >
                        <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-300 ease-out ${
                                settingsSearchQuickActionsEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                <div className="p-4 flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                            <RefreshCw className="w-5 h-5 text-orange-600 dark:text-orange-300" />
                        </div>
                        <div className="min-w-0">
                            <p className="font-semibold text-gray-900 dark:text-white">Auto-Scan Settings Search</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Automatically add new settings and panels to Ctrl K search</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => updatePreferences?.({ command_palette_auto_scan_settings: !commandPaletteAutoScanEnabled })}
                        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                            commandPaletteAutoScanEnabled ? 'bg-orange-600' : 'bg-gray-200 dark:bg-gray-700'
                        }`}
                        aria-pressed={commandPaletteAutoScanEnabled}
                    >
                        <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-300 ease-out ${
                                commandPaletteAutoScanEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                <div className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                            <Share2 className="w-5 h-5 text-orange-600 dark:text-orange-300" />
                        </div>
                        <div>
                            <p className="font-semibold text-gray-900 dark:text-white">Share Website</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Send the DatSer link or let someone scan the QR code</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
                        <div className="space-y-3">
                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Website link</p>
                                <p className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-white">{appShareUrl || 'Website link unavailable'}</p>
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                <button type="button" onClick={() => openPresetShare('whatsapp')} className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
                                    <MessageCircle className="h-4 w-4 shrink-0" /> <span>WhatsApp</span>
                                </button>
                                <button type="button" onClick={() => openPresetShare('sms')} className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
                                    <MessageCircle className="h-4 w-4 shrink-0" /> <span>SMS</span>
                                </button>
                                <button type="button" onClick={() => openPresetShare('email')} className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
                                    <Mail className="h-4 w-4 shrink-0" /> <span>Email</span>
                                </button>
                                <button type="button" onClick={shareWebsite} className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700">
                                    <Share2 className="h-4 w-4 shrink-0" /> <span>Share</span>
                                </button>
                            </div>
                            <button type="button" onClick={copyShareLink} className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 text-sm font-bold text-orange-700 transition-colors hover:bg-orange-100 dark:border-orange-500/30 dark:bg-orange-500/15 dark:text-orange-200">
                                <Copy className="h-4 w-4" /> Copy website link
                            </button>
                        </div>
                        <div className="rounded-2xl border border-gray-200 bg-white p-3 text-center dark:border-gray-700 dark:bg-gray-900/40">
                            <div className="mb-2 flex flex-col items-center justify-center gap-1 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                <span className="inline-flex items-center gap-2">
                                    <QrCode className="h-4 w-4" /> QR Code
                                </span>
                                {qrCodeUrl && (
                                    <button
                                        type="button"
                                        onClick={() => setIsQrExpanded(true)}
                                        className="text-[11px] font-bold normal-case tracking-normal text-orange-600 transition hover:text-orange-700 dark:text-orange-300 dark:hover:text-orange-200"
                                    >
                                        Tap to expand
                                    </button>
                                )}
                            </div>
                            {qrCodeUrl ? (
                                <button
                                    type="button"
                                    onClick={() => setIsQrExpanded(true)}
                                    className="mx-auto block rounded-xl bg-white p-1 transition hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    aria-label="Expand website QR code"
                                >
                                    <img src={qrCodeUrl} alt="DatSer website QR code" className="h-32 w-32 rounded-lg" />
                                </button>
                            ) : (
                                <div className="grid h-32 w-32 place-items-center rounded-xl bg-gray-100 text-xs text-gray-500 dark:bg-gray-800">No QR</div>
                            )}
                        </div>
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

                <div className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                            <Clock3 className="w-5 h-5 text-emerald-700 dark:text-emerald-300" />
                        </div>
                        <div>
                            <p className="font-semibold text-gray-900 dark:text-white">Notification Display Time</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Choose how long app-style notifications stay before they disappear</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {[
                            { label: 'Normal', value: 6500 },
                            { label: 'Long', value: 9000 },
                            { label: 'Read slowly', value: 12000 }
                        ].map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                onClick={() => setNotificationDurationMs?.(item.value)}
                                className={`min-h-[40px] rounded-xl border px-4 text-sm font-semibold transition-colors ${
                                    Number(notificationDurationMs) === item.value
                                        ? 'border-orange-500 bg-orange-50 text-orange-700 dark:border-orange-400 dark:bg-orange-500/15 dark:text-orange-200'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'
                                }`}
                            >
                                {item.label} ({Math.round(item.value / 1000)}s)
                            </button>
                        ))}
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                            type="number"
                            min="2"
                            max="20"
                            step="0.5"
                            value={Number(customDurationMs) >= 1000 ? Number(customDurationMs) / 1000 : customDurationMs}
                            onChange={(event) => setCustomDurationMs(String(Number(event.target.value || 0) * 1000))}
                            className="min-h-[42px] flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-gray-700 dark:bg-gray-900/40 dark:text-white"
                            placeholder="Custom seconds"
                        />
                        <button
                            type="button"
                            onClick={() => setNotificationDurationMs?.(customDurationMs)}
                            className="min-h-[42px] rounded-xl bg-orange-600 px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700"
                        >
                            Apply
                        </button>
                    </div>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        Current setting: about {(Number(notificationDurationMs || 6500) / 1000).toFixed(1).replace('.0', '')} seconds.
                    </p>
                </div>

                <div className="hidden">
                    <div>
                        {false ? (
                            <>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <p className="text-sm font-bold text-gray-900 dark:text-white">{latestApkRelease.title || 'DatSer Android update'}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Latest: {latestApkRelease.versionName} ({latestApkRelease.versionCode})
                                            {installedAppInfo?.versionName ? ` · Current: ${installedAppInfo.versionName} (${installedAppInfo.versionCode || 'web'})` : ''}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                            Published: {latestApkRelease.publishedAt ? new Date(latestApkRelease.publishedAt).toLocaleString() : 'Recent update'}
                                        </p>
                                    </div>
                                    <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${
                                        installedAppInfo && isReleaseNewer(latestApkRelease, installedAppInfo)
                                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200'
                                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
                                    }`}>
                                        {installedAppInfo && isReleaseNewer(latestApkRelease, installedAppInfo) ? 'Update ready' : 'Latest available'}
                                    </span>
                                </div>
                                {latestApkRelease.description && (
                                    <p className="mt-2 text-xs leading-5 text-gray-600 dark:text-gray-300">{latestApkRelease.description}</p>
                                )}
                                <button
                                    type="button"
                                    onClick={handleApkDownload}
                                    className="mt-3 min-h-[42px] w-full rounded-xl bg-orange-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700"
                                >
                                    Download Android APK
                                </button>
                                <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                                    Android keeps APK files in its normal downloads/install area. After installing, delete the APK from Downloads if you want to free storage.
                                </p>
                            </>
                        ) : null}
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
        {isQrExpanded && qrCodeUrl && typeof document !== 'undefined' && createPortal((
            <div
                className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm animate-fade-in"
                onClick={() => setIsQrExpanded(false)}
                role="dialog"
                aria-modal="true"
                aria-label="Expanded DatSer website QR code"
            >
                <div
                    className="relative rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl shadow-black/30 animate-scale-in dark:border-gray-700 dark:bg-[#2F3030]"
                    onClick={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        onClick={() => setIsQrExpanded(false)}
                        className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-gray-100 text-gray-600 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                        aria-label="Close QR code"
                    >
                        <X className="h-5 w-5" />
                    </button>
                    <div className="px-8 text-center">
                        <p className="text-base font-bold text-gray-900 dark:text-white">Scan DatSer</p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Open the website on another device.</p>
                    </div>
                    <img src={qrCodeUrl} alt="Large DatSer website QR code" className="mt-5 h-[min(72vw,360px)] w-[min(72vw,360px)] rounded-2xl bg-white p-3" />
                </div>
            </div>
        ), document.body)}
        </>
    )
}

export default React.memo(AccessibilitySettingsSection)
