import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { groupRecordsByIdentity, normalizeReviewRow } from '../utils/memberDataReview'
import { createReviewTableFetcher, loadAllMonthReviewRows } from '../utils/memberDataReviewLoader'

const REVIEW_CACHE_TTL_MS = 10 * 60 * 1000

// Module-level raw-row cache keyed by owner + table signature so the review
// page never re-fetches every month on re-render or on navigating back.
const reviewLoadCache = new Map()

const getReviewCacheKey = (ownerId, tables) => `${ownerId}:${(tables || []).join(',')}`

const useMemberDataReview = () => {
  const {
    monthlyTables,
    dataOwnerId,
    user,
    isSupabaseConfigured,
    workspaceMemberCodeAssignments
  } = useApp()

  const ownerId = dataOwnerId || user?.id
  const tables = Array.isArray(monthlyTables) ? monthlyTables : []
  const cacheKey = ownerId ? getReviewCacheKey(ownerId, tables) : ''

  const [rowsByTable, setRowsByTable] = useState(null)
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [error, setError] = useState(null)
  const reloadCounterRef = useRef(0)

  const fetchTableRows = useCallback((table) => (
    createReviewTableFetcher({
      supabase,
      ownerId,
      isConfigured: isSupabaseConfigured()
    })(table)
  ), [ownerId, isSupabaseConfigured])

  const load = useCallback(async (force = false) => {
    if (!ownerId || tables.length === 0) {
      setRowsByTable(null)
      setStatus('idle')
      return
    }

    const now = Date.now()
    const cached = reviewLoadCache.get(cacheKey)
    if (!force && cached && now - cached.ts < REVIEW_CACHE_TTL_MS) {
      setRowsByTable(cached.rowsByTable)
      setStatus('ready')
      setError(null)
      return
    }

    setStatus('loading')
    try {
      const loaded = await loadAllMonthReviewRows({ tables, ownerId, fetchTableRows })
      reviewLoadCache.set(cacheKey, { ts: now, rowsByTable: loaded })
      setRowsByTable(loaded)
      setStatus('ready')
      setError(null)
    } catch (err) {
      console.error('Member data review load failed:', err)
      setStatus('error')
      setError(err)
    }
  }, [ownerId, tables, cacheKey, fetchTableRows])

  useEffect(() => {
    void load()
  }, [load])

  const reload = useCallback(() => {
    reloadCounterRef.current += 1
    if (cacheKey) reviewLoadCache.delete(cacheKey)
    void load(true)
  }, [load, cacheKey])

  const persons = useMemo(() => {
    if (!rowsByTable) return []
    const records = []
    for (const [table, rows] of rowsByTable) {
      for (const row of rows) {
        const record = normalizeReviewRow(row, {
          tableName: table,
          ownerId,
          codeAssignments: workspaceMemberCodeAssignments || {}
        })
        if (record) records.push(record)
      }
    }
    return groupRecordsByIdentity(records)
  }, [rowsByTable, ownerId, workspaceMemberCodeAssignments])

  const rawRecordCount = useMemo(() => {
    if (!rowsByTable) return 0
    let count = 0
    for (const rows of rowsByTable.values()) count += Array.isArray(rows) ? rows.length : 0
    return count
  }, [rowsByTable])

  return {
    status,
    error,
    persons,
    rawRecordCount,
    monthCount: tables.length,
    reload,
    reloadKey: reloadCounterRef.current
  }
}

export default useMemberDataReview
