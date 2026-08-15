// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  checkLiveEndpoint,
  findVercelStatus,
  verifyDeployment
} from './verify-production-deploy.mjs'

describe('Deployment Gate (verify-production-deploy)', () => {
  it('identifies Vercel status from GitHub commit statuses list', () => {
    const statuses = [
      { context: 'ci/circleci', state: 'success' },
      { context: 'Vercel', state: 'success', description: 'Deployment has completed' }
    ]
    const found = findVercelStatus(statuses)
    expect(found).toBeDefined()
    expect(found.context).toBe('Vercel')
    expect(found.state).toBe('success')
  })

  it('verifies successful deployment and live smoke test', async () => {
    const mockFetch = vi.fn(async (url) => {
      if (url.includes('api.github.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { context: 'Vercel', state: 'success', description: 'Deployment has completed' }
          ]
        }
      }
      if (url.endsWith('/api/gemini-extract')) {
        return { ok: false, status: 401, json: async () => ({ ok: false, code: 'UNAUTHORIZED' }) }
      }
      return {
        ok: true,
        status: 200,
        text: async () => '<!DOCTYPE html><html><head></head><body><div id="root"></div><script src="/assets/index-123.js"></script></body></html>'
      }
    })

    const logs = []
    const result = await verifyDeployment({
      targetSha: 'cfefd0127b7ed33359f940b368f036aca548db88',
      maxWaitMs: 1000,
      pollIntervalMs: 10,
      fetchFn: mockFetch,
      sleepFn: () => Promise.resolve(),
      logFn: (msg) => logs.push(msg),
      errorFn: vi.fn()
    })

    expect(result.ok).toBe(true)
    expect(result.sha).toBe('cfefd0127b7ed33359f940b368f036aca548db88')
    expect(logs.some(l => l.includes('DATSER PRODUCTION DEPLOYMENT VERIFIED'))).toBe(true)
  })

  it('fails loudly when Vercel reports a failure state', async () => {
    const mockFetch = vi.fn(async (url) => {
      if (url.includes('api.github.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              context: 'Vercel',
              state: 'failure',
              description: 'Command "vite build" exited with 127',
              target_url: 'https://vercel.com/failed-dpl'
            }
          ]
        }
      }
      return { ok: true, status: 200, text: async () => '' }
    })

    const errors = []
    const result = await verifyDeployment({
      targetSha: 'failed-sha-12345',
      maxWaitMs: 1000,
      pollIntervalMs: 10,
      fetchFn: mockFetch,
      sleepFn: () => Promise.resolve(),
      logFn: vi.fn(),
      errorFn: (msg) => errors.push(msg)
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('VERCEL_FAILED')
    expect(errors.some(e => e.includes('DEPLOYMENT FAILED'))).toBe(true)
  })

  it('fails when live smoke test returns 500 error or wrong HTML', async () => {
    const mockFetch = vi.fn(async (url) => {
      if (url.includes('api.github.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { context: 'Vercel', state: 'success', description: 'Deployment has completed' }
          ]
        }
      }
      return {
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      }
    })

    const errors = []
    const result = await verifyDeployment({
      targetSha: 'good-sha-bad-site',
      maxWaitMs: 1000,
      pollIntervalMs: 10,
      fetchFn: mockFetch,
      sleepFn: () => Promise.resolve(),
      logFn: vi.fn(),
      errorFn: (msg) => errors.push(msg)
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('LIVE_CHECK_FAILED')
    expect(errors.some(e => e.includes('LIVE SMOKE TEST FAILED'))).toBe(true)
  })
})
