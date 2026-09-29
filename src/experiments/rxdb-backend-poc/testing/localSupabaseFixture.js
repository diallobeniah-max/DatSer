import { execFileSync, execSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

export const readLocalSupabase = () => {
  if (process.env.DATSER_LOCAL_SUPABASE_URL && process.env.DATSER_LOCAL_SUPABASE_ANON_KEY && process.env.DATSER_LOCAL_SUPABASE_SERVICE_ROLE_KEY) {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.DATSER_LOCAL_SUPABASE_URL)) throw new Error('Member V2 integration tests require local Supabase.')
    return { url: process.env.DATSER_LOCAL_SUPABASE_URL, anonKey: process.env.DATSER_LOCAL_SUPABASE_ANON_KEY, serviceKey: process.env.DATSER_LOCAL_SUPABASE_SERVICE_ROLE_KEY }
  }
  const dockerBin = 'C:\\Program Files\\Docker\\Docker\\resources\\bin'
  const options = { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: process.platform === 'win32' ? `${dockerBin};${process.env.PATH}` : process.env.PATH } }
  const raw = process.platform === 'win32'
    ? execSync('npx supabase status -o json', options)
    : execFileSync(npx, ['supabase', 'status', '-o', 'json'], options)
  const status = JSON.parse(raw)
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(status.API_URL)) throw new Error('POC tests require local Supabase.')
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY }
}

export const readLocalSupabaseDbContainer = () => {
  if (process.env.DATSER_LOCAL_SUPABASE_DB_CONTAINER) return process.env.DATSER_LOCAL_SUPABASE_DB_CONTAINER
  const docker = process.platform === 'win32' ? 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' : 'docker'
  const result = execFileSync(docker, ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'], { encoding: 'utf8' })
  const container = result.trim().split(/\r?\n/)[0]
  if (!container) throw new Error('Local Supabase database container is required for this integration test.')
  return container
}

// Vitest may run several integration files in parallel, but they share one
// local Supabase database and create workspace-month tables/catalog objects.
// Serialize only those database-backed suites; all unit/browser tests remain
// parallel. The lock is process-safe and recovers an abandoned owner.
export const acquireLocalSupabaseIntegrationLock = async ({ timeoutMs = 180000 } = {}) => {
  const identity = process.env.DATSER_LOCAL_SUPABASE_DB_CONTAINER
    || process.env.DATSER_LOCAL_SUPABASE_URL
    || 'datser-local-supabase'
  const suffix = createHash('sha256').update(identity).digest('hex').slice(0, 20)
  const lockDirectory = join(tmpdir(), `datser-local-supabase-test-${suffix}.lock`)
  const token = randomUUID()
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await mkdir(lockDirectory)
      await writeFile(join(lockDirectory, 'owner.json'), JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }), { flag: 'wx' })
      return async () => {
        try {
          const owner = JSON.parse(await readFile(join(lockDirectory, 'owner.json'), 'utf8'))
          if (owner.token === token) await rm(lockDirectory, { recursive: true, force: true })
        } catch { /* The lock was already recovered or released. */ }
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        await rm(lockDirectory, { recursive: true, force: true }).catch(() => {})
        throw error
      }
      try {
        const owner = JSON.parse(await readFile(join(lockDirectory, 'owner.json'), 'utf8'))
        let processAlive = true
        try { process.kill(owner.pid, 0) } catch { processAlive = false }
        if (!processAlive || Date.now() - Number(owner.createdAt) > 15 * 60 * 1000) {
          await rm(lockDirectory, { recursive: true, force: true })
          continue
        }
      } catch {
        try {
          const lockInfo = await stat(lockDirectory)
          if (Date.now() - lockInfo.mtimeMs > 10000) await rm(lockDirectory, { recursive: true, force: true })
        } catch { /* Another process removed the lock. */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('Timed out waiting for the shared local Supabase integration lock.')
}

export const createSyntheticFixture = async () => {
  const config = readLocalSupabase()
  const admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const nonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const password = `Poc-${crypto.randomUUID()}-9a!`
  const createUser = async (label) => {
    const email = `rxdb-poc-${label}-${nonce}@local.invalid`
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw error
    const client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const login = await client.auth.signInWithPassword({ email, password })
    if (login.error) throw login.error
    await client.realtime.setAuth(login.data.session.access_token)
    return { id: data.user.id, email, password, client }
  }
  const ownerA = await createUser('owner-a')
  const collaboratorA = await createUser('collab-a')
  const userB = await createUser('user-b')
  const workspaceA = crypto.randomUUID()
  const workspaceB = crypto.randomUUID()
  const createA = await ownerA.client.rpc('poc_create_workspace', { p_name: 'Synthetic Workspace A', p_workspace_id: workspaceA })
  if (createA.error) throw createA.error
  const add = await ownerA.client.rpc('poc_add_workspace_member', { p_workspace_id: workspaceA, p_user_id: collaboratorA.id, p_role: 'collaborator' })
  if (add.error) throw add.error
  const createB = await userB.client.rpc('poc_create_workspace', { p_name: 'Synthetic Workspace B', p_workspace_id: workspaceB })
  if (createB.error) throw createB.error
  return { ...config, admin, ownerA, collaboratorA, userB, workspaceA, workspaceB }
}
