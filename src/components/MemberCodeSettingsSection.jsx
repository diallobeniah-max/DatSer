import React from 'react'
import { BadgeCheck, CheckCircle, Church, Mail, ScanSearch, Sparkles, UserRound } from 'lucide-react'

const ToggleRow = ({ icon: Icon, title, description, checked, onChange, settingId, getSettingTargetClass }) => (
    <div
        data-setting-id={settingId}
        tabIndex={-1}
        className={`flex items-center justify-between gap-4 p-4 ${getSettingTargetClass?.(settingId) || ''}`}
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
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                checked ? 'bg-orange-600' : 'bg-gray-200 dark:bg-gray-700'
            }`}
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

const optionClass = (active) => (
    `relative rounded-2xl border p-3 text-left transition-all ${
        active
            ? 'border-orange-500 bg-orange-50 text-orange-900 shadow-sm dark:bg-orange-500/15 dark:text-orange-100'
            : 'border-gray-200 bg-white text-gray-700 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'
    }`
)

const MemberCodeSettingsSection = ({ preferences, updatePreferences, getSettingTargetClass }) => {
    const enabled = preferences?.member_codes_enabled === true
    const quickPassEnabled = preferences?.member_code_quick_pass_enabled !== false
    const showLogo = preferences?.member_code_show_logo !== false
    const showPhoto = preferences?.member_code_show_photo !== false
    const showEmail = preferences?.member_code_show_email !== false
    const autoOpenProfile = preferences?.member_code_auto_profile_enabled === true
    const badgeStyle = preferences?.member_code_badge_style || 'soft'
    const cardStyle = preferences?.member_code_card_style || 'wave'
    const accentColor = preferences?.member_code_accent_color || 'orange'

    const setPreference = (key, value) => updatePreferences?.({ [key]: value })

    const badgeStyles = [
        { id: 'soft', label: 'Soft' },
        { id: 'outline', label: 'Outline' },
        { id: 'solid', label: 'Solid' },
        { id: 'circle', label: 'Circle' }
    ]

    const cardStyles = [
        { id: 'wave', label: 'Wave' },
        { id: 'glass', label: 'Glass' },
        { id: 'gradient', label: 'Gradient' },
        { id: 'classic', label: 'Classic' }
    ]

    const accents = [
        { id: 'orange', className: 'bg-orange-500' },
        { id: 'blue', className: 'bg-blue-500' },
        { id: 'purple', className: 'bg-purple-500' },
        { id: 'green', className: 'bg-emerald-500' },
        { id: 'teal', className: 'bg-cyan-500' }
    ]

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Member Codes</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    Configure index badges, member passes, and quick profile previews.
                </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
                <div className="space-y-5">
                    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:divide-gray-700">
                        <ToggleRow
                            icon={BadgeCheck}
                            title="Enable Member Codes"
                            description="Show member codes on each card for quick check-in and lookup."
                            checked={enabled}
                            settingId="member_codes_enabled"
                            getSettingTargetClass={getSettingTargetClass}
                            onChange={() => setPreference('member_codes_enabled', !enabled)}
                        />
                        <ToggleRow
                            icon={ScanSearch}
                            title="Quick Pass"
                            description="Open a focused pass when a member code is tapped."
                            checked={quickPassEnabled}
                            settingId="member_code_quick_pass"
                            getSettingTargetClass={getSettingTargetClass}
                            onChange={() => setPreference('member_code_quick_pass_enabled', !quickPassEnabled)}
                        />
                        <ToggleRow
                            icon={Church}
                            title="Show Church Logo"
                            description="Show the DatSer church mark on the pass."
                            checked={showLogo}
                            settingId="member_code_logo"
                            getSettingTargetClass={getSettingTargetClass}
                            onChange={() => setPreference('member_code_show_logo', !showLogo)}
                        />
                        <ToggleRow
                            icon={UserRound}
                            title="Show Member Photo"
                            description="Show the member photo or initials on the pass."
                            checked={showPhoto}
                            settingId="member_code_photo"
                            getSettingTargetClass={getSettingTargetClass}
                            onChange={() => setPreference('member_code_show_photo', !showPhoto)}
                        />
                        <ToggleRow
                            icon={Mail}
                            title="Show Email"
                            description="Display email on the profile preview when available."
                            checked={showEmail}
                            settingId="member_code_email"
                            getSettingTargetClass={getSettingTargetClass}
                            onChange={() => setPreference('member_code_show_email', !showEmail)}
                        />
                        <ToggleRow
                            icon={Sparkles}
                            title="Auto-Open Exact Match"
                            description="Open the pass automatically when a typed code matches one member."
                            checked={autoOpenProfile}
                            settingId="member_code_auto_open"
                            getSettingTargetClass={getSettingTargetClass}
                            onChange={() => setPreference('member_code_auto_profile_enabled', !autoOpenProfile)}
                        />
                    </div>

                    <div data-setting-id="member_code_badge_style" tabIndex={-1} className={`rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 ${getSettingTargetClass?.('member_code_badge_style') || ''}`}>
                        <h4 className="font-semibold text-gray-900 dark:text-white">Badge Style</h4>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose the shape of the member code badge.</p>
                        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {badgeStyles.map((option) => (
                                <button key={option.id} type="button" onClick={() => setPreference('member_code_badge_style', option.id)} className={optionClass(badgeStyle === option.id)}>
                                    <span className={`${option.id === 'circle' ? 'rounded-full px-3 py-2' : 'rounded-lg px-3 py-2'} inline-flex border border-orange-400 bg-orange-500/15 text-xs font-black text-orange-700 dark:text-orange-200`}>
                                        E79
                                    </span>
                                    <span className="mt-2 block text-sm font-semibold">{option.label}</span>
                                    {badgeStyle === option.id && <CheckCircle className="absolute right-2 top-2 h-4 w-4 text-orange-500" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div data-setting-id="member_code_card_style" tabIndex={-1} className={`rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 ${getSettingTargetClass?.('member_code_card_style') || ''}`}>
                        <h4 className="font-semibold text-gray-900 dark:text-white">Card Style</h4>
                        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {cardStyles.map((option) => (
                                <button key={option.id} type="button" onClick={() => setPreference('member_code_card_style', option.id)} className={optionClass(cardStyle === option.id)}>
                                    <span className="block h-12 rounded-xl bg-gradient-to-br from-gray-900 via-gray-800 to-orange-950 dark:from-gray-700 dark:to-orange-950" />
                                    <span className="mt-2 block text-sm font-semibold">{option.label}</span>
                                    {cardStyle === option.id && <CheckCircle className="absolute right-2 top-2 h-4 w-4 text-orange-500" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div data-setting-id="member_code_accent" tabIndex={-1} className={`rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 ${getSettingTargetClass?.('member_code_accent') || ''}`}>
                        <h4 className="font-semibold text-gray-900 dark:text-white">Accent Color</h4>
                        <div className="mt-4 flex flex-wrap gap-3">
                            {accents.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setPreference('member_code_accent_color', option.id)}
                                    className={`grid h-10 w-10 place-items-center rounded-full border-2 ${accentColor === option.id ? 'border-orange-500' : 'border-transparent'}`}
                                    aria-label={`Use ${option.id} accent`}
                                >
                                    <span className={`h-7 w-7 rounded-full ${option.className}`} />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-gray-950 p-4 text-white shadow-xl dark:border-gray-700">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-300">Live Preview</p>
                    <p className="mt-1 text-sm text-white/55">This is how members will see their pass and profile.</p>
                    <div className="mt-4 rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_50%_30%,rgba(249,115,22,0.35),transparent_45%),linear-gradient(180deg,#1c1f20,#101111)] p-5 text-center">
                        {showLogo && <Church className="mx-auto h-10 w-10 text-orange-400" />}
                        <p className="mt-2 text-sm font-semibold">DatSer Church</p>
                        {showPhoto && (
                            <div className="mx-auto my-5 grid h-24 w-24 place-items-center rounded-full border-4 border-orange-500 bg-gradient-to-br from-orange-500 to-purple-500 text-4xl font-black">
                                E
                            </div>
                        )}
                        <div className="flex items-center justify-center gap-2">
                            <h4 className="text-2xl font-black">Esther M</h4>
                            <span className="rounded-lg border border-green-400/35 bg-green-500/15 px-2 py-1 text-xs font-black text-green-300">E79</span>
                        </div>
                        <p className="mt-2 text-sm text-white/55">Joined January 10, 2026</p>
                        {showEmail && <p className="mt-2 text-xs text-white/45">esther.m@example.com</p>}
                    </div>
                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                        <div className="flex items-center gap-3">
                            <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-orange-500 to-purple-500 font-black">E</div>
                            <div>
                                <p className="font-bold">Esther M <span className="ml-1 text-xs text-green-300">E79</span></p>
                                <p className="text-xs text-white/45">+233 55 123 4567</p>
                            </div>
                        </div>
                    </div>
                    <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-xs text-white/55">
                        Changes are saved automatically and reflected in the member cards.
                    </p>
                </div>
            </div>
        </div>
    )
}

export default React.memo(MemberCodeSettingsSection)
