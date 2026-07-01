import React from 'react'
import { Users, UserPlus, Mail, Shield, CheckCircle, Trash2, Loader2, AlertCircle, RefreshCw, KeyRound, Link2, Power } from 'lucide-react'
import { getCollaboratorEmail } from '../utils/collaborators'

const TeamSettingsSection = ({
    collaborators,
    fetchingCollaborators,
    collaboratorLoadError,
    hasConfirmedCollaboratorLoad,
    onRetryCollaborators,
    adminCodeStatus,
    adminCodeForm,
    setAdminCodeForm,
    isAdminCodeLoading,
    isAdminCodeSaving,
    handleSaveAdminCode,
    isRelinkingCollaborators,
    handleRelinkCollaborators,
    isApprovingExistingCollaborators,
    handleApproveExistingCollaborators,
    handleToggleCollaboratorStatus,
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

            {!isCollaborator && (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
                    <form
                        onSubmit={handleSaveAdminCode}
                        className="rounded-2xl border border-orange-200/70 bg-orange-50/50 p-4 dark:border-orange-900/50 dark:bg-orange-950/20"
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white">
                                <KeyRound className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">Admin Code Login</h4>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                        adminCodeStatus?.is_set
                                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                    }`}>
                                        {isAdminCodeLoading ? 'Checking...' : adminCodeStatus?.is_set ? 'Code active' : 'Not set'}
                                    </span>
                                </div>
                                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                    Rotate the Admin Code Login safely. The code is hashed server-side and never shown after saving.
                                </p>
                                {adminCodeStatus?.error && (
                                    <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-300">
                                        {adminCodeStatus.error}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1.5">
                                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">New code</span>
                                <input
                                    type="password"
                                    value={adminCodeForm.code}
                                    onChange={(event) => setAdminCodeForm(prev => ({ ...prev, code: event.target.value }))}
                                    placeholder="At least 6 characters"
                                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                                    autoComplete="new-password"
                                />
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Confirm code</span>
                                <input
                                    type="password"
                                    value={adminCodeForm.confirm}
                                    onChange={(event) => setAdminCodeForm(prev => ({ ...prev, confirm: event.target.value }))}
                                    placeholder="Repeat code"
                                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                                    autoComplete="new-password"
                                />
                            </label>
                        </div>

                        <button
                            type="submit"
                            disabled={isAdminCodeSaving || !adminCodeForm.code || !adminCodeForm.confirm}
                            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-orange-500/20 transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                        >
                            {isAdminCodeSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                            Save admin code
                        </button>
                    </form>

                    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                <Link2 className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <h4 className="text-sm font-bold text-gray-900 dark:text-white">Collaborator links</h4>
                                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                    Match invited emails to real login accounts so access, counts, and Share Access stay in sync.
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleRelinkCollaborators}
                            disabled={isRelinkingCollaborators || isApprovingExistingCollaborators || collaborators.length === 0}
                            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-800 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
                        >
                            {isRelinkingCollaborators ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Relink existing collaborators
                        </button>
                        <button
                            type="button"
                            onClick={handleApproveExistingCollaborators}
                            disabled={isApprovingExistingCollaborators || isRelinkingCollaborators || collaborators.length === 0}
                            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isApprovingExistingCollaborators ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                            Approve existing collaborators
                        </button>
                    </div>
                </div>
            )}

            <div
                data-setting-id="manage_team"
                tabIndex={-1}
                className={`space-y-3 ${getSettingTargetClass('manage_team')}`}
            >
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Workspace Collaborators ({fetchingCollaborators && !hasConfirmedCollaboratorLoad ? '...' : collaborators.length})
                </h4>

                {fetchingCollaborators ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 flex flex-col items-center justify-center">
                        <Loader2 className="w-8 h-8 text-orange-500 animate-spin mb-3" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">Loading collaborators...</p>
                    </div>
                ) : collaboratorLoadError && collaborators.length === 0 && !hasConfirmedCollaboratorLoad ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-900/60 p-8 text-center">
                        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
                        <h5 className="font-semibold text-gray-900 dark:text-white mb-1">Could not load collaborators</h5>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-sm mx-auto">
                            {collaboratorLoadError}
                        </p>
                        <button
                            type="button"
                            onClick={onRetryCollaborators}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Retry
                        </button>
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
                                            {getCollaboratorEmail(collaborator)}
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
                                            {collaborator.status === 'disabled' ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                                    <Power className="w-2.5 h-2.5" />
                                                    Disabled
                                                </span>
                                            ) : collaborator.status === 'active' || collaborator.status === 'accepted' ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                                                    <CheckCircle className="w-2.5 h-2.5" />
                                                    {collaborator.status === 'accepted' ? 'Accepted' : 'Active'}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                                    Pending
                                                </span>
                                            )}
                                            {(collaborator.linked_status === 'missing auth user' || collaborator.linked_status === 'missing_auth_account' || collaborator.auth_account_status === 'missing_auth_account') && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                                    Missing login
                                                </span>
                                            )}
                                            {collaborator.auth_account_status === 'needs_email_confirmation' && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                                    Confirm email
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {!isCollaborator && (
                                    <div className="flex shrink-0 items-center gap-1">
                                        <button
                                            onClick={() => handleToggleCollaboratorStatus(collaborator.id)}
                                            disabled={deletingCollaboratorId === collaborator.id}
                                            className="rounded-lg px-2.5 py-2 text-xs font-bold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                                            title={collaborator.status === 'disabled' ? 'Activate collaborator' : 'Disable collaborator'}
                                        >
                                            {collaborator.status === 'disabled' ? 'Activate' : 'Disable'}
                                        </button>
                                        <button
                                            onClick={() => handleDeleteCollaborator(collaborator.id)}
                                            disabled={deletingCollaboratorId === collaborator.id}
                                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                                            title="Remove collaborator"
                                        >
                                            {deletingCollaboratorId === collaborator.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                        </button>
                                    </div>
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
