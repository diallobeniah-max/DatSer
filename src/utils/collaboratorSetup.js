export const sendCollaboratorSetupEmail = async ({ supabase, user, preferences, email }) => {
  const collaboratorEmail = String(email || '').trim().toLowerCase()
  if (!collaboratorEmail) {
    throw new Error('Collaborator email is required')
  }

  const { data: { session } } = await supabase.auth.getSession()
  const appUrl = `${window.location.origin}${import.meta.env?.BASE_URL || '/'}`
  const inviterName = preferences?.workspace_name || user?.user_metadata?.full_name || user?.email || 'DatSer'

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
    throw new Error(result.error || 'Failed to send setup email')
  }

  if (result.alreadyExists) {
    const { error } = await supabase.auth.resetPasswordForEmail(collaboratorEmail, {
      redirectTo: appUrl
    })
    if (error) throw error
    return {
      ...result,
      emailSent: true,
      passwordResetSent: true,
      message: 'Password reset/setup email sent'
    }
  }

  return result
}
