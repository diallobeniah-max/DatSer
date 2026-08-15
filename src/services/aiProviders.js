// Client bridge for AI Provider settings. The full key is NEVER returned to the
// browser or stored client-side; the server returns only status + maskedSuffix.

export const AI_PROVIDERS_ENDPOINT = '/api/ai-providers'

export const toProviderHeaders = (bearerToken, workspaceId) => {
  const headers = { 'Content-Type': 'application/json' }
  if (workspaceId) headers['X-DatSer-Workspace-Id'] = workspaceId
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`
  return headers
}

export const fetchProviderStatus = async ({ bearerToken, workspaceId, provider = 'gemini' }) => {
  const qs = new URLSearchParams({ ownerId: workspaceId || '', provider })
  const response = await fetch(`${AI_PROVIDERS_ENDPOINT}?${qs.toString()}`, {
    method: 'GET',
    headers: toProviderHeaders(bearerToken, workspaceId)
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Could not load provider status.')
  }
  return payload
}

export const setProviderSecret = async ({ bearerToken, workspaceId, provider = 'gemini', secret }) => {
  const response = await fetch(AI_PROVIDERS_ENDPOINT, {
    method: 'POST',
    headers: toProviderHeaders(bearerToken, workspaceId),
    body: JSON.stringify({ action: 'set', provider, secret })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Could not save the provider key.')
  }
  return payload
}

export const testProviderConnection = async ({ bearerToken, workspaceId, provider = 'gemini', secret = '' }) => {
  const response = await fetch(AI_PROVIDERS_ENDPOINT, {
    method: 'POST',
    headers: toProviderHeaders(bearerToken, workspaceId),
    body: JSON.stringify({ action: 'test', provider, secret })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Could not test the provider.')
  }
  return payload
}

export const removeProviderSecret = async ({ bearerToken, workspaceId, provider = 'gemini' }) => {
  const qs = new URLSearchParams({ ownerId: workspaceId || '', provider })
  const response = await fetch(`${AI_PROVIDERS_ENDPOINT}?${qs.toString()}`, {
    method: 'DELETE',
    headers: toProviderHeaders(bearerToken, workspaceId)
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Could not remove the provider key.')
  }
  return payload
}
