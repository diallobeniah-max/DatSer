import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  }
)

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Admin login is temporarily unavailable' }, 503)
    }

    const payload = await req.json().catch(() => ({}))
    const code = typeof payload?.code === 'string' ? payload.code : ''
    if (!code || code.length > 256) {
      return jsonResponse({ error: 'Invalid admin code' }, 400)
    }

    const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    const clientIp = forwardedFor || req.headers.get('cf-connecting-ip') || 'unknown'
    const ipHash = await sha256(`${clientIp}|${serviceRoleKey.slice(-24)}`)

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data: verification, error: verifyError } = await supabaseAdmin.rpc(
      'verify_admin_code_login_edge',
      { p_code: code, p_ip_hash: ipHash }
    )
    if (verifyError) {
      console.error('Admin code verification failed:', verifyError.code)
      return jsonResponse({ error: 'Admin login is temporarily unavailable' }, 503)
    }
    if (!verification?.success) {
      const status = verification?.code === 'rate_limited' ? 429 : 401
      return jsonResponse({ error: verification?.error || 'Invalid admin code' }, status)
    }

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: verification.owner_email
    })
    const tokenHash = linkData?.properties?.hashed_token
    if (linkError || !tokenHash || linkData?.user?.id !== verification.owner_id) {
      console.error('Admin session exchange failed:', linkError?.message || 'owner mismatch')
      return jsonResponse({ error: 'Admin login is temporarily unavailable' }, 503)
    }

    return jsonResponse({ success: true, token_hash: tokenHash, type: 'email' })
  } catch (error) {
    console.error('Unexpected admin login error:', error instanceof Error ? error.message : 'unknown')
    return jsonResponse({ error: 'Admin login is temporarily unavailable' }, 500)
  }
})
