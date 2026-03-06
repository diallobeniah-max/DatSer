import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { X, UserPlus, Mail, Trash2, Users, AlertCircle, Send, CheckCircle, Clock, RefreshCw, Copy, Link2 } from 'lucide-react'
import { toast } from 'react-toastify'
import { supabase } from '../lib/supabase'

const ShareAccessModal = ({ isOpen, onClose }) => {
  const { user, preferences } = useAuth()
  const { isDarkMode } = useTheme()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendingId, setResendingId] = useState(null)
  const [collaborators, setCollaborators] = useState([])
  const [fetchingCollaborators, setFetchingCollaborators] = useState(false)
  const [error, setError] = useState('')

  // Fetch existing collaborators when modal opens
  useEffect(() => {
    if (isOpen && user) {
      fetchCollaborators()
    }
  }, [isOpen, user])

  const fetchCollaborators = async () => {
    if (!user) return
    
    setFetchingCollaborators(true)
    setError('')
    
    try {
      const { data, error } = await supabase
        .from('collaborators')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setCollaborators(data || [])
    } catch (err) {
      console.error('Error fetching collaborators:', err)
      setError('Failed to load collaborators')
    } finally {
      setFetchingCollaborators(false)
    }
  }

  const sendInvite = async (collaboratorEmail) => {
    const { data: { session } } = await supabase.auth.getSession()
    const appUrl = 'https://datser.vercel.app/'
    const inviterName = preferences?.workspace_name || user?.user_metadata?.full_name || user?.email

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-collaborator-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ 
          email: collaboratorEmail,
          inviterName,
          appUrl
        })
      }
    )
    
    const result = await response.json()
    if (!response.ok || result.error) {
      throw new Error(result.error || 'Failed to send invite')
    }
    return result
  }

  const handleAddCollaborator = async (e) => {
    e.preventDefault()
    
    if (!email.trim()) {
      toast.error('Please enter an email address')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      toast.error('Please enter a valid email address')
      return
    }

    // Can't invite yourself
    if (email.trim().toLowerCase() === user?.email?.toLowerCase()) {
      toast.warning("You can't invite yourself")
      return
    }

    // Check if already added
    if (collaborators.some(c => c.email.toLowerCase() === email.trim().toLowerCase())) {
      toast.warning('This person has already been invited')
      return
    }

    setLoading(true)
    setError('')

    try {
      const collaboratorEmail = email.trim().toLowerCase()
      
      // 1. Generate invite link via Edge Function
      const inviteResult = await sendInvite(collaboratorEmail)

      // 2. Add to collaborators table
      const { data, error } = await supabase
        .from('collaborators')
        .insert([{
          owner_id: user.id,
          email: collaboratorEmail,
          status: 'pending',
          invite_token: inviteResult.inviteLink || null,
          invited_by_name: preferences?.workspace_name || user?.user_metadata?.full_name || user?.email
        }])
        .select()
        .single()

      if (error) throw error

      // Track email send for rate limit display
      if (inviteResult.emailSent) {
        try {
          const raw = localStorage.getItem('email_send_timestamps')
          const timestamps = raw ? JSON.parse(raw) : []
          const cutoff = Date.now() - 60 * 60 * 1000
          const recent = timestamps.filter(ts => ts > cutoff)
          recent.push(Date.now())
          localStorage.setItem('email_send_timestamps', JSON.stringify(recent))
        } catch { /* ignore */ }
      }

      // Copy invite link to clipboard and show appropriate message
      if (inviteResult.inviteLink) {
        try {
          await navigator.clipboard.writeText(inviteResult.inviteLink)
          if (inviteResult.emailSent) {
            toast.success(`Invite email sent to ${collaboratorEmail}! Link also copied to clipboard.`)
          } else if (inviteResult.alreadyExists) {
            toast.success(`${collaboratorEmail} already has an account. Login link copied to clipboard.`)
          } else {
            toast.success(`Invite link copied to clipboard! Share it with ${collaboratorEmail}`)
          }
        } catch {
          if (inviteResult.emailSent) {
            toast.success(`Invite email sent to ${collaboratorEmail}!`)
          } else {
            toast.success(`Invite created for ${collaboratorEmail}. Use the copy button to share the link.`)
          }
        }
      }

      setCollaborators(prev => [data, ...prev])
      setEmail('')
    } catch (err) {
      console.error('Error adding collaborator:', err)
      if (err.code === '23505') {
        toast.error('This email has already been invited')
      } else {
        toast.error(err.message || 'Failed to send invite. Please try again.')
      }
      setError('Failed to send invite')
    } finally {
      setLoading(false)
    }
  }

  const handleResendInvite = async (collaborator) => {
    setResendingId(collaborator.id)
    try {
      const result = await sendInvite(collaborator.email)
      if (result.inviteLink) {
        // Update the stored invite link
        await supabase
          .from('collaborators')
          .update({ invite_token: result.inviteLink })
          .eq('id', collaborator.id)
        
        // Update local state
        setCollaborators(prev => prev.map(c => 
          c.id === collaborator.id ? { ...c, invite_token: result.inviteLink } : c
        ))

        try {
          await navigator.clipboard.writeText(result.inviteLink)
          toast.success(`New invite link copied to clipboard!`)
        } catch {
          toast.success(`New invite link generated. Use the copy button to share it.`)
        }
      }
    } catch (err) {
      console.error('Error resending invite:', err)
      toast.error('Failed to generate new invite link')
    } finally {
      setResendingId(null)
    }
  }

  const handleCopyLink = async (inviteLink) => {
    if (!inviteLink) {
      toast.error('No invite link available. Try resending the invite.')
      return
    }
    try {
      await navigator.clipboard.writeText(inviteLink)
      toast.success('Invite link copied to clipboard!')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  const handleRemoveCollaborator = async (collaboratorId, collaboratorEmail) => {
    try {
      const { error } = await supabase
        .from('collaborators')
        .delete()
        .eq('id', collaboratorId)
        .eq('owner_id', user.id)

      if (error) throw error

      setCollaborators(prev => prev.filter(c => c.id !== collaboratorId))
      toast.success(`Removed ${collaboratorEmail}`)
    } catch (err) {
      console.error('Error removing collaborator:', err)
      toast.error('Failed to remove collaborator')
    }
  }

  const getStatusBadge = (status) => {
    switch (status) {
      case 'accepted':
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
            <CheckCircle className="w-3 h-3" />
            Joined
          </span>
        )
      case 'rejected':
        return (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
            Declined
          </span>
        )
      case 'expired':
        return (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
            Expired
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
            <Clock className="w-3 h-3" />
            Invite Sent
          </span>
        )
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
      <div className="shadow-2xl ring-1 max-w-md w-full mx-4 max-h-[90vh] flex flex-col transition-all duration-300 bg-white dark:bg-gray-800 ring-gray-200 dark:ring-gray-700 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-600">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
              <Users className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Share Access</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Invite people by email. They'll receive a link to join and access your data.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Invite Form */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Invite by email
            </label>
            <form onSubmit={handleAddCollaborator} className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@email.com"
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium whitespace-nowrap"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Invite
                  </>
                )}
              </button>
            </form>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              They'll receive an email with a link to join. Works with any email — Gmail, Outlook, Yahoo, etc.
            </p>
          </div>

          {/* Collaborators List */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                <Users className="w-4 h-4 inline mr-1.5" />
                People with access ({collaborators.length})
              </label>
            </div>

            {fetchingCollaborators ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-600"></div>
              </div>
            ) : collaborators.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No one has been invited yet</p>
                <p className="text-xs mt-1">Enter an email above to send an invite</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {collaborators.map((collaborator) => (
                  <div
                    key={collaborator.id}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600"
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium text-orange-600 dark:text-orange-400">
                          {collaborator.email.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {collaborator.email}
                        </p>
                        <div className="flex items-center space-x-2 mt-0.5">
                          {getStatusBadge(collaborator.status)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {collaborator.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleCopyLink(collaborator.invite_token)}
                            className="p-1.5 text-gray-400 hover:text-green-500 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                            title="Copy invite link"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleResendInvite(collaborator)}
                            disabled={resendingId === collaborator.id}
                            className="p-1.5 text-gray-400 hover:text-orange-500 dark:hover:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg transition-colors"
                            title="Generate new invite link"
                          >
                            <RefreshCw className={`w-4 h-4 ${resendingId === collaborator.id ? 'animate-spin' : ''}`} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleRemoveCollaborator(collaborator.id, collaborator.email)}
                        className="p-1.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        title="Remove access"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center space-x-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-600">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default ShareAccessModal
