import React from 'react'
import { AlertTriangle, Trash2, ShieldAlert, ArrowRight } from 'lucide-react'

const DangerSettingsSection = ({
    user,
    isCollaborator,
    handleSignOut,
    getSettingTargetClass
}) => {
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-1">Danger Zone</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Irreversible actions and account deletion</p>
            </div>

            <div className="bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 rounded-2xl p-5">
                <div className="flex items-start gap-4">
                    <div className="p-2 bg-red-100 dark:bg-red-900/40 rounded-xl">
                        <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                    </div>
                    <div>
                        <h4 className="font-bold text-gray-900 dark:text-white">Account Deletion</h4>
                        <p className="text-sm text-red-800/80 dark:text-red-300/80 mt-1 leading-relaxed">
                            Deleting your account will permanently remove all your ministry data, collaborators, and history. This action cannot be undone.
                        </p>
                        <button
                            disabled={true}
                            className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition-all shadow-md shadow-red-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <Trash2 className="w-4 h-4" />
                            Delete My Account
                        </button>
                        <p className="mt-2 text-[10px] text-red-600/60 dark:text-red-400/60 uppercase font-bold tracking-widest">
                            Currently disabled for safety
                        </p>
                    </div>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                <div className="p-4 flex items-center justify-between">
                    <div>
                        <p className="font-semibold text-gray-900 dark:text-white">Sign Out All Devices</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Force sign out from all browsers and APK installs</p>
                    </div>
                    <button
                        onClick={handleSignOut}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                    >
                        <ArrowRight className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {isCollaborator && (
                <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/50 rounded-2xl p-5 flex gap-4">
                    <ShieldAlert className="w-6 h-6 text-orange-600 dark:text-orange-400 flex-shrink-0" />
                    <div>
                        <h4 className="font-bold text-orange-900 dark:text-orange-100 text-sm">Collaborator Restriction</h4>
                        <p className="text-sm text-orange-800/80 dark:text-orange-300/80 mt-1">
                            As a collaborator, you cannot delete the workspace or the main owner account. You can only remove your own access from the Team section.
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}

export default React.memo(DangerSettingsSection)
