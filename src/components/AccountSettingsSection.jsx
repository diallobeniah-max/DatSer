import React from 'react'
import { User, Mail, Pencil, Lock, Monitor, Loader2 } from 'lucide-react'
import CombinedDatePicker from './CombinedDatePicker'

const AccountSettingsSection = ({
    user,
    dob,
    setDob,
    handleSaveDob,
    isDobSaving,
    installedAppInfo,
    resetPassword,
    handleSignOut,
    setIsPhotoEditorOpen,
    getSettingTargetClass
}) => {
    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Account Settings</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Manage your account information and security</p>
            </div>

            {/* Profile Card */}
            <div
                data-setting-id="profile_photo"
                tabIndex={-1}
                className={`bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 ${getSettingTargetClass('profile_photo')}`}
            >
                <div className="flex items-center gap-4">
                    <div className="relative flex-shrink-0">
                        {(() => {
                            const localAvatar = typeof window !== 'undefined' ? localStorage.getItem('user_avatar_url') : null
                            const avatarUrl = localAvatar || user?.user_metadata?.avatar_url
                            return avatarUrl ? (
                                <img
                                    src={avatarUrl}
                                    alt="Profile"
                                    className="w-16 h-16 min-w-[64px] min-h-[64px] rounded-full object-cover border-2 border-white dark:border-gray-600 shadow-md"
                                />
                            ) : (
                                <div className="w-16 h-16 min-w-[64px] min-h-[64px] rounded-full bg-gradient-to-br from-orange-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold shadow-md">
                                    {user?.email?.[0]?.toUpperCase() || 'U'}
                                </div>
                            )
                        })()}
                        <button
                            onClick={() => setIsPhotoEditorOpen(true)}
                            className="absolute -bottom-1 -right-1 p-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-full shadow-lg transition-colors btn-press"
                            title="Change photo"
                        >
                            <Pencil className="w-3 h-3" />
                        </button>
                    </div>
                    <div
                        data-setting-id="account_name"
                        tabIndex={-1}
                        className={`flex-1 min-w-0 ${getSettingTargetClass('account_name')}`}
                    >
                        <h4 className="font-semibold text-gray-900 dark:text-white truncate">
                            {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
                        </h4>
                        <p
                            data-setting-id="account_email"
                            tabIndex={-1}
                            className={`text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1 truncate ${getSettingTargetClass('account_email')}`}
                        >
                            <Mail className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{user?.email}</span>
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            {user?.app_metadata?.provider === 'google' ? 'Signed in with Google' : 'Email and password account'}
                        </p>
                    </div>
                </div>
            </div>

            <div
                data-setting-id="app_version"
                tabIndex={-1}
                className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 ${getSettingTargetClass('app_version')}`}
            >
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                        <Monitor className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-gray-900 dark:text-white">App Version</h4>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            Current install: <span className="font-semibold text-gray-800 dark:text-gray-100">
                                {installedAppInfo ? `${installedAppInfo.versionName} (${installedAppInfo.versionCode || 'web'})` : 'Loading...'}
                            </span>
                        </p>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            APK mode: <span className="font-semibold text-gray-800 dark:text-gray-100">
                                {installedAppInfo?.runtimeMode || 'Website'}
                            </span>
                        </p>
                    </div>
                </div>
            </div>

            {/* Personal Information */}
            <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Personal Information
                </h4>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                    <div
                        data-setting-id="date_of_birth"
                        tabIndex={-1}
                        className={`p-4 flex items-center justify-between ${getSettingTargetClass('date_of_birth')}`}
                    >
                        <div className="flex-1">
                            <label htmlFor="dob" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Date of Birth
                            </label>
                            <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
                                <div className="w-full max-w-xs">
                                    <CombinedDatePicker
                                        name="account_date_of_birth"
                                        value={dob}
                                        onChange={(event) => setDob(event.target.value)}
                                        placeholder="Select date of birth"
                                        birthDateMode={preferences?.date_of_birth_picker_mode || 'combined'}
                                    />
                                </div>
                                <button
                                    onClick={handleSaveDob}
                                    disabled={isDobSaving || dob === (user?.user_metadata?.date_of_birth || '')}
                                    className={`min-h-[44px] px-3 py-2 text-sm rounded-lg transition-colors font-medium flex items-center justify-center gap-2 ${
                                        isDobSaving || dob === (user?.user_metadata?.date_of_birth || '')
                                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                                            : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
                                    }`}
                                >
                                    {isDobSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {isDobSaving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Security */}
            <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    Security
                </h4>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                    <div
                        data-setting-id="password"
                        tabIndex={-1}
                        className={`p-4 flex items-center justify-between ${getSettingTargetClass('password')}`}
                    >
                        <div className="flex items-center gap-3">
                            <div>
                                <p className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                    Password
                                    {window.__needsPasswordSetup && (
                                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full">
                                            Action needed
                                        </span>
                                    )}
                                </p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {user?.app_metadata?.provider === 'google'
                                        ? 'Managed by Google'
                                        : window.__needsPasswordSetup
                                        ? 'Set up a password for email login'
                                        : 'Change your password'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={async () => {
                                if (user?.app_metadata?.provider === 'google') {
                                    alert('Your account is secured via Google. Manage it at myaccount.google.com')
                                } else if (window.__needsPasswordSetup && window.__openSetPassword) {
                                    window.__openSetPassword()
                                } else {
                                    try {
                                        await resetPassword(user?.email)
                                    } catch (err) { }
                                }
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                window.__needsPasswordSetup
                                    ? 'bg-orange-600 text-white hover:bg-orange-700'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                        >
                            {user?.app_metadata?.provider === 'google' ? 'View' : window.__needsPasswordSetup ? 'Set Up' : 'Change'}
                        </button>
                    </div>
                    <div className="p-4 flex items-center justify-between">
                        <div>
                            <p className="font-medium text-gray-900 dark:text-white">Sign Out</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Sign out of your account</p>
                        </div>
                        <button
                            onClick={handleSignOut}
                            className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default React.memo(AccountSettingsSection)
