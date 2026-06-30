export const getCollaboratorEmail = (collaborator) => (
  collaborator?.email ||
  collaborator?.collaborator_email ||
  collaborator?.collaboratorEmail ||
  ''
)

export const normalizeCollaborator = (collaborator) => {
  if (!collaborator) return null
  const email = String(getCollaboratorEmail(collaborator) || '').trim().toLowerCase()
  const status = collaborator.status || (
    collaborator.accepted_at || collaborator.collaborator_user_id ? 'active' : 'pending'
  )
  const role = collaborator.role || (collaborator.is_admin ? 'admin' : 'member')

  return {
    ...collaborator,
    email,
    collaborator_email: collaborator.collaborator_email || email,
    display_name: collaborator.display_name || collaborator.name || email,
    role,
    status,
    is_admin: Boolean(collaborator.is_admin || role === 'admin'),
    linked_status: collaborator.collaborator_user_id
      ? 'linked'
      : status === 'disabled'
        ? 'disabled'
        : status === 'active' || status === 'accepted'
          ? 'missing auth user'
          : 'pending'
  }
}

export const normalizeCollaborators = (collaborators = []) => (
  Array.isArray(collaborators)
    ? collaborators.map(normalizeCollaborator).filter(Boolean)
    : []
)

export const collaboratorMatchesEmail = (collaborator, email) => (
  getCollaboratorEmail(collaborator).trim().toLowerCase() === String(email || '').trim().toLowerCase()
)
