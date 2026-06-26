import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, BadgeCheck, BellRing, CheckCircle, Church, Edit3, ImagePlus, Mail, Save, ScanSearch, Search, ShieldCheck, Shuffle, Sparkles, UserRound, Users, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'
import { buildMemberIndexCodeMap, getMemberIndexCode } from '../utils/memberIndexCodes'
import MemberCodeBadge, { normalizeBadgeStyleKey } from './MemberCodeBadge'
import MemberCodePassCard, {
    MEMBER_CODE_CARD_STYLE_OPTIONS,
    getMemberCodeCardStyle,
    normalizeMemberCodeCardStyleKey
} from './MemberCodePassCard'

const AUTO_CYCLE_INTERVALS = [
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
    { value: 60, label: '1 hour' }
]

const DEFAULT_SHARE_MESSAGE_TEMPLATE = 'Hi. Thank you for being part of {workspace}. Your member pass code is {code}.'

const normalizeAutoCycleMinutes = (value) => {
    const numericValue = Number(value)
    return AUTO_CYCLE_INTERVALS.some((option) => option.value === numericValue) ? numericValue : 30
}

const ToggleRow = ({ icon: Icon, title, description, checked, onChange, settingId, getSettingTargetClass, disabled = false }) => (
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
            disabled={disabled}
            onClick={(event) => {
                event.stopPropagation()
                onChange?.()
            }}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:focus:ring-offset-gray-900 ${
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
    `group relative min-w-0 rounded-2xl border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-300 ${
        active
            ? 'border-orange-500 bg-orange-50 text-orange-900 shadow-sm dark:bg-orange-500/15 dark:text-orange-100'
            : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'
    }`
)

const MemberCodeSettingsSection = ({ preferences, updatePreferences, getSettingTargetClass, isAdminAccess = false }) => {
    const { members = [], dataOwnerId, user, isCollaborator, isAdminCollaborator } = useApp()
    const workspaceEnabled = preferences?.workspace_member_codes_enabled
    const enabled = (workspaceEnabled ?? preferences?.member_codes_enabled) === true
    const quickPassEnabled = preferences?.member_code_quick_pass_enabled !== false
    const showLogo = preferences?.member_code_show_logo !== false
    const showPhoto = preferences?.member_code_show_photo !== false
    const showEmail = preferences?.member_code_show_email !== false
    const autoOpenProfile = preferences?.member_code_auto_profile_enabled === true
    const badgeStyle = preferences?.member_code_badge_style || 'soft'
    const normalizedBadgeStyle = normalizeBadgeStyleKey(badgeStyle)
    const cardStyle = normalizeMemberCodeCardStyleKey(preferences?.member_code_card_style)
    const selectedCardStyle = getMemberCodeCardStyle(cardStyle)
    const autoCycleMinutes = normalizeAutoCycleMinutes(preferences?.member_code_auto_cycle_minutes)
    const churchName = preferences?.member_code_church_name || 'DatSer Church'
    const churchLogoUrl = preferences?.member_code_logo_url || ''
    const turboCheckInEnabled = preferences?.member_code_turbo_enabled === true
    const turboNotificationEnabled = preferences?.member_code_turbo_notification_enabled !== false
    const codeLookupEnabled = preferences?.member_code_lookup_enabled !== false
    const shareMessageTemplate = preferences?.member_code_share_message_template || DEFAULT_SHARE_MESSAGE_TEMPLATE
    const [editingChurchName, setEditingChurchName] = useState(false)
    const [draftChurchName, setDraftChurchName] = useState(churchName)
    const [lookupCode, setLookupCode] = useState('')
    const [draftShareMessage, setDraftShareMessage] = useState(shareMessageTemplate)
    const [isUploadingLogo, setIsUploadingLogo] = useState(false)
    const [savingKey, setSavingKey] = useState('')
    const [saveStatus, setSaveStatus] = useState(null)
    const logoInputRef = useRef(null)

    const memberIndexCodeMap = useMemo(() => buildMemberIndexCodeMap(members), [members])
    const lookupResult = useMemo(() => {
        const normalizedCode = lookupCode.trim().toUpperCase()
        if (!normalizedCode || !codeLookupEnabled) return null

        return members.find((member) => {
            const generatedCode = getMemberIndexCode(member, memberIndexCodeMap)
            const candidateCodes = [
                generatedCode,
                member?.member_code,
                member?.memberCode,
                member?.code,
                member?.Code,
                member?.['Member Code']
            ].filter(Boolean)

            return candidateCodes.some((candidate) => String(candidate).trim().toUpperCase() === normalizedCode)
        }) || null
    }, [codeLookupEnabled, lookupCode, memberIndexCodeMap, members])

    const lookupName = lookupResult?.full_name || lookupResult?.fullName || lookupResult?.['Full Name'] || lookupResult?.name || lookupResult?.Name || ''

    useEffect(() => {
        if (!editingChurchName) {
            setDraftChurchName(churchName)
        }
    }, [churchName, editingChurchName])

    useEffect(() => {
        setDraftShareMessage(shareMessageTemplate)
    }, [shareMessageTemplate])

    const affectedMemberCount = members.length
    const adminStatusLabel = isCollaborator
        ? (isAdminCollaborator ? 'Admin collaborator' : 'Collaborator')
        : 'Workspace owner'
    const workspaceTargetLabel = isCollaborator && dataOwnerId
        ? 'Owner workspace'
        : 'Your workspace'

    const setPreference = async (key, value, label = 'Member Codes setting') => {
        if (!updatePreferences) return null
        setSavingKey(key)
        setSaveStatus(null)
        try {
            const result = await updatePreferences({ [key]: value })
            setSaveStatus({ type: 'success', message: `${label} saved.` })
            return result
        } catch (error) {
            console.error('Member code preference save failed:', error)
            setSaveStatus({ type: 'error', message: `${label} could not be saved.` })
            return null
        } finally {
            setSavingKey('')
        }
    }
    const setMemberCodesEnabled = async (value) => {
        if (!updatePreferences) return null
        setSavingKey('member_codes_enabled')
        setSaveStatus(null)
        try {
            const result = await updatePreferences?.({
            member_codes_enabled: value,
                ...(isAdminAccess ? { workspace_member_codes_enabled: value } : {})
            })
            setSaveStatus({ type: 'success', message: value ? 'Member codes enabled for the workspace.' : 'Member codes hidden for the workspace.' })
            return result
        } catch (error) {
            console.error('Member code enable save failed:', error)
            setSaveStatus({ type: 'error', message: 'Member code visibility could not be saved.' })
            return null
        } finally {
            setSavingKey('')
        }
    }
    const setWorkspaceMemberCodesEnabled = async (value) => {
        if (!updatePreferences) return null
        setSavingKey('workspace_member_codes_enabled')
        setSaveStatus(null)
        try {
            const result = await updatePreferences?.({
                workspace_member_codes_enabled: value,
                member_codes_enabled: value
            })
            setSaveStatus({ type: 'success', message: value ? 'Workspace Member Codes enabled for connected members.' : 'Workspace Member Codes disabled for connected members.' })
            return result
        } catch (error) {
            console.error('Workspace member code save failed:', error)
            setSaveStatus({ type: 'error', message: 'Workspace Member Codes could not be saved.' })
            return null
        } finally {
            setSavingKey('')
        }
    }
    const saveChurchName = () => {
        const cleanName = draftChurchName.trim() || 'DatSer Church'
        setPreference('member_code_church_name', cleanName, 'Pass organization name')
        setEditingChurchName(false)
    }
    const saveShareMessageTemplate = () => {
        setPreference('member_code_share_message_template', draftShareMessage.trim() || DEFAULT_SHARE_MESSAGE_TEMPLATE, 'Share message')
    }
    const uploadChurchLogo = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        if (!['image/png', 'image/jpeg'].includes(file.type)) {
            toast.error('Choose a PNG or JPEG image')
            return
        }
        if (file.size > 3 * 1024 * 1024) {
            toast.error('Logo must be smaller than 3 MB')
            return
        }
        const ownerId = dataOwnerId || user?.id
        if (!ownerId || !isAdminAccess) {
            toast.error('Only an admin can change the workspace logo')
            return
        }
        setIsUploadingLogo(true)
        try {
            const extension = file.type === 'image/png' ? 'png' : 'jpg'
            const filePath = `${ownerId}/workspace-logo.${extension}`
            const { error } = await supabase.storage.from('member-code-branding').upload(filePath, file, {
                upsert: true,
                contentType: file.type,
                cacheControl: '3600'
            })
            if (error) throw error
            const { data } = supabase.storage.from('member-code-branding').getPublicUrl(filePath)
            const publicUrl = `${data.publicUrl}?v=${Date.now()}`
            await updatePreferences?.({ member_code_logo_url: publicUrl })
            toast.success('Workspace icon updated for everyone')
        } catch (error) {
            console.error('Workspace icon upload failed:', error)
            toast.error(error?.message || 'Could not upload the workspace icon')
        } finally {
            setIsUploadingLogo(false)
        }
    }

    const badgeStyles = [
        { id: 'coral', label: 'Coral Flame', description: 'Warm red-orange code badge' },
        { id: 'green', label: 'Green Dove', description: 'Soft green badge with gentle glow' },
        { id: 'crimson', label: 'Crimson', description: 'Dark red badge, clear outline' },
        { id: 'magenta', label: 'Purple Worship', description: 'Bold purple and magenta badge' },
        { id: 'amber', label: 'Golden Prayer', description: 'Amber worship pass badge' }
    ]

    const cardStyles = MEMBER_CODE_CARD_STYLE_OPTIONS

    const passBadgeStyle = selectedCardStyle.badgeStyleKey

    return (
        <div className="space-y-6">
            <div className="overflow-hidden rounded-[1.75rem] border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-5 shadow-sm dark:border-orange-500/20 dark:from-[#201208] dark:via-gray-900 dark:to-[#130f0a]">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-2xl">
                        <p className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white/80 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-orange-700 dark:border-orange-400/20 dark:bg-white/5 dark:text-orange-200">
                            <BadgeCheck className="h-3.5 w-3.5" />
                            Member Codes control room
                        </p>
                        <h3 className="mt-3 text-2xl font-black tracking-tight text-gray-950 dark:text-white">Make every pass scannable, searchable, and shared from one place.</h3>
                        <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                            Configure the code name, workspace-wide visibility, QR pass behavior, and the exact members affected before saving.
                        </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[28rem]">
                        <div className="rounded-2xl border border-white/70 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.06]">
                            <Users className="h-4 w-4 text-orange-600 dark:text-orange-300" />
                            <p className="mt-2 text-2xl font-black text-gray-950 dark:text-white">{affectedMemberCount}</p>
                            <p className="text-xs font-bold text-gray-500 dark:text-gray-400">connected members affected</p>
                        </div>
                        <div className="rounded-2xl border border-white/70 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.06]">
                            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                            <p className="mt-2 text-sm font-black text-gray-950 dark:text-white">{adminStatusLabel}</p>
                            <p className="text-xs font-bold text-gray-500 dark:text-gray-400">{workspaceTargetLabel}</p>
                        </div>
                        <div className="rounded-2xl border border-white/70 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.06]">
                            <Save className="h-4 w-4 text-orange-600 dark:text-orange-300" />
                            <p className={`mt-2 text-sm font-black ${enabled ? 'text-emerald-700 dark:text-emerald-200' : 'text-gray-950 dark:text-white'}`}>{enabled ? 'Codes active' : 'Codes hidden'}</p>
                            <p className="text-xs font-bold text-gray-500 dark:text-gray-400">{savingKey ? 'Saving changes...' : 'Auto-saved controls'}</p>
                        </div>
                    </div>
                </div>
                {saveStatus && (
                    <div className={`mt-4 flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm font-bold ${
                        saveStatus.type === 'error'
                            ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100'
                    }`}>
                        {saveStatus.type === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                        <span>{saveStatus.message}</span>
                    </div>
                )}
            </div>

            <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,32rem),1fr))]">
                <div className="space-y-5">
                    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:divide-gray-700">
                        <ToggleRow
                            icon={BadgeCheck}
                            title="Enable Member Codes"
                            description="Show member codes on each card for quick check-in and lookup."
                            checked={enabled}
                            settingId="member_codes_enabled"
                            getSettingTargetClass={getSettingTargetClass}
                            disabled={savingKey === 'member_codes_enabled'}
                            onChange={() => setMemberCodesEnabled(!enabled)}
                        />
                        {isAdminAccess && (
                            <ToggleRow
                                icon={BadgeCheck}
                                title="Workspace Member Codes"
                                description="Admin control for the member-code display default across this workspace."
                                checked={workspaceEnabled === true}
                                settingId="workspace_member_codes_enabled"
                                getSettingTargetClass={getSettingTargetClass}
                                disabled={savingKey === 'workspace_member_codes_enabled'}
                                onChange={() => setWorkspaceMemberCodesEnabled(workspaceEnabled !== true)}
                            />
                        )}
                        <ToggleRow
                            icon={ScanSearch}
                            title="Quick Pass"
                            description="Open a focused pass when a member code is tapped."
                            checked={quickPassEnabled}
                            settingId="member_code_quick_pass"
                            getSettingTargetClass={getSettingTargetClass}
                            disabled={savingKey === 'member_code_quick_pass_enabled'}
                            onChange={() => setPreference('member_code_quick_pass_enabled', !quickPassEnabled, 'Quick Pass')}
                        />
                        <ToggleRow
                            icon={Church}
                            title="Show Church Logo"
                            description="Show the church mark on the pass."
                            checked={showLogo}
                            settingId="member_code_logo"
                            getSettingTargetClass={getSettingTargetClass}
                            disabled={savingKey === 'member_code_show_logo'}
                            onChange={() => setPreference('member_code_show_logo', !showLogo, 'Logo visibility')}
                        />
                        {isAdminAccess && (
                            <div data-setting-id="member_code_logo_upload" className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 p-4 dark:bg-gray-900/30">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-orange-200 bg-white dark:border-orange-400/20 dark:bg-black/25">
                                        {churchLogoUrl ? <img src={churchLogoUrl} alt="Workspace icon" className="h-full w-full object-contain p-1" /> : <Church className="h-6 w-6 text-orange-500" />}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-semibold text-gray-900 dark:text-white">Workspace icon</p>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">PNG or JPEG, shared with every workspace member.</p>
                                    </div>
                                </div>
                                <input ref={logoInputRef} type="file" accept="image/png,image/jpeg" onChange={uploadChurchLogo} className="hidden" />
                                <button type="button" onClick={() => logoInputRef.current?.click()} disabled={isUploadingLogo} className="inline-flex items-center gap-2 rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-black text-orange-700 transition hover:bg-orange-100 disabled:opacity-50 dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-200">
                                    <ImagePlus className="h-4 w-4" />
                                    {isUploadingLogo ? 'Uploading...' : 'Upload icon'}
                                </button>
                            </div>
                        )}
                        <ToggleRow
                            icon={UserRound}
                            title="Show Member Photo"
                            description="Show the member photo or initials on the pass."
                            checked={showPhoto}
                            settingId="member_code_photo"
                            getSettingTargetClass={getSettingTargetClass}
                            disabled={savingKey === 'member_code_show_photo'}
                            onChange={() => setPreference('member_code_show_photo', !showPhoto, 'Member photo visibility')}
                        />
                        <ToggleRow
                            icon={Mail}
                            title="Show Email"
                            description="Display email on the profile preview when available."
                            checked={showEmail}
                            settingId="member_code_email"
                            getSettingTargetClass={getSettingTargetClass}
                            disabled={savingKey === 'member_code_show_email'}
                            onChange={() => setPreference('member_code_show_email', !showEmail, 'Email visibility')}
                        />
                        <ToggleRow
                            icon={Sparkles}
                            title="Auto-Open Exact Match"
                            description="Open the pass automatically when a typed code matches one member."
                            checked={autoOpenProfile}
                            settingId="member_code_auto_open"
                            getSettingTargetClass={getSettingTargetClass}
                            disabled={savingKey === 'member_code_auto_profile_enabled'}
                            onChange={() => setPreference('member_code_auto_profile_enabled', !autoOpenProfile, 'Auto-open exact match')}
                        />
                        <ToggleRow
                            icon={Search}
                            title="Code Number Lookup"
                            description="Show the matching member name while typing a code number."
                            checked={codeLookupEnabled}
                            settingId="member_code_lookup"
                            getSettingTargetClass={getSettingTargetClass}
                            disabled={savingKey === 'member_code_lookup_enabled'}
                            onChange={() => setPreference('member_code_lookup_enabled', !codeLookupEnabled, 'Code Number Lookup')}
                        />
                        {isAdminAccess && (
                            <>
                                <ToggleRow
                                    icon={Sparkles}
                                    title="Turbo Code Check-In"
                                    description="An exact typed code marks that member present immediately and bypasses the missing-info prompt."
                                    checked={turboCheckInEnabled}
                                    settingId="member_code_turbo"
                                    getSettingTargetClass={getSettingTargetClass}
                                    disabled={savingKey === 'member_code_turbo_enabled'}
                                    onChange={() => setPreference('member_code_turbo_enabled', !turboCheckInEnabled, 'Turbo Code Check-In')}
                                />
                                <ToggleRow
                                    icon={BellRing}
                                    title="Turbo Check-In Notification"
                                    description="Show a confirmation popup after an exact code marks a member present."
                                    checked={turboNotificationEnabled}
                                    settingId="member_code_turbo_notification"
                                    getSettingTargetClass={getSettingTargetClass}
                                    disabled={savingKey === 'member_code_turbo_notification_enabled'}
                                    onChange={() => setPreference('member_code_turbo_notification_enabled', !turboNotificationEnabled, 'Turbo notification')}
                                />
                            </>
                        )}
                        <div
                            data-setting-id="member_code_lookup_field"
                            tabIndex={-1}
                            className={`bg-gray-50 p-4 dark:bg-gray-900/30 ${getSettingTargetClass?.('member_code_lookup_field') || ''}`}
                        >
                            <label htmlFor="member-code-lookup-input" className="text-sm font-semibold text-gray-900 dark:text-white">
                                Code number preview
                            </label>
                            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                <div className="relative flex-1">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                    <input
                                        id="member-code-lookup-input"
                                        value={lookupCode}
                                        disabled={!codeLookupEnabled}
                                        onChange={(event) => setLookupCode(event.target.value.toUpperCase())}
                                        placeholder="Type a code like K56"
                                        className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm font-bold uppercase tracking-wide text-gray-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-black/25 dark:text-white"
                                    />
                                </div>
                                <div className="min-h-[2.75rem] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-black/25 sm:min-w-[13rem]">
                                    {lookupCode.trim() ? (
                                        lookupResult ? (
                                            <>
                                                <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-300">Matched member</p>
                                                <p className="truncate font-black text-gray-900 dark:text-white">{lookupName || 'Unnamed member'}</p>
                                            </>
                                        ) : (
                                            <>
                                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">No match yet</p>
                                                <p className="truncate font-semibold text-gray-600 dark:text-gray-300">Check the code or sync latest data.</p>
                                            </>
                                        )
                                    ) : (
                                        <>
                                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Ready</p>
                                            <p className="truncate font-semibold text-gray-600 dark:text-gray-300">A name appears here.</p>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div data-setting-id="member_code_badge_style" tabIndex={-1} className={`rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 ${getSettingTargetClass?.('member_code_badge_style') || ''}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h4 className="font-semibold text-gray-900 dark:text-white">Badge Style</h4>
                                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose the shape and automatic mix for member code badges.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPreference('member_code_badge_style', 'auto')}
                                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                                    badgeStyle === 'auto'
                                        ? 'border-orange-500 bg-orange-600 text-white'
                                        : 'border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-400 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200'
                                }`}
                            >
                                <Shuffle className="h-4 w-4" />
                                Auto Mix
                            </button>
                        </div>
                        {badgeStyle === 'auto' && (
                            <div className="mt-4 rounded-xl border border-orange-500/30 bg-orange-500/10 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-bold text-orange-900 dark:text-orange-100">Rotate member colors</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Auto Mix changes each member badge on your chosen schedule.</p>
                                    </div>
                                    <div className="flex rounded-xl border border-orange-500/30 bg-black/5 p-1 dark:bg-black/20">
                                        {AUTO_CYCLE_INTERVALS.map((option) => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setPreference('member_code_auto_cycle_minutes', option.value)}
                                                className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
                                                    autoCycleMinutes === option.value
                                                        ? 'bg-orange-600 text-white shadow-sm'
                                                        : 'text-orange-800 hover:bg-orange-500/10 dark:text-orange-100'
                                                }`}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,9.25rem),1fr))]">
                            {badgeStyles.map((option) => (
                                <button key={option.id} type="button" onClick={() => setPreference('member_code_badge_style', option.id)} className={optionClass(normalizedBadgeStyle === option.id)}>
                                    <MemberCodeBadge code="E79" styleKey={option.id} className="h-8 w-full max-w-[8.25rem] min-w-0 px-3 text-xs" />
                                    <span className="mt-2 block break-words text-sm font-semibold leading-tight">{option.label}</span>
                                    <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{option.description}</span>
                                    {normalizedBadgeStyle === option.id && <CheckCircle className="absolute right-2 top-2 h-4 w-4 text-orange-500" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div data-setting-id="member_code_card_style" tabIndex={-1} className={`rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 ${getSettingTargetClass?.('member_code_card_style') || ''}`}>
                        <h4 className="font-semibold text-gray-900 dark:text-white">Card Style</h4>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose one premium member pass effect. Each option shows its motion live.</p>
                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {cardStyles.map((option) => (
                                <button key={option.id} type="button" onClick={() => setPreference('member_code_card_style', option.id)} className={optionClass(cardStyle === option.id)}>
                                    <MemberCodePassCard styleKey={option.id} compact className="member-code-pass-card-preview h-20 rounded-xl border border-white/10 transition duration-200 group-hover:scale-[1.02]">
                                        <div className="flex h-full items-center justify-center">
                                            <MemberCodeBadge code="E79" styleKey={option.badgeStyleKey} className="h-8 min-w-[4.75rem] px-4 text-xs" />
                                        </div>
                                    </MemberCodePassCard>
                                    <span className="mt-2 block text-sm font-semibold leading-tight">{option.label}</span>
                                    <span className="mt-0.5 block text-xs font-semibold text-orange-700 dark:text-orange-200">{option.colorName}</span>
                                    <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{option.description}</span>
                                    {cardStyle === option.id && <CheckCircle className="absolute right-2 top-2 h-4 w-4 text-orange-500" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div
                        data-setting-id="member_code_share_message"
                        tabIndex={-1}
                        className={`rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 ${getSettingTargetClass?.('member_code_share_message') || ''}`}
                    >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h4 className="font-semibold text-gray-900 dark:text-white">Share Message</h4>
                                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                    Customize the text used for WhatsApp, SMS, and shared member pass previews.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={saveShareMessageTemplate}
                                className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-orange-700"
                            >
                                Save
                            </button>
                        </div>
                        <textarea
                            value={draftShareMessage}
                            onChange={(event) => setDraftShareMessage(event.target.value)}
                            onBlur={saveShareMessageTemplate}
                            rows={4}
                            className="mt-3 w-full resize-y rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold leading-6 text-gray-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-500/20 dark:border-white/10 dark:bg-black/25 dark:text-white"
                        />
                        <p className="mt-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                            Tokens: {'{name}'}, {'{code}'}, {'{workspace}'}.
                        </p>
                    </div>

                </div>

                <div className={`member-code-live-preview-panel rounded-3xl border p-4 shadow-xl ${selectedCardStyle.accentClass}`}>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600 dark:text-orange-300">Live Preview</p>
                    <p className="mt-1 text-sm text-gray-600 dark:text-white/55">This is how members will see their pass and profile.</p>
                    <MemberCodePassCard styleKey={cardStyle} className="member-code-settings-pass-preview mt-4 rounded-2xl border p-5 text-center">
                        {showLogo && (
                            <div className="member-code-pass-icon-tile mx-auto">
                                {churchLogoUrl ? <img src={churchLogoUrl} alt="" className="h-full w-full object-contain p-2" /> : <Church className="h-10 w-10 text-[var(--member-pass-accent)]" />}
                            </div>
                        )}
                        <div
                            data-setting-id="member_code_church_name"
                            tabIndex={-1}
                            className={`mt-2 flex items-center justify-center gap-2 text-sm font-semibold ${getSettingTargetClass?.('member_code_church_name') || ''}`}
                        >
                            {editingChurchName ? (
                                <div className="flex w-full items-center gap-2">
                                    <input
                                        value={draftChurchName}
                                        onChange={(event) => setDraftChurchName(event.target.value)}
                                        className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-center text-gray-900 outline-none focus:border-orange-400 dark:border-white/10 dark:bg-black/30 dark:text-white"
                                        autoFocus
                                    />
                                    <button type="button" onClick={saveChurchName} className="rounded-xl bg-orange-600 px-3 py-2 text-xs font-bold text-white">Save</button>
                                    <button type="button" onClick={() => { setDraftChurchName(churchName); setEditingChurchName(false) }} className="grid h-9 w-9 place-items-center rounded-xl bg-black/5 text-gray-600 dark:bg-white/10 dark:text-white/70">
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDraftChurchName(churchName)
                                            setEditingChurchName(true)
                                        }}
                                        className="inline-flex items-center gap-2 rounded-xl px-2 py-1 text-gray-800 transition hover:bg-black/5 dark:text-white dark:hover:bg-white/10"
                                    >
                                        <span>{churchName}</span>
                                        <Edit3 className="h-3.5 w-3.5 text-gray-500 dark:text-white/45" />
                                    </button>
                                </>
                            )}
                        </div>
                        {showPhoto && (
                            <div className="mx-auto my-5 grid h-24 w-24 place-items-center rounded-full border-4 border-[var(--member-pass-accent)] bg-gradient-to-br from-[var(--member-pass-accent)] to-[var(--member-pass-accent-2)] text-4xl font-black text-white shadow-[0_0_42px_var(--member-pass-soft)]">
                                E
                            </div>
                        )}
                        <div className="flex items-center justify-center gap-2">
                            <h4 className="text-2xl font-black text-gray-900 dark:text-white">Esther M</h4>
                            <MemberCodeBadge code="E79" styleKey={passBadgeStyle} className="h-8 min-w-[4.75rem] px-4 text-xs" />
                        </div>
                        <p className="mt-2 text-sm text-gray-600 dark:text-white/55">Joined January 10, 2026</p>
                        {showEmail && <p className="mt-2 text-xs text-gray-500 dark:text-white/45">esther.m@example.com</p>}
                    </MemberCodePassCard>
                    <div className="member-code-preview-strip mt-4 rounded-2xl border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--member-pass-accent)] to-[var(--member-pass-accent-2)] font-black text-white">E</div>
                                <div className="min-w-0">
                                    <p className="truncate font-bold text-gray-900 dark:text-white">Esther M</p>
                                    <p className="text-xs text-gray-500 dark:text-white/45">+233 55 123 4567</p>
                                </div>
                            </div>
                            <MemberCodeBadge code="E79" styleKey={passBadgeStyle} className="h-8 min-w-[4.75rem] px-4 text-xs" />
                        </div>
                    </div>
                    <p className="member-code-preview-note mt-4 rounded-2xl border p-3 text-xs">
                        Changes are saved automatically and reflected in the member cards.
                    </p>
                </div>
            </div>
        </div>
    )
}

export default React.memo(MemberCodeSettingsSection)
