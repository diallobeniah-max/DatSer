import { describe, expect, it } from 'vitest'
import { FILE_STORAGE_QUOTA_BYTES, formatBytes, summarizeOfflineSyncHealth, summarizeSavedScanUsage } from './paperScanUsageHealth'

describe('formatBytes', () => {
  it('formats byte counts with readable units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(795030)).toBe('776.4 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1024.00 MB')
    expect(FILE_STORAGE_QUOTA_BYTES).toBe(1024 * 1024 * 1024)
  })

  it('survives missing or empty input', () => {
    expect(formatBytes(null)).toBe('0 B')
    expect(formatBytes(undefined)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
  })
})

describe('summarizeSavedScanUsage', () => {
  it('counts only persisted per-sheet usageMetadata and never treats a total rollup as another call', () => {
    const summary = summarizeSavedScanUsage([{ id: 'scan-a', name: 'August', usage_metadata: {
      'sheet-1': { promptTokenCount: 8, candidatesTokenCount: 3 },
      _total: { promptTokenCount: 8, candidatesTokenCount: 3 }
    }, extraction: { 'sheet-1': { extractedAt: '2026-08-13T09:00:00.000Z' } } }])
    expect(summary).toMatchObject({ successfulCalls: 1, promptTokens: 8, candidateTokens: 3, totalTokens: 11, lastSuccessfulAt: '2026-08-13T09:00:00.000Z' })
  })

  it('does not invent a last-success timestamp for older saved scans', () => {
    const summary = summarizeSavedScanUsage([{ id: 'old', usage_metadata: { 'sheet-1': { promptTokenCount: 1 } }, extraction: { 'sheet-1': {} } }])
    expect(summary.lastSuccessfulAt).toBeNull()
  })
})

describe('summarizeOfflineSyncHealth', () => {
  it('reports pending and failed changes separately from the existing offline engine state', () => {
    expect(summarizeOfflineSyncHealth({
      isOnline: true,
      offlineModeStatus: 'online',
      offlineCacheMeta: { lastSyncAt: '2026-08-13T08:00:00.000Z' },
      offlinePendingChanges: [{ sync_status: 'pending' }, { sync_status: 'failed' }]
    })).toMatchObject({ healthy: false, pending: 1, failed: 1, lastSync: '2026-08-13T08:00:00.000Z' })
  })
})
