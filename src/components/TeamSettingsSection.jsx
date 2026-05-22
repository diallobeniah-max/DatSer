import React from 'react'
import { Users, UserPlus, Mail, Shield, CheckCircle, Trash2, Loader2, Zap } from 'lucide-react'

const TeamSettingsSection = ({
    collaborators,
    fetchingCollaborators,
    isCollaborator,
    user,
    setIsShareModalOpen,
    handleDeleteCollaborator,
    pendingRemoval,
    isRemovingCollaborator,
    deletingCollaboratorId,
    confirmRemoveCollaborator,
    closeRemoveModal,
    getSettingTargetClass
}) => {
    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Team Management</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Manage who has access to this workspace</p>
                </div>
                {!isCollaborator && (
                    <button
                        onClick={() => setIsShareModalOpen(true)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold transition-all shadow-md shadow-orange-500/20 active:scale-95"
                    >
                        <UserPlus className="w-4 h-4" />
                        <span>Invite Collaborator</span>
                    </button>
                )}
            </div>

            <div
                data-setting-id="manage_team"
                tabIndex={-1}
                className={`space-y-3 ${getSettingTargetClass('manage_team')}`}
            >
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Workspace Collaborators ({collaborators.length})
                </h4>

                {fetchingCollaborators ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 flex flex-col items-center justify-center">
                        <Loader2 className="w-8 h-8 text-orange-500 animate-spin mb-3" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">Loading collaborators...</p>
                    </div>
                ) : collaborators.length === 0 ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
                        <div className="w-16 h-16 bg-gray-50 dark:bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Users className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                        </div>
                        <h5 className="font-semibold text-gray-900 dark:text-white mb-1">No collaborators yet</h5>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-xs mx-auto">
                            Invite team members to help you manage attendance and member data.
                        </p>
                        {!isCollaborator && (
                            <button
                                onClick={() => setIsShareModalOpen(true)}
                                className="text-sm font-bold text-orange-600 dark:text-orange-400 hover:underline"
                            >
                                Send your first invite →
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
                        {collaborators.map((collaborator) => (
                            <div key={collaborator.id} className="p-4 flex items-center justify-between gap-4 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-100 to-orange-50 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center flex-shrink-0">
                                        <Mail className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-semibold text-gray-900 dark:text-white truncate">
                                            {collaborator.email}
                                        </p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                                collaborator.role === 'admin'
                                                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                                                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                            }`}>
                                                <Shield className="w-2.5 h-2.5" />
                                                {collaborator.role}
                                            </span>
                                            {collaborator.status === 'active' ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                                                    <CheckCircle className="w-2.5 h-2.5" />
                                                    Active
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                                    Pending
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {!isCollaborator && (
                                    <button
                                        onClick={() => handleDeleteCollaborator(collaborator.id)}
                                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                        title="Remove collaborator"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Admin only notice */}
            {isCollaborator && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-4 flex gap-3">
                    <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">View Only Access</p>
                        <p className="text-sm text-blue-800/80 dark:text-blue-300/80 mt-1">
                            As a collaborator, you can view the team list but only the workspace owner can invite or remove members.
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}

export default React.memo(TeamSettingsSection)
