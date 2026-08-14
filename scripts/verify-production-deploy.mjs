#!/usr/bin/env node
import { execFileSync } from 'node:child_process'

export const GITHUB_REPO = 'diallobeniah-max/DatSer'
export const DEFAULT_PRODUCTION_URL = 'https://datser.vercel.app'

export const getHeadCommitSha = (cwd = process.cwd()) => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch (error) {
    throw new Error(`Failed to resolve local HEAD commit SHA: ${error.message}`)
  }
}

export const fetchCommitStatuses = async (sha, { repo = GITHUB_REPO, fetchFn = globalThis.fetch } = {}) => {
  const url = `https://api.github.com/repos/${repo}/commits/${sha}/statuses`
  const res = await fetchFn(url, {
    headers: {
      'User-Agent': 'DatSer-Deploy-Gate'
    }
  })
  if (!res.ok) {
    throw new Error(`GitHub API request failed with status ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

export const findVercelStatus = (statuses = []) => {
  if (!Array.isArray(statuses)) return null
  return statuses.find(s => s.context === 'Vercel' || s.creator?.login === 'vercel[bot]') || null
}

export const checkLiveEndpoint = async (url, { fetchFn = globalThis.fetch } = {}) => {
  const targetUrl = url.replace(/\/$/, '')
  const pageRes = await fetchFn(`${targetUrl}/`, {
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
  })
  if (!pageRes.ok) {
    return { ok: false, step: 'site-load', status: pageRes.status, error: `Live site returned HTTP ${pageRes.status}` }
  }
  const html = await pageRes.text()
  if (!html.includes('<div id="root">') && !html.includes('assets/index-')) {
    return { ok: false, step: 'html-content', error: 'Live site HTML does not contain expected DatSer markup.' }
  }

  // Smoke test serverless endpoint
  try {
    const apiRes = await fetchFn(`${targetUrl}/api/gemini-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true })
    })
    // Endpoint must be protected and respond with 401
    if (apiRes.status !== 401) {
      return { ok: false, step: 'api-guard', status: apiRes.status, error: `Expected 401 from /api/gemini-extract but received ${apiRes.status}` }
    }
  } catch (err) {
    return { ok: false, step: 'api-guard', error: `Failed to reach /api/gemini-extract: ${err.message}` }
  }

  return { ok: true, status: 200 }
}

export const verifyDeployment = async ({
  targetSha,
  productionUrl = DEFAULT_PRODUCTION_URL,
  repo = GITHUB_REPO,
  maxWaitMs = 180000,
  pollIntervalMs = 5000,
  fetchFn = globalThis.fetch,
  sleepFn = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  logFn = console.log,
  errorFn = console.error
} = {}) => {
  const sha = targetSha || getHeadCommitSha()
  logFn(`[DeployGate] Verifying deployment for SHA: ${sha}`)

  const startTime = Date.now()
  let vercelStatus = null

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const statuses = await fetchCommitStatuses(sha, { repo, fetchFn })
      vercelStatus = findVercelStatus(statuses)

      if (vercelStatus) {
        logFn(`[DeployGate] Vercel status for ${sha.slice(0, 7)}: ${vercelStatus.state} (${vercelStatus.description || 'no description'})`)

        if (vercelStatus.state === 'success') {
          break
        }

        if (vercelStatus.state === 'failure' || vercelStatus.state === 'error') {
          errorFn(`\n❌ DEPLOYMENT FAILED`)
          errorFn(`SHA: ${sha}`)
          errorFn(`Status: ${vercelStatus.state}`)
          errorFn(`Details: ${vercelStatus.description}`)
          errorFn(`Target URL: ${vercelStatus.target_url || 'N/A'}`)
          return {
            ok: false,
            reason: 'VERCEL_FAILED',
            sha,
            vercelStatus
          }
        }
      } else {
        logFn(`[DeployGate] Waiting for Vercel status registration...`)
      }
    } catch (err) {
      logFn(`[DeployGate] Polling notice: ${err.message}`)
    }

    await sleepFn(pollIntervalMs)
  }

  if (!vercelStatus || vercelStatus.state !== 'success') {
    errorFn(`\n❌ DEPLOYMENT TIMED OUT OR INCOMPLETE`)
    errorFn(`SHA: ${sha}`)
    errorFn(`Last Vercel State: ${vercelStatus?.state || 'UNREGISTERED'}`)
    return {
      ok: false,
      reason: 'VERCEL_TIMEOUT',
      sha,
      vercelStatus
    }
  }

  logFn(`[DeployGate] Vercel build SUCCESS. Running live smoke tests on ${productionUrl}...`)
  const liveCheck = await checkLiveEndpoint(productionUrl, { fetchFn })

  if (!liveCheck.ok) {
    errorFn(`\n❌ DEPLOYMENT INCOMPLETE / LIVE SMOKE TEST FAILED`)
    errorFn(`Step: ${liveCheck.step}`)
    errorFn(`Error: ${liveCheck.error}`)
    return {
      ok: false,
      reason: 'LIVE_CHECK_FAILED',
      sha,
      liveCheck
    }
  }

  logFn(`\n========================================`)
  logFn(`DATSER PRODUCTION DEPLOYMENT VERIFIED`)
  logFn(`SHA: ${sha}`)
  logFn(`URL: ${productionUrl}`)
  logFn(`========================================\n`)

  return {
    ok: true,
    sha,
    productionUrl,
    vercelStatus
  }
}

import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Auto-run if executed directly as CLI script
const currentFilePath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  const shaArg = process.argv[2]?.trim()
  verifyDeployment({ targetSha: shaArg })
    .then((result) => {
      if (!result.ok) {
        process.exit(1)
      }
    })
    .catch((err) => {
      console.error(`Deploy verification crashed: ${err.message}`)
      process.exit(1)
    })
}
