import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'
import {
  assertSupabaseMutationAffected,
  executeSupabaseWrite,
  isTransientSupabaseError
} from '../utils/supabaseWrite'
import { useAuth } from './AuthContext'
import {
  isBackendHealthy,
  isBackendDegradedError,
  markBackendDegraded,
  subscribeBackendHealth
} from '../utils/backendHealthCoordinator'
import { notify } from '../utils/notify'
import { buildMemberIndexCodeMap, DEFAULT_MEMBER_CODE_LENGTH, getMemberIndexCode, getMemberIndexCodeAliases, normalizeMemberCodeFormat, normalizeMemberCodeLength } from '../utils/memberIndexCodes'
import {
  mergeWorkspaceMemberCodeAssignments,
  readAllWorkspaceMemberCodeAssignmentPages,
  readWorkspaceMemberCodeAssignmentsCache,
  toWorkspaceMemberCodeMap,
  writeWorkspaceMemberCodeAssignmentsCache
} from '../utils/workspaceMemberCodeAssignments'
import { consumeMemberCheckInUrl } from '../utils/qrCheckIn'
import {
  attachMemberIdentity,
  buildMemberIdentityHint,
  getMemberCanonicalId,
  getMemberOwnerId,
  getMemberSourceTable
} from '../utils/memberIdentity'
import { DEFAULT_GUIDED_FORM_SETTINGS, normalizeGuidedOrder, readGuidedFormSettings, writeGuidedFormSettings } from '../utils/guidedFormSettings'
import { DEV_BYPASS_STORAGE_KEY, isLocalWebDeveloperModeAllowed } from '../utils/developerMode'
import { mergeAttendanceMapWithPending, mergeRealtimeMemberWithPending } from '../utils/realtimeMerge'
import { classifyMemberSearch, getSearchableMemberName, normalizeSearchText } from '../utils/memberSearch'
import { normalizeHistoricalSearchSettings, resolveHistoricalSearchTables } from '../utils/historicalSearchSettings'
import { formatMemberName, normalizeMemberNameStyle } from '../utils/memberNameStyle'
import { createAttendanceSnapshotVersionRegistry } from '../utils/attendanceSnapshot'
import { createResumeSyncCoordinator } from '../utils/appResumeSync'
import { createSyncFlushScheduler } from '../utils/syncFlushScheduler'
import {
  buildAutoCalendarPreferences,
  buildManualCalendarPreferences,
  getPersonalManualDeadline,
  getPersonalManualExpiryPhase,
  PERSONAL_MANUAL_DURATION_MS,
  PERSONAL_MANUAL_WARNING_MS
} from '../utils/personalCalendarMode'
import { invalidateRequestScope, runScopedRequest } from '../utils/runtimeRequestRegistry'
import { acquireRealtimeChannel } from '../utils/realtimeChannelRegistry'
import {
  isAttendanceAlreadySynced,
  isOfflineAttendanceConflict,
  normalizeQueuedAttendanceValue
} from '../utils/attendanceRecords'
import {
  clearAllOfflineData,
  deleteMemberPreviewMember,
  filterPreviewMembersForWrite,
  getNextFailureSyncStatus,
  getOfflineSnapshot,
  getMemberPreviewMembers,
  getSyncableChangesNextAttemptDelayMs,
  isChangeRetryEligible,
  isChangeSyncable,
  isOfflineStoreAvailable,
  getPendingOfflineChanges,
  queueOfflineChange,
  removeOfflineChange,
  resolveServerDeletedMemberChange,
  saveMemberPreviewMembers,
  saveOfflineSnapshot,
  SYNC_RETRY_LIMIT,
  updateOfflineChangeStatus
} from '../utils/offlineStore'
import {
  addMemberDeleteTombstone,
  filterDeletedMembers,
  getActiveSnapshotMembers,
  isMemberStaleDeleted,
  readMemberDeleteTombstones
} from '../utils/memberDeleteTombstones'

const AppContext = createContext()

const MONTHS_IN_YEAR = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const sortMonthTables = (tables = []) => {
  return tables
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const [monthA = '', yearA = '0'] = a.split('_')
      const [monthB = '', yearB = '0'] = b.split('_')

      if (yearA !== yearB) {
        return parseInt(yearA, 10) - parseInt(yearB, 10)
      }
      return MONTHS_IN_YEAR.indexOf(monthA) - MONTHS_IN_YEAR.indexOf(monthB)
    })
}

// Get current month table name
const getCurrentMonthTable = () => {
  const now = new Date()
  const currentMonth = MONTHS_IN_YEAR[now.getMonth()]
  const currentYear = now.getFullYear()
  return `${currentMonth}_${currentYear}`
}

// Default table for all users - January 2026
const DEFAULT_TABLE = 'January_2026'

// Fallback monthly tables for when Supabase is not configured (demo mode only)
const FALLBACK_MONTHLY_TABLES = [DEFAULT_TABLE]
const DEFAULT_COLLAB_TABLE = 'January_2026'
const COLLAB_FALLBACK_TABLES = [DEFAULT_COLLAB_TABLE]
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const isConfirmedMissingMonthTableError = (error) => {
  if (!error || isBackendDegradedError(error)) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const message = String(error.message || '').toLowerCase()
  return (
    message.includes('relation') && message.includes('does not exist')
  ) || (
    message.includes('table') && message.includes('does not exist')
  )
}
const NOTIFICATION_DURATION_STORAGE_KEY = 'datser_notification_duration_ms'
const NOTIFICATION_DURATION_MIGRATION_KEY = 'datser_notification_duration_readable_default_v2'
const NOTIFICATION_DURATION_COMPACT_MIGRATION_KEY = 'datser_notification_duration_compact_default_v1'
const DEFAULT_NOTIFICATION_DURATION_MS = 4200
const SEARCH_SUGGESTION_VIEW_STORAGE_KEY = 'datser_search_suggestion_view'
const SEARCH_SUGGESTION_PROMPT_STORAGE_KEY = 'datser_search_suggestion_prompt_seen_v1'
const SEARCH_SUGGESTION_PROMPT_TOAST_ID = 'search-display-mode-prompt'
const SEARCH_SUGGESTION_VIEW_MODES = ['short', 'full']
const DEFAULT_SEARCH_SUGGESTION_VIEW = 'full'
const RECENT_MEMBER_EDITS_STORAGE_KEY = 'datser_recent_member_edits'
const RECENT_MEMBER_EDITS_LIMIT = 80
const MEMBER_PREVIEW_PAGE_SIZE = 20
// The dashboard paints the first 20 members immediately. Background indexing
// can use larger pages so it does not compete with the interactive UI through
// dozens of tiny requests on larger workspaces.
const MEMBER_PREVIEW_SYNC_PAGE_SIZE = 100
const MEMBER_PREVIEW_CACHE_TTL_MS = 30 * 60 * 1000
const MEMBER_PREVIEW_BACKGROUND_SYNC_TTL_MS = 90 * 1000
const MEMBER_PREVIEW_SYNC_OVERLAP_MS = 5000
const AUTO_SYNC_DEBOUNCE_MS = 1200
const MEMBER_PREVIEW_CACHE_PREFIX = 'datser_member_preview_cache_v1'
const MEMBER_PREVIEW_SYNC_META_PREFIX = 'datser_member_preview_sync_meta_v1'
const MEMBER_CODE_SETTINGS_CACHE_PREFIX = 'datser_member_code_settings'
const MEMBER_CODE_ASSIGNMENT_PAGE_SIZE = 500
const MEMBER_PREVIEW_SELECT = [
  'id',
  '"Full Name"',
  '"Phone Number"',
  '"Gender"',
  '"Age"',
  '"Current Level"',
  'workspace',
  '"Member"',
  '"Regular"',
  '"Newcomer"',
  '"Manual Badge"',
  '"Badge Type"',
  'inserted_at',
  'updated_at',
  'deleted_at',
  'is_visitor',
  'parent_name_1',
  'parent_phone_1',
  'parent_name_2',
  'parent_phone_2',
  'notes',
  'ministry',
  'date_of_birth',
  'workspace_owner_id',
  'user_id'
].join(',')
const MEMBER_BADGE_SELECT = 'id,"Member","Regular","Newcomer","Manual Badge","Badge Type"'

const getMemberDisplayNameForRecentEdit = (member) => (
  member?.full_name ||
  member?.['Full Name'] ||
  member?.name ||
  member?.Name ||
  'Unknown member'
)

const getRecentMemberEditsStorageKey = (scope = 'guest') => `${RECENT_MEMBER_EDITS_STORAGE_KEY}:${scope || 'guest'}`

const readStoredRecentMemberEdits = (scope = 'guest') => {
  if (typeof window === 'undefined') return []
  try {
    const scoped = window.localStorage.getItem(getRecentMemberEditsStorageKey(scope))
    const legacy = window.localStorage.getItem(RECENT_MEMBER_EDITS_STORAGE_KEY)
    const parsed = JSON.parse(scoped || legacy || '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.edited_at) : []
  } catch {
    return []
  }
}

const resolveLogicalMonthStart = (tableName) => {
  if (!tableName || typeof tableName !== 'string') return null
  const [monthName, yearStr] = tableName.split('_')
  const monthIdx = MONTHS_IN_YEAR.indexOf(monthName)
  const yearNum = Number(yearStr)
  if (monthIdx === -1 || !Number.isInteger(yearNum)) return null
  const monthPad = String(monthIdx + 1).padStart(2, '0')
  return `${yearNum}-${monthPad}-01`
}

const getMemberPreviewCacheKey = (scope = 'guest', tableName = 'default') => (
  `${MEMBER_PREVIEW_CACHE_PREFIX}:${scope || 'guest'}:${tableName || 'default'}`
)

const readMemberPreviewCache = (scope, tableName) => {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getMemberPreviewCacheKey(scope, tableName)) || 'null')
    if (!parsed || !Array.isArray(parsed.data) || !parsed.ts) return null
    return parsed
  } catch {
    return null
  }
}

const writeMemberPreviewCache = (scope, tableName, payload) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(getMemberPreviewCacheKey(scope, tableName), JSON.stringify(payload))
  } catch (error) {
    console.warn('Unable to cache member preview data:', error)
  }
}

const getMemberPreviewSyncMetaKey = (scope = 'guest', tableName = 'default') => (
  `${MEMBER_PREVIEW_SYNC_META_PREFIX}:${scope || 'guest'}:${tableName || 'default'}`
)

const readMemberPreviewSyncMeta = (scope, tableName) => {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getMemberPreviewSyncMetaKey(scope, tableName)) || 'null')
    if (!parsed) return null
    const syncedAt = Number.isFinite(parsed.syncedAt)
      ? parsed.syncedAt
      : Number.isFinite(Date.parse(parsed.lastSyncAt || parsed.lastSyncedAt || ''))
        ? Date.parse(parsed.lastSyncAt || parsed.lastSyncedAt)
        : null
    if (!Number.isFinite(syncedAt)) return null
    return {
      ...parsed,
      syncedAt,
      lastSyncAt: parsed.lastSyncAt || parsed.lastSyncedAt || new Date(syncedAt).toISOString()
    }
  } catch {
    return null
  }
}

const writeMemberPreviewSyncMeta = (scope, tableName, meta = {}) => {
  if (typeof window === 'undefined') return
  try {
    const lastSyncAt = meta.lastSyncAt || meta.lastSyncedAt || new Date().toISOString()
    window.localStorage.setItem(getMemberPreviewSyncMetaKey(scope, tableName), JSON.stringify({
      ...meta,
      lastSyncAt,
      syncedAt: Number.isFinite(meta.syncedAt) ? meta.syncedAt : Date.now()
    }))
  } catch (error) {
    console.warn('Unable to save member preview sync metadata:', error)
  }
}

const isMemberPreviewSyncStale = (scope, tableName, now = Date.now()) => {
  const meta = readMemberPreviewSyncMeta(scope, tableName)
  if (!meta) return true
  return now - (meta.syncedAt || 0) > MEMBER_PREVIEW_BACKGROUND_SYNC_TTL_MS
}

const clearMemberPreviewLocalStorage = () => {
  if (typeof window === 'undefined') return
  try {
    const prefixes = [`${MEMBER_PREVIEW_CACHE_PREFIX}:`, `${MEMBER_PREVIEW_SYNC_META_PREFIX}:`]
    Object.keys(window.localStorage).forEach((key) => {
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        window.localStorage.removeItem(key)
      }
    })
  } catch (error) {
    console.warn('Unable to clear member preview local metadata:', error)
  }
}

const mergeMemberPreviewPages = (existing = [], incoming = []) => {
  const byId = new Map()
  existing.forEach((member) => {
    if (member?.id) byId.set(member.id, member)
  })
  incoming.forEach((member) => {
    if (member?.id) byId.set(member.id, { ...(byId.get(member.id) || {}), ...member })
  })
  return Array.from(byId.values())
}

const getMemberFreshnessTime = (member = {}) => {
  const raw = member.updated_at || member.updatedAt || member.modified_at || member.last_updated || member.inserted_at || member.created_at
  const parsed = Date.parse(raw || '')
  return Number.isFinite(parsed) ? parsed : 0
}

const mergeMemberSnapshotSources = (...sources) => {
  const byId = new Map()

  sources.forEach((source) => {
    if (!Array.isArray(source)) return
    source.forEach((rawMember) => {
      if (!rawMember?.id || rawMember.deleted_at) return
      const member = normalizeMemberRecord(rawMember)
      const key = String(member.id)
      const existing = byId.get(key)

      if (!existing) {
        byId.set(key, member)
        return
      }

      const existingTime = getMemberFreshnessTime(existing)
      const memberTime = getMemberFreshnessTime(member)
      byId.set(
        key,
        normalizeMemberRecord(memberTime >= existingTime
          ? { ...existing, ...member }
          : { ...member, ...existing })
      )
    })
  })

  return Array.from(byId.values())
}

const applyPendingChangesToMemberSnapshot = (snapshotMembers = [], pendingChanges = [], tableName = null) => {
  const byId = new Map()
  snapshotMembers.forEach((member) => {
    if (member?.id) byId.set(String(member.id), normalizeMemberRecord(member))
  })

  ;(pendingChanges || []).forEach((change) => {
    if (!change || (tableName && change.table_name && change.table_name !== tableName)) return
    const memberId = change.member_id || change.member_data?.id
    if (!memberId) return
    const key = String(memberId)

    if (change.action_type === 'member_delete') {
      byId.delete(key)
      return
    }

    if (change.action_type === 'member_add') {
      byId.set(key, normalizeMemberRecord({
        ...(byId.get(key) || {}),
        ...(change.member_data || {}),
        id: memberId,
        updated_at: change.created_at || change.timestamp || new Date().toISOString()
      }))
      return
    }

    if (change.action_type === 'member_update') {
      byId.set(key, normalizeMemberRecord({
        ...(byId.get(key) || { id: memberId }),
        ...(change.updates || {}),
        updated_at: change.created_at || change.timestamp || new Date().toISOString()
      }))
    }
  })

  return Array.from(byId.values())
}

const mergeAttendanceSnapshots = (...sources) => {
  const merged = {}
  sources.forEach((source) => {
    if (!source || typeof source !== 'object') return
    Object.entries(source).forEach(([dateKey, values]) => {
      if (!values || typeof values !== 'object') return
      merged[dateKey] = {
        ...(merged[dateKey] || {}),
        ...values
      }
    })
  })
  return merged
}

const applyPendingAttendanceChanges = (source = {}, pendingChanges = [], tableName = '') => {
  const next = mergeAttendanceSnapshots(source)

  pendingChanges
    .filter((change) => (
      change?.member_id &&
      (!tableName || !change.table_name || change.table_name === tableName) &&
      ['attendance_mark', 'bulk_attendance_mark'].includes(change.action_type)
    ))
    .forEach((change) => {
      const dateKey = change.service_date || change.session_id
      if (!dateKey) return
      next[dateKey] = { ...(next[dateKey] || {}) }
      const queuedPresent = normalizeQueuedAttendanceValue(change.present)
      if (queuedPresent === null) {
        delete next[dateKey][change.member_id]
      } else {
        next[dateKey][change.member_id] = queuedPresent
      }
    })

  return next
}

const getWorkspaceCacheScope = ({ userId, dataOwnerId, isCollaborator }) => {
  if (isCollaborator && dataOwnerId) return `owner-${dataOwnerId}`
  if (dataOwnerId) return `owner-${dataOwnerId}`
  if (userId) return `user-${userId}`
  return 'guest'
}


const shouldLogAppContext = import.meta.env.MODE !== 'test'
const appContextLog = (...args) => {
  if (shouldLogAppContext) {
    console.log(...args)
  }
}

const invalidateMembersCacheRefs = (membersCacheRef, searchCacheRef, tableName) => {
  searchCacheRef.current.clear()
  const cacheKey = tableName || 'default'
  membersCacheRef.current.delete(cacheKey)
}

// Helper function for timezone-safe date string formatting (YYYY-MM-DD)
const getLocalDateString = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getAttendanceColumnNameForDate = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `attendance_${year}_${month}_${day}`
}

const resolveAttendanceDateKeyFromColumn = (columnName, tableName = '') => {
  const normalized = String(columnName || '')
  const lower = normalized.toLowerCase()
  const newMatch = lower.match(/^attendance_(\d{4})_(\d{2})_(\d{2})$/)
  if (newMatch) {
    return `${newMatch[1]}-${newMatch[2]}-${newMatch[3]}`
  }

  const oldMatch = normalized.match(/[Aa]ttendance[_ ](\d+)(st|nd|rd|th)?/)
  if (oldMatch && tableName) {
    const [monthName, yearStr] = String(tableName).split('_')
    const monthIndex = MONTHS_IN_YEAR.indexOf(monthName)
    const year = parseInt(yearStr, 10)
    const day = parseInt(oldMatch[1], 10)
    if (monthIndex >= 0 && Number.isFinite(year) && Number.isFinite(day)) {
      const date = new Date(year, monthIndex, day)
      if (!Number.isNaN(date.getTime())) {
        return getLocalDateString(date)
      }
    }
  }

  return null
}

const makeLocalUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16)
    const resolved = char === 'x' ? value : (value & 0x3) | 0x8
    return resolved.toString(16)
  })
}

const isBrowserOnline = () => {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

const OFFLINE_MODE_STORAGE_KEY = 'datser_offline_mode'
const OFFLINE_SAVE_NOTICE_THRESHOLD_KEY = 'datser_offline_save_notice_threshold'
const OFFLINE_MODES = ['auto', 'online', 'offline']
const DEFAULT_OFFLINE_SAVE_NOTICE_THRESHOLD = 10

const getStoredOfflineMode = () => {
  if (typeof window === 'undefined') return 'auto'
  const saved = localStorage.getItem(OFFLINE_MODE_STORAGE_KEY)
  return OFFLINE_MODES.includes(saved) ? saved : 'auto'
}

const getStoredOfflineSaveNoticeThreshold = () => {
  if (typeof window === 'undefined') return DEFAULT_OFFLINE_SAVE_NOTICE_THRESHOLD
  const saved = Number(localStorage.getItem(OFFLINE_SAVE_NOTICE_THRESHOLD_KEY))
  if (!Number.isFinite(saved)) return DEFAULT_OFFLINE_SAVE_NOTICE_THRESHOLD
  return Math.min(99, Math.max(1, Math.round(saved)))
}

const toLocalStartOfDay = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

const parseMonthTable = (tableName) => {
  if (!tableName || typeof tableName !== 'string') return null
  const [monthName, yearStr] = tableName.split('_')
  const monthIndex = MONTHS_IN_YEAR.indexOf(monthName)
  const yearNum = parseInt(yearStr, 10)
  if (monthIndex < 0 || Number.isNaN(yearNum)) return null
  return { monthName, monthIndex, yearNum }
}

const getSundaysForMonth = (monthIndex, yearNum) => {
  const sundays = []
  const date = new Date(yearNum, monthIndex, 1)
  while (date.getMonth() === monthIndex && date.getDay() !== 0) {
    date.setDate(date.getDate() + 1)
  }
  while (date.getMonth() === monthIndex) {
    sundays.push(new Date(date.getFullYear(), date.getMonth(), date.getDate()))
    date.setDate(date.getDate() + 7)
  }
  return sundays
}

const getAttendanceColumnsForMonthTable = (tableName) => {
  const parsed = parseMonthTable(tableName)
  if (!parsed) return []
  return getSundaysForMonth(parsed.monthIndex, parsed.yearNum).map((date) => ({
    column_name: getAttendanceColumnNameForDate(date)
  }))
}

const getSundayDefaultForTable = (tableName, referenceDate = new Date()) => {
  const parsed = parseMonthTable(tableName)
  const referenceDay = toLocalStartOfDay(referenceDate)
  if (!parsed || !referenceDay) return null

  const sundays = getSundaysForMonth(parsed.monthIndex, parsed.yearNum)
  if (sundays.length === 0) return null

  const isReferenceInTableMonth =
    referenceDay.getFullYear() === parsed.yearNum &&
    referenceDay.getMonth() === parsed.monthIndex

  if (isReferenceInTableMonth) {
    const sundaysUpToReference = sundays.filter((sunday) => sunday.getTime() <= referenceDay.getTime())
    return sundaysUpToReference.length > 0
      ? sundaysUpToReference[sundaysUpToReference.length - 1]
      : sundays[0]
  }

  if (referenceDay.getTime() < sundays[0].getTime()) return sundays[0]
  if (referenceDay.getTime() > sundays[sundays.length - 1].getTime()) return sundays[sundays.length - 1]

  const sundaysUpToReference = sundays.filter((sunday) => sunday.getTime() <= referenceDay.getTime())
  return sundaysUpToReference.length > 0 ? sundaysUpToReference[sundaysUpToReference.length - 1] : sundays[0]
}

// Personal calendar selection is deliberately short-lived. The persisted expiry
// protects a resumed session; activity refreshes the in-memory deadline without
// creating background preference writes.

const parseStoredCalendarDate = (value) => {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value !== 'string') return null

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch
    const parsed = new Date(Number(year), Number(month) - 1, Number(day))
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const normalizeDateToSundayForTable = (date, tableName) => {
  const parsed = parseMonthTable(tableName)
  const normalizedDate = toLocalStartOfDay(date)
  const fallbackSunday = getSundayDefaultForTable(tableName, new Date())

  if (!parsed) return normalizedDate || fallbackSunday
  if (!normalizedDate) return fallbackSunday

  const isInTableMonth =
    normalizedDate.getFullYear() === parsed.yearNum &&
    normalizedDate.getMonth() === parsed.monthIndex

  if (isInTableMonth && normalizedDate.getDay() === 0) {
    return normalizedDate
  }

  return getSundayDefaultForTable(tableName, normalizedDate) || fallbackSunday
}

const normalizeMemberRecord = (member, identity = {}) => {
  if (!member) return member
  // Preserve the original name if it exists, don't overwrite with empty string
  const existingName = member.full_name ?? member['Full Name']
  const name = (
    typeof existingName === 'string' && existingName.trim()
  ) ? existingName.trim()
    : (typeof member.name === 'string' && member.name.trim()
      ? member.name.trim()
      : (typeof member.Name === 'string' && member.Name.trim()
        ? member.Name.trim()
        : existingName)) // Keep original value (could be null/undefined) rather than defaulting to empty string
  return attachMemberIdentity(
    { ...member, full_name: name, 'Full Name': name, name: name, Name: name },
    identity
  )
}

const buildMemberTableRow = (memberData = {}, { id = null, workspaceName = null, userId = null, workspaceOwnerId = null } = {}) => {
  const genRaw = memberData.gender || memberData['Gender']
  const gen = typeof genRaw === 'string'
    ? (genRaw.trim().toLowerCase() === 'male' ? 'Male' : genRaw.trim().toLowerCase() === 'female' ? 'Female' : genRaw)
    : genRaw
  const ageRaw = memberData.age || memberData['Age']
  const ageStr = (ageRaw === undefined || ageRaw === null || ageRaw === '') ? null : String(ageRaw).trim()
  const dobRaw = memberData.date_of_birth || memberData['date_of_birth']
  const dobStr = (dobRaw === undefined || dobRaw === null || dobRaw === '') ? null : String(dobRaw).trim()
  const phoneRaw = memberData.phone_number ?? memberData.phoneNumber ?? memberData['Phone Number']
  const phoneStr = (phoneRaw === undefined || phoneRaw === null) ? null : String(phoneRaw).trim() || null

  return {
    ...(id ? { id } : {}),
    'Full Name': memberData.full_name || memberData.fullName || memberData['Full Name'],
    'Gender': gen,
    'Phone Number': phoneStr,
    'Age': ageStr,
    'date_of_birth': dobStr,
    'Current Level': memberData.current_level || memberData.currentLevel || memberData['Current Level'],
    workspace: workspaceName,
    parent_name_1: memberData.parent_name_1 || null,
    parent_phone_1: memberData.parent_phone_1 || null,
    parent_name_2: memberData.parent_name_2 || null,
    parent_phone_2: memberData.parent_phone_2 || null,
    notes: memberData.notes || null,
    is_visitor: memberData.is_visitor || false,
    workspace_owner_id: workspaceOwnerId || userId,
    user_id: userId
  }
}

const sanitizeQueuedMemberInsert = (memberData = {}) => {
  const blockedKeys = new Set(['__offline_status', 'full_name', 'name', 'Name', 'created_at', 'updated_at', 'inserted_at'])
  return Object.fromEntries(
    Object.entries(memberData)
      .filter(([key, value]) => !blockedKeys.has(key) && value !== undefined)
  )
}

// Get the latest available table from localStorage, falling back to DEFAULT_TABLE
const getLatestTable = () => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('selectedMonthTable')
    if (saved) return saved
  }
  return DEFAULT_TABLE
}

// Mock data for development when Supabase is not configured
const mockMembers = [
  {
    id: '1',
    'Full Name': 'John Doe',
    'Gender': 'Male',
    'Phone Number': 1234567890,
    'Age': '16',
    'Current Level': 'SHS1',
    inserted_at: new Date().toISOString()
  },
  {
    id: '2',
    'Full Name': 'Jane Smith',
    'Gender': 'Female',
    'Phone Number': 987654321,
    'Age': '15',
    'Current Level': 'JHS3',
    inserted_at: new Date().toISOString()
  },
  {
    id: '3',
    'Full Name': 'Michael Johnson',
    'Gender': 'Male',
    'Phone Number': 555123456,
    'Age': '17',
    'Current Level': 'SHS2',
    inserted_at: new Date().toISOString()
  }
]

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}

const WORKSPACE_MEMBER_CODE_PREFERENCE_KEYS = [
  'member_name_style',
  'workspace_member_codes_enabled',
  'member_code_format',
  'member_code_length',
  'member_code_quick_pass_enabled',
  'member_code_show_logo',
  'member_code_show_photo',
  'member_code_show_email',
  'member_code_auto_profile_enabled',
  'member_code_badge_style',
  'member_code_card_style',
  'member_code_church_name',
  'member_code_logo_url',
  'member_code_turbo_enabled',
  'member_code_turbo_notification_enabled',
  'member_code_auto_cycle_minutes',
  'member_code_lookup_enabled',
  'member_code_share_message_template',
  'guided_form_settings'
]

const OWNER_STICKY_MEMBER_CODE_SELECT_KEYS = WORKSPACE_MEMBER_CODE_PREFERENCE_KEYS
  .filter((key) => key !== 'member_code_auto_cycle_minutes')

const OWNER_STICKY_PREFERENCE_SELECT = [
  'admin_sticky_month',
  'admin_sticky_sundays',
  'locked_default_date',
  ...OWNER_STICKY_MEMBER_CODE_SELECT_KEYS
].join(',')

const getMemberCodeSettingsCacheKey = (ownerId) => `${MEMBER_CODE_SETTINGS_CACHE_PREFIX}:${ownerId || 'local'}`

const readMemberCodeSettingsCache = (ownerId) => {
  if (typeof window === 'undefined' || !ownerId) return null
  try {
    const cached = JSON.parse(window.localStorage.getItem(getMemberCodeSettingsCacheKey(ownerId)) || 'null')
    if (!cached || typeof cached !== 'object') return null
    return {
      format: normalizeMemberCodeFormat(cached.format),
      length: normalizeMemberCodeLength(cached.length),
      updatedAt: cached.updatedAt || null
    }
  } catch {
    return null
  }
}

const writeMemberCodeSettingsCache = (ownerId, { format, length, updatedAt } = {}) => {
  if (typeof window === 'undefined' || !ownerId) return
  try {
    window.localStorage.setItem(getMemberCodeSettingsCacheKey(ownerId), JSON.stringify({
      format: normalizeMemberCodeFormat(format),
      length: normalizeMemberCodeLength(length),
      updatedAt: updatedAt || new Date().toISOString()
    }))
  } catch {
    // Storage is only a startup hint; the remote preference remains authoritative.
  }
}

const pickWorkspaceMemberCodePreferences = (source = {}) => (
  WORKSPACE_MEMBER_CODE_PREFERENCE_KEYS.reduce((picked, key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      picked[key] = source[key]
    }
    return picked
  }, {})
)

const isDeveloperBypassStorageEnabled = () => (
  isLocalWebDeveloperModeAllowed() &&
  typeof window !== 'undefined' &&
  window.localStorage.getItem(DEV_BYPASS_STORAGE_KEY) === 'true'
)

export const AppProvider = ({ children }) => {
  // Get user from auth context - may be null during initial load
  const authContext = useAuth()
  const user = authContext?.user
  // `preferences` merges personal and workspace settings. Calendar mode is
  // personal, and workspace defaults intentionally include calendar values,
  // so use the unmerged personal record for calendar decisions.
  const personalCalendarPreferences = authContext?.personalPreferences || authContext?.preferences || null
  // A successful calendar RPC is authoritative, but AuthContext reaches this
  // provider on the next render. Keep that confirmed result locally for the
  // short hand-off so a background reconciliation cannot briefly put the user
  // back on the Auto month between the save response and preference hydration.
  const [confirmedCalendarPreferenceOverride, setConfirmedCalendarPreferenceOverride] = useState(null)
  const effectivePersonalCalendarPreferences = confirmedCalendarPreferenceOverride
    ? { ...(personalCalendarPreferences || {}), ...confirmedCalendarPreferenceOverride }
    : personalCalendarPreferences
  const personalPreferences = authContext?.personalPreferences || authContext?.preferences || null
  const authLoading = authContext?.loading
  // Hydration readiness for the personal preference bundle. Calendar controls
  // must stay disabled until this confirms, otherwise an explicit Manual save
  // is rejected while the dashboard already looks fully usable.
  const preferencesHydrated = authContext?.preferencesHydrated === true
  const preferencesLoading = authContext?.preferencesLoading === true
  const preferencesError = authContext?.preferencesError || null
  const isDeveloperBypass = authContext?.isDeveloperBypass === true
  const isDeveloperBypassActive = isDeveloperBypass || isDeveloperBypassStorageEnabled()
  const isAdminCodeLogin = authContext?.preferences?.admin_code_login === true || user?.app_metadata?.provider === 'admin-code'
  const [members, setMembers] = useState([])
  const [membersTotalCount, setMembersTotalCount] = useState(0)
  const [membersLoadedAll, setMembersLoadedAll] = useState(false)
  const [memberPreviewSyncStatus, setMemberPreviewSyncStatus] = useState({
    isSyncing: false,
    cachedCount: 0,
    totalCount: 0,
    lastSyncedAt: null,
    lastSyncAt: null,
    lastRemoteUpdatedAt: null,
    source: 'idle'
  })
  const [recentMemberEdits, setRecentMemberEdits] = useState([])
  const [loading, setLoading] = useState(true)
  // Explicit initial hydration state. 'HYDRATED' is set ONLY after an authoritative
  // member load has been applied (server page, full snapshot, cache, offline snapshot
  // or a confirmed zero/table-missing result). Early-return and transient-error paths
  // never set it, so the dashboard can distinguish "loading/unresolved" from a real
  // "no members yet" result.
  const [memberHydrationState, setMemberHydrationState] = useState('NOT_STARTED')
  // True once the saved month has been resolved from preferences on startup. Gates the
  // first member fetch so we never fetch with the provisional (localStorage) table.
  const [monthResolved, setMonthResolved] = useState(false)

  // Collaborator state - tracks if current user is viewing someone else's data
  const [dataOwnerId, setDataOwnerId] = useState(null) // The owner whose data we're viewing
  const [isCollaborator, setIsCollaborator] = useState(false)
  const [isAdminCollaborator, setIsAdminCollaborator] = useState(false)
  const [ownerEmail, setOwnerEmail] = useState(null)
  const [hasAccess, setHasAccess] = useState(true) // Whether user has permission to access the app
  const [searchTerm, setSearchTerm] = useState('')
  const [serverSearchResults, setServerSearchResults] = useState(null)
  const [deletedMemberSearchTombstones, setDeletedMemberSearchTombstones] = useState([])
  const searchCacheRef = useRef(new Map())
  const nameColumnCacheRef = useRef(new Map())
  const inFlightAttendancePromisesRef = useRef(new Map())
  const devCountersRef = useRef({
    syncStarted: 0,
    syncCoalesced: 0,
    schemaFetchCount: 0,
    attendanceFetchCount: 0,
    staleResultIgnored: 0,
    realtimeSubscribedCount: 0
  })
  const membersCacheRef = useRef(new Map()) // tableName -> { data, ts }
  const memberPreviewBackgroundSyncRunnerRef = useRef(null)
  const memberCountReconcileInFlightRef = useRef(false)
  const searchRequestRef = useRef(0)
  const attendanceSnapshotVersionRef = useRef(createAttendanceSnapshotVersionRegistry())
  const qrCheckInRunRef = useRef({ key: '', running: false })
  const hasInitialAppLoadRunRef = useRef(false)
  const resumeSyncCoordinatorRef = useRef(null)
  const resumeSyncCallbackRef = useRef(null)
  const workspaceCacheScope = useMemo(() => getWorkspaceCacheScope({
    userId: user?.id,
    dataOwnerId,
    isCollaborator
  }), [dataOwnerId, isCollaborator, user?.id])
  const runtimeRequestScopeRef = useRef(null)
  const [attendanceData, setAttendanceData] = useState({})
  const attendanceDataRef = useRef({})
  useEffect(() => {
    attendanceDataRef.current = attendanceData
  }, [attendanceData])
  const [currentTable, setCurrentTable] = useState(getLatestTable())

  useEffect(() => {
    const nextScope = {
      workspace: workspaceCacheScope,
      owner: dataOwnerId || user?.id || 'guest',
      table: currentTable || 'none'
    }
    const previous = runtimeRequestScopeRef.current
    if (previous && (
      previous.workspace !== nextScope.workspace ||
      previous.owner !== nextScope.owner ||
      previous.table !== nextScope.table
    )) {
      invalidateRequestScope(`${previous.workspace}:${previous.table}`)
      invalidateRequestScope(`${previous.owner}:${previous.table}`)
      if (previous.owner !== nextScope.owner) {
        invalidateRequestScope(`${previous.owner}:workspace`)
      }
    }
    runtimeRequestScopeRef.current = nextScope
  }, [currentTable, dataOwnerId, user?.id, workspaceCacheScope])

  useEffect(() => {
    setDeletedMemberSearchTombstones([])
    searchCacheRef.current.clear()
    setServerSearchResults(null)
  }, [currentTable, workspaceCacheScope])

  useEffect(() => {
    setRecentMemberEdits(readStoredRecentMemberEdits(workspaceCacheScope))
  }, [workspaceCacheScope])

  const recordRecentMemberEdit = useCallback((member, editedAt = new Date().toISOString(), meta = {}) => {
    if (!member?.id) return
    setRecentMemberEdits((prev) => {
      const dateKey = meta.dateKey || meta.date_key || (meta.date instanceof Date ? getLocalDateString(meta.date) : null)
      const nextEntry = {
        id: member.id,
        member_id: member.id,
        name: getMemberDisplayNameForRecentEdit(member),
        table: meta.table || currentTable,
        date_key: dateKey,
        action: meta.action || 'update',
        summary: meta.summary || 'Updated member details',
        changed_fields: Array.isArray(meta.changedFields) ? meta.changedFields : [],
        edited_at: editedAt
      }
      const next = [
        nextEntry,
        ...prev.filter((item) => !(item?.id === member.id && item?.table === nextEntry.table && item?.action === nextEntry.action))
      ].slice(0, RECENT_MEMBER_EDITS_LIMIT)

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(getRecentMemberEditsStorageKey(workspaceCacheScope), JSON.stringify(next))
        } catch (error) {
          console.warn('Unable to store recent member edits:', error)
        }
      }

      return next
    })
  }, [currentTable, workspaceCacheScope])

  // Admin sticky defaults for collaborators
  const [ownerStickyMonth, setOwnerStickyMonth] = useState(null)
  const [ownerStickySundays, setOwnerStickySundays] = useState([])
  const [ownerMemberCodePreferences, setOwnerMemberCodePreferences] = useState({})
  const preferences = useMemo(() => {
    if (!isCollaborator || !ownerMemberCodePreferences || Object.keys(ownerMemberCodePreferences).length === 0) {
      return personalPreferences
    }
    return {
      ...(personalPreferences || {}),
      ...ownerMemberCodePreferences
    }
  }, [isCollaborator, ownerMemberCodePreferences, personalPreferences])
  const memberNameStyle = normalizeMemberNameStyle(
    isCollaborator
      ? ownerMemberCodePreferences?.member_name_style
      : authContext?.workspacePreferences?.member_name_style
  )
  const formatDisplayMemberName = useCallback(
    (value) => formatMemberName(value, memberNameStyle),
    [memberNameStyle]
  )
  const [workspaceMemberCodeAssignments, setWorkspaceMemberCodeAssignments] = useState({})
  const [workspaceMemberCodeStatus, setWorkspaceMemberCodeStatus] = useState('idle')
  const workspaceMemberCodeRequestRef = useRef({ ownerId: null, sequence: 0 })
  const workspaceMemberCodeAssignmentsRef = useRef({})
  const memberCodeRecoveryQueueRef = useRef(new Map())
  const memberCodeRecoveryTimerRef = useRef(null)
  const memberCodeRecoveryRunningRef = useRef(false)
  const memberCodeRecoveryFlushRef = useRef(null)
  const workspaceMemberCodeOwnerId = dataOwnerId || user?.id
  const [cachedMemberCodeSettings, setCachedMemberCodeSettings] = useState(() => readMemberCodeSettingsCache(workspaceMemberCodeOwnerId))
  const hasConfirmedRemoteMemberCodeFormat = preferences?.member_code_format !== undefined && preferences?.member_code_format !== null
  const hasConfirmedRemoteMemberCodeLength = preferences?.member_code_length !== undefined && preferences?.member_code_length !== null
  const memberCodeFormat = normalizeMemberCodeFormat(
    hasConfirmedRemoteMemberCodeFormat ? preferences.member_code_format : cachedMemberCodeSettings?.format
  )
  const memberCodeLength = normalizeMemberCodeLength(
    hasConfirmedRemoteMemberCodeLength ? preferences.member_code_length : cachedMemberCodeSettings?.length ?? DEFAULT_MEMBER_CODE_LENGTH
  )

  useEffect(() => {
    setCachedMemberCodeSettings(readMemberCodeSettingsCache(workspaceMemberCodeOwnerId))
  }, [workspaceMemberCodeOwnerId])

  useEffect(() => {
    const ownerId = workspaceMemberCodeOwnerId
    if (!ownerId || isDeveloperBypass) {
      workspaceMemberCodeAssignmentsRef.current = {}
      setWorkspaceMemberCodeAssignments({})
      setWorkspaceMemberCodeStatus('idle')
      return
    }

    const cached = readWorkspaceMemberCodeAssignmentsCache(ownerId)
    const cachedAssignments = cached?.assignments || {}
    workspaceMemberCodeAssignmentsRef.current = cachedAssignments
    setWorkspaceMemberCodeAssignments(cachedAssignments)
    setWorkspaceMemberCodeStatus(cached?.assignments && Object.keys(cached.assignments).length > 0 ? 'loading' : 'idle')
  }, [isDeveloperBypass, workspaceMemberCodeOwnerId])

  useEffect(() => {
    workspaceMemberCodeAssignmentsRef.current = workspaceMemberCodeAssignments
  }, [workspaceMemberCodeAssignments])

  useEffect(() => {
    if (!workspaceMemberCodeOwnerId || !hasConfirmedRemoteMemberCodeFormat || !hasConfirmedRemoteMemberCodeLength) return
    const next = {
      format: normalizeMemberCodeFormat(preferences.member_code_format),
      length: normalizeMemberCodeLength(preferences.member_code_length),
      updatedAt: preferences.updated_at || new Date().toISOString()
    }
    setCachedMemberCodeSettings(next)
    writeMemberCodeSettingsCache(workspaceMemberCodeOwnerId, next)
  }, [hasConfirmedRemoteMemberCodeFormat, hasConfirmedRemoteMemberCodeLength, preferences?.member_code_format, preferences?.member_code_length, preferences?.updated_at, workspaceMemberCodeOwnerId])
  const [adminSyncNotice, setAdminSyncNotice] = useState(null)
  const adminRealtimeChannelRef = useRef(null)
  const adminRealtimeStatusRef = useRef('CLOSED')
  const pendingAdminBroadcastRef = useRef(null)
  const liveCalendarBroadcastRef = useRef({ table: null, date: null })

  // Load saved month from user preferences on app startup
  useEffect(() => {
    const loadSavedMonth = async () => {
      if (!user || authLoading) return
      // Wait for personal-calendar preferences to hydrate so the authoritative
      // month (current_month_table) is known before the first member fetch. Without
      // this, startup resolves the provisional localStorage/default month first and
      // fetches January before preferences restore August (the month race). If
      // hydration errors out, fall back to localStorage/default below instead of
      // hanging forever.
      if (!preferencesHydrated && !preferencesError) return

      try {
        const storageKey = isCollaborator && dataOwnerId ? `selectedMonthTable_${dataOwnerId}` : 'selectedMonthTable'
        const localSaved = localStorage.getItem(storageKey)

        const storedManualTable = effectivePersonalCalendarPreferences?.calendar_mode === 'manual'
          ? effectivePersonalCalendarPreferences?.manual_month_table
          : null

        // A confirmed, unexpired personal Manual selection always wins over
        // the normal saved-month hydration. Reconciliation later validates the
        // selected Sunday; it must not first bounce the view back to Auto.
        if (storedManualTable) {
          setCurrentTable(storedManualTable)
          localStorage.setItem(storageKey, storedManualTable)
          return
        }

        if (isCollaborator && ownerStickyMonth && !localSaved && !effectivePersonalCalendarPreferences?.current_month_table) {
          setCurrentTable(ownerStickyMonth)
          localStorage.setItem(storageKey, ownerStickyMonth)
          return
        }

        // Try to load from Supabase preferences first (persisted across devices)
        if (effectivePersonalCalendarPreferences?.current_month_table) {
          const savedMonth = effectivePersonalCalendarPreferences.current_month_table
          appContextLog('[MONTH] Loaded saved month from Supabase preferences:', savedMonth)
          setCurrentTable(savedMonth)
          localStorage.setItem(storageKey, savedMonth)
          return
        }

        // Fallback to localStorage if preferences not yet synced
        if (localSaved) {
          appContextLog('[MONTH] Loaded month from localStorage:', localSaved)
          setCurrentTable(localSaved)
          return
        }

        // Default to DEFAULT_TABLE if nothing is saved
        appContextLog('[MONTH] No saved month found, using default:', DEFAULT_TABLE)
        localStorage.setItem(storageKey, DEFAULT_TABLE)
      } catch (error) {
        console.error('[MONTH] Error loading saved month:', error)
        // Fallback to localStorage on error
        const storageKey = isCollaborator && dataOwnerId ? `selectedMonthTable_${dataOwnerId}` : 'selectedMonthTable'
        const localSaved = localStorage.getItem(storageKey) || DEFAULT_TABLE
        setCurrentTable(localSaved)
        localStorage.setItem(storageKey, localSaved)
      } finally {
        // Month resolution is complete (resolved or defaulted). The member fetch
        // effect waits on this flag so it never fires against the provisional table.
        setMonthResolved(true)
      }
    }

    loadSavedMonth()
  }, [
    user,
    authLoading,
    preferencesHydrated,
    preferencesError,
    effectivePersonalCalendarPreferences?.calendar_mode,
    effectivePersonalCalendarPreferences?.manual_month_table,
    effectivePersonalCalendarPreferences?.current_month_table,
    isCollaborator,
    dataOwnerId,
    ownerStickyMonth
  ])
  const [monthlyTables, setMonthlyTables] = useState(FALLBACK_MONTHLY_TABLES)
  const [selectedAttendanceDate, setSelectedAttendanceDate] = useState(null)
  const selectedAttendanceDateRef = useRef(selectedAttendanceDate)
  useEffect(() => {
    selectedAttendanceDateRef.current = selectedAttendanceDate
  }, [selectedAttendanceDate])
  const [availableSundayDates, setAvailableSundayDates] = useState([])
  const [isOnline, setIsOnline] = useState(isBrowserOnline)
  const [offlineCacheMeta, setOfflineCacheMeta] = useState(null)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  const [offlinePendingChanges, setOfflinePendingChanges] = useState([])
  const offlinePendingChangesRef = useRef([])
  const [offlineStatusMessage, setOfflineStatusMessage] = useState('')
  const [isPreparingOffline, setIsPreparingOffline] = useState(false)
  const [isSyncingOffline, setIsSyncingOffline] = useState(false)
  const [offlineMode, setOfflineModeState] = useState(getStoredOfflineMode)
  const [offlineSaveNoticeThreshold, setOfflineSaveNoticeThresholdState] = useState(getStoredOfflineSaveNoticeThreshold)
  const [notificationDurationMs, setNotificationDurationMsState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_NOTIFICATION_DURATION_MS
    const stored = Number(localStorage.getItem(NOTIFICATION_DURATION_STORAGE_KEY))
    const needsReadableDefault = localStorage.getItem(NOTIFICATION_DURATION_MIGRATION_KEY) !== 'true'
    const needsCompactDefault = localStorage.getItem(NOTIFICATION_DURATION_COMPACT_MIGRATION_KEY) !== 'true'
    if (needsCompactDefault && (!Number.isFinite(stored) || stored === 6500)) {
      localStorage.setItem(NOTIFICATION_DURATION_STORAGE_KEY, String(DEFAULT_NOTIFICATION_DURATION_MS))
      localStorage.setItem(NOTIFICATION_DURATION_MIGRATION_KEY, 'true')
      localStorage.setItem(NOTIFICATION_DURATION_COMPACT_MIGRATION_KEY, 'true')
      return DEFAULT_NOTIFICATION_DURATION_MS
    }
    if (needsCompactDefault) {
      localStorage.setItem(NOTIFICATION_DURATION_COMPACT_MIGRATION_KEY, 'true')
    }
    if (needsReadableDefault && (!Number.isFinite(stored) || stored < DEFAULT_NOTIFICATION_DURATION_MS)) {
      localStorage.setItem(NOTIFICATION_DURATION_STORAGE_KEY, String(DEFAULT_NOTIFICATION_DURATION_MS))
      localStorage.setItem(NOTIFICATION_DURATION_MIGRATION_KEY, 'true')
      return DEFAULT_NOTIFICATION_DURATION_MS
    }
    if (needsReadableDefault) {
      localStorage.setItem(NOTIFICATION_DURATION_MIGRATION_KEY, 'true')
    }
    return Number.isFinite(stored)
      ? Math.min(20000, Math.max(1800, Math.round(stored)))
      : DEFAULT_NOTIFICATION_DURATION_MS
  })
  const [searchSuggestionView, setSearchSuggestionViewState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_SEARCH_SUGGESTION_VIEW
    const stored = localStorage.getItem(SEARCH_SUGGESTION_VIEW_STORAGE_KEY)
    const promptSeen = localStorage.getItem(SEARCH_SUGGESTION_PROMPT_STORAGE_KEY) === 'true'
    if (!promptSeen) {
      localStorage.setItem(SEARCH_SUGGESTION_VIEW_STORAGE_KEY, DEFAULT_SEARCH_SUGGESTION_VIEW)
      return DEFAULT_SEARCH_SUGGESTION_VIEW
    }
    return SEARCH_SUGGESTION_VIEW_MODES.includes(stored) ? stored : DEFAULT_SEARCH_SUGGESTION_VIEW
  })
  const autoSnapshotTimerRef = useRef(null)
  const autoPrepareOfflineRef = useRef({ signature: '', running: false })
  const backgroundRefreshRef = useRef({ running: false, lastRun: 0 })
  const realtimeSyncStatusTimerRef = useRef(null)
  const normalizedAttendanceBackendAvailableRef = useRef(null)
  const syncOfflineChangesRef = useRef(null)
  const [backendHealthy, setBackendHealthy] = useState(() => isBackendHealthy())
  const syncFlushSchedulerRef = useRef(null)
  const createActiveSyncFlushScheduler = useCallback(() => createSyncFlushScheduler({
    run: () => syncOfflineChangesRef.current?.().catch((error) => {
      console.warn('Automatic offline sync failed:', error)
    }),
    minDelayMs: AUTO_SYNC_DEBOUNCE_MS
  }), [])
  // A disposed scheduler must never remain the active scheduler. React
  // StrictMode simulates an unmount/remount in development, which runs the
  // unmount cleanup and disposes the scheduler while the ref still points at
  // it. Every read goes through this helper so callers always get a live
  // scheduler: a disposed one is replaced, never reused. Only one scheduler is
  // ever active because the ref atomically swaps to the fresh instance and the
  // old one is disposed (its timer is cleared and schedule() is inert).
  const getActiveSyncFlushScheduler = useCallback(() => {
    const current = syncFlushSchedulerRef.current
    if (current && !current.isDisposed()) return current
    const next = createActiveSyncFlushScheduler()
    syncFlushSchedulerRef.current = next
    return next
  }, [createActiveSyncFlushScheduler])
  if (!syncFlushSchedulerRef.current || syncFlushSchedulerRef.current.isDisposed()) {
    syncFlushSchedulerRef.current = getActiveSyncFlushScheduler()
  }
  const offlineSyncInFlightRef = useRef(false)
  const applyOfflineSnapshotRef = useRef(null)
  const searchDisplayPromptQueuedRef = useRef(false)

  useEffect(() => () => {
    syncFlushSchedulerRef.current?.dispose?.()
  }, [])

  useEffect(() => {
    setBackendHealthy(isBackendHealthy())
    return subscribeBackendHealth((healthy) => setBackendHealthy(healthy))
  }, [])

  useEffect(() => {
    offlinePendingChangesRef.current = offlinePendingChanges
  }, [offlinePendingChanges])

  const setOfflineMode = useCallback((mode) => {
    const nextMode = OFFLINE_MODES.includes(mode) ? mode : 'auto'
    setOfflineModeState(nextMode)
    if (typeof window !== 'undefined') {
      localStorage.setItem(OFFLINE_MODE_STORAGE_KEY, nextMode)
    }
    window.setTimeout(async () => {
      try {
        const snapshotRecord = await getOfflineSnapshot().catch(() => null)
        const pendingChanges = await getPendingOfflineChanges().catch(() => [])
        const snapshot = snapshotRecord?.snapshot
        setOfflineCacheMeta(snapshotRecord ? {
          cached_at: snapshotRecord.cached_at,
          member_count: snapshot?.members?.length || 0,
          table_count: snapshot?.monthlyTables?.length || 0,
          attendance_date_count: snapshot?.attendanceData ? Object.keys(snapshot.attendanceData).length : 0,
          authenticated_user_id: snapshot?.authenticated_user_id || null,
          data_owner_id: snapshot?.data_owner_id || null,
          workspace: snapshot?.workspace || null
        } : null)
        setOfflinePendingChanges(pendingChanges)
        setPendingSyncCount(pendingChanges.length)
        if (nextMode === 'offline' && snapshotRecord) {
          applyOfflineSnapshotRef.current?.(snapshotRecord)
          setOfflineStatusMessage('Offline Mode - using saved local data.')
        } else if (nextMode === 'offline') {
          setOfflineStatusMessage('Download offline data before using forced offline mode.')
        } else if (nextMode === 'auto' && !isBrowserOnline() && snapshotRecord) {
          applyOfflineSnapshotRef.current?.(snapshotRecord)
          setOfflineStatusMessage('Offline Mode - using saved local data.')
        } else if (nextMode === 'online') {
          setOfflineStatusMessage('')
        }
      } catch (error) {
        console.warn('Unable to apply offline mode change:', error)
      }
    }, 0)
    if (nextMode === 'online' && !isBrowserOnline()) {
      toast.warn('Online mode selected, but internet is unavailable.')
    } else if (nextMode === 'offline') {
      setOfflineStatusMessage(isBrowserOnline() ? '' : 'Offline Mode - using saved local data.')
    }
  }, [])

  const setOfflineSaveNoticeThreshold = useCallback((value) => {
    const numericValue = Number(value)
    const nextValue = Number.isFinite(numericValue)
      ? Math.min(99, Math.max(1, Math.round(numericValue)))
      : DEFAULT_OFFLINE_SAVE_NOTICE_THRESHOLD
    setOfflineSaveNoticeThresholdState(nextValue)
    if (typeof window !== 'undefined') {
      localStorage.setItem(OFFLINE_SAVE_NOTICE_THRESHOLD_KEY, String(nextValue))
    }
  }, [])

  const setNotificationDurationMs = useCallback((value) => {
    const numericValue = Number(value)
    const nextValue = Number.isFinite(numericValue)
      ? Math.min(20000, Math.max(1800, Math.round(numericValue)))
      : DEFAULT_NOTIFICATION_DURATION_MS
    setNotificationDurationMsState(nextValue)
    if (typeof window !== 'undefined') {
      localStorage.setItem(NOTIFICATION_DURATION_STORAGE_KEY, String(nextValue))
    }
  }, [])

  const setSearchSuggestionView = useCallback((value) => {
    const nextValue = SEARCH_SUGGESTION_VIEW_MODES.includes(value) ? value : DEFAULT_SEARCH_SUGGESTION_VIEW
    setSearchSuggestionViewState(nextValue)
    if (typeof window !== 'undefined') {
      localStorage.setItem(SEARCH_SUGGESTION_VIEW_STORAGE_KEY, nextValue)
    }
  }, [])

  const resolveSearchSuggestionPrompt = useCallback((value) => {
    const nextValue = SEARCH_SUGGESTION_VIEW_MODES.includes(value) ? value : DEFAULT_SEARCH_SUGGESTION_VIEW
    if (typeof window !== 'undefined') {
      localStorage.setItem(SEARCH_SUGGESTION_PROMPT_STORAGE_KEY, 'true')
    }
    searchDisplayPromptQueuedRef.current = false
    setSearchSuggestionView(nextValue)
    toast.dismiss(SEARCH_SUGGESTION_PROMPT_TOAST_ID)
    toast.clearWaitingQueue()
  }, [setSearchSuggestionView])

  useEffect(() => {
    if (!user || authLoading || typeof window === 'undefined') return
    if (localStorage.getItem(SEARCH_SUGGESTION_PROMPT_STORAGE_KEY) === 'true') return
    if (searchDisplayPromptQueuedRef.current) return

    searchDisplayPromptQueuedRef.current = true
    setSearchSuggestionView(DEFAULT_SEARCH_SUGGESTION_VIEW)

    const timer = window.setTimeout(() => {
      localStorage.setItem(SEARCH_SUGGESTION_PROMPT_STORAGE_KEY, 'true')
      toast.dismiss()
      toast.clearWaitingQueue()
      window.setTimeout(() => {
        notify.info('Try the new search tray?', {
          title: 'New search display',
          message: 'Try the short tray?',
          details: 'Full list stays default. Switch now or keep it.',
          defaultExpanded: true,
          autoClose: 7000,
          toastId: SEARCH_SUGGESTION_PROMPT_TOAST_ID,
          actions: [
            {
              variant: 'primary',
              label: 'Try tray',
              onClick: () => resolveSearchSuggestionPrompt('short')
            },
            {
              label: 'Keep full',
              onClick: () => resolveSearchSuggestionPrompt('full')
            }
          ]
        })
      }, 180)
    }, 1400)

    return () => {
      window.clearTimeout(timer)
      searchDisplayPromptQueuedRef.current = false
    }
  }, [authLoading, resolveSearchSuggestionPrompt, setSearchSuggestionView, user])

  const shouldUseOfflineData = offlineMode === 'offline' || (offlineMode === 'auto' && !isOnline)
  const isOfflineModeActive = shouldUseOfflineData && Boolean(offlineCacheMeta)
  const offlineModeStatus = offlineMode === 'offline'
    ? 'forced-offline'
    : isOfflineModeActive
      ? 'offline'
      : isOnline
        ? 'online'
        : 'online-unavailable'
  const shouldShowOfflineSaveNotice = useCallback((count = pendingSyncCount) => {
    const isOfflineOnly = offlineMode === 'offline' || !isOnline
    return isOfflineOnly && Number(count || 0) >= offlineSaveNoticeThreshold
  }, [isOnline, offlineMode, offlineSaveNoticeThreshold, pendingSyncCount])

  const refreshOfflineStatus = useCallback(async () => {
    try {
      // A pending change that has already spent its automatic retry budget can
      // never be auto-flushed again; surface it as an explicit recoverable
      // failure instead of leaving it "waiting to sync" forever.
      const currentPending = await getPendingOfflineChanges().catch(() => [])
      for (const change of currentPending) {
        if (isChangeSyncable(change) && Number(change.retry_count || 0) >= SYNC_RETRY_LIMIT) {
          await updateOfflineChangeStatus(change.local_change_id, {
            sync_status: 'failed',
            error: 'Sync kept failing after several attempts. Your change is still saved locally - retry from Settings.'
          })
        }
      }

      const [snapshotRecord, pendingChanges] = await Promise.all([
        getOfflineSnapshot().catch(() => null),
        getPendingOfflineChanges().catch(() => [])
      ])

      const snapshot = snapshotRecord?.snapshot
      setOfflineCacheMeta(snapshotRecord ? {
        cached_at: snapshotRecord.cached_at,
        member_count: snapshot?.members?.length || 0,
        table_count: snapshot?.monthlyTables?.length || 0,
        attendance_date_count: snapshot?.attendanceData ? Object.keys(snapshot.attendanceData).length : 0,
        authenticated_user_id: snapshot?.authenticated_user_id || null,
        data_owner_id: snapshot?.data_owner_id || null,
        workspace: snapshot?.workspace || null
      } : null)
      setOfflinePendingChanges(pendingChanges)
      setPendingSyncCount(pendingChanges.length)
    } catch (error) {
      console.warn('Unable to refresh offline status:', error)
    }
  }, [])

  const applyOfflineSnapshot = useCallback((snapshotRecord) => {
    const snapshot = snapshotRecord?.snapshot || snapshotRecord
    if (!snapshot) return false
    if (user?.id && snapshot.authenticated_user_id !== user.id) {
      console.warn('Ignoring offline snapshot for a different authenticated user.')
      return false
    }

    if (Array.isArray(snapshot.members)) {
      // A soft-deleted member must never be restored as active from a stale
      // offline snapshot. Filter both deleted_at rows and id-scoped tombstones.
      setMembers(getActiveSnapshotMembers(snapshot))
    }
    if (Array.isArray(snapshot.monthlyTables) && snapshot.monthlyTables.length > 0) {
      setMonthlyTables(snapshot.monthlyTables)
    }
    if (snapshot.currentTable) {
      setCurrentTable(snapshot.currentTable)
    }
    if (snapshot.attendanceData && typeof snapshot.attendanceData === 'object') {
      setAttendanceData(snapshot.attendanceData)
    }
    if (snapshot.selectedAttendanceDate) {
      const date = new Date(snapshot.selectedAttendanceDate)
      if (!Number.isNaN(date.getTime())) {
        setSelectedAttendanceDate(date)
      }
    }

    return true
  }, [user?.id])

  useEffect(() => {
    applyOfflineSnapshotRef.current = applyOfflineSnapshot
  }, [applyOfflineSnapshot])

  useEffect(() => {
    refreshOfflineStatus()
  }, [refreshOfflineStatus])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleOnline = async () => {
      setIsOnline(true)
      const pendingChanges = await getPendingOfflineChanges().catch(() => [])
      setOfflineStatusMessage(
        pendingChanges.length > 0
          ? `Back online - ${pendingChanges.length} change${pendingChanges.length === 1 ? '' : 's'} waiting to sync.`
          : 'Back online - review pending changes before syncing.'
      )
      notify.online(
        pendingChanges.length > 0
          ? `${pendingChanges.length} change${pendingChanges.length === 1 ? '' : 's'} waiting to sync.`
          : 'Review pending changes before syncing.',
        { title: 'Back online', toastId: 'back-online' }
      )
      await refreshOfflineStatus()
    }
    const handleOffline = async () => {
      setIsOnline(false)
      const snapshotRecord = await getOfflineSnapshot().catch(() => null)
      if (offlineMode === 'auto' && snapshotRecord && applyOfflineSnapshot(snapshotRecord)) {
        setOfflineStatusMessage('Offline Mode - using saved local data.')
      } else if (offlineMode === 'online') {
        setOfflineStatusMessage('Online mode is selected, but internet is unavailable.')
        toast.warn('Online mode selected, but internet is unavailable.')
      } else {
        setOfflineStatusMessage('Prepare Offline Mode - download data for offline use.')
      }
      refreshOfflineStatus()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [applyOfflineSnapshot, offlineMode, refreshOfflineStatus])

  useEffect(() => {
    if (!shouldUseOfflineData) return

    let cancelled = false
    const loadCachedData = async () => {
      const snapshotRecord = await getOfflineSnapshot().catch(() => null)
      if (!cancelled && snapshotRecord) {
        applyOfflineSnapshot(snapshotRecord)
        if (offlineMode === 'offline') {
          setOfflineStatusMessage('Offline Mode - using saved local data.')
        }
      }
    }

    loadCachedData()

    return () => {
      cancelled = true
    }
  }, [applyOfflineSnapshot, offlineMode, shouldUseOfflineData])

  useEffect(() => {
    if (!isOnline || pendingSyncCount > 0 || !offlineStatusMessage) return undefined

    const timeoutId = setTimeout(() => setOfflineStatusMessage(''), 6000)
    return () => clearTimeout(timeoutId)
  }, [isOnline, offlineStatusMessage, pendingSyncCount])

  // Global dashboard tab state (mobile header controls All/Edited)
  const [dashboardTab, setDashboardTab] = useState('all')

  // Badge filter state - persisted across all components
  const [badgeFilter, setBadgeFilter] = useState(() => {
    const saved = localStorage.getItem('badgeFilter')
    return saved ? JSON.parse(saved) : [] // Start with no badges selected
  })

  // Auto-All-Dates feature (auto-mark all dates up to today)
  const [autoAllDatesEnabledState, setAutoAllDatesEnabledState] = useState(() => {
    return localStorage.getItem('autoAllDatesEnabled') === 'true'
  })
  const setAutoAllDatesEnabled = useCallback((nextValue) => {
    setAutoAllDatesEnabledState((currentValue) => {
      const resolvedValue = typeof nextValue === 'function' ? nextValue(currentValue) : nextValue
      const enabled = Boolean(resolvedValue)
      localStorage.setItem('autoAllDatesEnabled', enabled.toString())
      return enabled
    })
  }, [])
  const autoAllDatesEnabled = autoAllDatesEnabledState

  // Missing-info prompt before attendance (optional per device/browser)
  const [missingInfoPromptEnabledState, setMissingInfoPromptEnabledState] = useState(() => {
    const savedValue = localStorage.getItem('missingInfoPromptEnabled')
    return savedValue === null ? true : savedValue === 'true'
  })
  const setMissingInfoPromptEnabled = useCallback((nextValue) => {
    setMissingInfoPromptEnabledState((currentValue) => {
      const resolvedValue = typeof nextValue === 'function' ? nextValue(currentValue) : nextValue
      const enabled = Boolean(resolvedValue)
      localStorage.setItem('missingInfoPromptEnabled', enabled.toString())
      return enabled
    })
  }, [])
  const missingInfoPromptEnabled = missingInfoPromptEnabledState

  const [guidedFormSettingsState, setGuidedFormSettingsState] = useState(() => (
    readGuidedFormSettings(dataOwnerId)
  ))

  useEffect(() => {
    setGuidedFormSettingsState(readGuidedFormSettings(dataOwnerId))
  }, [dataOwnerId])

  useEffect(() => {
    const remote = authContext?.workspacePreferences?.guided_form_settings
    const isMatchingOwner = authContext?.workspacePreferencesOwnerId === dataOwnerId
    if (remote && typeof remote === 'object' && isMatchingOwner) {
      const base = readGuidedFormSettings(dataOwnerId)
      setGuidedFormSettingsState({
        ...DEFAULT_GUIDED_FORM_SETTINGS,
        ...base,
        ...remote,
        guidedOrder: normalizeGuidedOrder(remote.guidedOrder || base?.guidedOrder)
      })
    }
  }, [authContext?.workspacePreferences?.guided_form_settings, authContext?.workspacePreferencesOwnerId, dataOwnerId])

  const setGuidedFormSetting = useCallback(async (key, value) => {
    const resolvedValue = typeof value === 'function'
      ? value(guidedFormSettingsState[key])
      : value
    const previousSettings = guidedFormSettingsState
    const nextSettings = {
      ...guidedFormSettingsState,
      [key]: key === 'guidedOrder' ? normalizeGuidedOrder(resolvedValue) : resolvedValue
    }
    setGuidedFormSettingsState(nextSettings)
    writeGuidedFormSettings(nextSettings, workspaceCacheScope)

    try {
      if (user?.id) {
        if (isCollaborator && dataOwnerId && !isAdminCollaborator) {
          throw new Error('Only a workspace owner or admin collaborator can change shared form visibility')
        }
        const ok = await authContext?.saveWorkspacePreferences?.(dataOwnerId, { guided_form_settings: nextSettings })
        if (!ok) {
          throw new Error('Workspace preferences save failed')
        }
      }
      return nextSettings
    } catch (error) {
      setGuidedFormSettingsState(previousSettings)
      writeGuidedFormSettings(previousSettings, workspaceCacheScope)
      console.error('Unable to save workspace form visibility settings:', error)
      notify.error('The previous form setting was restored. Please retry.', {
        title: 'Settings sync failed'
      })
      throw error
    }
  }, [authContext, dataOwnerId, guidedFormSettingsState, isAdminCollaborator, isCollaborator, user?.id, workspaceCacheScope])
  const guidedFormSettings = guidedFormSettingsState

  useEffect(() => {
    const remoteSettings = preferences?.guided_form_settings
    if (!remoteSettings || typeof remoteSettings !== 'object' || Array.isArray(remoteSettings)) return
    setGuidedFormSettingsState((currentSettings) => {
      const nextSettings = {
        ...currentSettings,
        ...remoteSettings,
        guidedOrder: normalizeGuidedOrder(remoteSettings.guidedOrder || currentSettings.guidedOrder)
      }
      writeGuidedFormSettings(nextSettings, workspaceCacheScope)
      return nextSettings
    })
  }, [preferences?.guided_form_settings, workspaceCacheScope])

  useEffect(() => {
    const workspaceSettings = ownerMemberCodePreferences?.guided_form_settings
    if (!workspaceSettings || typeof workspaceSettings !== 'object' || Array.isArray(workspaceSettings)) return
    setGuidedFormSettingsState((currentSettings) => {
      const nextSettings = {
        ...currentSettings,
        ...workspaceSettings,
        guidedOrder: normalizeGuidedOrder(workspaceSettings.guidedOrder || currentSettings.guidedOrder)
      }
      writeGuidedFormSettings(nextSettings, workspaceCacheScope)
      return nextSettings
    })
  }, [ownerMemberCodePreferences?.guided_form_settings, workspaceCacheScope])

  useEffect(() => {
    document.documentElement.classList.toggle(
      'guided-next-pulse-disabled',
      guidedFormSettingsState?.pulseNextButton === false
    )
    document.documentElement.classList.toggle(
      'guided-next-cue-disabled',
      guidedFormSettingsState?.showNextButton !== true
    )
  }, [guidedFormSettingsState?.pulseNextButton, guidedFormSettingsState?.showNextButton])

  useEffect(() => {
    if (!user?.id || !hasAccess || loading) return undefined

    const hasSnapshotData =
      members.length > 0 ||
      monthlyTables.length > 0 ||
      Object.keys(attendanceData || {}).length > 0

    if (!hasSnapshotData) return undefined

    if (autoSnapshotTimerRef.current) {
      clearTimeout(autoSnapshotTimerRef.current)
    }

    autoSnapshotTimerRef.current = setTimeout(() => {
      saveOfflineSnapshot({
        members: filterDeletedMembers(members),
        monthlyTables,
        currentTable,
        attendanceData,
        selectedAttendanceDate: selectedAttendanceDate ? getLocalDateString(selectedAttendanceDate) : null,
        preferences: preferences || null,
        guidedFormSettings,
        workspace: preferences?.workspace_name || null,
        authenticated_user_id: user.id,
        data_owner_id: dataOwnerId || user.id,
        is_collaborator: isCollaborator,
        is_admin_collaborator: isAdminCollaborator,
        owner_email: ownerEmail || null,
        saved_at: new Date().toISOString(),
        auto_cached: true
      })
        .then(() => refreshOfflineStatus())
        .catch((error) => {
          console.warn('Automatic offline cache save failed:', error)
        })
    }, 1000)

    return () => {
      if (autoSnapshotTimerRef.current) {
        clearTimeout(autoSnapshotTimerRef.current)
        autoSnapshotTimerRef.current = null
      }
    }
  }, [
    user?.id,
    hasAccess,
    loading,
    members,
    monthlyTables,
    currentTable,
    attendanceData,
    selectedAttendanceDate,
    preferences,
    guidedFormSettings,
    dataOwnerId,
    isCollaborator,
    isAdminCollaborator,
    ownerEmail,
    refreshOfflineStatus
  ])

  // Admin-locked default date forces collaborators to a specific date
  const [lockedDefaultDate, setLockedDefaultDate] = useState(null)
  const suppressDateBroadcastRef = useRef(false)
  const personalCalendarMode = effectivePersonalCalendarPreferences?.calendar_mode === 'manual' ? 'manual' : 'auto'
  const manualMonthTable = effectivePersonalCalendarPreferences?.manual_month_table || null
  const manualSundayDateValue = effectivePersonalCalendarPreferences?.manual_sunday_date || null
  const manualOverrideUntil = effectivePersonalCalendarPreferences?.manual_override_until || null
  const manualSundayDate = useMemo(() => parseStoredCalendarDate(manualSundayDateValue), [manualSundayDateValue])
  const manualOverrideUntilDate = useMemo(() => parseStoredCalendarDate(manualOverrideUntil), [manualOverrideUntil])
  const [personalManualDeadlineAt, setPersonalManualDeadlineAt] = useState(() => manualOverrideUntilDate?.getTime() ?? null)
  const [personalManualExpiryWarning, setPersonalManualExpiryWarning] = useState(false)
  const effectiveManualDeadlineAt = personalManualDeadlineAt ?? manualOverrideUntilDate?.getTime() ?? null
  const isManualOverrideExpired = Boolean(effectiveManualDeadlineAt && effectiveManualDeadlineAt <= Date.now())
  const collaboratorLockedByOwner = Boolean(isCollaborator && lockedDefaultDate)
  const isPersonalManualMode = personalCalendarMode === 'manual' && !isManualOverrideExpired && !collaboratorLockedByOwner

  useEffect(() => {
    if (personalCalendarMode !== 'manual') {
      setPersonalManualDeadlineAt(null)
      setPersonalManualExpiryWarning(false)
      return
    }

    const persistedDeadline = manualOverrideUntilDate?.getTime() ?? null
    if (!persistedDeadline) return

    // Never let an older server response shorten a more recent local activity
    // deadline. Supabase remains authoritative when it sends a newer value.
    setPersonalManualDeadlineAt((currentDeadline) => Math.max(currentDeadline ?? 0, persistedDeadline) || null)
  }, [personalCalendarMode, manualOverrideUntilDate])

  // Fetch the owner's locked default date (for collaborators)
  const fetchLockedDefaultDate = useCallback(async (ownerId) => {
    if (!isSupabaseConfigured() || !ownerId) return null
    try {
      const { data, error } = await supabase.rpc('get_owner_locked_date', {
        owner_uuid: ownerId
      })
      if (!error && data) {
        setLockedDefaultDate(data)
        return data
      }
      setLockedDefaultDate(null)
      return null
    } catch (err) {
      console.error('Error fetching locked default date:', err)
      setLockedDefaultDate(null)
      return null
    }
  }, [])

  // Save locked default date (admin only)
  const saveLockedDefaultDate = useCallback(async (dateStr) => {
    if (!isSupabaseConfigured() || !user?.id || isCollaborator) return false

    // Optimistic UI Update
    const previousDateStr = lockedDefaultDate;
    setLockedDefaultDate(dateStr || null)
    if (dateStr) {
      try {
        const [year, month, day] = dateStr.split('-')
        const newDate = new Date(year, parseInt(month) - 1, parseInt(day))
        const normalizedDate = normalizeDateToSundayForTable(newDate, currentTable)
        if (normalizedDate) {
          setSelectedAttendanceDate(normalizedDate)
        }
      } catch (e) {
        console.error('Error parsing locked date:', e)
      }
    }

    try {
      if (!user?.id || !isSupabaseConfigured()) {
        return true
      }
      const [, yearStr] = (currentTable || '').split('_')
      const targetOwnerId = dataOwnerId || user.id
      const { error } = await supabase.rpc('update_owner_admin_override', {
        p_owner_id: targetOwnerId,
        p_month_table: currentTable || null,
        p_year: parseInt(yearStr, 10) || new Date().getFullYear(),
        p_sunday_dates: dateStr ? [dateStr] : null,
        p_locked_date: dateStr || null
      })

      if (!error) {
        return true
      }

      console.error('Error saving locked default date:', error)
      setLockedDefaultDate(previousDateStr)
      return false
    } catch (err) {
      console.error('Error saving locked default date:', err)
      setLockedDefaultDate(previousDateStr)
      return false
    }
  }, [user?.id, dataOwnerId, lockedDefaultDate, currentTable])

  const getMonthStorageKey = useCallback(() => {
    if (isCollaborator && dataOwnerId) {
      return `selectedMonthTable_${dataOwnerId}`
    }
    return 'selectedMonthTable'
  }, [isCollaborator, dataOwnerId])

  const changeCurrentTable = useCallback((tableName, { persistPreference = false } = {}) => {
    setCurrentTable(tableName)
    const storageKey = getMonthStorageKey()
    if (tableName) {
      localStorage.setItem(storageKey, tableName)
    } else {
      localStorage.removeItem(storageKey)
    }
    // Only a direct month-picker choice is allowed to write a preference. This
    // callback is also used by hydration, collaborator broadcasts, fallbacks,
    // and calendar reconciliation, which must stay local-only.
    if (persistPreference && tableName && authContext?.savePersonalPreferences) {
      void authContext.savePersonalPreferences({ current_month_table: tableName })
    }
  }, [getMonthStorageKey, authContext?.savePersonalPreferences])

  const pruneMissingTable = useCallback((tableName) => {
    if (!tableName) return
    setMonthlyTables(prev => {
      const filtered = sortMonthTables(prev.filter(t => t !== tableName))
      if (currentTable === tableName) {
        const fallback = filtered[filtered.length - 1] || null
        changeCurrentTable(fallback)
      }
      return filtered
    })
  }, [currentTable, changeCurrentTable])

  // Check if Supabase is properly configured
  const isSupabaseConfigured = useCallback(() => {
    const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL
    return supabase && supabaseUrl &&
      supabaseUrl !== 'your_supabase_url_here' &&
      supabaseUrl !== 'https://placeholder.supabase.co'
  }, [])

  const fetchOwnerStickyDefaults = useCallback(async (ownerId) => {
    if (!isSupabaseConfigured() || !ownerId) return null
    // Keep the last confirmed owner defaults visible while Supabase is
    // degraded. A background refresh must never blank a collaborator's
    // workspace context or create another request during a 503/schema outage.
    if (!isBackendHealthy()) return null
    try {
      const query = supabase
        .from('user_preferences')
        .select(OWNER_STICKY_PREFERENCE_SELECT)
        .eq('user_id', ownerId)

      const { data, error } = await (
        typeof query.maybeSingle === 'function'
          ? query.maybeSingle()
          : query.single()
      )

      if (!error && data) {
        setOwnerStickyMonth(data.admin_sticky_month || null)
        setOwnerStickySundays(Array.isArray(data.admin_sticky_sundays) ? data.admin_sticky_sundays : [])
        setLockedDefaultDate(data.locked_default_date || null)
        setOwnerMemberCodePreferences(pickWorkspaceMemberCodePreferences(data))
        return data
      }

      if (error && isBackendDegradedError(error)) markBackendDegraded(error)
      return null
    } catch (err) {
      if (isBackendDegradedError(err)) markBackendDegraded(err)
      console.error('Error fetching owner sticky defaults:', err)
      return null
    }
  }, [isSupabaseConfigured])

  const readWorkspaceMemberCodeAssignments = useCallback(async (ownerId) => {
    return readAllWorkspaceMemberCodeAssignmentPages({
      pageSize: MEMBER_CODE_ASSIGNMENT_PAGE_SIZE,
      fetchPage: async (from, pageSize) => {
        const { data, error } = await supabase
          .from('workspace_member_codes')
          .select('member_id, ordinal, current_code, aliases, updated_at')
          .eq('workspace_owner_id', ownerId)
          .order('ordinal', { ascending: true })
          .range(from, from + pageSize - 1)
        if (error) throw error
        return data || []
      }
    })
  }, [])

  const mergeConfirmedWorkspaceMemberCodeAssignments = useCallback((ownerId, rows = []) => {
    const incoming = toWorkspaceMemberCodeMap(rows)
    const next = mergeWorkspaceMemberCodeAssignments(workspaceMemberCodeAssignmentsRef.current, incoming)
    workspaceMemberCodeAssignmentsRef.current = next
    setWorkspaceMemberCodeAssignments(next)
    writeWorkspaceMemberCodeAssignmentsCache(ownerId, next)
    return next
  }, [])

  const readConfirmedWorkspaceMemberCodeAssignments = useCallback(async (ownerId, { force = false } = {}) => {
    return runScopedRequest(
      `${ownerId}:workspace`,
      'member-code-assignments',
      () => readWorkspaceMemberCodeAssignments(ownerId),
      { force, cacheResult: true }
    )
  }, [readWorkspaceMemberCodeAssignments])

  const enqueueMemberCodeRecovery = useCallback((member, error = null) => {
    const memberId = getMemberCanonicalId(member)
    if (!memberId || member?.deleted_at) return
    const key = String(memberId)
    const existing = memberCodeRecoveryQueueRef.current.get(key)
    const attempts = existing?.attempts || 0
    const message = String(error?.message || '').toLowerCase()
    const permanent = message.includes('permission') || message.includes('not allowed') || message.includes('validation') || message.includes('anonymous')
    if (permanent || attempts >= 3) return

    memberCodeRecoveryQueueRef.current.set(key, {
      member,
      attempts,
      nextAttemptAt: Date.now() + (attempts === 0 ? 400 : Math.min(8000, 1000 * (2 ** attempts)))
    })

    if (memberCodeRecoveryTimerRef.current) return
    const delay = Math.max(0, Math.min(...Array.from(memberCodeRecoveryQueueRef.current.values()).map((entry) => entry.nextAttemptAt - Date.now())))
    memberCodeRecoveryTimerRef.current = window.setTimeout(() => {
      memberCodeRecoveryTimerRef.current = null
      memberCodeRecoveryFlushRef.current?.()
    }, delay)
  }, [])

  const loadWorkspaceMemberCodes = useCallback(async ({ ensure = false, membersToEnsure = [], force = false } = {}) => {
    const ownerId = dataOwnerId || user?.id
    if (!ownerId || isDeveloperBypass || !isSupabaseConfigured()) return []
    if (!isBackendHealthy()) {
      setWorkspaceMemberCodeStatus('paused-degraded')
      return Object.values(workspaceMemberCodeAssignmentsRef.current)
    }
    // Active workspace owners and collaborators with workspace access can allocate
    // and ensure member codes when adding members or hydrating workspace data.
    const canAllocate = Boolean(ownerId)
    const shouldEnsure = ensure && canAllocate

    const canonicalMembers = (membersToEnsure || [])
      .filter((member) => getMemberCanonicalId(member) && !member?.deleted_at)
    const legacyCodeMap = buildMemberIndexCodeMap(canonicalMembers, { codeLength: memberCodeLength })
    const memberPayload = canonicalMembers
      .filter((member) => !workspaceMemberCodeAssignmentsRef.current[String(getMemberCanonicalId(member))])
      .map((member) => ({
        id: getMemberCanonicalId(member),
        legacy_code: getMemberIndexCode(member, legacyCodeMap)
      }))
      // Allocation must not depend on whichever client happened to load rows first.
      .sort((left, right) => left.legacy_code.localeCompare(right.legacy_code) || left.id.localeCompare(right.id))

    if (workspaceMemberCodeRequestRef.current.ownerId !== ownerId) {
      workspaceMemberCodeRequestRef.current = { ownerId, sequence: 0 }
    }
    const requestId = ++workspaceMemberCodeRequestRef.current.sequence
    const isCurrentRequest = () => (
      workspaceMemberCodeRequestRef.current.ownerId === ownerId &&
      workspaceMemberCodeRequestRef.current.sequence === requestId
    )

    setWorkspaceMemberCodeStatus(shouldEnsure ? 'allocating' : 'loading')
    try {
      if (shouldEnsure && memberPayload.length > 0) {
        const { error } = await supabase.rpc('ensure_workspace_member_codes', { p_owner_id: ownerId, p_members: memberPayload })
        if (error) throw error
        invalidateRequestScope(`${ownerId}:workspace`, 'member-code-assignments')
      }
      const data = await readConfirmedWorkspaceMemberCodeAssignments(ownerId, { force: force || (shouldEnsure && memberPayload.length > 0) })
      if (!isCurrentRequest()) return data
      mergeConfirmedWorkspaceMemberCodeAssignments(ownerId, data)
      setWorkspaceMemberCodeStatus('ready')
      return data
    } catch (error) {
      // Keep the last confirmed cache visible during a temporary connection
      // recovery; never replace it with a client-generated assignment.
      console.warn('Workspace member-code assignments are unavailable:', error)
      if (isCurrentRequest()) setWorkspaceMemberCodeStatus('unavailable')
      throw error
    }
  }, [dataOwnerId, isAdminCollaborator, isCollaborator, isDeveloperBypass, isSupabaseConfigured, memberCodeLength, mergeConfirmedWorkspaceMemberCodeAssignments, readConfirmedWorkspaceMemberCodeAssignments, user?.id])

  // Hydrate the authoritative workspace assignments as soon as the workspace
  // identity is known. This must not wait for the first preview page, otherwise
  // badges appear only after a later render or a second search.
  useEffect(() => {
    if (isDeveloperBypass || !isSupabaseConfigured() || !(dataOwnerId || user?.id)) return undefined
    loadWorkspaceMemberCodes().catch(() => {})
    return undefined
  }, [dataOwnerId, isDeveloperBypass, isSupabaseConfigured, loadWorkspaceMemberCodes, user?.id])

  // Only allocate after the complete current member index has hydrated, and
  // only for canonical identities the server has not assigned yet.
  useEffect(() => {
    if (!membersLoadedAll || !members.length || isDeveloperBypass || !isSupabaseConfigured() || !(dataOwnerId || user?.id)) return undefined
    const missingMembers = members.filter((member) => {
      const memberId = getMemberCanonicalId(member)
      return memberId && !member.deleted_at && !workspaceMemberCodeAssignments[String(memberId)]
    })
    if (missingMembers.length === 0) return undefined
    loadWorkspaceMemberCodes({ ensure: true, membersToEnsure: missingMembers }).catch(() => {})
    return undefined
  }, [dataOwnerId, isDeveloperBypass, isSupabaseConfigured, loadWorkspaceMemberCodes, members, membersLoadedAll, user?.id, workspaceMemberCodeAssignments])

  const ensureMemberCodeAssignment = useCallback(async (member, { queueOnFailure = true } = {}) => {
    const ownerId = dataOwnerId || user?.id
    const memberId = getMemberCanonicalId(member)
    if (!ownerId || !memberId || isDeveloperBypass || !isSupabaseConfigured()) return null
    const existing = workspaceMemberCodeAssignmentsRef.current[String(memberId)]
    if (existing) return existing

    const legacyCodeMap = buildMemberIndexCodeMap([member], { codeLength: memberCodeLength })
    const payload = {
      id: String(memberId),
      legacy_code: getMemberIndexCode(member, legacyCodeMap)
    }

    try {
      const { data } = await executeSupabaseWrite(
        () => supabase.rpc('ensure_workspace_member_code', { p_owner_id: ownerId, p_member: payload }),
        { action: 'Allocate member code', retries: 1 }
      )
      const assignment = Array.isArray(data) ? data[0] : data
      if (!assignment?.member_id || !assignment?.current_code) {
        throw new Error('Member code allocation did not return a confirmed assignment')
      }
      return mergeConfirmedWorkspaceMemberCodeAssignments(ownerId, [assignment])[String(memberId)] || null
    } catch (error) {
      if (queueOnFailure) enqueueMemberCodeRecovery(member, error)
      throw error
    }
  }, [dataOwnerId, enqueueMemberCodeRecovery, isDeveloperBypass, isSupabaseConfigured, memberCodeLength, mergeConfirmedWorkspaceMemberCodeAssignments, user?.id])

  const flushMemberCodeRecoveryQueue = useCallback(async () => {
    if (memberCodeRecoveryRunningRef.current) return
    if (!isBrowserOnline()) {
      if (memberCodeRecoveryQueueRef.current.size > 0 && !memberCodeRecoveryTimerRef.current) {
        memberCodeRecoveryTimerRef.current = window.setTimeout(() => {
          memberCodeRecoveryTimerRef.current = null
          memberCodeRecoveryFlushRef.current?.()
        }, 2000)
      }
      return
    }
    const readyEntries = Array.from(memberCodeRecoveryQueueRef.current.entries())
      .filter(([, entry]) => entry.nextAttemptAt <= Date.now())
    if (readyEntries.length === 0) return

    memberCodeRecoveryRunningRef.current = true
    try {
      const batch = readyEntries.map(([, entry]) => entry.member)
      await loadWorkspaceMemberCodes({ ensure: true, membersToEnsure: batch })
      readyEntries.forEach(([memberId]) => {
        if (workspaceMemberCodeAssignmentsRef.current[memberId]) {
          memberCodeRecoveryQueueRef.current.delete(memberId)
        }
      })
    } catch (error) {
      const message = String(error?.message || error?.details || '').toLowerCase()
      const permanent = message.includes('permission') || message.includes('not allowed') || message.includes('validation') || message.includes('anonymous')
      readyEntries.forEach(([memberId, entry]) => {
        const attempts = entry.attempts + 1
        if (permanent || attempts >= 3) {
          memberCodeRecoveryQueueRef.current.delete(memberId)
          return
        }
        memberCodeRecoveryQueueRef.current.set(memberId, {
          ...entry,
          attempts,
          nextAttemptAt: Date.now() + Math.min(8000, 1000 * (2 ** attempts))
        })
      })
    } finally {
      memberCodeRecoveryRunningRef.current = false
      if (memberCodeRecoveryQueueRef.current.size > 0) {
        const nextDelay = Math.max(0, Math.min(...Array.from(memberCodeRecoveryQueueRef.current.values()).map((entry) => entry.nextAttemptAt - Date.now())))
        if (!memberCodeRecoveryTimerRef.current) {
          memberCodeRecoveryTimerRef.current = window.setTimeout(() => {
            memberCodeRecoveryTimerRef.current = null
            memberCodeRecoveryFlushRef.current?.()
          }, nextDelay)
        }
      }
    }
  }, [loadWorkspaceMemberCodes])

  useEffect(() => {
    memberCodeRecoveryFlushRef.current = flushMemberCodeRecoveryQueue
    return () => { memberCodeRecoveryFlushRef.current = null }
  }, [flushMemberCodeRecoveryQueue])

  useEffect(() => () => {
    if (memberCodeRecoveryTimerRef.current) window.clearTimeout(memberCodeRecoveryTimerRef.current)
  }, [])

  const convertWorkspaceMemberCodeFormat = useCallback(async (nextFormat, nextCodeLength = memberCodeLength) => {
    const ownerId = dataOwnerId || user?.id
    const format = normalizeMemberCodeFormat(nextFormat)
    const codeLength = normalizeMemberCodeLength(nextCodeLength)
    if (!ownerId || isDeveloperBypass || !isSupabaseConfigured()) {
      throw new Error('Member-code format changes require an authenticated workspace connection.')
    }
    if (!isOnline) {
      throw new Error('Reconnect before changing all workspace member codes. This conversion cannot be queued offline.')
    }
    if (isCollaborator && !isAdminCollaborator) {
      throw new Error('Only the workspace owner or an admin collaborator can change the member-code format.')
    }

    if (workspaceMemberCodeRequestRef.current.ownerId !== ownerId) {
      workspaceMemberCodeRequestRef.current = { ownerId, sequence: 0 }
    }
    const conversionRequestId = ++workspaceMemberCodeRequestRef.current.sequence
    setWorkspaceMemberCodeStatus('converting')
    try {
      const result = await executeSupabaseWrite(
        () => supabase.rpc('configure_workspace_member_codes', { p_owner_id: ownerId, p_format: format, p_code_length: codeLength }),
        { action: 'Change workspace member-code format', retries: 1 }
      )
      invalidateRequestScope(`${ownerId}:workspace`, 'member-code-assignments')
      const assignments = await readConfirmedWorkspaceMemberCodeAssignments(ownerId)
      if (workspaceMemberCodeRequestRef.current.ownerId === ownerId && workspaceMemberCodeRequestRef.current.sequence === conversionRequestId) {
        mergeConfirmedWorkspaceMemberCodeAssignments(ownerId, assignments)
      }
      if (isCollaborator) {
        await fetchOwnerStickyDefaults(ownerId)
      } else {
        await authContext?.loadUserPreferences?.(user?.id)
      }
      setWorkspaceMemberCodeStatus('ready')
      return result.data || []
    } catch (error) {
      setWorkspaceMemberCodeStatus('error')
      throw error
    }
  }, [authContext, dataOwnerId, fetchOwnerStickyDefaults, isAdminCollaborator, isCollaborator, isDeveloperBypass, isOnline, isSupabaseConfigured, memberCodeLength, mergeConfirmedWorkspaceMemberCodeAssignments, readConfirmedWorkspaceMemberCodeAssignments, user?.id])

  // Check if current user is a collaborator and get the owner's ID
  const checkCollaboratorStatus = async () => {
    appContextLog('=== checkCollaboratorStatus STARTED ===')
    appContextLog('User email:', user?.email)
    appContextLog('User ID:', user?.id)
    appContextLog('Supabase configured?', isSupabaseConfigured())

    if (isDeveloperBypass && user?.id) {
      setIsCollaborator(false)
      setIsAdminCollaborator(false)
      setDataOwnerId(user.id)
      setOwnerEmail(null)
      setHasAccess(true)
      setOwnerStickyMonth(null)
      setOwnerStickySundays([])
      return user.id
    }

    if (isAdminCodeLogin && user?.id) {
      appContextLog('Admin code owner session detected; allowing owner access without collaborator lookup.')
      setIsCollaborator(false)
      setIsAdminCollaborator(false)
      setDataOwnerId(user.id)
      setOwnerEmail(null)
      setHasAccess(true)
      setOwnerStickyMonth(null)
      setOwnerStickySundays([])
      fetchOwnerStickyDefaults(user.id)
      return user.id
    }

    if (!user?.id || !isSupabaseConfigured()) {
      appContextLog('Skipping collaborator check - no user ID or Supabase not configured')
      setIsCollaborator(false)
      setDataOwnerId(null)
      setOwnerEmail(null)
      return null
    }

    if (shouldUseOfflineData) {
      const snapshotRecord = await getOfflineSnapshot().catch(() => null)
      const snapshot = snapshotRecord?.snapshot
      if (shouldUseOfflineData && snapshot?.authenticated_user_id === user.id && applyOfflineSnapshot(snapshotRecord)) {
        setIsCollaborator(Boolean(snapshot.is_collaborator))
        setIsAdminCollaborator(Boolean(snapshot.is_admin_collaborator))
        // An incomplete collaborator snapshot must never silently become the
        // collaborator's personal workspace while offline.
        const snapshotOwnerId = snapshot.data_owner_id || dataOwnerId || (snapshot.is_collaborator ? null : user.id)
        setDataOwnerId(snapshotOwnerId)
        setOwnerEmail(snapshot.owner_email || null)
        setHasAccess(true)
        setOfflineStatusMessage('Offline Mode - using saved local data.')
        return snapshotOwnerId
      }
    }

    // Preserve the last confirmed owner context instead of probing access
    // endpoints while the backend health coordinator is cooling down.
    if (!isBackendHealthy()) {
      const snapshotRecord = await getOfflineSnapshot().catch(() => null)
      const snapshot = snapshotRecord?.snapshot
      const confirmedOwnerId = snapshot?.data_owner_id || dataOwnerId || null
      if (confirmedOwnerId) {
        setIsCollaborator(Boolean(snapshot?.is_collaborator ?? confirmedOwnerId !== user.id))
        if (typeof snapshot?.is_admin_collaborator === 'boolean') {
          setIsAdminCollaborator(snapshot.is_admin_collaborator)
        }
        setDataOwnerId(confirmedOwnerId)
        setHasAccess(true)
      }
      return confirmedOwnerId
    }

    try {
      const normalizedEmail = user.email?.trim().toLowerCase()
      let data = null
      let error = null

      const { data: accessContext, error: accessContextError } = await supabase.rpc('get_current_user_access_context')
      if (!accessContextError && accessContext) {
        appContextLog('Access context RPC result:', accessContext)
        if (!accessContext.has_access) {
          appContextLog('Access denied: user is not an owner or collaborator')
          if (dataOwnerId && dataOwnerId !== user.id && authContext?.clearRevokedWorkspaceCache) {
            authContext.clearRevokedWorkspaceCache(dataOwnerId)
          }
          setIsCollaborator(false)
          setIsAdminCollaborator(false)
          setDataOwnerId(user.id)
          setOwnerEmail(null)
          setHasAccess(false)
          return null
        }

        if (accessContext.is_collaborator) {
          setIsCollaborator(true)
          setIsAdminCollaborator(Boolean(accessContext.is_admin_collaborator))
          setDataOwnerId(accessContext.owner_id)
          setOwnerEmail(null)
          setHasAccess(true)
          fetchOwnerStickyDefaults(accessContext.owner_id)
          return accessContext.owner_id
        }

        setIsCollaborator(false)
        setIsAdminCollaborator(false)
        setDataOwnerId(accessContext.owner_id || user.id)
        setOwnerEmail(null)
        setHasAccess(true)
        setOwnerStickyMonth(null)
        setOwnerStickySundays([])
        fetchOwnerStickyDefaults(accessContext.owner_id || user.id)
        return accessContext.owner_id || user.id
      }

      if (accessContextError) {
        console.warn('Access context RPC unavailable; falling back to legacy access checks:', accessContextError.message)
        if (isBackendDegradedError(accessContextError)) {
          markBackendDegraded(accessContextError)
          const snapshotRecord = await getOfflineSnapshot().catch(() => null)
          const snapshot = snapshotRecord?.snapshot
          const confirmedOwnerId = snapshot?.data_owner_id || dataOwnerId || null
          if (confirmedOwnerId) {
            setIsCollaborator(Boolean(snapshot?.is_collaborator ?? confirmedOwnerId !== user.id))
            setIsAdminCollaborator(Boolean(snapshot?.is_admin_collaborator))
            setDataOwnerId(confirmedOwnerId)
            setHasAccess(true)
          }
          // Never turn a collaborator into a workspace owner because the
          // access RPC is temporarily unavailable.
          return confirmedOwnerId
        }
      }

      const collaboratorQuery = supabase
        .from('collaborators')
        .select('owner_id, status, email, is_admin')
        .eq('collaborator_user_id', user.id)
        .in('status', ['accepted', 'active'])
      const userLookup = await (
        typeof collaboratorQuery.maybeSingle === 'function'
          ? collaboratorQuery.maybeSingle()
          : collaboratorQuery.single()
      )

      data = userLookup.data
      error = userLookup.error

      if (!data && normalizedEmail) {
        appContextLog('Collaborator lookup by user id returned no match. Falling back to email lookup:', normalizedEmail)
        const emailQueryBase = supabase
          .from('collaborators')
          .select('owner_id, status, email, is_admin')
        const emailQuery = typeof emailQueryBase.ilike === 'function'
          ? emailQueryBase.ilike('email', normalizedEmail)
          : emailQueryBase.eq('email', normalizedEmail)
        const emailLookup = await (
          typeof emailQuery.maybeSingle === 'function'
            ? emailQuery
              .in('status', ['accepted', 'active'])
              .maybeSingle()
            : emailQuery
              .in('status', ['accepted', 'active'])
              .single()
        )
        data = emailLookup.data
        error = emailLookup.error
      }

      appContextLog('Collaborators query result:', { data, error })

      if (error) {
        console.warn('Collaborator status check failed with error. Retaining existing workspace owner ID:', dataOwnerId || user?.id)
        if (isBackendDegradedError(error)) {
          markBackendDegraded(error)
        }
        const snapshotRecord = await getOfflineSnapshot().catch(() => null)
        const snapshot = snapshotRecord?.snapshot
        const resolvedOwnerId = snapshot?.data_owner_id || dataOwnerId || null
        setIsCollaborator(Boolean(snapshot?.is_collaborator ?? Boolean(resolvedOwnerId && resolvedOwnerId !== user?.id)))
        if (typeof snapshot?.is_admin_collaborator === 'boolean') {
          setIsAdminCollaborator(snapshot.is_admin_collaborator)
        }
        if (resolvedOwnerId) setDataOwnerId(resolvedOwnerId)
        setHasAccess(true)
        return resolvedOwnerId
      }

      if (!data) {
        // Verified: query succeeded with 0 records. User is NOT a collaborator on another workspace.
        appContextLog('User is NOT a collaborator. Checking if they are an owner...')

        const { data: ownerTables, error: ownerError } = await supabase
          .from('user_month_tables')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)

        const { data: prefs, error: prefsError } = await supabase
          .from('user_preferences')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)

        if (ownerError || prefsError) {
          console.warn('Owner access check failed; keeping access open until the next retry.', ownerError || prefsError)
          const fallbackOwnerId = dataOwnerId || user.id
          const retainCollaboratorScope = Boolean(dataOwnerId && dataOwnerId !== user.id)
          setIsCollaborator(retainCollaboratorScope)
          if (!retainCollaboratorScope) {
            setIsAdminCollaborator(false)
          }
          setDataOwnerId(fallbackOwnerId)
          setOwnerEmail(null)
          setHasAccess(true)
          return fallbackOwnerId
        }

        const isRealOwner = (ownerTables && ownerTables.length > 0) || (prefs && prefs.length > 0)

        if (!isRealOwner) {
          // Random user with no data and not a collaborator - DENY ACCESS
          appContextLog('Access denied: user is not an owner or collaborator')
        setIsCollaborator(false)
        setIsAdminCollaborator(false)
          setDataOwnerId(null)
          setOwnerEmail(null)
          setHasAccess(false)
          return null
        }

        appContextLog('User is a verified owner')
        setIsCollaborator(false)
        setDataOwnerId(user.id)
        setOwnerEmail(null)
        setHasAccess(true)
        setOwnerStickyMonth(null)
        setOwnerStickySundays([])
        fetchOwnerStickyDefaults(user.id)
        return user.id
      }

      // User is a collaborator - they should see the owner's data
      appContextLog('User is a collaborator')
      appContextLog('Owner ID:', data.owner_id)
      appContextLog('Status:', data.status)
      setIsCollaborator(true)
      setIsAdminCollaborator(Boolean(data?.is_admin))
      setDataOwnerId(data.owner_id)
      setHasAccess(true)
      fetchOwnerStickyDefaults(data.owner_id)

      // Fetch Workspace Name from Owner for collaborator display without writing to database
      const { data: ownerWsName, error: wsError } = await supabase.rpc('get_owner_workspace_name', {
        owner_uuid: data.owner_id
      })

      if (!wsError && ownerWsName) {
        appContextLog('Loaded owner workspace name:', ownerWsName)
      }

      // Get owner's email for display
      const { data: ownerData } = await supabase
        .from('collaborators')
        .select('owner_id')
        .eq('owner_id', data.owner_id)
        .limit(1)

      // Get owner email from auth.users via a different method
      setOwnerEmail(null) // We'll show owner_id for now

      appContextLog('=== checkCollaboratorStatus COMPLETE - User is COLLABORATOR ===')
      return data.owner_id
    } catch (err) {
      console.error('ERROR in checkCollaboratorStatus:', err)
      const snapshotRecord = await getOfflineSnapshot().catch(() => null)
      const snapshot = snapshotRecord?.snapshot
      if (shouldUseOfflineData && snapshot?.authenticated_user_id === user.id && applyOfflineSnapshot(snapshotRecord)) {
        setIsCollaborator(Boolean(snapshot.is_collaborator))
        setIsAdminCollaborator(Boolean(snapshot.is_admin_collaborator))
        // A collaborator snapshot without a confirmed owner must not be
        // re-scoped to the collaborator's own UUID. That would make a
        // temporary access failure look like an empty personal workspace.
        const snapshotOwnerId = snapshot.data_owner_id || dataOwnerId || (snapshot.is_collaborator ? null : user.id)
        setDataOwnerId(snapshotOwnerId)
        setOwnerEmail(snapshot.owner_email || null)
        setHasAccess(true)
        setOfflineStatusMessage('Offline Mode - using saved local data.')
        return snapshotOwnerId
      }

      // An exception means access was not confirmed, not that a collaborator
      // became an owner. Preserve the last owner scope and wait for the shared
      // health coordinator to allow a later retry instead of loading a second,
      // incorrect workspace with the collaborator's UUID.
      if (isBackendDegradedError(err)) markBackendDegraded(err)
      const confirmedOwnerId = dataOwnerId || null
      if (confirmedOwnerId) {
        setIsCollaborator(confirmedOwnerId !== user?.id)
        setDataOwnerId(confirmedOwnerId)
      }
      setOwnerEmail(null)
      setHasAccess(true)
      return confirmedOwnerId
    }
  }

  // Determine collaborator status whenever auth state settles
  useEffect(() => {
    if (authLoading) return
    checkCollaboratorStatus()
  }, [authLoading, user?.email, user?.id])

  useEffect(() => {
    if (!isCollaborator || !dataOwnerId) {
      setOwnerStickyMonth(null)
      setOwnerStickySundays([])
      setAdminSyncNotice(null)
      setIsAdminCollaborator(false)
      return
    }
    fetchOwnerStickyDefaults(dataOwnerId)
  }, [isCollaborator, dataOwnerId, fetchOwnerStickyDefaults])

  const buildAdminTarget = useCallback((stickyMonth, stickySundays) => {
    let targetTable = null
    let targetDate = null
    if (stickyMonth) {
      targetTable = stickyMonth
    }

    if (!targetDate && targetTable && Array.isArray(stickySundays) && stickySundays.length > 0) {
      const [monthName, yearStr] = targetTable.split('_')
      const yearNum = parseInt(yearStr, 10)
      const monthIndex = MONTHS_IN_YEAR.indexOf(monthName) + 1
      const match = stickySundays.find((dateStr) => {
        const [y, m] = dateStr.split('-').map(Number)
        return y === yearNum && m === monthIndex
      })
      if (match) {
        const [y, m, d] = match.split('-').map(Number)
        targetDate = new Date(y, m - 1, d)
      }
    }

    return { targetTable, targetDate }
  }, [])

  const applyAdminTargetForCollaborator = useCallback((targetTable, targetDateKey) => {
    if (!isCollaborator || isPersonalManualMode) return

    const effectiveTable = targetTable || currentTable
    if (targetTable && targetTable !== currentTable) {
      changeCurrentTable(targetTable)
    }

    if (!targetDateKey) return
    const [y, m, d] = targetDateKey.split('-').map(Number)
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return

    const normalizedDate = normalizeDateToSundayForTable(new Date(y, m - 1, d), effectiveTable)
    if (!normalizedDate) return

    const currentDateKey = selectedAttendanceDate ? getLocalDateString(selectedAttendanceDate) : null
    const normalizedDateKey = getLocalDateString(normalizedDate)
    if (currentDateKey === normalizedDateKey) return

    setSelectedAttendanceDate(normalizedDate)
    localStorage.setItem(`selectedAttendanceDate_${effectiveTable}`, normalizedDate.toISOString())
  }, [isCollaborator, isPersonalManualMode, currentTable, changeCurrentTable, selectedAttendanceDate])

  const updateAdminSyncNotice = useCallback((stickyMonth, stickySundays) => {
    if (!isCollaborator) return
    const { targetTable, targetDate } = buildAdminTarget(stickyMonth, stickySundays)
    if (!targetTable && !targetDate) {
      setAdminSyncNotice(null)
      return
    }
    const targetDateKey = targetDate ? getLocalDateString(targetDate) : null
    applyAdminTargetForCollaborator(targetTable, targetDateKey)
    setAdminSyncNotice(null)
  }, [
    isCollaborator,
    buildAdminTarget,
    applyAdminTargetForCollaborator
  ])

  const applyAdminBroadcastNotice = useCallback((payload) => {
    if (!isCollaborator) return
    const targetTable = payload?.targetTable || null
    const targetDateKey = payload?.targetDate || null
    if (!targetTable && !targetDateKey) return
    applyAdminTargetForCollaborator(targetTable, targetDateKey)
    setAdminSyncNotice(null)
  }, [isCollaborator, applyAdminTargetForCollaborator])

  const sendAdminPeriodBroadcast = useCallback((payload) => {
    const channel = adminRealtimeChannelRef.current
    if (!channel || adminRealtimeStatusRef.current !== 'SUBSCRIBED' || typeof channel.send !== 'function') {
      pendingAdminBroadcastRef.current = payload
      return
    }
    try {
      const sendResult = channel.send({
        type: 'broadcast',
        event: 'admin_period_change',
        payload
      })
      if (sendResult && typeof sendResult.catch === 'function') {
        sendResult.catch((err) => {
          console.error('Error sending admin period broadcast:', err)
          pendingAdminBroadcastRef.current = payload
        })
      }
    } catch (err) {
      console.error('Error sending admin period broadcast:', err)
      pendingAdminBroadcastRef.current = payload
    }
  }, [])

  useEffect(() => {
    const channelOwnerId = isCollaborator ? dataOwnerId : user?.id
    if (!isSupabaseConfigured() || !channelOwnerId) return
    const channel = supabase.channel(`admin-sync-${channelOwnerId}`, {
      config: {
        broadcast: { self: false }
      }
    })
    if (isCollaborator) {
      channel.on('broadcast', { event: 'admin_period_change' }, ({ payload }) => {
        applyAdminBroadcastNotice(payload)
      })
    }
    channel.subscribe((status) => {
      adminRealtimeStatusRef.current = status
      if (status === 'SUBSCRIBED' && pendingAdminBroadcastRef.current && typeof channel.send === 'function') {
        const pendingPayload = pendingAdminBroadcastRef.current
        pendingAdminBroadcastRef.current = null
        channel.send({
          type: 'broadcast',
          event: 'admin_period_change',
          payload: pendingPayload
        }).catch((err) => {
          console.error('Error sending queued admin period broadcast:', err)
          pendingAdminBroadcastRef.current = pendingPayload
        })
      }
    })
    adminRealtimeChannelRef.current = channel
    return () => {
      supabase.removeChannel(channel)
      if (adminRealtimeChannelRef.current === channel) {
        adminRealtimeChannelRef.current = null
      }
      adminRealtimeStatusRef.current = 'CLOSED'
    }
  }, [isSupabaseConfigured, isCollaborator, dataOwnerId, user?.id, applyAdminBroadcastNotice])

  useEffect(() => {
    updateAdminSyncNotice(ownerStickyMonth, ownerStickySundays)
  }, [ownerStickyMonth, ownerStickySundays, updateAdminSyncNotice])

  // Activity Logging Helper
  const logActivity = useCallback(async (action, details) => {
    if (!isSupabaseConfigured() || !user) return

    try {
      const targetOwner = isCollaborator ? dataOwnerId : user.id
      if (!targetOwner) {
        console.warn('Cannot log activity: targetOwner is undefined')
        return
      }

      await supabase.from('activity_logs').insert({
        actor_id: user.id,
        actor_email: user.email,
        action,
        details,
        target_owner_id: targetOwner
      })
    } catch (error) {
      console.error('Failed to log activity:', error)
    }
  }, [user, isCollaborator, dataOwnerId])

  const applyDeletedAtFilter = useCallback((query) => {
    if (!query) return query
    if (typeof query.is === 'function') return query.is('deleted_at', null)
    if (typeof query.eq === 'function') return query.eq('deleted_at', null)
    return query
  }, [])

  const applyWorkspaceOwnerFilter = useCallback((query) => {
    const ownerId = dataOwnerId || user?.id
    if (!query || !ownerId || typeof query.eq !== 'function') return query
    return query.eq('workspace_owner_id', ownerId)
  }, [dataOwnerId, user?.id])


  const fetchMemberPreviewPage = async (tableName, offset = 0, pageSize = MEMBER_PREVIEW_PAGE_SIZE) => {
    const from = Math.max(0, offset)
    const to = from + Math.max(1, pageSize) - 1
    await ensureMemberPreviewSyncColumns(tableName)
    let response = await applyDeletedAtFilter(applyWorkspaceOwnerFilter(
      supabase
        .from(tableName)
        .select(MEMBER_PREVIEW_SELECT, { count: 'exact' })
    )).range(from, to)

    if (response.error) {
      const message = response.error.message?.toLowerCase() || ''
      const shouldFallback =
        response.error.code === 'PGRST100' ||
        response.error.code === '42703' ||
        message.includes('failed to parse') ||
        message.includes('does not exist') ||
        message.includes('column')

      if (shouldFallback) {
        console.warn('[fetchMembers] Preview column select failed; falling back to one-page row select:', response.error)
        const deletedColumnMissing = message.includes('deleted_at') || response.error.code === '42703'
        let fallbackQuery = applyWorkspaceOwnerFilter(supabase
          .from(tableName)
          .select('*', { count: 'exact' }))
        if (!deletedColumnMissing) {
          fallbackQuery = applyDeletedAtFilter(fallbackQuery)
        }
        response = await fallbackQuery.range(from, to)
      }
    }

    return response
  }

  const applyMemberPreviewCache = (tableName, payload, { background = false } = {}) => {
    const normalizedMembers = filterDeletedMembers(payload?.data || []).map((member) => normalizeMemberRecord(member, {
      tableName,
      ownerId: dataOwnerId || user?.id
    }))
    const totalCount = Number.isFinite(payload?.totalCount) ? payload.totalCount : normalizedMembers.length
    const loadedAll = Boolean(payload?.loadedAll) || normalizedMembers.length >= totalCount
    const cachePayload = {
      data: normalizedMembers,
      ts: payload?.ts || Date.now(),
      totalCount,
      loadedAll
    }

    setMembers(normalizedMembers)
    setMembersTotalCount(totalCount)
    setMembersLoadedAll(loadedAll)
    setMemberHydrationState('HYDRATED')
    membersCacheRef.current.set(tableName || 'default', cachePayload)
    writeMemberPreviewCache(workspaceCacheScope, tableName, cachePayload)

    if (!background) {
      setLoading(false)
      // The cached count can be stale (e.g. soft-deletes that predate the sync
      // window). Confirm it against the server and heal data+count when it drifts.
      void reconcileAuthoritativeCount(tableName)
    }

    return normalizedMembers
  }

  const persistLoadedMemberPreview = (tableName, nextMembers, overrides = {}) => {
    const cacheKey = tableName || 'default'
    const normalizedMembers = (nextMembers || []).filter((member) => !member?.deleted_at).map((member) => normalizeMemberRecord(member, {
      tableName,
      ownerId: dataOwnerId || user?.id
    }))
    const totalCount = Number.isFinite(overrides.totalCount)
      ? overrides.totalCount
      : Math.max(membersTotalCount || 0, normalizedMembers.length)
    const loadedAll = overrides.loadedAll ?? membersLoadedAll
    const cachePayload = {
      data: normalizedMembers,
      ts: Date.now(),
      totalCount,
      loadedAll
    }
    membersCacheRef.current.set(cacheKey, cachePayload)
    writeMemberPreviewCache(workspaceCacheScope, tableName, cachePayload)
    setMembersTotalCount(totalCount)
    setMembersLoadedAll(loadedAll)
  }

  const persistMemberPreviewIndex = useCallback(async (tableName, nextMembers, overrides = {}) => {
    if (!tableName || !Array.isArray(nextMembers) || nextMembers.length === 0) return 0
    if (!isOfflineStoreAvailable()) return 0
    try {
      // Never persist a deleted/tombstoned row into the active preview index.
      const normalizedMembers = filterDeletedMembers(nextMembers).map(normalizeMemberRecord)
      const savedCount = await saveMemberPreviewMembers(workspaceCacheScope, tableName, normalizedMembers)
      setMemberPreviewSyncStatus(prev => ({
        ...prev,
        cachedCount: Math.max(prev.cachedCount || 0, overrides.cachedCount || normalizedMembers.length),
        totalCount: overrides.totalCount ?? prev.totalCount,
        lastSyncedAt: overrides.lastSyncedAt || new Date().toISOString(),
        source: overrides.source || prev.source || 'indexeddb'
      }))
      return savedCount
    } catch (error) {
      console.warn('Could not persist member preview index:', error)
      return 0
    }
  }, [workspaceCacheScope])

  const markMemberPreviewSyncComplete = useCallback((tableName, overrides = {}) => {
    if (!tableName) return null
    const syncedAt = overrides.lastSyncAt || new Date().toISOString()
    const cachedCount = Number.isFinite(overrides.cachedCount) ? overrides.cachedCount : 0
    const totalCount = Number.isFinite(overrides.totalCount) ? overrides.totalCount : cachedCount
    const meta = {
      ...overrides,
      cachedCount,
      totalCount,
      lastSyncAt: syncedAt,
      lastRemoteUpdatedAt: overrides.lastRemoteUpdatedAt || syncedAt
    }
    writeMemberPreviewSyncMeta(workspaceCacheScope, tableName, meta)
    setMemberPreviewSyncStatus(prev => ({
      ...prev,
      isSyncing: false,
      cachedCount: Math.max(prev.cachedCount || 0, cachedCount),
      totalCount: Math.max(prev.totalCount || 0, totalCount),
      lastSyncedAt: syncedAt,
      lastSyncAt: syncedAt,
      lastRemoteUpdatedAt: meta.lastRemoteUpdatedAt,
      source: overrides.source || prev.source || 'indexeddb'
    }))
    return meta
  }, [workspaceCacheScope])

  const getMemberPreviewSyncSince = useCallback((tableName) => {
    const meta = readMemberPreviewSyncMeta(workspaceCacheScope, tableName)
    const metaSync = meta?.lastSyncAt || meta?.lastSyncedAt
    const cacheSync = readMemberPreviewCache(workspaceCacheScope, tableName)?.ts
    const fallback = Number.isFinite(cacheSync) ? new Date(cacheSync).toISOString() : null
    const syncSource = metaSync || fallback
    if (!syncSource) return null
    const metaDate = new Date(syncSource)
    if (Number.isNaN(metaDate.getTime())) return null
    const overlap = Math.max(0, MEMBER_PREVIEW_SYNC_OVERLAP_MS)
    return new Date(Math.max(0, metaDate.getTime() - overlap)).toISOString()
  }, [workspaceCacheScope])

  const ensureMemberPreviewSyncColumns = useCallback(async (tableName) => {
    // Normal client rendering, sync, and attendance operations only read/write data.
    // Schema management is performed strictly during table creation or migrations.
    void tableName
    return true
  }, [])

  const readMemberPreviewIndex = useCallback(async (tableName = currentTable) => {
    if (!tableName) return []
    if (!isOfflineStoreAvailable()) return []
    try {
      const cachedMembers = await getMemberPreviewMembers(workspaceCacheScope, tableName)
      return filterDeletedMembers(cachedMembers || []).map(normalizeMemberRecord)
    } catch (error) {
      console.warn('Could not read member preview index:', error)
      return []
    }
  }, [currentTable, workspaceCacheScope])

  const searchMemberPreviewIndex = useCallback(async (term, tableName = currentTable) => {
    if (!normalizeSearchText(term) || !tableName) return []
    const cachedMembers = await readMemberPreviewIndex(tableName)
    const cachedCodeMap = buildMemberIndexCodeMap(cachedMembers, {
      format: memberCodeFormat,
      codeLength: memberCodeLength,
      persistedCodes: workspaceMemberCodeAssignments,
      allowLegacyFallback: false
    })
    return classifyMemberSearch({
      members: cachedMembers,
      query: term,
      getCode: (member) => getMemberIndexCode(member, cachedCodeMap) || member?.member_code || '',
      getCodeAliases: (member) => getMemberIndexCodeAliases(member, cachedCodeMap),
      codeLength: memberCodeLength
    }).visible.slice(0, 50)
  }, [currentTable, memberCodeFormat, memberCodeLength, readMemberPreviewIndex, workspaceMemberCodeAssignments])

  function startMemberPreviewBackgroundSync(tableName = currentTable, options = {}) {
    if (!tableName || isDeveloperBypass || !isSupabaseConfigured() || shouldUseOfflineData) return
    if (!isBackendHealthy()) {
      setMemberPreviewSyncStatus(prev => ({ ...prev, isSyncing: false, source: 'paused-degraded' }))
      return
    }
    if (offlineMode === 'online' && !isOnline) return
    const syncSince = getMemberPreviewSyncSince(tableName)
    const needsInitialIndex = !syncSince
    if (!options.force && !needsInitialIndex && !isMemberPreviewSyncStale(workspaceCacheScope, tableName)) {
      setMemberPreviewSyncStatus(prev => ({
        ...prev,
        source: options.source || 'fresh',
        lastSyncedAt: readMemberPreviewSyncMeta(workspaceCacheScope, tableName)?.lastSyncAt || prev.lastSyncedAt,
        lastSyncAt: readMemberPreviewSyncMeta(workspaceCacheScope, tableName)?.lastSyncAt || prev.lastSyncAt
      }))
      return
    }

    const syncKey = `${workspaceCacheScope}:${tableName || 'default'}`

    setMemberPreviewSyncStatus(prev => ({
      ...prev,
      isSyncing: true,
      source: options.source || 'background'
    }))

    void runScopedRequest(syncKey, 'member-reconciliation', async () => {
      await ensureMemberPreviewSyncColumns(tableName)

      let offset = 0
      let remoteRows = []
      let latestRemoteUpdatedAt = syncSince || null
      let pageSize = MEMBER_PREVIEW_SYNC_PAGE_SIZE
      let remoteTotalCount = 0

      while (pageSize === MEMBER_PREVIEW_SYNC_PAGE_SIZE) {
        let data
        let error
        let count
        if (!syncSince) {
          ({ data, error, count } = await fetchMemberPreviewPage(tableName, offset, MEMBER_PREVIEW_SYNC_PAGE_SIZE))
        } else {
          let query = supabase
            .from(tableName)
            .select(MEMBER_PREVIEW_SELECT, { count: 'exact' })
            .order('updated_at', { ascending: true })
          query = applyWorkspaceOwnerFilter(query).gt('updated_at', syncSince)
          ;({ data, error, count } = await query.range(offset, offset + MEMBER_PREVIEW_SYNC_PAGE_SIZE - 1))
        }
        if (error) throw error

        const pageRows = (data || []).map(normalizeMemberRecord)
        pageSize = pageRows.length
        if (pageRows.length > 0) {
          remoteRows = remoteRows.concat(pageRows)
          const pageLatest = pageRows.reduce((latest, row) => {
            const updated = Date.parse(row.updated_at || row.updatedAt || row.inserted_at || row.created_at || '')
            if (!Number.isFinite(updated)) return latest
            return Math.max(latest, updated)
          }, 0)
          if (pageLatest > 0) {
            latestRemoteUpdatedAt = new Date(Math.max(Date.parse(latestRemoteUpdatedAt || 0), pageLatest)).toISOString()
          }
        }

        if (needsInitialIndex && Number.isFinite(count)) {
          remoteTotalCount = count
        }

        if (pageRows.length < MEMBER_PREVIEW_SYNC_PAGE_SIZE) break
        offset += MEMBER_PREVIEW_SYNC_PAGE_SIZE
        await sleep(60)
      }

      // A row is treated as deleted when the server confirms deleted_at OR when a
      // local tombstone says it was deleted more recently than the fetched row
      // (stale in-flight pre-delete data must never resurrect a deleted member).
      const tombstoneList = readMemberDeleteTombstones()
      const deletedRows = remoteRows.filter((row) => row?.deleted_at || isMemberStaleDeleted(row, tombstoneList))
      const deletedIds = deletedRows.map((row) => String(row.id))
      const activeRows = remoteRows.filter((row) => !row?.deleted_at && !isMemberStaleDeleted(row, tombstoneList))

      if (deletedRows.length > 0) {
        // Persist a tombstone for every remotely-confirmed delete so a later
        // stale cache/index write or reopen can never resurrect the row.
        deletedRows.forEach((row) => {
          addMemberDeleteTombstone(row.id, row.deleted_at || new Date().toISOString(), tableName)
        })
      }

      if (activeRows.length > 0) {
        await saveMemberPreviewMembers(workspaceCacheScope, tableName, activeRows)
        applyAttendanceColumnsFromMemberRows(activeRows, tableName)
      }

      if (deletedIds.length > 0) {
        setDeletedMemberSearchTombstones((prev) => {
          const byId = new Map(prev.map((member) => [String(member.id), member]))
          deletedRows.forEach((member) => byId.set(String(member.id), normalizeMemberRecord(member)))
          return [...byId.values()].slice(-100)
        })
        await Promise.all(deletedIds.map((memberId) => deleteMemberPreviewMember(workspaceCacheScope, tableName, memberId)))
        deletedIds.forEach((memberId) => removeMemberFromAttendanceData(memberId))
      }

      const indexedMembers = await readMemberPreviewIndex(tableName)
      const filteredMembers = filterDeletedMembers(indexedMembers)
      const cachePayload = {
        data: filteredMembers,
        ts: Date.now(),
        totalCount: remoteTotalCount || filteredMembers.length,
        loadedAll: needsInitialIndex || membersLoadedAll
      }

      membersCacheRef.current.set(tableName || 'default', cachePayload)
      writeMemberPreviewCache(workspaceCacheScope, tableName, cachePayload)

      if (tableName === currentTable) {
        setMembers((prev) => {
          const next = mergeMemberPreviewPages(prev.filter((member) => !deletedIds.includes(String(member.id))), activeRows)
          return next
        })
        setMembersTotalCount(remoteTotalCount || filteredMembers.length)
        // An initial sync has read every preview page. Mark that fact so later
        // searches can trust the local index instead of repeatedly querying it.
        if (needsInitialIndex) setMembersLoadedAll(true)
      }

      if (activeRows.length > 0 || deletedIds.length > 0) {
        searchCacheRef.current.clear()
        refreshSearch()
      }

      const now = new Date().toISOString()
      markMemberPreviewSyncComplete(tableName, {
        cachedCount: filteredMembers.length,
        totalCount: remoteTotalCount || filteredMembers.length,
        source: 'background',
        lastSyncAt: now,
        lastRemoteUpdatedAt: latestRemoteUpdatedAt || now
      })
    }, { force: options.force, cacheResult: false }).catch((error) => {
      console.warn('Background member preview sync failed:', error)
      setMemberPreviewSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        source: 'error'
      }))
    })
  }

  memberPreviewBackgroundSyncRunnerRef.current = startMemberPreviewBackgroundSync

  // Fetch members from current monthly table or use mock data
  const fetchMembers = async (tableName = currentTable, options = {}) => {
    const { forceRefresh = false, background = false, forceOnline = false, fullSnapshot = false } = options
    // Tracks whether this call applied authoritative data. Used to keep the
    // dashboard in a loading state (never false-empty) when a foreground fetch
    // ends with an error and no usable data.
    let hydratedThisFetch = false
    const markHydrated = () => {
      hydratedThisFetch = true
      setMemberHydrationState('HYDRATED')
    }
    if (!tableName) {
      console.warn('fetchMembers called with null/undefined tableName, skipping')
      if (!background) setMemberHydrationState('LOADING')
      return []
    }
    if (!isBackendHealthy()) {
      const cached = membersCacheRef.current.get(tableName) || readMemberPreviewCache(workspaceCacheScope, tableName)
      if (cached?.data?.length) {
        hydratedThisFetch = true
        return applyMemberPreviewCache(tableName, cached, { background })
      }
      if (members?.length) {
        if (!background) setLoading(false)
        return members
      }
      if (!background) setMemberHydrationState('LOADING')
      return []
    }
    try {
      if (!background) {
        setLoading(true)
        setMemberHydrationState('LOADING')
      }
      appContextLog(`Fetching members from table: ${tableName} for user: ${user?.id}`)

      if (shouldUseOfflineData && !forceOnline) {
        const snapshotRecord = await getOfflineSnapshot().catch(() => null)
        if (snapshotRecord && applyOfflineSnapshot(snapshotRecord)) {
          markHydrated()
          if (!background) {
            setLoading(false)
            setOfflineStatusMessage('Offline Mode - using saved local data.')
          }
          return filterDeletedMembers(snapshotRecord?.snapshot?.members || [])
        }
        if (offlineMode === 'offline') {
          if (!background) {
            toast.warn('No offline cache found. Download offline data while online first.')
          }
          // No offline snapshot and no data: keep the loading/offline state so the
          // dashboard never renders a false "No members yet".
          if (!background) {
            setMemberHydrationState('LOADING')
          }
          return
        }
      }

      if (offlineMode === 'online' && !isOnline && !background) {
        toast.warn('Online mode selected, but internet is unavailable.')
      }

      if (isDeveloperBypassActive || isDeveloperBypassStorageEnabled() || !isSupabaseConfigured()) {
        appContextLog('Using mock data - Supabase not configured')
        setMembers(mockMembers)
        setMembersTotalCount(mockMembers.length)
        setMembersLoadedAll(true)
        markHydrated()
        if (!background) {
          setLoading(false)
        }
        return mockMembers
      }

      // Check if we have a valid session
      const { data: { session } } = await supabase.auth.getSession()
      appContextLog('Current session:', session ? `authenticated as ${session.user?.id}` : 'not authenticated')
      if (!session) {
        const isAdminCodeLogin = authContext?.preferences?.admin_code_login === true
        if (isDeveloperBypassStorageEnabled()) {
          appContextLog('Developer bypass became active during member fetch; using mock data')
          setMembers(mockMembers)
          setMembersTotalCount(mockMembers.length)
          setMembersLoadedAll(true)
          markHydrated()
          if (!background) {
            setLoading(false)
          }
          return mockMembers
        }
        if (!user?.id) {
          appContextLog('No active session yet; waiting for login before loading members')
          // Leave unresolved/loading: auto re-triggers when auth resolves.
          if (!background) {
            setMemberHydrationState('LOADING')
          }
          return []
        }
        if (isAdminCodeLogin) {
          appContextLog('Admin code session active; continuing with anon Supabase read path.')
        } else {
          console.warn('No active session - user may need to log in again')
          if (!background) {
            toast.error('Session expired. Please refresh and log in again.')
          }
          // Session gone but no fresh data: keep loading state, never false-empty.
          if (!background) {
            setMemberHydrationState('LOADING')
          }
          return []
        }
      }

      // Serve from cache when fresh (reduces egress)
      const cacheKey = tableName || 'default'
      const now = Date.now()

      if (fullSnapshot) {
        appContextLog(`Querying full offline snapshot from ${tableName}`)
        const pageSize = 1000
        let from = 0
        let allData = []
        let hasMore = true

        while (hasMore) {
          let fullSnapshotQuery = applyDeletedAtFilter(applyWorkspaceOwnerFilter(supabase
            .from(tableName)
            .select('*')))
          const { data, error } = await fullSnapshotQuery.range(from, from + pageSize - 1)

          if (error) {
            console.error('Error fetching full offline member snapshot:', error)

            if (isConfirmedMissingMonthTableError(error)) {
              await handleMissingTable(tableName)
              setMembers([])
              markHydrated()
              return []
            }

            if (isBackendDegradedError(error)) {
              markBackendDegraded(error)
            }

            throw error
          }

          const page = data || []
          allData = allData.concat(page)
          hasMore = page.length === pageSize
          from += pageSize
        }

        const normalizedMembers = allData.map((member) => normalizeMemberRecord(member, {
          tableName,
          ownerId: dataOwnerId || user?.id
        }))
        setMembers(normalizedMembers)
        setMembersTotalCount(normalizedMembers.length)
        setMembersLoadedAll(true)
        markHydrated()
        membersCacheRef.current.set(cacheKey, {
          data: normalizedMembers,
          ts: now,
          totalCount: normalizedMembers.length,
          loadedAll: true
        })
        writeMemberPreviewCache(workspaceCacheScope, tableName, {
          data: normalizedMembers,
          ts: now,
          totalCount: normalizedMembers.length,
          loadedAll: true
        })
        markMemberPreviewSyncComplete(tableName, {
          cachedCount: normalizedMembers.length,
          totalCount: normalizedMembers.length,
          source: 'full-snapshot',
          lastSyncAt: new Date(now).toISOString(),
          lastRemoteUpdatedAt: normalizedMembers.reduce((latest, member) => {
            const updated = Date.parse(member.updated_at || member.updatedAt || member.inserted_at || member.created_at || '')
            if (!Number.isFinite(updated)) return latest
            return Math.max(latest, updated)
          }, 0) || new Date(now).toISOString()
        })
        appContextLog(`Successfully loaded ${normalizedMembers.length} members for offline snapshot`)
        return normalizedMembers
      }

      const cached = membersCacheRef.current.get(cacheKey)
      if (!forceRefresh && cached && (now - cached.ts) < MEMBER_PREVIEW_CACHE_TTL_MS) {
        appContextLog('Using cached members for', cacheKey)
        hydratedThisFetch = true
        return applyMemberPreviewCache(tableName, cached, { background })
      }

      const persistedCache = readMemberPreviewCache(workspaceCacheScope, tableName)
      if (!forceRefresh && persistedCache && (now - persistedCache.ts) < MEMBER_PREVIEW_CACHE_TTL_MS) {
        appContextLog('Using persisted cached members for', cacheKey)
        hydratedThisFetch = true
        return applyMemberPreviewCache(tableName, persistedCache, { background })
      }

      if (!forceRefresh) {
        const indexedMembers = await readMemberPreviewIndex(tableName)
        if (indexedMembers.length > 0) {
          appContextLog('Using IndexedDB member preview index for', cacheKey)
          const cachePayload = {
            data: indexedMembers,
            ts: now,
            totalCount: Math.max(membersTotalCount || 0, indexedMembers.length),
            loadedAll: false
          }
          setMemberPreviewSyncStatus(prev => ({
            ...prev,
            cachedCount: indexedMembers.length,
            totalCount: Math.max(prev.totalCount || 0, cachePayload.totalCount),
            source: 'indexeddb'
          }))
          applyMemberPreviewCache(tableName, cachePayload, { background })
          hydratedThisFetch = true
          startMemberPreviewBackgroundSync(tableName, {
            existingMembers: indexedMembers,
            silent: true
          })
          return indexedMembers
        }
      }

      appContextLog(`Querying first ${MEMBER_PREVIEW_PAGE_SIZE} members from ${tableName} with session user: ${session?.user?.id || user?.id || 'admin-code'}`)
      const { data, error, count } = await runScopedRequest(
        `${workspaceCacheScope}:${tableName}`,
        'member-first-page',
        () => fetchMemberPreviewPage(tableName, 0),
        { force: forceRefresh }
      )

      appContextLog(`Query result: ${data?.length || 0} rows, error: ${error?.message || 'none'}`)

      if (error) {
        console.error('Error fetching members:', error)
        appContextLog('Error details:', error.message, error.code)

        if (isConfirmedMissingMonthTableError(error)) {
          await handleMissingTable(tableName)
          setMembers([])
          markHydrated()
          return
        }

        if (isBackendDegradedError(error)) {
          markBackendDegraded(error)
        }

        if (isTransientSupabaseError(error) || !isBrowserOnline()) {
          const snapshotRecord = await getOfflineSnapshot().catch(() => null)
          if (snapshotRecord && applyOfflineSnapshot(snapshotRecord)) {
            markHydrated()
            setOfflineStatusMessage('Offline Mode - using saved local data.')
            return filterDeletedMembers(snapshotRecord?.snapshot?.members || [])
          }
        }

        if (!background) {
          toast.error(`Database error: ${error.message}`, { autoClose: 10000 })
        }
        console.warn('Fetch members failed; preserving current member list.')
      } else {
        // Keep members even without names - don't filter them out as that could cause members to disappear
        // The normalizeMemberRecord function will handle setting a default name if needed
        const normalizedMembers = (data || []).map((member) => normalizeMemberRecord(member, {
          tableName,
          ownerId: dataOwnerId || user?.id
        }))
        const totalCount = count ?? normalizedMembers.length
        const loadedAll = normalizedMembers.length >= totalCount || normalizedMembers.length < MEMBER_PREVIEW_PAGE_SIZE
        const cachePayload = { data: normalizedMembers, ts: now, totalCount, loadedAll }
        setMembers(prev => mergeMemberPreviewPages(prev, normalizedMembers))
        setMembersTotalCount(totalCount)
        setMembersLoadedAll(loadedAll)
        markHydrated()
        membersCacheRef.current.set(cacheKey, cachePayload)
        writeMemberPreviewCache(workspaceCacheScope, tableName, cachePayload)
        markMemberPreviewSyncComplete(tableName, {
          cachedCount: normalizedMembers.length,
          totalCount,
          source: 'first-page',
          lastSyncAt: new Date(now).toISOString(),
          lastRemoteUpdatedAt: normalizedMembers.reduce((latest, member) => {
            const updated = Date.parse(member.updated_at || member.updatedAt || member.inserted_at || member.created_at || '')
            if (!Number.isFinite(updated)) return latest
            return Math.max(latest, updated)
          }, 0) || new Date(now).toISOString()
        })
        persistMemberPreviewIndex(tableName, normalizedMembers, {
          cachedCount: normalizedMembers.length,
          totalCount,
          source: 'first-page'
        })
        if (!loadedAll) {
          startMemberPreviewBackgroundSync(tableName, {
            existingMembers: normalizedMembers,
            totalCount,
            silent: true,
            force: forceRefresh
          })
        }
        appContextLog(`Successfully loaded ${normalizedMembers.length} members from ${tableName}`)
        appContextLog('First few members:', normalizedMembers.slice(0, 3))
        appContextLog('Sample member structure:', normalizedMembers[0])
        // Removed automatic toast notification on page load
        return normalizedMembers
      }
    } catch (error) {
      console.error('Unexpected error in fetchMembers:', error)
      if (isTransientSupabaseError(error) || !isBrowserOnline()) {
        const snapshotRecord = await getOfflineSnapshot().catch(() => null)
        if (snapshotRecord && applyOfflineSnapshot(snapshotRecord)) {
          markHydrated()
          setOfflineStatusMessage('Offline Mode - using saved local data.')
          return filterDeletedMembers(snapshotRecord?.snapshot?.members || [])
        }
      }
      appContextLog('Preserving current members after unexpected fetch error')
      if (!background) {
        toast.error(`Unable to refresh saved data: ${error.message || 'unknown error'}`, { autoClose: 10000 })
      }
    } finally {
      // Only clear the loading state if this call produced usable data (authoritative
      // load or existing members). A transient error with nothing to show keeps the
      // dashboard in its loading/skeleton state — never a false "No members yet".
      if (!background && (hydratedThisFetch || (members && members.length > 0))) {
        setLoading(false)
      }
    }
  }

  // Reconcile the displayed member count against the authoritative server count
  // when we served a cached "loadedAll" preview. The persisted cache can drift from
  // the DB (e.g. soft-deletes that predate the incremental sync window), so on a
  // foreground load we confirm the count and, if it no longer matches the cache,
  // rebuild the data from the authoritative active rows so data + count converge.
  const reconcileAuthoritativeCount = useCallback(async (tableName = currentTable) => {
    if (!tableName || isDeveloperBypass || !isSupabaseConfigured() || shouldUseOfflineData) return
    if (!isBackendHealthy()) return
    if (offlineMode === 'online' && !isOnline) return
    // Per-table single-flight: a provisional-month reconcile must not block the
    // real (resolved) month's reconcile.
    if (memberCountReconcileInFlightRef.current === tableName) return
    memberCountReconcileInFlightRef.current = tableName
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      let query = supabase
        .from(tableName)
        .select('id', { count: 'exact', head: true })
      query = applyWorkspaceOwnerFilter(applyDeletedAtFilter(query))
      const { count, error } = await query
      if (error) {
        appContextLog('Authoritative count query failed, skipping reconcile:', error?.message)
        return
      }
      if (!Number.isFinite(count)) return
      const cached = membersCacheRef.current.get(tableName) || readMemberPreviewCache(workspaceCacheScope, tableName)
      const cachedTotalCount = cached?.totalCount
      // Only reconcile when we actually served a fully-loaded cache whose total no
      // longer matches the server. First-page/snapshot loads carry fresh counts.
      if (cachedTotalCount != null && cachedTotalCount !== count) {
        appContextLog(`Reconciling stale member count for ${tableName}: cache ${cachedTotalCount} -> server ${count}`)
        await fetchMembers(tableName, { fullSnapshot: true, background: true })
      }
    } catch (error) {
      appContextLog('Member count reconciliation failed:', error?.message)
    } finally {
      if (memberCountReconcileInFlightRef.current === tableName) {
        memberCountReconcileInFlightRef.current = null
      }
    }
  }, [currentTable, isDeveloperBypass, isSupabaseConfigured, shouldUseOfflineData, isBackendHealthy, offlineMode, isOnline, supabase, applyWorkspaceOwnerFilter, applyDeletedAtFilter, membersCacheRef, workspaceCacheScope, fetchMembers, readMemberPreviewCache, appContextLog])

  const fetchMoreMembers = async (tableName = currentTable, options = {}) => {
    const { forceOnline = false } = options
    if (!tableName || membersLoadedAll || shouldUseOfflineData || isDeveloperBypassActive || isDeveloperBypassStorageEnabled() || !isSupabaseConfigured()) {
      return members
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        if (isDeveloperBypassStorageEnabled()) {
          return members
        }
        if (!user?.id) {
          return members
        }
        toast.error('Session expired. Please refresh and log in again.')
        return members
      }

      const offset = members.length
      const { data, error, count } = await fetchMemberPreviewPage(tableName, offset)
      if (error) throw error

      const normalizedPage = (data || []).map(normalizeMemberRecord)
      const mergedMembers = mergeMemberPreviewPages(members, normalizedPage)
      const totalCount = count ?? membersTotalCount ?? mergedMembers.length
      const loadedAll =
        mergedMembers.length >= totalCount ||
        normalizedPage.length < MEMBER_PREVIEW_PAGE_SIZE
      const cachePayload = {
        data: mergedMembers,
        ts: Date.now(),
        totalCount,
        loadedAll
      }

      setMembers(mergedMembers)
      setMembersTotalCount(totalCount)
      setMembersLoadedAll(loadedAll)
      membersCacheRef.current.set(tableName || 'default', cachePayload)
      writeMemberPreviewCache(workspaceCacheScope, tableName, cachePayload)
      markMemberPreviewSyncComplete(tableName, {
        cachedCount: mergedMembers.length,
        totalCount,
        source: 'load-more',
        lastSyncAt: new Date().toISOString(),
        lastRemoteUpdatedAt: normalizedPage.reduce((latest, member) => {
          const updated = Date.parse(member.updated_at || member.updatedAt || member.inserted_at || member.created_at || '')
          if (!Number.isFinite(updated)) return latest
          return Math.max(latest, updated)
        }, 0) || new Date().toISOString()
      })
      persistMemberPreviewIndex(tableName, normalizedPage, {
        cachedCount: mergedMembers.length,
        totalCount,
        source: 'load-more'
      })
      return mergedMembers
    } catch (error) {
      console.error('Error loading more members:', error)
      if (!forceOnline && (isTransientSupabaseError(error) || !isBrowserOnline())) {
        const cached = readMemberPreviewCache(workspaceCacheScope, tableName)
        if (cached) {
          return applyMemberPreviewCache(tableName, cached, { background: true })
        }
      }
      toast.error('Could not load more members right now.')
      return members
    }
  }

  // Add new member to current monthly table
  const addMember = async (memberData) => {
    let transformedDataForQueue = null
    try {
      if (isDeveloperBypass || !isSupabaseConfigured()) {
        // Demo mode - add to local state
        const newMember = {
          id: Date.now().toString(),
          'Full Name': memberData.full_name || memberData.fullName || memberData['Full Name'],
          'Gender': memberData.gender || memberData['Gender'],
          'Phone Number': memberData.phone_number || memberData.phoneNumber || memberData['Phone Number'],
          'Age': memberData.age || memberData['Age'],
          date_of_birth: memberData.date_of_birth || memberData['date_of_birth'] || null,
          'Current Level': memberData.current_level || memberData.currentLevel || memberData['Current Level'],
          notes: memberData.notes || null,
          is_visitor: Boolean(memberData.is_visitor),
          parent_name_1: memberData.parent_name_1 || null,
          parent_phone_1: memberData.parent_phone_1 || null,
          parent_name_2: memberData.parent_name_2 || null,
          parent_phone_2: memberData.parent_phone_2 || null,
          'Member Status': 'New', // Default status for new members
          'Badge Type': 'newcomer', // Default badge
          'Join Date': new Date().toISOString().split('T')[0], // Join date
          'Manual Badge': null, // For manually assigned badges
          inserted_at: new Date().toISOString()
        }
        setMembers(prev => [newMember, ...prev])
        searchCacheRef.current.clear()
        await persistMemberPreviewIndex(currentTable, [newMember], {
          cachedCount: members.length + 1,
          totalCount: Math.max((membersTotalCount || members.length) + 1, members.length + 1),
          source: 'add'
        })
        markMemberPreviewSyncComplete(currentTable, {
          cachedCount: members.length + 1,
          totalCount: Math.max((membersTotalCount || members.length) + 1, members.length + 1),
          source: 'add',
          lastSyncAt: new Date().toISOString()
        })
        recordRecentMemberEdit(newMember, new Date().toISOString(), {
          action: 'add',
          summary: 'Added member',
          table: currentTable
        })
        refreshSearch()
        toast.success('Member added')
        // Return the created member object directly for downstream usage
        return newMember
      }

      // Transform data to match monthly table structure
      const workspaceName = authContext?.preferences?.workspace_name || null
      const localId = makeLocalUuid()
      const transformedData = buildMemberTableRow(memberData, {
        id: localId,
        workspaceName,
        userId: user?.id,
        workspaceOwnerId: dataOwnerId || user?.id
      })
      transformedDataForQueue = transformedData


      if (shouldUseOfflineData || !isBrowserOnline()) {
        const createdAt = new Date().toISOString()
        const createdMember = normalizeMemberRecord({
          ...transformedData,
          inserted_at: createdAt,
          created_at: createdAt,
          updated_at: createdAt,
          __offline_status: 'pending_add'
        })

        setMembers(prev => [createdMember, ...prev.filter(existing => existing.id !== createdMember.id)])
        invalidateMembersCacheRefs(membersCacheRef, searchCacheRef, currentTable)
        await persistMemberPreviewIndex(currentTable, [createdMember], {
          cachedCount: members.length + 1,
          totalCount: Math.max((membersTotalCount || members.length) + 1, members.length + 1),
          source: 'offline-add'
        })
        await queueOfflineChange({
          local_change_id: `member_add_${createdMember.id}`,
          action_type: 'member_add',
          table_name: currentTable,
          member_id: createdMember.id,
          member_data: createdMember,
          created_at: createdAt,
          sync_status: 'pending'
        })
        await refreshOfflineStatus()
        recordRecentMemberEdit(createdMember, createdAt, {
          action: 'add',
          summary: 'Added member offline',
          table: currentTable
        })
        refreshSearch()
        setOfflineStatusMessage('Member saved offline and will sync automatically.')
        if (shouldShowOfflineSaveNotice(pendingSyncCount + 1)) {
          notify.sync('Member saved offline and will sync automatically.', {
            title: 'Saved to pending sync',
            toastId: 'offline-save-threshold'
          })
        }
        return createdMember
      }

      const { data } = await executeSupabaseWrite(
        () => supabase
          .from(currentTable)
          .insert([transformedData])
          .select(),
        { action: `Add member to ${currentTable}` }
      )

      const createdMember = normalizeMemberRecord(data?.[0] || null)
      if (!createdMember) {
        throw new Error('Member was saved but no record was returned from Supabase')
      }

      // A confirmed member is not a completed create until its authoritative
      // workspace assignment is available. Keep the member if allocation is
      // temporarily unavailable, but place it on the deduplicated recovery
      // queue rather than requiring a search, edit, or full refresh.
      let confirmedCode = null
      try {
        confirmedCode = await ensureMemberCodeAssignment(createdMember)
      } catch (codeError) {
        console.warn('Member saved; code recovery queued:', codeError)
      }
      const memberWithCode = {
        ...createdMember,
        member_code: confirmedCode?.current_code || createdMember.member_code || null,
        __member_code_status: confirmedCode ? 'confirmed' : 'recovering'
      }

      searchCacheRef.current.clear()
      setMembers(prev => {
        const nextMembers = [memberWithCode, ...prev.filter(existing => existing.id !== memberWithCode.id)]
        persistLoadedMemberPreview(currentTable, nextMembers, {
          totalCount: Math.max((membersTotalCount || prev.length) + 1, nextMembers.length),
          loadedAll: membersLoadedAll
        })
        return nextMembers
      })
      await persistMemberPreviewIndex(currentTable, [memberWithCode], {
        cachedCount: members.length + 1,
        totalCount: Math.max((membersTotalCount || members.length) + 1, members.length + 1),
        source: 'add'
      })
      markMemberPreviewSyncComplete(currentTable, {
        cachedCount: members.length + 1,
        totalCount: Math.max((membersTotalCount || members.length) + 1, members.length + 1),
        source: 'add',
        lastSyncAt: new Date().toISOString()
      })
      recordRecentMemberEdit(memberWithCode, new Date().toISOString(), {
        action: 'add',
        summary: 'Added member',
        table: currentTable
      })
      refreshSearch()
      toast.success('Member added')

      // Log the action
      logActivity('ADD_MEMBER', `Added new member: ${memberData.full_name || memberData.fullName || memberData['Full Name']}`)

      // Return the created member row directly
      return {
        ...memberWithCode
      }
    } catch (error) {
      console.error('Error adding member:', error)
      if (transformedDataForQueue && (isTransientSupabaseError(error) || !isBrowserOnline())) {
        const createdAt = new Date().toISOString()
        const createdMember = normalizeMemberRecord({
          ...transformedDataForQueue,
          inserted_at: createdAt,
          created_at: createdAt,
          updated_at: createdAt,
          __offline_status: 'pending_add'
        })
        setMembers(prev => [createdMember, ...prev.filter(existing => existing.id !== createdMember.id)])
        invalidateMembersCacheRefs(membersCacheRef, searchCacheRef, currentTable)
        await persistMemberPreviewIndex(currentTable, [createdMember], {
          cachedCount: members.length + 1,
          totalCount: Math.max((membersTotalCount || members.length) + 1, members.length + 1),
          source: 'network-fallback-add'
        })
        await queueOfflineChange({
          local_change_id: `member_add_${createdMember.id}`,
          action_type: 'member_add',
          table_name: currentTable,
          member_id: createdMember.id,
          member_data: createdMember,
          created_at: createdAt,
          sync_status: 'pending'
        })
        await refreshOfflineStatus()
        recordRecentMemberEdit(createdMember, createdAt, {
          action: 'add',
          summary: 'Added member while connection was unavailable',
          table: currentTable
        })
        refreshSearch()
        notify.sync('Member saved on this device and will sync automatically.', {
          title: 'Saved offline'
        })
        return createdMember
      }
      toast.error('Failed to add member')
      // Propagate error; callers can catch
      throw error
    }
  }

  // Attendance columns are deterministic. Runtime reads must never query schema
  // metadata before loading normal member or attendance data.
  const getAttendanceColumns = useCallback(async () => {
    return getAttendanceColumnsForMonthTable(currentTable)
  }, [currentTable])

  // Get available attendance dates for the current table
  const getAvailableAttendanceDates = async () => {
    try {
      return (await getAttendanceColumns())
        .map((column) => Number(column.column_name.slice(-2)))
        .filter(Number.isFinite)
    } catch (error) {
      console.error('Error getting available attendance dates:', error)
      return []
    }
  }

  // Helper function to get all Sundays in a month
  const getSundaysInMonth = useCallback((monthName, year) => {
    const monthIndex = MONTHS_IN_YEAR.indexOf(monthName)

    if (monthIndex === -1) {
      throw new Error(`Invalid month name: ${monthName}`)
    }

    return getSundaysForMonth(monthIndex, year)
  }, [])

  // Get available Sunday dates for the current table
  // Shows ALL Sundays in the selected month so users can mark attendance for any Sunday
  const getAvailableSundayDates = async () => {
    try {
      // Parse the current table to get month and year
      const [monthName, year] = currentTable.split('_')
      const yearNum = parseInt(year)
      const monthIndex = MONTHS_IN_YEAR.indexOf(monthName)

      if (!monthName || monthIndex < 0 || isNaN(yearNum)) {
        console.error('Invalid table format:', currentTable)
        return []
      }

      // Return all Sundays in the month - attendance columns will be created as needed
      const allSundays = getSundaysInMonth(monthName, yearNum)
      appContextLog(`Found ${allSundays.length} Sundays in ${monthName} ${yearNum}:`, allSundays.map(d => d.getDate()))
      if (isCollaborator) {
        const stickyForMonth = ownerStickySundays
          .filter((dateStr) => {
            const [y, m] = dateStr.split('-').map(Number)
            return y === yearNum && m === monthIndex + 1
          })
          .map((dateStr) => {
            const [y, m, d] = dateStr.split('-').map(Number)
            return new Date(y, m - 1, d)
          })
          .filter((dateObj) => dateObj.getDay() === 0)
          .sort((a, b) => a.getTime() - b.getTime())
        if (stickyForMonth.length > 0) {
          return stickyForMonth
        }
      }

      return allSundays
    } catch (error) {
      console.error('Error getting available Sunday dates:', error)
      return []
    }
  }

  // Initialize available Sunday dates and set default selected date
  const initializeAttendanceDates = async () => {
    const sundays = await getAvailableSundayDates()
    setAvailableSundayDates(sundays)

    if (sundays.length > 0) {
      suppressDateBroadcastRef.current = true

      if (isPersonalManualMode && manualMonthTable === currentTable) {
        const manualDateKey = manualSundayDate ? getLocalDateString(manualSundayDate) : null
        const matchingManualDate = manualDateKey
          ? sundays.find((sunday) => getLocalDateString(sunday) === manualDateKey)
          : null

        if (matchingManualDate) {
          setAndSaveAttendanceDate(matchingManualDate, currentTable)
          setTimeout(() => { suppressDateBroadcastRef.current = false }, 300)
          return
        }
      }

      // Sunday-only mode: default to the active Sunday for this month.
      const autoSunday = getSundayDefaultForTable(currentTable, new Date())
      if (autoSunday) {
        setAndSaveAttendanceDate(autoSunday)
        setTimeout(() => { suppressDateBroadcastRef.current = false }, 300)
        return
      }

      // Fallback to a stored Sunday only if it still exists in this month.
      const savedDateKey = `selectedAttendanceDate_${currentTable}`
      const savedDate = localStorage.getItem(savedDateKey)
      if (savedDate) {
        const savedDateTime = new Date(savedDate)
        const matchingDate = sundays.find(sunday => (
          sunday.getFullYear() === savedDateTime.getFullYear() &&
          sunday.getMonth() === savedDateTime.getMonth() &&
          sunday.getDate() === savedDateTime.getDate()
        ))

        if (matchingDate) {
          setAndSaveAttendanceDate(matchingDate)
          setTimeout(() => { suppressDateBroadcastRef.current = false }, 300)
          return
        }
      }

      setAndSaveAttendanceDate(sundays[0])
      setTimeout(() => { suppressDateBroadcastRef.current = false }, 300)
    }
  }

  // Calculate member attendance rate
  const calculateAttendanceRate = (member) => {
    // Support both OLD format (Attendance 7th) and NEW format (attendance_2025_12_07)
    const attendanceColumns = Object.keys(member).filter(key => {
      const keyLower = key.toLowerCase()
      const hasValue = member[key] !== null && member[key] !== undefined
      // OLD format: Attendance 7th, Attendance 14th
      const isOldFormat = key.startsWith('Attendance ') && hasValue
      // NEW format: attendance_2025_12_07
      const isNewFormat = /^attendance_\d{4}_\d{2}_\d{2}$/.test(keyLower) && hasValue
      return isOldFormat || isNewFormat
    })

    if (attendanceColumns.length === 0) return 0

    const presentCount = attendanceColumns.filter(col =>
      member[col] === 'Present' || member[col] === true
    ).length

    return Math.round((presentCount / attendanceColumns.length) * 100)
  }

  // Calculate member badge based on attendance and join date
  const calculateMemberBadge = (member) => {
    const joinDate = new Date(member['Join Date'] || member.inserted_at)
    const now = new Date()
    const daysSinceJoin = Math.floor((now - joinDate) / (1000 * 60 * 60 * 24))
    const attendanceRate = calculateAttendanceRate(member)

    // Check for manual badge first
    if (member['Manual Badge']) {
      return member['Manual Badge']
    }

    // New member (less than 30 days)
    if (daysSinceJoin < 30) {
      return 'newcomer'
    }

    // Regular member badges based on attendance
    if (attendanceRate >= 75) {
      return 'regular'
    } else if (attendanceRate >= 50) {
      return 'member'
    } else {
      return 'newcomer'
    }
  }

  // Update member badges for all members
  const updateMemberBadges = () => {
    setMembers(prev => prev.map(member => ({
      ...member,
      // Only update Badge Type if there's no Manual Badge assigned
      'Badge Type': member['Manual Badge'] || calculateMemberBadge(member),
      'Attendance Rate': calculateAttendanceRate(member)
    })))
  }

  // Toggle badge for member (supports multiple badges) - similar to attendance toggle
  const toggleMemberBadge = async (memberId, badgeType, options = {}) => {
    try {
      const { suppressToast = false } = options
      console.log('Supabase configured:', isSupabaseConfigured())
      console.log('Current table:', currentTable)

      // Find the member and log their current badge status
      const member = members.find(m => m.id === memberId)
      const memberName = member ? (member['Full Name'] || member['full_name']) : 'Member'

      if (!isSupabaseConfigured()) {
        // Demo mode - update local state
        setMembers(prev => prev.map(member => {
          if (member.id === memberId) {
            const currentBadges = member['Manual Badges'] || []
            let updatedBadges

            if (currentBadges.includes(badgeType)) {
              // Remove badge if already selected
              updatedBadges = currentBadges.filter(badge => badge !== badgeType)
            } else {
              // Add badge if not selected
              updatedBadges = [...currentBadges, badgeType]
            }

            const updatedMember = { ...member, 'Manual Badges': updatedBadges }
            return updatedMember
          }
          return member
        }))
        return { success: true }
      }

      // For Supabase, handle individual badge toggling like attendance
      const targetMember = members.find(m => m.id === memberId)

      // Check current badge status - this determines if we're turning ON or OFF
      const currentlyHasBadge = memberHasBadge(targetMember, badgeType)
      console.log(`Current badge status for ${badgeType}:`, currentlyHasBadge)

      // Prepare update object - toggle the badge state
      const updateData = {}

      // Update the specific badge column (toggle: if has badge, remove it; if doesn't have badge, add it)
      if (badgeType === 'member') {
        updateData.Member = currentlyHasBadge ? null : 'Yes'
      } else if (badgeType === 'regular') {
        updateData.Regular = currentlyHasBadge ? null : 'Yes'
      } else if (badgeType === 'newcomer') {
        updateData.Newcomer = currentlyHasBadge ? null : 'Yes'
      }

      console.log('Update data:', updateData)

      if (shouldUseOfflineData || !isBrowserOnline()) {
        setMembers(prev => prev.map(member => {
          if (member.id !== memberId) return member
          return {
            ...member,
            ...updateData,
            __offline_status: 'pending_update',
            updated_at: new Date().toISOString()
          }
        }))
        invalidateMembersCacheRefs(membersCacheRef, searchCacheRef, currentTable)
        await queueOfflineChange({
          local_change_id: `member_update_${currentTable}_${memberId}`,
          action_type: 'member_update',
          table_name: currentTable,
          member_id: memberId,
          updates: updateData,
          base_updated_at: targetMember?.updated_at || targetMember?.UpdatedAt || targetMember?.inserted_at || null,
          created_at: new Date().toISOString(),
          sync_status: 'pending'
        })
        await refreshOfflineStatus()
        if (!suppressToast && shouldShowOfflineSaveNotice(pendingSyncCount + 1)) {
          notify.sync('Badge change saved offline and will sync automatically.', {
            title: 'Saved to pending sync',
            toastId: 'offline-save-threshold'
          })
        }
        return { success: true, offline: true }
      }

      const { data } = await executeSupabaseWrite(
        () => supabase
          .from(currentTable)
          .update(updateData)
          .eq('id', memberId)
          .select(),
        { action: `Update ${badgeType} badge in ${currentTable}` }
      )

      console.log('Supabase update result:', { data, error: null })

      // Update local state to reflect the change
      setMembers(prev => prev.map(member => {
        if (member.id === memberId) {
          const updatedMember = { ...member }

          // Update the specific badge column in local state
          if (badgeType === 'member') {
            updatedMember.Member = currentlyHasBadge ? null : 'Yes'
          } else if (badgeType === 'regular') {
            updatedMember.Regular = currentlyHasBadge ? null : 'Yes'
          } else if (badgeType === 'newcomer') {
            updatedMember.Newcomer = currentlyHasBadge ? null : 'Yes'
          }

          return updatedMember
        }
        return member
      }))

      invalidateMembersCacheRefs(membersCacheRef, searchCacheRef, currentTable)

      // Show success message like attendance system (unless suppressed)
      if (!suppressToast) {
        if (currentlyHasBadge) {
          toast.success(`${badgeType.charAt(0).toUpperCase() + badgeType.slice(1)} badge removed for: ${memberName}`, {
            style: {
              background: '#f3f4f6',
              color: '#374151'
            }
          })
        } else {
          toast.success(`${badgeType.charAt(0).toUpperCase() + badgeType.slice(1)} badge assigned to: ${memberName}`, {
            style: {
              background: '#10b981',
              color: '#ffffff'
            }
          })
        }
      }

      // Log the action
      logActivity(
        currentlyHasBadge ? 'REMOVE_BADGE' : 'ASSIGN_BADGE',
        `${currentlyHasBadge ? 'Removed' : 'Assigned'} ${badgeType} badge for ${memberName}`
      )

      return { success: true }
    } catch (error) {
      console.error('Error toggling badge:', error)
      toast.error('Failed to update badge. Please try again.')
      throw error
    }
  }

  const findAttendanceColumnForDate = async (date) => getAttendanceColumnNameForDate(date)

  const getAttendanceColumnsForTable = useCallback(async (tableName) => {
    return getAttendanceColumnsForMonthTable(tableName)
  }, [])

  const findAttendanceColumnForDateInTable = useCallback(async (date) => (
    getAttendanceColumnNameForDate(date)
  ), [])

  // Check if attendance column exists in the current table
  const checkAttendanceColumnExists = async (attendanceColumn) => {
    return /^attendance_\d{4}_\d{2}_\d{2}$/.test(String(attendanceColumn || '').toLowerCase())
  }

  // Create attendance column for a specific date if it doesn't exist
  const createAttendanceColumn = async (date) => {
    try {
      if (!isSupabaseConfigured()) return { success: true }

      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')

      // New format: attendance_2025_12_07
      const columnName = `attendance_${year}_${month}_${day}`

      console.log(`Creating attendance column: ${columnName} in table ${currentTable}`)

      // Use Supabase RPC to add the column (requires a DB function)
      // For now, we'll use a direct SQL approach via rpc
      const { data, error } = await supabase.rpc('add_attendance_column', {
        table_name: currentTable,
        column_name: columnName
      })

      if (error) {
        console.error('Error creating attendance column:', error)
        // If the RPC doesn't exist, provide helpful error message
        if (error.message?.includes('function') || error.code === '42883') {
          toast.error('Please create the add_attendance_column function in Supabase. See documentation.', {
            toastId: `attendance-column-${currentTable}-${columnName}`
          })
        }
        throw error
      }

      console.log(`Successfully created column: ${columnName}`)
      return { success: true, columnName }
    } catch (error) {
      console.error('Failed to create attendance column:', error)
      return { success: false, error }
    }
  }

  const syncNormalizedAttendanceRecord = async (memberId, effectiveDate, present) => {
    if (isDeveloperBypass || !isSupabaseConfigured() || !supabase) return
    if (normalizedAttendanceBackendAvailableRef.current === false) return

    const ownerId = dataOwnerId || user?.id
    if (!ownerId || !memberId || !effectiveDate) return

    const status = present === null ? 'unknown' : present ? 'present' : 'absent'
    const member = members.find(m => m.id === memberId)

    if (member) {
      try {
        const fullName = member.full_name || member['Full Name'] || member.name || 'Unknown'
        const { error: memberSyncError } = await supabase.rpc('upsert_follow_up_member', {
          p_owner_id: ownerId,
          p_member_id: memberId,
          p_full_name: fullName,
          p_phone_number: member.phone_number || member['Phone Number'] || member.phone || null,
          p_parent_phone_number: member.parent_phone_number || member['Parent Phone Number'] || null,
          p_age_group: member.age_group || member['Age Group'] || member.current_level || member['Current Level'] || null,
          p_gender: member.gender || member.Gender || null,
          p_ministry_group: member.ministry_group || member['Ministry Group'] || null,
          p_created_at: member.created_at || member.inserted_at || null
        })

        if (memberSyncError) throw memberSyncError
      } catch (memberSyncError) {
        const message = memberSyncError?.message || ''
        const missingMemberSync =
          memberSyncError?.code === '42883' ||
          memberSyncError?.code === '42P01' ||
          message.includes('upsert_follow_up_member') ||
          message.includes('members')

        if (!missingMemberSync) {
          console.warn('Normalized member sync failed, continuing attendance sync:', memberSyncError)
        } else {
          normalizedAttendanceBackendAvailableRef.current = false
          return
        }
      }
    }

    try {
      const { error } = await supabase.rpc('upsert_attendance_record', {
        p_owner_id: ownerId,
        p_service_date: getLocalDateString(effectiveDate),
        p_member_id: memberId,
        p_status: status,
        p_marked_by: user?.id || null,
        p_title: 'Sunday Service'
      })

      if (error) throw error
      normalizedAttendanceBackendAvailableRef.current = true
    } catch (error) {
      const message = error?.message || ''
      const missingBackend =
        error?.code === '42883' ||
        error?.code === '42P01' ||
        message.includes('upsert_attendance_record') ||
        message.includes('upsert_follow_up_member') ||
        message.includes('attendance_sessions') ||
        message.includes('attendance_records')

      if (missingBackend) {
        normalizedAttendanceBackendAvailableRef.current = false
        console.info('Attendance follow-up backend migration has not been applied yet; monthly attendance was still saved.')
      } else {
        console.warn('Monthly attendance saved, but normalized follow-up sync failed:', error)
      }
    }
  }

  const applyLocalAttendanceState = useCallback((memberIds, effectiveDate, present, attendanceColumn) => {
    const ids = Array.isArray(memberIds) ? memberIds : [memberIds]
    const dateKey = getLocalDateString(effectiveDate)
    const columnName = attendanceColumn || getAttendanceColumnNameForDate(effectiveDate)
    const attendanceValue = present === null ? null : (present ? 'Present' : 'Absent')
    const idSet = new Set(ids.map((id) => String(id)))
    attendanceSnapshotVersionRef.current.markLocalChange(currentTable, dateKey)

    setMembers((prev) => prev.map((member) =>
      idSet.has(String(member.id))
        ? { ...member, [columnName]: attendanceValue }
        : member
    ))

    setAttendanceData((prev) => {
      const dateAttendance = { ...(prev[dateKey] || {}) }
      ids.forEach((id) => {
        const canonicalId = String(id)
        if (present === null) {
          delete dateAttendance[canonicalId]
        } else {
          dateAttendance[canonicalId] = present
        }
      })

      const next = {
        ...prev,
        [dateKey]: dateAttendance
      }
      attendanceDataRef.current = next
      return next
    })
  }, [currentTable])

  const rollbackLocalAttendanceState = useCallback((memberIds, effectiveDate, previousState = {}) => {
    const ids = Array.isArray(memberIds) ? memberIds : [memberIds]
    const dateKey = getLocalDateString(effectiveDate)
    const previousById = previousState.byId || {}
    const idSet = new Set(ids.map((id) => String(id)))
    attendanceSnapshotVersionRef.current.markLocalChange(currentTable, dateKey)

    setMembers((prev) => prev.map((member) => {
      if (!idSet.has(String(member.id))) return member
      const previous = previousById[member.id] || previousById[String(member.id)]
      if (!previous?.columnName) return member

      if (previous.hadColumn) {
        return { ...member, [previous.columnName]: previous.columnValue }
      }

      const { [previous.columnName]: _removed, ...rest } = member
      return rest
    }))

    setAttendanceData((prev) => {
      const dateAttendance = { ...(prev[dateKey] || {}) }
      ids.forEach((id) => {
        const canonicalId = String(id)
        const previous = previousById[id] || previousById[canonicalId]
        if (!previous) return
        if (previous.hadAttendanceKey) {
          dateAttendance[canonicalId] = previous.attendanceValue
        } else {
          delete dateAttendance[canonicalId]
        }
      })

      return {
        ...prev,
        [dateKey]: dateAttendance
      }
    })
  }, [currentTable])

  const applyAttendanceColumnsFromMemberRows = useCallback((rows = [], tableName = currentTable) => {
    if (!Array.isArray(rows) || rows.length === 0) return
    setAttendanceData((prev) => {
      const next = { ...prev }
      rows.forEach((row) => {
        if (!row?.id) return
        Object.entries(row).forEach(([key, value]) => {
          const dateKey = resolveAttendanceDateKeyFromColumn(key, tableName)
          if (!dateKey) return
          if (value === 'Present' || value === true) {
            next[dateKey] = { ...(next[dateKey] || {}), [row.id]: true }
          } else if (value === 'Absent' || value === false) {
            next[dateKey] = { ...(next[dateKey] || {}), [row.id]: false }
          } else if (next[dateKey]) {
            const { [row.id]: _removed, ...rest } = next[dateKey]
            next[dateKey] = rest
          }
        })
      })
      return next
    })
  }, [currentTable])

  const removeMemberFromAttendanceData = useCallback((memberId) => {
    if (!memberId) return
    setAttendanceData((prev) => {
      let changed = false
      const next = {}
      Object.entries(prev || {}).forEach(([dateKey, membersForDate]) => {
        if (!membersForDate || typeof membersForDate !== 'object') {
          next[dateKey] = membersForDate
          return
        }
        if (!(memberId in membersForDate)) {
          next[dateKey] = membersForDate
          return
        }
        const { [memberId]: _removed, ...rest } = membersForDate
        next[dateKey] = rest
        changed = true
      })
      return changed ? next : prev
    })
  }, [])

  const queueOfflineAttendanceChanges = useCallback(async (
    memberIds,
    effectiveDate,
    present,
    actionType = 'attendance_mark',
    baseValues = null
  ) => {
    const ids = Array.isArray(memberIds) ? memberIds : [memberIds]
    const serviceDate = getLocalDateString(effectiveDate)
    const createdAt = new Date().toISOString()

    // One durable queue row per member/date means repeated offline taps converge
    // to the user's latest choice instead of replaying stale intermediate states.
    const pendingChanges = await getPendingOfflineChanges().catch(() => [])
    const existingById = new Map(
      pendingChanges
        .filter((change) => (
          change?.member_id &&
          change?.table_name === currentTable &&
          change?.service_date === serviceDate &&
          ['attendance_mark', 'bulk_attendance_mark'].includes(change?.action_type)
        ))
        .map((change) => [String(change.member_id), change])
    )
    const currentDateAttendance = attendanceData?.[serviceDate] || {}

    applyLocalAttendanceState(ids, effectiveDate, present)

    await Promise.all(ids.map((memberId) => {
      const existing = existingById.get(String(memberId))
      const suppliedBase = baseValues && Object.prototype.hasOwnProperty.call(baseValues, memberId)
        ? baseValues[memberId]
        : undefined
      const basePresent = existing?.has_base_value
        ? existing.base_present
        : suppliedBase !== undefined
          ? suppliedBase
          : Object.prototype.hasOwnProperty.call(currentDateAttendance, memberId)
            ? currentDateAttendance[memberId]
            : null

      return queueOfflineChange({
        local_change_id: existing?.local_change_id || `attendance_${currentTable}_${serviceDate}_${memberId}`,
        action_type: actionType,
        member_id: memberId,
        session_id: serviceDate,
        service_date: serviceDate,
        table_name: currentTable,
        attendance_status: present === null ? 'unknown' : (present ? 'present' : 'absent'),
        present,
        base_present: basePresent,
        has_base_value: true,
        timestamp: createdAt,
        created_at: existing?.created_at || createdAt,
        updated_at: createdAt,
        sync_status: 'pending'
      })
    }))

    await refreshOfflineStatus()
    setOfflineStatusMessage(`${ids.length} attendance change${ids.length === 1 ? '' : 's'} saved offline.`)
    if (shouldShowOfflineSaveNotice(pendingSyncCount + ids.length)) {
      notify.sync(`${ids.length} attendance change${ids.length === 1 ? '' : 's'} saved offline.`, {
        title: 'Saved to pending sync',
        details: 'Sync when you are back online.',
        toastId: 'offline-save-threshold'
      })
    }

    return { success: true, offline: true }
  }, [applyLocalAttendanceState, attendanceData, currentTable, pendingSyncCount, refreshOfflineStatus, shouldShowOfflineSaveNotice])

  const queueRetryableAttendanceChange = useCallback(async (memberIds, effectiveDate, present, reason, baseValues = null) => {
    const result = await queueOfflineAttendanceChanges(memberIds, effectiveDate, present, 'attendance_mark', baseValues)
    const reasonText = reason?.message || reason || 'The server did not confirm the save.'
    setOfflineStatusMessage('Attendance save is pending retry. It will sync automatically when the connection is healthy.')
    notify.sync('Attendance save is pending retry.', {
      title: 'Will retry save',
      details: reasonText,
      toastId: `attendance-retry-${getLocalDateString(effectiveDate)}`
    })
    return { ...result, queuedAfterFailure: true, error: reasonText }
  }, [queueOfflineAttendanceChanges])

  // Mark attendance for a member in monthly table
  const markAttendance = async (memberId, date, present) => {
    let optimisticApplied = false
    let optimisticRollbackState = null
    let optimisticEffectiveDate = null
    try {
      const effectiveDate = normalizeDateToSundayForTable(date, currentTable)
      if (!effectiveDate) {
        return { success: false, error: 'No valid Sunday found for this month' }
      }
      optimisticEffectiveDate = effectiveDate

      if (shouldUseOfflineData) {
        return queueOfflineAttendanceChanges(memberId, effectiveDate, present)
      }

      if (offlineMode === 'online' && !isOnline) {
        toast.warn('Online mode selected, but internet is unavailable.')
      }

      setOfflineStatusMessage('Saving attendance...')

      if (isDeveloperBypass || !isSupabaseConfigured()) {
        // Demo mode - update local state
        applyLocalAttendanceState(memberId, effectiveDate, present)
        setOfflineStatusMessage('Attendance saved.')
        return { success: true }
      }

      const optimisticColumn = getAttendanceColumnNameForDate(effectiveDate)
      const dateKey = getLocalDateString(effectiveDate)
      const previousDateAttendance = attendanceData?.[dateKey] || {}
      const previousMember = members.find((member) => String(member.id) === String(memberId)) || {}
      optimisticRollbackState = {
        byId: {
          [memberId]: {
            columnName: optimisticColumn,
            hadColumn: Object.prototype.hasOwnProperty.call(previousMember, optimisticColumn),
            columnValue: previousMember?.[optimisticColumn],
            hadAttendanceKey: Object.prototype.hasOwnProperty.call(previousDateAttendance, String(memberId)),
            attendanceValue: previousDateAttendance[String(memberId)]
          }
        }
      }
      applyLocalAttendanceState(memberId, effectiveDate, present, optimisticColumn)
      optimisticApplied = true

      let attendanceColumn = await findAttendanceColumnForDate(effectiveDate)

      // If column doesn't exist, create it
      if (!attendanceColumn) {
        console.log('Attendance column not found for date, creating it...')
        const result = await createAttendanceColumn(effectiveDate)

        if (!result.success) {
          toast.error('Failed to create attendance column for this date', {
            toastId: `attendance-column-${currentTable}-${getLocalDateString(effectiveDate)}`
          })
          throw result.error || new Error('Failed to create attendance column')
        }

        attendanceColumn = result.columnName
      }

      const attendanceUpdatedAt = new Date().toISOString()
      const canWritePreviewSyncColumns = await ensureMemberPreviewSyncColumns(currentTable)

      const identityMember = members.find((member) => String(member.id) === String(memberId)) || { id: memberId }
      const attendanceOwnerId = getMemberOwnerId(identityMember) || dataOwnerId || user?.id
      if (!attendanceOwnerId) throw new Error('Unable to determine the workspace owner for this attendance save')
      const attendanceWrite = await executeSupabaseWrite(
        () => supabase.rpc('update_member_record_resilient', {
          p_table_name: currentTable,
          p_member_id: memberId,
          p_updates: {
            [attendanceColumn]: present === null ? null : (present ? 'Present' : 'Absent'),
            ...(canWritePreviewSyncColumns ? { updated_at: attendanceUpdatedAt } : {})
          },
          p_owner_id: attendanceOwnerId,
          p_identity: buildMemberIdentityHint(identityMember)
        }),
        { action: `Save attendance in ${currentTable}` }
      )
      if (!attendanceWrite?.data?.success || !attendanceWrite?.data?.row) {
        throw new Error('Attendance save could not be verified. Please retry.')
      }
      const resolvedMemberId = attendanceWrite.data.member_id || memberId
      if (String(resolvedMemberId) !== String(memberId)) {
        const recoveredMember = normalizeMemberRecord({ ...identityMember, ...attendanceWrite.data.row, id: resolvedMemberId })
        setMembers((previous) => previous.map((member) => (
          String(member.id) === String(memberId) ? recoveredMember : member
        )))
        setAttendanceData((previous) => {
          const dateAttendance = { ...(previous[dateKey] || {}) }
          const currentValue = dateAttendance[String(memberId)]
          delete dateAttendance[String(memberId)]
          if (currentValue !== undefined) dateAttendance[String(resolvedMemberId)] = currentValue
          return { ...previous, [dateKey]: dateAttendance }
        })
      }

      // The monthly table is the source of truth. Follow-up normalization is an
      // optional secondary index and must never delay live check-in feedback.
      syncNormalizedAttendanceRecord(resolvedMemberId, effectiveDate, present).catch((error) => {
        console.warn('Background attendance follow-up sync failed:', error)
      })

      // Update local state for members and attendanceData (for real-time UI updates)
      applyLocalAttendanceState(resolvedMemberId, effectiveDate, present, attendanceColumn)

      const attendanceValue = present === null ? null : (present ? 'Present' : 'Absent')
      const updatedAttendanceMember = normalizeMemberRecord({
        ...(members.find(m => String(m.id) === String(resolvedMemberId)) || { id: resolvedMemberId }),
        [attendanceColumn]: attendanceValue,
        updated_at: attendanceUpdatedAt
      })
      applyAttendanceColumnsFromMemberRows([updatedAttendanceMember], currentTable)
      await persistMemberPreviewIndex(currentTable, [updatedAttendanceMember], {
        cachedCount: members.length,
        totalCount: membersTotalCount,
        source: 'attendance'
      })
      markMemberPreviewSyncComplete(currentTable, {
        cachedCount: members.length,
        totalCount: membersTotalCount,
        source: 'attendance',
        lastSyncAt: new Date().toISOString()
      })

      searchCacheRef.current.clear()
      const changedMember = members.find(m => String(m.id) === String(resolvedMemberId)) || { id: resolvedMemberId }
      recordRecentMemberEdit(changedMember, new Date().toISOString(), {
        action: 'attendance',
        summary: `Marked ${present === null ? 'clear' : present ? 'present' : 'absent'}`,
        dateKey: getLocalDateString(effectiveDate),
        table: currentTable
      })

      // Check if month is complete and process badges (guarded)
      if (badgeProcessingEnabled) {
        setTimeout(() => processEndOfMonthBadges(), 500)
      }

      // Log the attendance action
      const memberName = members.find(m => String(m.id) === String(resolvedMemberId))?.['full_name'] || members.find(m => String(m.id) === String(resolvedMemberId))?.['Full Name'] || 'Unknown'
      const attendanceStatus = present === null ? 'Cleared' : present ? 'Present' : 'Absent'
      logActivity('MARK_ATTENDANCE', `Marked ${memberName} as ${attendanceStatus} on ${effectiveDate.toLocaleDateString()}`)

      invalidateRequestScope(`${dataOwnerId || user?.id || 'guest'}:${currentTable}`, 'attendance-reconciliation')
      setOfflineStatusMessage('Attendance saved.')
      return { success: true }
    } catch (error) {
      console.error('Error marking attendance:', error)
      const effectiveDate = normalizeDateToSundayForTable(date, currentTable)
      if (effectiveDate && (isTransientSupabaseError(error) || !isBrowserOnline())) {
        console.warn('Attendance save failed transiently; queued for retry:', error)
        const previous = optimisticRollbackState?.byId?.[memberId]
        const baseValues = previous
          ? { [memberId]: previous.hadAttendanceKey ? previous.attendanceValue : null }
          : null
        return queueRetryableAttendanceChange(memberId, effectiveDate, present, error, baseValues)
      }
      if (optimisticApplied && optimisticEffectiveDate && optimisticRollbackState) {
        rollbackLocalAttendanceState(memberId, optimisticEffectiveDate, optimisticRollbackState)
      }
      setOfflineStatusMessage('Attendance save failed. Please retry.')
      toast.error(error?.message || 'Failed to mark attendance')
      return { success: false, error }
    }
  }

  // Check if ALL Sundays from first to last in the month are filled
  const isMonthAttendanceComplete = () => {
    if (availableSundayDates.length === 0) return false

    // Check that EVERY Sunday has attendance data for at least 1 member
    for (const sunday of availableSundayDates) {
      const dateKey = getLocalDateString(sunday)
      const attendanceForDate = attendanceData[dateKey]

      // If this Sunday has no attendance data at all, month is not complete
      if (!attendanceForDate || Object.keys(attendanceForDate).length === 0) {
        console.log(`Month not complete: Sunday ${dateKey} has no attendance data`)
        return false
      }
    }

    // All Sundays from first to last have attendance data
    console.log(`Month attendance complete: All ${availableSundayDates.length} Sundays have attendance data`)
    return true
  }

  // Check for 3 consecutive Sunday attendances for a member in current month
  const checkMemberConsecutiveAttendance = (memberId) => {
    if (availableSundayDates.length < 3) return false

    const sortedSundays = [...availableSundayDates].sort((a, b) => a - b)
    let consecutiveCount = 0

    for (const sunday of sortedSundays) {
      const dateKey = getLocalDateString(sunday)
      const memberStatus = attendanceData[dateKey]?.[memberId]

      if (memberStatus === true) {
        consecutiveCount++
        if (consecutiveCount >= 3) {
          return true // Found 3 consecutive
        }
      } else if (memberStatus === false) {
        consecutiveCount = 0 // Reset on absent
      }
      // If undefined/null, treat as absent and reset
      else {
        consecutiveCount = 0
      }
    }

    return false
  }

  // Toggleable guard to prevent runaway badge processing loops
  const badgeProcessingEnabled = false

  // Process all members at end of month and assign badges
  const processedEndOfMonthRef = useRef(new Set())
  const processEndOfMonthBadges = async () => {
    try {
      if (!badgeProcessingEnabled) return
      if (!isSupabaseConfigured()) return
      if (!isMonthAttendanceComplete()) {
        console.log('Month attendance not complete yet, skipping badge assignment')
        return
      }

      console.log('Processing end-of-month badges for', currentTable)
      let badgesAssigned = 0

      for (const member of members) {
        // Check if member has 3 consecutive Sundays
        const hasThreeConsecutive = checkMemberConsecutiveAttendance(member.id)

        if (hasThreeConsecutive) {
          // Only update if not already a regular or higher badge
          if (member['Badge Type'] !== 'regular' && member['Badge Type'] !== 'vip') {
            await updateMember(member.id, {
              'Badge Type': 'regular',
              'Member Status': 'Member'
            }, { silent: true })
            badgesAssigned++
          }
        }
        // If they don't have 3 consecutive, keep their current badge (don't downgrade)
      }

      if (badgesAssigned > 0) {
        toast.success(`End of month: ${badgesAssigned} member${badgesAssigned > 1 ? 's' : ''} earned Regular Member badge!`)
      }
      processedEndOfMonthRef.current.add(currentTable)
    } catch (error) {
      console.error('Error processing end-of-month badges:', error)
    }
  }

  // Bulk attendance marking for monthly table
  const bulkAttendance = async (memberIds, date, present) => {
    let rollbackState = null
    let rollbackDate = null
    let shouldRollback = true
    const uniqueMemberIds = Array.from(new Set((Array.isArray(memberIds) ? memberIds : [memberIds])
      .filter((memberId) => memberId !== null && memberId !== undefined && memberId !== '')))
    try {
      if (uniqueMemberIds.length === 0) {
        return { success: true, updated: 0 }
      }

      const effectiveDate = normalizeDateToSundayForTable(date, currentTable)
      if (!effectiveDate) {
        return { success: false, error: 'No valid Sunday found for this month' }
      }

      if (shouldUseOfflineData) {
        return queueOfflineAttendanceChanges(uniqueMemberIds, effectiveDate, present, 'bulk_attendance_mark')
      }

      if (offlineMode === 'online' && !isOnline) {
        toast.warn('Online mode selected, but internet is unavailable.')
      }

      if (!isSupabaseConfigured()) {
        // Demo mode - update local state
        applyLocalAttendanceState(uniqueMemberIds, effectiveDate, present)
        toast.success('Bulk attendance marked! (Demo Mode)')
        return { success: true, updated: uniqueMemberIds.length }
      }

      rollbackDate = effectiveDate
      const optimisticColumn = getAttendanceColumnNameForDate(effectiveDate)
      const dateKey = getLocalDateString(effectiveDate)
      const previousDateAttendance = attendanceData?.[dateKey] || {}
      rollbackState = {
        byId: Object.fromEntries(uniqueMemberIds.map((memberId) => {
          const previousMember = members.find((member) => member.id === memberId) || {}
          return [memberId, {
            columnName: optimisticColumn,
            hadColumn: Object.prototype.hasOwnProperty.call(previousMember, optimisticColumn),
            columnValue: previousMember?.[optimisticColumn],
            hadAttendanceKey: Object.prototype.hasOwnProperty.call(previousDateAttendance, memberId),
            attendanceValue: previousDateAttendance[memberId]
          }]
        }))
      }
      applyLocalAttendanceState(uniqueMemberIds, effectiveDate, present, optimisticColumn)

      const attendanceColumn = await findAttendanceColumnForDate(effectiveDate)

      if (!attendanceColumn) {
        throw new Error(`No attendance column found for this date in ${currentTable}`)
      }

      const attendanceValue = present === null ? null : (present ? 'Present' : 'Absent')
      const bulkAttendanceUpdatedAt = new Date().toISOString()
      const canWritePreviewSyncColumns = await ensureMemberPreviewSyncColumns(currentTable)

      // One write for the selected records is much faster than a request per
      // card. Returned ids make a partial RLS/stale-record result fail closed.
      const result = await executeSupabaseWrite(
        () => supabase
          .from(currentTable)
          .update({
            [attendanceColumn]: attendanceValue,
            ...(canWritePreviewSyncColumns ? { updated_at: bulkAttendanceUpdatedAt } : {})
          })
          .in('id', uniqueMemberIds)
          .select('id'),
        { action: `Save bulk attendance in ${currentTable}` }
      )
      assertSupabaseMutationAffected(result, 'Bulk attendance save')
      if ((result.data || []).length !== uniqueMemberIds.length) {
        // A partial write is never described as complete. Refresh the one
        // affected Sunday before surfacing the error so the screen reflects
        // the server rather than rolling back to an equally inaccurate view.
        await fetchAndApplyAttendanceForDate(effectiveDate)
        shouldRollback = false
        const mismatch = new Error(`Only ${(result.data || []).length} of ${uniqueMemberIds.length} attendance records were updated. Nothing is reported as complete.`)
        mismatch.code = 'DATSER_PARTIAL_BULK_ATTENDANCE'
        throw mismatch
      }

      // Update local state for members and attendanceData (for real-time UI updates)
      applyLocalAttendanceState(uniqueMemberIds, effectiveDate, present, attendanceColumn)

      const bulkAttendanceValue = attendanceValue
      const updatedBulkAttendanceMembers = uniqueMemberIds.map((memberId) => normalizeMemberRecord({
        ...(members.find((member) => member.id === memberId) || { id: memberId }),
        [attendanceColumn]: bulkAttendanceValue,
        updated_at: bulkAttendanceUpdatedAt
      }))
      applyAttendanceColumnsFromMemberRows(updatedBulkAttendanceMembers, currentTable)
      await persistMemberPreviewIndex(currentTable, updatedBulkAttendanceMembers, {
        cachedCount: members.length,
        totalCount: membersTotalCount,
        source: 'bulk-attendance'
      })
      markMemberPreviewSyncComplete(currentTable, {
        cachedCount: members.length,
        totalCount: membersTotalCount,
        source: 'bulk-attendance',
        lastSyncAt: new Date().toISOString()
      })

      // Check if month is complete and process badges
      if (badgeProcessingEnabled) {
        setTimeout(() => processEndOfMonthBadges(), 500)
      }

      invalidateRequestScope(`${dataOwnerId || user?.id || 'guest'}:${currentTable}`, 'attendance-reconciliation')
      const actionLabel = present === null ? 'cleared' : 'saved'
      toast.success(`Bulk attendance ${actionLabel} for ${uniqueMemberIds.length} members.`)
      return { success: true, updated: uniqueMemberIds.length }
    } catch (error) {
      console.error('Error marking bulk attendance:', error)
      if (shouldRollback && rollbackDate && rollbackState) {
        rollbackLocalAttendanceState(uniqueMemberIds, rollbackDate, rollbackState)
      }
      toast.error(present === null ? 'Failed to clear attendance' : 'Failed to mark bulk attendance')
      return { success: false, error }
    }
  }

  // Fetch attendance for a specific date from monthly table
  const fetchAttendanceForDate = async (date) => {
    try {
      if (!isSupabaseConfigured()) {
        // Demo mode - return mock attendance data
        const dateKey = getLocalDateString(date)
        return attendanceData[dateKey] || {}
      }

      const attendanceColumn = await findAttendanceColumnForDate(date)

      if (!attendanceColumn) {
        appContextLog(`No attendance column found for this date in ${currentTable}`)
        return {}
      }

      // Paginate to avoid Supabase default 1000-row cap
      let allRecords = []
      let fetchOff = 0
      const PG_SIZE = 1000
      while (true) {
        let query = supabase
          .from(currentTable)
          .select(`id, "${attendanceColumn}"`)
        const ownerId = dataOwnerId || user?.id
        if (ownerId) query = query.eq('workspace_owner_id', ownerId)
        query = query.is('deleted_at', null)
        const { data: pg, error: pgErr } = await query
          .range(fetchOff, fetchOff + PG_SIZE - 1)

        if (pgErr) throw pgErr
        if (!pg || pg.length === 0) break
        allRecords = allRecords.concat(pg)
        if (pg.length < PG_SIZE) break
        fetchOff += PG_SIZE
      }

      // Transform to object format - include both Present (true) and Absent (false)
      const attendanceMap = {}
      allRecords.forEach(record => {
        const value = record[attendanceColumn]
        if (value === 'Present') {
          attendanceMap[record.id] = true
        } else if (value === 'Absent') {
          attendanceMap[record.id] = false
        }
        // If value is null/undefined, don't add to map (no attendance marked yet)
      })

      return attendanceMap
    } catch (error) {
      console.error('Error fetching attendance:', error)
      const dateKey = getLocalDateString(date)
      return attendanceData[dateKey] || {}
    }
  }

  const fetchAttendanceForDateInTable = useCallback(async (date, tableName) => {
    if (!date || !tableName || !isSupabaseConfigured()) {
      const dateKey = getLocalDateString(date)
      return (dateKey && attendanceData[dateKey]) || {}
    }

    const dateKey = getLocalDateString(date)
    if (!dateKey) return {}

    const key = `${tableName}:${dateKey}`
    if (inFlightAttendancePromisesRef.current.has(key)) {
      devCountersRef.current.attendanceFetchDeduplicated = (devCountersRef.current.attendanceFetchDeduplicated || 0) + 1
      return inFlightAttendancePromisesRef.current.get(key)
    }

    const promise = (async () => {
      try {
        const attendanceColumn = await findAttendanceColumnForDateInTable(date, tableName)

        if (!attendanceColumn) {
          appContextLog(`No attendance column found for this date in ${tableName}`)
          return {}
        }

        let allRecords = []
        let fetchOff = 0
        const PG_SIZE = 1000
        while (true) {
          let query = supabase
            .from(tableName)
            .select(`id, "${attendanceColumn}"`)
          const ownerId = dataOwnerId || user?.id
          if (ownerId) query = query.eq('workspace_owner_id', ownerId)
          query = query.is('deleted_at', null)
          const { data: pg, error: pgErr } = await query
            .range(fetchOff, fetchOff + PG_SIZE - 1)

          if (pgErr) throw pgErr
          if (!pg || pg.length === 0) break
          allRecords = allRecords.concat(pg)
          if (pg.length < PG_SIZE) break
          fetchOff += PG_SIZE
        }

        const attendanceMap = {}
        allRecords.forEach(record => {
          const value = record[attendanceColumn]
          if (value === 'Present') {
            attendanceMap[record.id] = true
          } else if (value === 'Absent') {
            attendanceMap[record.id] = false
          }
        })

        devCountersRef.current.attendanceFetchCount = (devCountersRef.current.attendanceFetchCount || 0) + 1
        return attendanceMap
      } catch (error) {
        console.error('Error fetching attendance:', error)
        return attendanceData[dateKey] || {}
      } finally {
        inFlightAttendancePromisesRef.current.delete(key)
      }
    })()

    inFlightAttendancePromisesRef.current.set(key, promise)
    return promise
  }, [attendanceData, dataOwnerId, findAttendanceColumnForDateInTable, isSupabaseConfigured, user?.id])

  // All UI refreshes go through one guarded apply path. A slow request is not
  // allowed to replace a newer read or an optimistic choice for the same
  // workspace table and Sunday.
  const fetchAndApplyAttendanceForDate = useCallback(async (date, tableName = currentTable) => {
    const dateKey = getLocalDateString(date)
    if (!dateKey || !tableName) return null

    const readVersion = attendanceSnapshotVersionRef.current.startRead(tableName, dateKey)
    const attendanceMap = tableName === currentTable
      ? await fetchAttendanceForDate(date)
      : await fetchAttendanceForDateInTable(date, tableName)

    if (!attendanceSnapshotVersionRef.current.canApplyRead(tableName, dateKey, readVersion)) {
      return null
    }

    setAttendanceData((previous) => {
      const next = {
        ...previous,
        [dateKey]: attendanceMap || {}
      }
      attendanceDataRef.current = next
      return next
    })
    return attendanceMap || {}
  }, [currentTable, fetchAttendanceForDateInTable])

  // Update member.
  // skipRefresh keeps optimistic local state without triggering the dashboard skeleton.
  // Use it only for flows that immediately update all affected local state themselves.
  // Options may pin the source table/owner/identity for replaying an offline mutation.
  const updateMember = async (id, updates, options = {}) => {
    const {
      silent = false,
      allowLocalFallback = false,
      skipRefresh = false,
      flushMode = false,
      targetTable: requestedTargetTable = null,
      ownerId: requestedOwnerId = null,
      identity: requestedIdentity = null
    } = options
    const editTimestamp = new Date().toISOString()
    const identityMember = members.find(m => m.id === id) || requestedIdentity || {}
    const targetTable = requestedTargetTable || getMemberSourceTable(identityMember, currentTable)
    const targetOwnerId = requestedOwnerId || getMemberOwnerId(identityMember, dataOwnerId || user?.id)
    try {
      if (isDeveloperBypass || !isSupabaseConfigured()) {
        // Demo mode - update local state
        const baseMember = members.find(m => m.id === id) || {}
        const updatedMember = { ...baseMember, ...updates, updated_at: editTimestamp }
        const updatedNameDemo = (
          typeof updates.full_name === 'string' && updates.full_name.trim()
        ) ? updates.full_name : (typeof updates['Full Name'] === 'string' ? updates['Full Name'] : undefined)
        if (updatedNameDemo !== undefined) {
          updatedMember['full_name'] = updatedNameDemo
          updatedMember['Full Name'] = updatedNameDemo
        }
        setMembers(prev => prev.map(m => m.id === id ? updatedMember : m))
        searchCacheRef.current.clear()
        await persistMemberPreviewIndex(currentTable, [updatedMember], {
          cachedCount: members.length,
          totalCount: membersTotalCount,
          source: 'update'
        })
        markMemberPreviewSyncComplete(currentTable, {
          cachedCount: members.length,
          totalCount: membersTotalCount,
          source: 'update',
          lastSyncAt: editTimestamp
        })
        recordRecentMemberEdit(updatedMember, editTimestamp)
        refreshSearch()
        if (!silent) toast.success('Member updated')
        return updatedMember
      }

      if (shouldUseOfflineData || !isBrowserOnline()) {
        if (flushMode) {
          // During an offline flush this branch means the update never reached
          // the server. The change is already queued; keep it and let the
          // flush loop mark the attempt instead of treating it as synced.
          const flushError = new Error('Member update could not reach the server and stays queued for retry.')
          flushError.code = '503'
          throw flushError
        }
        const createdAt = editTimestamp
        const existingMember = members.find(m => m.id === id) || {}
        const optimisticMember = normalizeMemberRecord({
          ...existingMember,
          ...updates,
          updated_at: createdAt,
          __offline_status: 'pending_update'
        }, { tableName: targetTable, ownerId: targetOwnerId })

        setMembers(prev => prev.map(m => (m.id === id ? optimisticMember : m)))
        invalidateMembersCacheRefs(membersCacheRef, searchCacheRef, targetTable)
        await persistMemberPreviewIndex(targetTable, [optimisticMember], {
          cachedCount: members.length,
          totalCount: membersTotalCount,
          source: 'offline-update'
        })
        await queueOfflineChange({
          local_change_id: `member_update_${targetTable}_${id}`,
          action_type: 'member_update',
          table_name: targetTable,
          owner_id: targetOwnerId,
          member_id: id,
          identity: buildMemberIdentityHint(existingMember),
          updates,
          base_updated_at: existingMember.updated_at || existingMember.UpdatedAt || existingMember.inserted_at || null,
          created_at: createdAt,
          sync_status: 'pending'
        })
        await refreshOfflineStatus()
        recordRecentMemberEdit(optimisticMember, createdAt, {
          action: 'update',
          summary: 'Updated member offline',
          table: currentTable
        })
        refreshSearch()
        if (!silent && shouldShowOfflineSaveNotice(pendingSyncCount + 1)) {
          notify.sync('Member update saved offline and will sync automatically.', {
            title: 'Saved to pending sync',
            toastId: 'offline-save-threshold'
          })
        }
        return optimisticMember
      }

      // Defensive copy so we can safely normalize values
      let normalized = { ...updates }
      if (normalized.updated_at === undefined) {
        normalized.updated_at = editTimestamp
      }

      // Normalize name field using schema-aware detection
      const nameCol = await resolveNameColumn(currentTable)
      console.log('[updateMember] Resolved name column:', nameCol)
      const incomingName = (
        typeof normalized.full_name === 'string' && normalized.full_name.trim()
      ) ? normalized.full_name : (typeof normalized['Full Name'] === 'string' ? normalized['Full Name'] : undefined)
      if (incomingName !== undefined) {
        normalized = { ...normalized, [nameCol]: incomingName }
        // Only delete the keys that are different from nameCol to avoid deleting the value we just set
        if (nameCol !== 'full_name') delete normalized.full_name
        if (nameCol !== 'Full Name') delete normalized['Full Name']
      }

      // Normalize gender to capitalized values the table expects
      const incomingGender = normalized.gender ?? normalized['Gender']
      if (typeof incomingGender === 'string') {
        const cap = incomingGender.trim().toLowerCase() === 'male' ? 'Male'
          : incomingGender.trim().toLowerCase() === 'female' ? 'Female'
            : incomingGender
        normalized = { ...normalized, Gender: cap }
        delete normalized.gender
      }

      // Normalize phone number (keep as string since column is TEXT)
      const incomingPhone = normalized.phone_number ?? normalized['Phone Number']
      if (incomingPhone !== undefined) {
        const phoneStr = String(incomingPhone || '').trim()
        normalized = { ...normalized, 'Phone Number': phoneStr || null }
        delete normalized.phone_number
      }

      // Normalize age (keep as string since column is TEXT)
      const incomingAge = normalized.age ?? normalized['Age']
      if (incomingAge !== undefined) {
        const ageStr = String(incomingAge ?? '').trim()
        normalized = { ...normalized, Age: ageStr || null }
        delete normalized.age
      }

      // Normalize date_of_birth (keep as string since column is TEXT)
      const incomingDob = normalized.date_of_birth ?? normalized['date_of_birth']
      if (incomingDob !== undefined) {
        const dobStr = String(incomingDob || '').trim()
        normalized = { ...normalized, date_of_birth: dobStr || null }
      }

      // Normalize Current Level field
      const incomingLevel = normalized.current_level ?? normalized['Current Level']
      if (incomingLevel !== undefined) {
        normalized = { ...normalized, 'Current Level': incomingLevel }
        delete normalized.current_level
      }

      // validColumns is always null here — schema introspection is not done at runtime
      // per the Runtime Schema Rule. Month tables store the display fields under
      // quoted PascalCase columns ("Full Name", "Phone Number", "Gender", "Age",
      // "Current Level", "Member", ...). The fallback below maps snake_case inputs
      // to those canonical column names and leaves already-canonical keys untouched,
      // so the resilient RPC payload (and queued offline replay) always uses valid
      // month-table column names. Internal/control fields are excluded by the
      // queue/insert sanitizers, not by this rename step.
      let validColumns = null

      // If validColumns not found (empty table or error), fallback to the canonical
      // month-table column names for standard fields.
      if (!validColumns) {
        if (normalized['phone_number'] !== undefined) {
          if (normalized['Phone Number'] === undefined) {
            normalized['Phone Number'] = normalized['phone_number']
          }
          delete normalized['phone_number']
        }
        if (normalized['age'] !== undefined) {
          if (normalized['Age'] === undefined) {
            normalized['Age'] = normalized['age']
          }
          delete normalized['age']
        }
        if (normalized['gender'] !== undefined) {
          if (normalized['Gender'] === undefined) {
            normalized['Gender'] = normalized['gender']
          }
          delete normalized['gender']
        }
        if (normalized['current_level'] !== undefined) {
          if (normalized['Current Level'] === undefined) {
            normalized['Current Level'] = normalized['current_level']
          }
          delete normalized['current_level']
        }
        if (normalized['full_name'] !== undefined) {
          // Only rename if 'full_name' is present (fallback from resolveNameColumn)
          if (normalized['Full Name'] === undefined) {
            normalized['Full Name'] = normalized['full_name']
          }
          delete normalized['full_name']
        }
        if (normalized['member'] !== undefined) {
          if (normalized['Member'] === undefined) {
            normalized['Member'] = normalized['member']
          }
          delete normalized['member']
        }
        if (normalized['regular'] !== undefined) {
          if (normalized['Regular'] === undefined) {
            normalized['Regular'] = normalized['regular']
          }
          delete normalized['regular']
        }
        if (normalized['newcomer'] !== undefined) {
          if (normalized['Newcomer'] === undefined) {
            normalized['Newcomer'] = normalized['newcomer']
          }
          delete normalized['newcomer']
        }
      }

      // Filter normalized object to only include valid columns if we know them
      if (validColumns) {
        const filteredNormalized = {}
        for (const key of Object.keys(normalized)) {
          if (validColumns.has(key)) {
            filteredNormalized[key] = normalized[key]
          } else {
            // Try alternative column names for name field
            if (key === 'Full Name' && validColumns.has('full_name')) {
              filteredNormalized['full_name'] = normalized[key]
              console.log('[updateMember] Mapped "Full Name" to "full_name"')
            } else if (key === 'full_name' && validColumns.has('Full Name')) {
              filteredNormalized['Full Name'] = normalized[key]
              console.log('[updateMember] Mapped "full_name" to "Full Name"')
            } else if ((key === 'Full Name' || key === 'full_name') && validColumns.has('name')) {
              filteredNormalized['name'] = normalized[key]
              console.log('[updateMember] Mapped to "name"')
            } else if ((key === 'Full Name' || key === 'full_name') && validColumns.has('Name')) {
              filteredNormalized['Name'] = normalized[key]
              console.log('[updateMember] Mapped to "Name"')
            } else if (key === 'Phone Number' && validColumns.has('phone_number')) {
              filteredNormalized['phone_number'] = normalized[key]
              console.log('[updateMember] Mapped "Phone Number" to "phone_number"')
            } else if (key === 'phone_number' && validColumns.has('Phone Number')) {
              filteredNormalized['Phone Number'] = normalized[key]
              console.log('[updateMember] Mapped "phone_number" to "Phone Number"')
            } else if (key === 'Age' && validColumns.has('age')) {
              filteredNormalized['age'] = normalized[key]
              console.log('[updateMember] Mapped "Age" to "age"')
            } else if (key === 'age' && validColumns.has('Age')) {
              filteredNormalized['Age'] = normalized[key]
              console.log('[updateMember] Mapped "age" to "Age"')
            } else if (key === 'Gender' && validColumns.has('gender')) {
              filteredNormalized['gender'] = normalized[key]
              console.log('[updateMember] Mapped "Gender" to "gender"')
            } else if (key === 'gender' && validColumns.has('Gender')) {
              filteredNormalized['Gender'] = normalized[key]
              console.log('[updateMember] Mapped "gender" to "Gender"')
            } else if (key === 'Current Level' && validColumns.has('current_level')) {
              filteredNormalized['current_level'] = normalized[key]
              console.log('[updateMember] Mapped "Current Level" to "current_level"')
            } else if (key === 'current_level' && validColumns.has('Current Level')) {
              filteredNormalized['Current Level'] = normalized[key]
              console.log('[updateMember] Mapped "current_level" to "Current Level"')
            } else if (key === 'parent_name_1' && validColumns.has('Parent Name 1')) {
              filteredNormalized['Parent Name 1'] = normalized[key]
            } else if (key === 'parent_phone_1' && validColumns.has('Parent Phone 1')) {
              filteredNormalized['Parent Phone 1'] = normalized[key]
            } else if (key === 'parent_name_2' && validColumns.has('Parent Name 2')) {
              filteredNormalized['Parent Name 2'] = normalized[key]
            } else if (key === 'parent_phone_2' && validColumns.has('Parent Phone 2')) {
              filteredNormalized['Parent Phone 2'] = normalized[key]
            } else if (key === 'notes' && validColumns.has('notes')) {
              filteredNormalized['notes'] = normalized[key]
              console.log('[updateMember] Including notes field')
            } else if (key === 'ministry' && validColumns.has('ministry')) {
              filteredNormalized['ministry'] = normalized[key]
              console.log('[updateMember] Including ministry field')
            } else if (key === 'is_visitor' && validColumns.has('is_visitor')) {
              filteredNormalized['is_visitor'] = normalized[key]
              console.log('[updateMember] Including is_visitor field')
            } else if (key === 'Member' && validColumns.has('member')) {
              filteredNormalized['member'] = normalized[key]
            } else if (key === 'member' && validColumns.has('Member')) {
              filteredNormalized['Member'] = normalized[key]
            } else if (key === 'Regular' && validColumns.has('regular')) {
              filteredNormalized['regular'] = normalized[key]
            } else if (key === 'regular' && validColumns.has('Regular')) {
              filteredNormalized['Regular'] = normalized[key]
            } else if (key === 'Newcomer' && validColumns.has('newcomer')) {
              filteredNormalized['newcomer'] = normalized[key]
            } else if (key === 'newcomer' && validColumns.has('Newcomer')) {
              filteredNormalized['Newcomer'] = normalized[key]
            } else {
              console.warn(`Skipping field "${key}" - column does not exist in table ${targetTable}`)
            }
          }
        }
        normalized = filteredNormalized
      }

      // Ensure we have something to update
      if (Object.keys(normalized).length === 0) {
        console.warn('No valid fields to update after filtering')
        if (!silent) toast.info('No changes to save')
        return members.find(m => m.id === id)
      }

      const optimisticPatch = { ...updates, ...normalized, updated_at: editTimestamp }

      try {
        if (!targetOwnerId) throw new Error('Unable to determine the workspace owner for this update')
        const updateResult = await executeSupabaseWrite(
          () => supabase.rpc('update_member_record_resilient', {
            p_table_name: targetTable,
            p_member_id: id,
            p_updates: normalized,
            p_owner_id: targetOwnerId,
            p_identity: buildMemberIdentityHint(identityMember)
          }),
          { action: `Update member in ${targetTable}` }
        )
        if (!updateResult?.data?.success || !updateResult?.data?.row) {
          throw new Error('Member update could not be verified')
        }
        if (updateResult.data.recovered) {
          console.info('[updateMember] Recovered stale member identity', {
            table: targetTable,
            originalMemberId: id,
            resolvedMemberId: updateResult.data.member_id
          })
        }
      } catch (error) {
        const isRlsError =
          error.code === '42501' ||
          error.code === 'DATSER_NO_ROWS' ||
          error.message?.toLowerCase().includes('row-level security') ||
          error.message?.toLowerCase().includes('permission denied')

        if (isRlsError) {
          const ownerId = targetOwnerId
          if (!ownerId) throw error
          await executeSupabaseWrite(
            () => supabase.rpc('update_member_record', {
              p_table_name: targetTable,
              p_member_id: id,
              p_updates: normalized,
              p_owner_id: ownerId
            }),
            { action: `Update member via RPC in ${targetTable}` }
          )
        } else {
          throw error
        }
      }

      // Update members state with optimistic patch - preserve existing name if not being updated
      let recentEditedMember = null
      setMembers(prev => {
        // Get the existing member to preserve their name
        const existingMember = prev.find(m => m.id === id)
        const existingName = existingMember?.full_name ?? existingMember?.['Full Name'] ?? existingMember?.name ?? existingMember?.Name
        
        // Only use the new name from updates if it's explicitly provided and valid
        let updatedName = undefined
        if (typeof updates.full_name === 'string' && updates.full_name.trim()) {
          updatedName = updates.full_name.trim()
        } else if (typeof updates['Full Name'] === 'string' && updates['Full Name'].trim()) {
          updatedName = updates['Full Name'].trim()
        } else if (typeof updates.name === 'string' && updates.name.trim()) {
          updatedName = updates.name.trim()
        } else if (typeof updates.Name === 'string' && updates.Name.trim()) {
          updatedName = updates.Name.trim()
        }
        
        // If no new name provided, keep the existing name
        const finalName = updatedName !== undefined ? updatedName : existingName
        
        const updatedMembers = prev.map(m => {
          if (m.id !== id) return m
          const merged = { ...m, ...optimisticPatch }
          merged.updated_at = editTimestamp
          // Ensure name is preserved
          if (finalName !== undefined) {
            merged.full_name = finalName
            merged['Full Name'] = finalName
            merged.name = finalName
            merged.Name = finalName
          }
          const resolvedPhone = updates['Phone Number'] ?? updates.phone_number
          if (resolvedPhone !== undefined) {
            merged['Phone Number'] = resolvedPhone
            merged.phone_number = resolvedPhone
          }
          const resolvedAge = updates['Age'] ?? updates.age
          if (resolvedAge !== undefined) {
            merged['Age'] = resolvedAge
            merged.age = resolvedAge
          }
          const resolvedLevel = updates['Current Level'] ?? updates.current_level
          if (resolvedLevel !== undefined) {
            merged['Current Level'] = resolvedLevel
            merged.current_level = resolvedLevel
          }
          recentEditedMember = merged
          return merged
        })
        return updatedMembers
      })
      const changedFields = Object.keys(updates || {}).filter((key) => updates[key] !== undefined)
      recordRecentMemberEdit(recentEditedMember || { ...(members.find(m => m.id === id) || {}), ...optimisticPatch }, editTimestamp, {
        action: 'update',
        summary: changedFields.length ? `Updated ${changedFields.slice(0, 3).join(', ')}` : 'Updated member details',
        changedFields,
        table: targetTable
      })

      searchCacheRef.current.clear()
      const cachedUpdateMember = recentEditedMember || { ...(members.find(m => m.id === id) || {}), ...optimisticPatch }
      persistLoadedMemberPreview(
        targetTable,
        members.map((member) => member.id === id ? normalizeMemberRecord({ ...member, ...cachedUpdateMember }) : member),
        { totalCount: membersTotalCount, loadedAll: membersLoadedAll }
      )
      await persistMemberPreviewIndex(targetTable, [cachedUpdateMember], {
        cachedCount: members.length,
        totalCount: membersTotalCount,
        source: 'update'
      })
      markMemberPreviewSyncComplete(targetTable, {
        cachedCount: members.length,
        totalCount: membersTotalCount,
        source: 'update',
        lastSyncAt: editTimestamp
      })
      if (skipRefresh) {
        appContextLog('[updateMember] Kept optimistic member cache without post-save refetch.')
      }

      // Update search after the preview index and stale result cache have been patched.
      refreshSearch()

      if (!silent) toast.success('Member updated')

      // Log the action
      const memberName = members.find(m => m.id === id)?.['full_name'] || members.find(m => m.id === id)?.['Full Name'] || 'Unknown'
      logActivity('UPDATE_MEMBER', `Updated member: ${memberName}`)

      return { ...(members.find(m => m.id === id) || {}), ...optimisticPatch }
    } catch (error) {
      console.error('Error updating member:', error)
      const shouldQueueForRetry = isTransientSupabaseError(error) || !isBrowserOnline()
      if (allowLocalFallback || shouldQueueForRetry) {
        const fallbackName = (
          typeof updates.full_name === 'string' && updates.full_name.trim()
        ) ? updates.full_name : (typeof updates['Full Name'] === 'string' ? updates['Full Name'] : undefined)
        let fallbackEditedMember = null
        setMembers(prev => prev.map(m => {
          if (m.id !== id) return m
          const merged = { ...m, ...updates, updated_at: editTimestamp }
          if (fallbackName !== undefined) {
            merged['full_name'] = fallbackName
            merged['Full Name'] = fallbackName
          }
          fallbackEditedMember = merged
          return merged
        }))
        recordRecentMemberEdit(fallbackEditedMember || { ...(members.find(m => m.id === id) || {}), ...updates, updated_at: editTimestamp }, editTimestamp)
        if (shouldQueueForRetry) {
          if (flushMode) {
            // The offline flush loop must know this attempt failed so it does
            // not remove the still-queued change. The change is already in
            // pendingChanges (the flush loop reads it), so do not re-queue it:
            // re-queueing would reset retry_count before the flush loop can
            // advance it. Throw instead and let the flush loop mark the
            // attempt (status pending, retry_count/last_attempt_at advance).
            const flushError = new Error('Member update was not confirmed by the server and stays queued for retry.')
            flushError.code = '503'
            throw flushError
          }
          const existingMember = members.find(m => m.id === id) || {}
          await queueOfflineChange({
            local_change_id: `member_update_${targetTable}_${id}`,
            action_type: 'member_update',
            table_name: targetTable,
            owner_id: targetOwnerId,
            member_id: id,
            identity: buildMemberIdentityHint(existingMember),
            updates,
            base_updated_at: existingMember.updated_at || existingMember.UpdatedAt || existingMember.inserted_at || null,
            created_at: editTimestamp,
            sync_status: 'pending'
          })
          await refreshOfflineStatus()
        }
        await persistMemberPreviewIndex(targetTable, [fallbackEditedMember || { ...(members.find(m => m.id === id) || {}), ...updates, updated_at: editTimestamp }], {
          cachedCount: members.length,
          totalCount: membersTotalCount,
          source: 'local-fallback-update'
        })
        searchCacheRef.current.clear()
        markMemberPreviewSyncComplete(targetTable, {
          cachedCount: members.length,
          totalCount: membersTotalCount,
          source: 'local-fallback-update',
          lastSyncAt: editTimestamp
        })
        refreshSearch()
        if (!silent) {
          if (shouldQueueForRetry) {
            notify.sync('Member update saved on this device and will sync automatically.', {
              title: 'Saved offline'
            })
          } else {
            toast.info('Saved locally on this device')
          }
        }
        return fallbackEditedMember || { ...(members.find(m => m.id === id) || {}), ...updates, updated_at: editTimestamp }
      }
      toast.error('Failed to update member')
      throw error
    }
  }

  // Remove a member from the persisted offline snapshot so a stale snapshot can
  // never resurrect it after a confirmed delete.
  const purgeMemberFromOfflineSnapshot = useCallback(async (memberId) => {
    if (!memberId) return
    try {
      const record = await getOfflineSnapshot().catch(() => null)
      const snapshot = record?.snapshot
      if (!snapshot || !Array.isArray(snapshot.members)) return
      const nextMembers = snapshot.members.filter((member) => String(member?.id) !== String(memberId))
      if (nextMembers.length === snapshot.members.length) return
      await saveOfflineSnapshot({ ...snapshot, members: nextMembers })
    } catch (err) {
      console.warn('Could not purge member from offline snapshot:', err)
    }
  }, [])

  // Delete member
  const deleteMember = async (memberId) => {

    // Validate memberId
    if (!memberId) {
      console.error('[DELETE] Error: No member ID provided')
      toast.error('Error: Invalid member ID')
      return { success: false }
    }

    // Support deletion in demo mode by updating local state so mobile users on static deployments can manage entries
    if (isDeveloperBypass || !isSupabaseConfigured()) {
      setMembers(prevMembers => {
        const deletedMember = prevMembers.find((member) => String(member.id) === String(memberId))
        if (deletedMember) {
          setDeletedMemberSearchTombstones((prev) => [
            ...prev.filter((member) => String(member.id) !== String(memberId)),
            { ...deletedMember, deleted_at: new Date().toISOString() }
          ].slice(-100))
        }
        const updated = prevMembers.filter(member => member.id !== memberId)
        console.log(`[DELETE] Members before: ${prevMembers.length}, after: ${updated.length}`)
        return updated
      })
      // Also remove from attendanceData snapshots to keep UI consistent
      setAttendanceData(prev => {
        const next = {}
        Object.entries(prev).forEach(([dateKey, map]) => {
          const { [memberId]: _removed, ...rest } = map || {}
          next[dateKey] = rest
        })
        return next
      })
      refreshSearch()
      await deleteMemberPreviewMember(workspaceCacheScope, currentTable, memberId)
      addMemberDeleteTombstone(memberId, new Date().toISOString(), currentTable)
      await purgeMemberFromOfflineSnapshot(memberId)
      toast.success('Member deleted (Demo Mode)')
      return { success: true }
    }

    if (shouldUseOfflineData || !isBrowserOnline()) {
      const existingMember = members.find(member => member.id === memberId) || null
      const createdAt = new Date().toISOString()
      if (existingMember) {
        setDeletedMemberSearchTombstones((prev) => [
          ...prev.filter((member) => String(member.id) !== String(memberId)),
          { ...existingMember, deleted_at: createdAt }
        ].slice(-100))
      }
      setMembers(prevMembers => prevMembers.filter(member => member.id !== memberId))
      setAttendanceData(prev => {
        const next = {}
        Object.entries(prev).forEach(([dateKey, map]) => {
          const { [memberId]: _removed, ...rest } = map || {}
          next[dateKey] = rest
        })
        return next
      })
      refreshSearch()
      invalidateMembersCacheRefs(membersCacheRef, searchCacheRef, currentTable)
      await deleteMemberPreviewMember(workspaceCacheScope, currentTable, memberId)
      addMemberDeleteTombstone(memberId, createdAt, currentTable)
      await purgeMemberFromOfflineSnapshot(memberId)
      await queueOfflineChange({
        local_change_id: `member_delete_${currentTable}_${memberId}`,
        action_type: 'member_delete',
        table_name: currentTable,
        member_id: memberId,
        base_updated_at: existingMember?.updated_at || existingMember?.UpdatedAt || existingMember?.inserted_at || null,
        member_snapshot: existingMember,
        created_at: createdAt,
        sync_status: 'pending'
      })
      await refreshOfflineStatus()
      if (shouldShowOfflineSaveNotice(pendingSyncCount + 1)) {
        notify.sync('Member deletion saved offline and will sync automatically.', {
          title: 'Saved to pending sync',
          toastId: 'offline-save-threshold'
        })
      }
      return { success: true, offline: true }
    }

    setLoading(true)
    try {
      await ensureMemberPreviewSyncColumns(currentTable)

      const deletedAt = new Date().toISOString()
      let softDeleted = false

      try {
        const { data, error } = await supabase
          .from(currentTable)
          .update({
            deleted_at: deletedAt,
            updated_at: deletedAt
          })
          .eq('id', memberId)
          .select('id, deleted_at, updated_at')

        console.log(`[DELETE] Soft delete response - Error: ${error ? error.message : 'none'}, Rows updated:`, data?.length || 0, data)

        if (!error && data && data.length > 0) {
          softDeleted = true
        } else if (error) {
          const normalized = error.message?.toLowerCase() || ''
          const isRlsError =
            error.code === '42501' ||
            normalized.includes('row-level security') ||
            normalized.includes('permission denied')
          const missingSyncColumn =
            error.code === '42703' ||
            normalized.includes('deleted_at') ||
            normalized.includes('updated_at') ||
            normalized.includes('column')
          if (!isRlsError && !missingSyncColumn) {
            throw error
          }
        }
      } catch (updateError) {
        const normalized = updateError?.message?.toLowerCase() || ''
        const isRlsError =
          updateError?.code === '42501' ||
          normalized.includes('row-level security') ||
          normalized.includes('permission denied')
        const missingSyncColumn =
          updateError?.code === '42703' ||
          normalized.includes('deleted_at') ||
          normalized.includes('updated_at') ||
          normalized.includes('column')
        if (!isRlsError && !missingSyncColumn) throw updateError
      }

      if (!softDeleted) {
        console.log('[DELETE] Soft delete via table update did not confirm. Trying RPC fallback...')
        try {
          const { data: rpcResult, error: rpcError } = await supabase.rpc('soft_delete_member', {
            target_table: currentTable,
            member_id: memberId
          })

          console.log(`[DELETE] Soft delete RPC response - Error: ${rpcError ? rpcError.message : 'none'}, Result:`, rpcResult)
          if (!rpcError) {
            softDeleted = Boolean(rpcResult || true)
          }
        } catch (rpcError) {
          console.warn('[DELETE] soft_delete_member RPC failed, trying hard delete fallback:', rpcError)
        }
      }

      if (!softDeleted) {
        console.log('[DELETE] Soft delete fallback failed; attempting legacy hard delete...')
        const { data, error } = await supabase
          .from(currentTable)
          .delete()
          .eq('id', memberId)
          .select('id')
        if (error) throw error
        softDeleted = Boolean(data?.length)
      }

      const { data: verifyData } = await supabase
        .from(currentTable)
        .select('id, deleted_at')
        .eq('id', memberId)
        .maybeSingle()

      if (verifyData && !verifyData.deleted_at) {
        console.error(`[DELETE] VERIFICATION FAILED - member ${memberId} is still active in ${currentTable}`)
        throw new Error(`Delete blocked by database policy. Please allow soft delete for the "${currentTable}" table in Supabase.`)
      }


      const deletedMember = members.find(member => member.id === memberId) || { id: memberId }
      setDeletedMemberSearchTombstones((prev) => [
        ...prev.filter((member) => String(member.id) !== String(memberId)),
        { ...deletedMember, deleted_at: deletedAt }
      ].slice(-100))

      // Confirmed deleted - now update local state
      setMembers(prevMembers => {
        const updated = prevMembers.filter(member => member.id !== memberId)
        console.log(`[DELETE] Members state updated: ${prevMembers.length} -> ${updated.length}`)
        persistLoadedMemberPreview(currentTable, updated, {
          totalCount: Math.max(0, (membersTotalCount || prevMembers.length) - 1),
          loadedAll: membersLoadedAll
        })
        return updated
      })

      // Also remove from attendanceData snapshots to keep UI consistent
      setAttendanceData(prev => {
        const next = {}
        Object.entries(prev).forEach(([dateKey, map]) => {
          const { [memberId]: _removed, ...rest } = map || {}
          next[dateKey] = rest
        })
        return next
      })

      // Clear search results to force re-filtering with updated members
      setServerSearchResults(prev => {
        if (!prev) return null
        // Filter out the deleted member from search results
        const filtered = prev.filter(member => member.id !== memberId)
        console.log(`[DELETE] Search results updated: ${prev.length} -> ${filtered.length}`)
        return filtered
      })

      // Update caches/search without refetching the whole table.
      searchCacheRef.current.clear()
      await deleteMemberPreviewMember(workspaceCacheScope, currentTable, memberId)
      markMemberPreviewSyncComplete(currentTable, {
        cachedCount: Math.max(0, members.length - 1),
        totalCount: Math.max(0, (membersTotalCount || members.length) - 1),
        source: 'delete',
        lastSyncAt: deletedAt
      })
      recordRecentMemberEdit(deletedMember, new Date().toISOString(), {
        action: 'delete',
        summary: 'Deleted member',
        table: currentTable
      })
      // Persist the delete tombstone and drop the member from every local source
      // so a stale cache/offline snapshot cannot resurrect it after reopen.
      addMemberDeleteTombstone(memberId, deletedAt, currentTable)
      await purgeMemberFromOfflineSnapshot(memberId)
      toast.success('Member deleted')
      logActivity('DELETE_MEMBER', `Deleted member ID: ${memberId}`)
      return { success: true }
    } catch (error) {
      console.error(`[DELETE] Error deleting member ${memberId}:`, error)
      toast.error(error.message || 'Error deleting member')
      return { success: false, error }
    } finally {
      setLoading(false)
    }
  }

  const ensureTableReady = useCallback(async (tableName, attempts = 5, delay = 800) => {
    if (!isSupabaseConfigured()) return true
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const { error } = await supabase
          .from(tableName)
          .select('id')
          .limit(1)
        if (!error || error.code === 'PGRST116') {
          return true
        }
        if (error.code !== 'PGRST205') {
          console.error(`ensureTableReady unexpected error for ${tableName}:`, error)
        }
      } catch (err) {
        console.error(`ensureTableReady threw for ${tableName}:`, err)
      }
      await sleep(delay)
    }
    throw new Error(`Table ${tableName} is not ready yet. Please try again in a moment.`)
  }, [isSupabaseConfigured])

  // Fetch available month tables from database
  const fetchMonthlyTables = useCallback(async (options = {}) => {
    // Helper to clear invalid table selection
    const clearInvalidTable = () => {
      console.log('Clearing invalid/empty table selection')
      if (currentTable && currentTable === DEFAULT_COLLAB_TABLE) {
        changeCurrentTable(null)
      }
    }

    try {
      const resolveFallbackTables = () => {
        try {
          const storageKey = isCollaborator && dataOwnerId ? `selectedMonthTable_${dataOwnerId}` : 'selectedMonthTable'
          const localSaved = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null
          const prefSaved = authContext?.preferences?.current_month_table
          const fallback = prefSaved || localSaved || currentTable
          if (fallback) {
            setMonthlyTables(sortMonthTables([fallback]))
            if (!currentTable) {
              changeCurrentTable(fallback)
            }
            return true
          }
        } catch (err) {
          console.warn('Failed to resolve fallback month tables:', err)
        }
        return false
      }

      // 1. Check configuration
      if (isDeveloperBypass || !isSupabaseConfigured()) {
        setMonthlyTables(FALLBACK_MONTHLY_TABLES)
        return
      }

      // A 503/schema-cache outage is not evidence that a month disappeared.
      // Preserve current/cached metadata and wait for the shared health probe.
      if (!isBackendHealthy()) {
        resolveFallbackTables()
        return
      }

      // 2. Identify whose data we are fetching
      const ownerId = dataOwnerId || user?.id
      if (!ownerId) {
        // No user/owner identified yet
        setMonthlyTables([])
        clearInvalidTable()
        return
      }

      if (shouldUseOfflineData) {
        const snapshotRecord = await getOfflineSnapshot().catch(() => null)
        const snapshot = snapshotRecord?.snapshot
        if (
          snapshot?.authenticated_user_id === user?.id &&
          Array.isArray(snapshot.monthlyTables) &&
          snapshot.monthlyTables.length > 0
        ) {
          setMonthlyTables(sortMonthTables(snapshot.monthlyTables))
          if (snapshot.currentTable && !currentTable) {
            changeCurrentTable(snapshot.currentTable)
          }
          setOfflineStatusMessage('Offline Mode - using saved local data.')
          return
        }
      }

      appContextLog(`Fetching monthly tables for owner: ${ownerId} (Am I collaborator? ${isCollaborator})`)

      // 3. Fetch tables using RPC to bypass RLS for collaborators
      // We use 'get_available_month_tables' which checks 'collaborators' table for permission
      const { data, error } = await runScopedRequest(
        `${ownerId}:workspace`,
        'available-month-tables',
        () => supabase.rpc('get_available_month_tables', {
          target_user_id: ownerId
        }),
        { force: options?.forceRefresh || false, cacheResult: true }
      )

      if (error) {
        // If RPC is missing (legacy), try fallback to direct select if we are the owner
        // For collaborators, direct select will fail RLS, so we rely on RPC.
        console.error('Error fetching monthly tables via RPC:', error)

        // Temporary backend failures are never evidence that a workspace has no
        // month tables. Preserve the last confirmed registry/cache and let the
        // single backend-health probe decide when normal refreshes can resume.
        // Falling through to direct selects here created a request fan-out and
        // could clear month metadata during a 503 or schema-cache outage.
        if (isBackendDegradedError(error)) {
          markBackendDegraded(error)
          resolveFallbackTables()
          return
        }

        if (!isCollaborator) {
          const { data: directData, error: directError } = await supabase
            .from('user_month_tables')
            .select('table_name')
            .eq('user_id', ownerId)

          if (!directError && directData) {
            const tableNames = directData.map(entry => entry.table_name).filter(Boolean)
            setMonthlyTables(sortMonthTables(tableNames))
            return
          }
        }

        // If everything fails
        if (resolveFallbackTables()) return
        setMonthlyTables([])
        return
      }

      // 4. Process results
      const tableNames = (data || []).map(entry => entry.table_name).filter(Boolean)

      if (tableNames.length === 0) {
        console.log('No tables found for this user/owner.')
        if (isCollaborator && ownerStickyMonth) {
          setMonthlyTables(sortMonthTables([ownerStickyMonth]))
          if (!currentTable) {
            changeCurrentTable(ownerStickyMonth)
          }
          return
        }
        if (!isCollaborator) {
          const { data: directData, error: directError } = await supabase
            .from('user_month_tables')
            .select('table_name')
            .eq('user_id', ownerId)

          if (!directError && directData) {
            const directTables = directData.map(entry => entry.table_name).filter(Boolean)
            if (directTables.length > 0) {
              setMonthlyTables(sortMonthTables(directTables))
              return
            }
          }
        }
        if (resolveFallbackTables()) return
        setMonthlyTables([])
        clearInvalidTable()
        return
      }

      // 5. Update state
      setMonthlyTables(sortMonthTables(tableNames))

    } catch (error) {
      console.error('Unexpected error in fetchMonthlyTables:', error)
      // Do not force fallback tables on error to avoid "ghost" months
    }
  }, [
    isSupabaseConfigured,
    isDeveloperBypass,
    dataOwnerId,
    user?.id,
    isCollaborator,
    ownerStickyMonth,
    shouldUseOfflineData,
    changeCurrentTable,
    authContext?.preferences?.current_month_table,
    currentTable
  ])

  const deleteMonthTable = useCallback(async (tableName) => {
    if (!tableName) return
    try {
      if (isDeveloperBypass || !isSupabaseConfigured()) {
        setMonthlyTables(prev => {
          const nextTables = sortMonthTables(prev.filter(t => t !== tableName))
          if (currentTable === tableName) {
            const fallback = nextTables[nextTables.length - 1] || null
            changeCurrentTable(fallback)
          }
          return nextTables
        })
        toast.info(`${tableName.replace('_', ' ')} removed (Demo Mode)`)
        return { success: true }
      }

      const ownerId = dataOwnerId || user?.id
      if (!ownerId) {
        throw new Error('Unable to identify workspace owner for deletion.')
      }

      let dropWarning = null
      const { error: dropError } = await supabase.rpc('drop_month_table', { table_to_drop: tableName })
      if (dropError) {
        const normalized = dropError.message?.toLowerCase() || ''
        const missingRpc = normalized.includes('function drop_month_table')
        const missingTable = dropError.code === 'PGRST205' || normalized.includes('does not exist')

        if (missingRpc) {
          dropWarning = 'drop_month_table RPC is missing in Supabase. Table will need to be removed manually.'
          console.warn(dropWarning)
        } else if (missingTable) {
          console.warn(`Table ${tableName} was already removed in Supabase.`)
        } else {
          throw dropError
        }
      }

      const { error: registryError } = await supabase
        .from('user_month_tables')
        .delete()
        .eq('user_id', ownerId)
        .eq('table_name', tableName)

      if (registryError) {
        throw registryError
      }

      setMonthlyTables(prev => {
        const nextTables = sortMonthTables(prev.filter(t => t !== tableName))
        if (currentTable === tableName) {
          const fallback = nextTables[nextTables.length - 1] || null
          changeCurrentTable(fallback)
        }
        return nextTables
      })

      if (ownerId) {
        invalidateRequestScope(`${ownerId}:workspace`, 'available-month-tables')
      }
      await fetchMonthlyTables({ forceRefresh: true })
      toast.success(`Deleted ${tableName.replace('_', ' ')}`)
      if (dropWarning) {
        toast.warn(dropWarning, { autoClose: 7000 })
      }
      return { success: true }
    } catch (error) {
      console.error('Error deleting month table:', error)
      if (isConfirmedMissingMonthTableError(error)) {
        await handleMissingTable(tableName)
        toast.info(`${tableName.replace('_', ' ')} already removed.`)
        return { success: true }
      }

      toast.error(error?.message || 'Failed to delete month')
      throw error
    }
  }, [isDeveloperBypass, isSupabaseConfigured, supabase, user?.id, dataOwnerId, currentTable, changeCurrentTable, fetchMonthlyTables])

  const handleMissingTable = useCallback(async (tableName) => {
    if (!tableName) return
    console.warn(`Table ${tableName} missing in Supabase - syncing local state`)

    pruneMissingTable(tableName)
    toast.warn(`${tableName.replace('_', ' ')} no longer exists in Supabase. Please recreate it if needed.`)
    const ownerId = dataOwnerId || user?.id
    if (ownerId) {
      invalidateRequestScope(`${ownerId}:workspace`, 'available-month-tables')
    }
    await fetchMonthlyTables({ forceRefresh: true })
  }, [dataOwnerId, fetchMonthlyTables, pruneMissingTable, user?.id])

  // Create new month by copying from the most recent month
  const createNewMonth = async ({
    month,
    year,
    monthName,
    sundays,
    copyMode = 'all',
    selectedMemberIds = [],
    sourceTableOverride = null
  }) => {
    try {
      const monthIdentifier = `${monthName}_${year}`
      const resolvedCopyMode = copyMode === 'attendance' ? 'custom' : copyMode
      const ownerId = dataOwnerId || user?.id

      if (isDeveloperBypass || !isSupabaseConfigured()) {
        // Demo mode - simulate table creation locally
        setMonthlyTables(prev => {
          if (prev.includes(monthIdentifier)) return prev
          return sortMonthTables([...prev, monthIdentifier])
        })

        changeCurrentTable(monthIdentifier)
        if (resolvedCopyMode === 'empty') {
          toast.success(`${monthIdentifier.replace('_', ' ')} ready`)
        } else if (resolvedCopyMode === 'custom') {
          if (selectedMemberIds.length === 0) {
            toast.info(`${monthIdentifier} created empty (Demo Mode)`)
          } else {
            toast.info(`${monthIdentifier} created with selected members (Demo Mode only simulates this state)`)
          }
        } else {
          toast.success(`${monthIdentifier.replace('_', ' ')} ready`)
        }
        return { success: true, tableName: monthIdentifier }
      }

      if (monthlyTables.includes(monthIdentifier)) {
        toast.error(`${monthIdentifier.replace('_', ' ')} already exists.`)
        changeCurrentTable(monthIdentifier)
        return { success: true, tableName: monthIdentifier, alreadyExists: true }
      }

      // Determine the source table: use currentTable if set, otherwise find the most recent month
      let sourceTable = sourceTableOverride || currentTable

      // If no current table or we want to ensure we use the most recent, find it
      if (!sourceTable && monthlyTables.length > 0) {
        const sortedTables = sortMonthTables([...monthlyTables])
        if (sortedTables.length > 0) {
          sourceTable = sortedTables[sortedTables.length - 1]
        }
      }

      const sourceMonthStart = resolvedCopyMode === 'empty'
        ? null
        : (resolveLogicalMonthStart(sourceTable) || null)

      console.log(`Creating new month table: ${monthIdentifier}`)
      console.log(`Copying from source logical month: ${sourceMonthStart || '(none - empty)'}`)

      const { data: result, error: createError } = await supabase.rpc(
        'create_workspace_month',
        {
          p_owner_id: ownerId,
          p_year: Number(year),
          p_month: MONTHS_IN_YEAR.indexOf(monthName) + 1,
          p_source_month: sourceMonthStart,
          p_copy_mode: resolvedCopyMode,
          p_member_ids: resolvedCopyMode === 'custom' ? selectedMemberIds : []
        }
      )

      if (createError) {
        console.error('Error creating month table:', createError)
        throw new Error(`Failed to create month table: ${createError.message}`)
      }

      console.log('Month table creation result:', result)

      await ensureTableReady(monthIdentifier)

      if (resolvedCopyMode === 'empty') {
        toast.success(`${monthName} ${year} ready`)
      } else if (resolvedCopyMode === 'custom') {
        const copiedCount = selectedMemberIds.length
        toast.success(`${monthName} ${year} ready (${copiedCount} copied)`)
      } else {
        toast.success(`${monthName} ${year} ready (${result?.members_copied || 0} copied)`)
      }

      // Optimistically add new month locally so menus update immediately
      setMonthlyTables(prev => {
        if (prev.includes(monthIdentifier)) return prev
        return sortMonthTables([...prev, monthIdentifier])
      })

      // Refresh the monthly tables list from database
      if (ownerId) {
        invalidateRequestScope(`${ownerId}:workspace`, 'available-month-tables')
      }
      await fetchMonthlyTables({ forceRefresh: true })

      // Clear cache for the new month to ensure fresh data fetch
      membersCacheRef.current.delete(monthIdentifier)

      // Switch to the new month
      changeCurrentTable(monthIdentifier)

      // Force refresh members after a short delay to ensure table is ready
      setTimeout(async () => {
        membersCacheRef.current.delete(monthIdentifier)
        await fetchMembers(monthIdentifier)
        await initializeAttendanceDates()
      }, 500)

      console.log(`Successfully created month: ${monthIdentifier}`)
      return { success: true, tableName: monthIdentifier, result }
    } catch (error) {
      console.error('Error creating new month:', error)

      // Provide detailed error information
      let errorMessage = 'Failed to create new month'
      if (error.message) {
        errorMessage += `: ${error.message}`
      } else if (error.error) {
        errorMessage += `: ${error.error}`
      }

      toast.error(errorMessage)
      throw error
    }
  }

  const activeMembers = useMemo(() => members.filter((member) => !member?.deleted_at), [members])
  const searchResultSections = useMemo(() => {
    const codeMap = buildMemberIndexCodeMap(activeMembers, {
      format: memberCodeFormat,
      codeLength: memberCodeLength,
      persistedCodes: workspaceMemberCodeAssignments,
      allowLegacyFallback: false
    })
    return classifyMemberSearch({
      members: activeMembers,
      remoteMembers: serverSearchResults || [],
      deletedMembers: deletedMemberSearchTombstones,
      query: searchTerm,
      getCode: (member) => getMemberIndexCode(member, codeMap) || member?.member_code || '',
      getCodeAliases: (member) => getMemberIndexCodeAliases(member, codeMap),
      codeLength: memberCodeLength
    })
  }, [activeMembers, deletedMemberSearchTombstones, memberCodeFormat, memberCodeLength, searchTerm, serverSearchResults, workspaceMemberCodeAssignments])
  const filteredMembers = searchTerm.trim()
    ? searchResultSections.visible.slice(0, 20)
    : activeMembers

  const resolveNameColumn = useCallback(async (tableName) => {
    const cached = nameColumnCacheRef.current.get(tableName)
    if (cached) return cached
    // The live monthly schema uses the quoted legacy column. Requesting
    // speculative aliases together makes PostgREST reject the whole query.
    const nameCol = 'Full Name'
    nameColumnCacheRef.current.set(tableName, nameCol)
    return nameCol
  }, [])

  const performServerSearch = useCallback(async (term) => {
    const trimmed = term.trim()
    const requestId = ++searchRequestRef.current
    const isCurrentRequest = () => searchRequestRef.current === requestId
    if (!trimmed) {
      setServerSearchResults(null)
      return
    }

    // When workspace members are available in memory (cached or synced),
    // local search on activeMembers is 100% immediate and authoritative.
    // Typing must perform zero network requests.
    if (activeMembers.length > 0 || membersLoadedAll) {
      if (isCurrentRequest()) setServerSearchResults(null)
      return
    }

    // The IndexedDB preview index is part of the canonical local store. Search
    // may read it, but typing must never start Supabase reconciliation or fetches.
    const localMatches = await searchMemberPreviewIndex(trimmed, currentTable)
    if (!isCurrentRequest()) return
    setServerSearchResults(localMatches)
  }, [activeMembers.length, currentTable, membersLoadedAll, searchMemberPreviewIndex])

  useEffect(() => {
    performServerSearch(searchTerm)
  }, [searchTerm, currentTable, performServerSearch])

  // Function to refresh search results
  const refreshSearch = useCallback(() => {
    // Clear server search results to force re-filtering with updated members
    if (searchTerm) {
      setServerSearchResults(null)
      // Re-run the search with current term to update results
      performServerSearch(searchTerm)
    }
  }, [searchTerm, performServerSearch])

  // Function to force refresh members from database
  const forceRefreshMembers = useCallback(async () => {
    console.log('Force refreshing members from database...')
    toast.info('Refreshing member data...')

    try {
      await fetchMembers(currentTable, { forceRefresh: true, forceOnline: true })
      toast.success('Member data refreshed successfully!')
      console.log('Members refreshed, new count:', members.length)
    } catch (error) {
      console.error('Error refreshing members:', error)
      toast.error('Failed to refresh member data')
    }
  }, [currentTable, fetchMembers, members.length])

  // Silent variant for programmatic refreshes (no toasts)
  const forceRefreshMembersSilent = useCallback(async () => {
    console.log('Force refreshing members (silent) ...')
    try {
      // Force bypass cache to get fresh data from Supabase
      await fetchMembers(currentTable, { forceRefresh: true, forceOnline: true })
      console.log('Members refreshed silently, new count:', members.length)
    } catch (error) {
      console.error('Error refreshing members (silent):', error)
      // No toast here to prevent notification noise
    }
  }, [currentTable, fetchMembers, members.length])

  const refreshMemberPreviewById = useCallback(async (memberId, options = {}) => {
    const tableName = options.tableName || currentTable
    if (!memberId || !tableName) return null

    const nowIso = options.updatedAt || new Date().toISOString()
    let remoteMember = null

    if (!options.skipRemote && !isDeveloperBypass && isSupabaseConfigured() && isBrowserOnline() && !shouldUseOfflineData) {
      try {
        await ensureMemberPreviewSyncColumns(tableName)
        let response = await applyDeletedAtFilter(
          supabase
            .from(tableName)
            .select(MEMBER_PREVIEW_SELECT)
            .eq('id', memberId)
        ).maybeSingle()

        if (response.error) {
          const message = response.error.message?.toLowerCase() || ''
          const shouldFallback =
            response.error.code === 'PGRST100' ||
            response.error.code === '42703' ||
            message.includes('failed to parse') ||
            message.includes('does not exist') ||
            message.includes('column')

          if (shouldFallback) {
            response = await supabase
              .from(tableName)
              .select('*')
              .eq('id', memberId)
              .maybeSingle()
          }
        }

        if (response.error) {
          console.warn('Could not fetch saved member preview row:', response.error)
        } else {
          remoteMember = response.data
        }
      } catch (error) {
        console.warn('Could not refresh saved member preview row:', error)
      }
    }

    const fallbackMember = options.fallbackMember || {}
    const remoteTime = getMemberFreshnessTime(remoteMember || {})
    const fallbackTime = getMemberFreshnessTime(fallbackMember || {})
    const mergedMember = remoteMember && remoteTime >= fallbackTime
      ? { ...fallbackMember, ...remoteMember }
      : { ...(remoteMember || {}), ...fallbackMember }
    const patchedMember = normalizeMemberRecord({
      ...mergedMember,
      id: memberId,
      updated_at: mergedMember.updated_at || mergedMember.updatedAt || nowIso,
      inserted_at: mergedMember.inserted_at || mergedMember.created_at || nowIso
    })

    if (!patchedMember?.id) return null

    if (patchedMember.deleted_at || options.deleted) {
      setDeletedMemberSearchTombstones((prev) => [
        ...prev.filter((member) => String(member.id) !== String(memberId)),
        patchedMember
      ].slice(-100))
      setMembers((prevMembers) => {
        const nextMembers = prevMembers.filter((member) => String(member.id) !== String(memberId))
        persistLoadedMemberPreview(tableName, nextMembers, {
          totalCount: Math.max(0, (membersTotalCount || prevMembers.length) - 1),
          loadedAll: membersLoadedAll
        })
        return nextMembers
      })
      await deleteMemberPreviewMember(workspaceCacheScope, tableName, memberId)
      searchCacheRef.current.clear()
      setServerSearchResults((prev) => prev ? prev.filter((member) => String(member.id) !== String(memberId)) : prev)
      refreshSearch()
      return null
    }

    setDeletedMemberSearchTombstones((prev) => prev.filter((member) => String(member.id) !== String(memberId)))

    let nextCount = members.length
    let didInsert = false
    setMembers((prevMembers) => {
      const exists = prevMembers.some((member) => String(member.id) === String(memberId))
      didInsert = !exists
      const nextMembers = exists
        ? prevMembers.map((member) => String(member.id) === String(memberId)
          ? normalizeMemberRecord({ ...member, ...patchedMember })
          : member)
        : [patchedMember, ...prevMembers]
      nextCount = nextMembers.length
      persistLoadedMemberPreview(tableName, nextMembers, {
        totalCount: Math.max(membersTotalCount || prevMembers.length, nextMembers.length),
        loadedAll: membersLoadedAll
      })
      return nextMembers
    })

    await persistMemberPreviewIndex(tableName, [patchedMember], {
      cachedCount: Math.max(nextCount, members.length + (didInsert ? 1 : 0)),
      totalCount: Math.max(membersTotalCount || 0, nextCount),
      source: options.source || 'single-member-refresh'
    })
    applyAttendanceColumnsFromMemberRows([patchedMember], tableName)
    markMemberPreviewSyncComplete(tableName, {
      cachedCount: Math.max(nextCount, members.length + (didInsert ? 1 : 0)),
      totalCount: Math.max(membersTotalCount || 0, nextCount),
      source: options.source || 'single-member-refresh',
      lastSyncAt: nowIso,
      lastRemoteUpdatedAt: patchedMember.updated_at || nowIso
    })

    if (options.action) {
      recordRecentMemberEdit(patchedMember, nowIso, {
        action: options.action,
        summary: options.summary,
        table: tableName,
        dateKey: options.dateKey
      })
    }

    searchCacheRef.current.clear()
    setServerSearchResults((prev) => {
      if (!prev) return prev
      const exists = prev.some((member) => String(member.id) === String(memberId))
      return exists
        ? prev.map((member) => String(member.id) === String(memberId) ? patchedMember : member)
        : [patchedMember, ...prev]
    })
    refreshSearch()

    if (!options.skipBackgroundSync) {
      memberPreviewBackgroundSyncRunnerRef.current?.(tableName, {
        force: true,
        source: options.source || 'single-member-refresh'
      })
    }

    return patchedMember
  }, [
    applyDeletedAtFilter,
    applyAttendanceColumnsFromMemberRows,
    currentTable,
    ensureMemberPreviewSyncColumns,
    isDeveloperBypass,
    isSupabaseConfigured,
    markMemberPreviewSyncComplete,
    members.length,
    membersLoadedAll,
    membersTotalCount,
    persistMemberPreviewIndex,
    recordRecentMemberEdit,
    refreshSearch,
    shouldUseOfflineData,
    workspaceCacheScope
  ])

  // Historical search uses the same canonical local store as the dashboard.
  const historicalSearchSettings = useMemo(() => (
    normalizeHistoricalSearchSettings(authContext?.preferences?.historical_search_settings)
  ), [authContext?.preferences?.historical_search_settings])

  const saveHistoricalSearchSettings = useCallback(async (newSettings) => {
    const targetOwnerId = dataOwnerId || authContext?.user?.id
    if (!targetOwnerId) return false
    const cleaned = normalizeHistoricalSearchSettings(newSettings)

    try {
      if (isSupabaseConfigured()) {
        const { data, error } = await supabase.rpc('update_historical_search_settings', {
          p_owner_id: targetOwnerId,
          p_settings: cleaned
        })
        if (!error && data) {
          // The authoritative RPC already persisted this workspace setting.
          // Do not immediately replay it through the generic preference RPC.
          return true
        }
        if (isBackendDegradedError(error)) {
          markBackendDegraded(error)
          return false
        }
      }

      if (authContext?.saveWorkspacePreferences) {
        const ok = await authContext.saveWorkspacePreferences(targetOwnerId, {
          historical_search_settings: cleaned
        })
        return ok
      }

      return false
    } catch (err) {
      console.error('saveHistoricalSearchSettings error:', err)
      return false
    }
  }, [authContext, dataOwnerId])

  // It intentionally performs no REST/RPC work while the user is searching.
  // Cross-month search: runs ONLY when explicitly invoked by user action.
  // Performs zero network requests while typing.
  const searchMemberAcrossAllTables = useCallback(async (searchQuery, options = {}) => {
    const query = String(searchQuery || '').trim()
    if (!query || query.length < 2) return []

    const targetOwnerId = dataOwnerId || authContext?.user?.id
    if (!targetOwnerId || !currentTable) return []

    const activeSettings = normalizeHistoricalSearchSettings(
      options?.scopeSettings || authContext?.preferences?.historical_search_settings
    )

    const targetTables = resolveHistoricalSearchTables({
      settings: activeSettings,
      monthlyTables,
      currentTable
    })

    if (activeSettings.mode === 'custom' && targetTables.length === 0) {
      return []
    }

    return runScopedRequest(
      workspaceCacheScope,
      `search_other_months:${query}:${activeSettings.mode}:${targetTables.join(',')}:${activeSettings.include_deleted}`,
      async () => {
        try {
          if (isSupabaseConfigured()) {
            const { data, error } = await supabase.rpc('search_workspace_members_across_months_scoped', {
              p_owner_id: targetOwnerId,
              p_current_table: currentTable,
              p_query: query,
              p_limit: 30,
              p_source_tables: targetTables,
              p_include_deleted: activeSettings.include_deleted
            })

            if (!error && Array.isArray(data)) {
              return data
            }

            // Fallback to legacy RPC if scoped RPC returns error
            const { data: legacyData, error: legacyError } = await supabase.rpc('search_workspace_members_across_months', {
              p_owner_id: targetOwnerId,
              p_current_table: currentTable,
              p_query: query,
              p_limit: 30
            })

            if (!legacyError && Array.isArray(legacyData)) {
              const targetSet = new Set(targetTables)
              return legacyData.filter((row) => targetSet.has(row.source_table))
            }
          }

          // Client-side fallback
          if (targetTables.length === 0) return []
          const resultsMap = new Map()
          const currentMemberIds = new Set((activeMembers || []).map((m) => String(m.id)))

          for (const table of targetTables) {
            try {
              let { data, error } = await supabase
                .from(table)
                .select(MEMBER_PREVIEW_SELECT)
                .limit(100)

              if (error) {
                const fallback = await supabase
                  .from(table)
                  .select('*')
                  .limit(100)
                data = fallback.data
                error = fallback.error
              }

              if (error || !Array.isArray(data)) continue

              const localCodeMap = buildMemberIndexCodeMap(data, {
                format: memberCodeFormat,
                codeLength: memberCodeLength,
                persistedCodes: workspaceMemberCodeAssignments,
                allowLegacyFallback: false
              })

              const matches = classifyMemberSearch({
                members: data,
                query,
                getCode: (m) => getMemberIndexCode(m, localCodeMap) || m?.member_code || '',
                getCodeAliases: (m) => getMemberIndexCodeAliases(m, localCodeMap),
                codeLength: memberCodeLength
              }).visible

              for (const member of matches) {
                if (!activeSettings.include_deleted && member.deleted_at) continue
                const idStr = String(member.id)
                if (!resultsMap.has(idStr)) {
                  resultsMap.set(idStr, {
                    canonical_member_id: member.id,
                    source_table: table,
                    source_month_label: table.replace('_', ' '),
                    full_name: getSearchableMemberName(member),
                    gender: member.Gender || member.gender || '',
                    phone_number: member['Phone Number'] || member.phone_number || member.phone || '',
                    age: member.Age || member.age || '',
                    current_level: member['Current Level'] || member.level || '',
                    member_code: getMemberIndexCode(member, localCodeMap) || member.member_code || '',
                    already_in_current_table: currentMemberIds.has(idStr),
                    is_deleted_in_current_table: false,
                    is_deleted_in_source: Boolean(member.deleted_at),
                    source_updated_at: member.inserted_at || new Date().toISOString()
                  })
                }
              }
            } catch (tblErr) {
              console.warn(`Failed searching candidate table ${table}:`, tblErr)
            }
          }

          return [...resultsMap.values()]
        } catch (err) {
          console.error('searchMemberAcrossAllTables failed:', err)
          return []
        }
      },
      { force: true, cacheResult: false }
    )
  }, [activeMembers, authContext, currentTable, dataOwnerId, memberCodeFormat, memberCodeLength, monthlyTables, workspaceCacheScope, workspaceMemberCodeAssignments])

  // Module-level single-flight registry for cross-month attendance requests
  // Key format: workspaceOwnerId:targetTable:canonicalMemberId:attendanceDate:attendanceStatus

  // Present/Import member from another month into current month:
  // Transactional, idempotent, preserves canonical ID & member code.
  // STRICTLY uses secure RPC set_member_attendance_from_other_month with ZERO client write fallback.
  const setMemberAttendanceFromOtherMonth = useCallback(async ({
    memberId,
    sourceTable,
    targetTable = currentTable,
    attendanceDate = selectedAttendanceDate,
    attendanceStatus = 'Present',
    memberNameHint = 'Member'
  }) => {
    if (!memberId || !sourceTable || !targetTable) {
      return { success: false, error_message: 'Missing required parameters' }
    }

    const sourceMonthStart = resolveLogicalMonthStart(sourceTable)
    const targetMonthStart = resolveLogicalMonthStart(targetTable)
    if (!sourceMonthStart || !targetMonthStart) {
      const msg = 'Source and target must be registered logical months'
      toast.error(msg)
      return { success: false, error_message: msg }
    }

    const targetOwnerId = dataOwnerId || user?.id
    if (!targetOwnerId) {
      return { success: false, error_message: 'Owner identification missing' }
    }

    const dateObj = attendanceDate ? new Date(attendanceDate) : (selectedAttendanceDate || new Date())
    const dateStr = getLocalDateString(dateObj)
    const normStatus = (attendanceStatus === true || String(attendanceStatus).toLowerCase() === 'present') ? 'Present' : 'Absent'
    const requestId = `set_att_${memberId}_${targetTable}_${dateStr}_${normStatus}_${Date.now()}`

    const singleFlightKey = `${targetOwnerId}:${targetTable}:${memberId}:${dateStr}:${normStatus}`
    if (globalThis.__crossMonthInFlightRequests?.has(singleFlightKey)) {
      console.warn('Cross-month attendance request already in-flight for key:', singleFlightKey)
      return { success: false, error_message: 'Request already in progress' }
    }

    if (!globalThis.__crossMonthInFlightRequests) {
      globalThis.__crossMonthInFlightRequests = new Set()
    }
    globalThis.__crossMonthInFlightRequests.add(singleFlightKey)

    if (import.meta.env.DEV) {
      console.assert(
        memberId && sourceMonthStart && targetMonthStart && dateStr && normStatus,
        'setMemberAttendanceFromOtherMonth parameter verification before RPC',
        { memberId, sourceMonthStart, targetMonthStart, dateStr, normStatus }
      )
    }

    try {
      if (!isSupabaseConfigured()) {
        const msg = `${memberNameHint} could not be added. No member data was changed.`
        toast.error(msg)
        return { success: false, error_message: msg }
      }

      // Production exposes the hardened logical-month contract under its
      // established compatibility name. Its arguments remain logical months,
      // so callers never control a physical table or attendance column.
      const { data, error } = await supabase.rpc('set_member_attendance_from_other_month', {
        p_owner_id: targetOwnerId,
        p_source_month: sourceMonthStart,
        p_target_month: targetMonthStart,
        p_member_id: memberId,
        p_attendance_date: dateStr,
        p_attendance_status: normStatus,
        p_request_id: requestId
      })

      const isTransportError = Boolean(error)
      const isSuccessTrue = Boolean(data && data.success === true)
      const hasMemberObj = Boolean(data && data.member && data.member.id)
      const isMemberIdMatch = Boolean(hasMemberObj && String(data.member.id) === String(memberId) && (data.member_id == null || String(data.member_id) === String(memberId)))
      const isTargetMatch = Boolean(data && (String(data.target_table) === String(targetTable) || String(data.target_month) === String(targetMonthStart)))
      const isAttendanceDateMatch = Boolean(data && String(data.attendance_date) === String(dateStr))
      const isAttendanceStatusMatch = Boolean(data && String(data.attendance_status) === String(normStatus))

      const isValidResponse = !isTransportError && isSuccessTrue && hasMemberObj && isMemberIdMatch && isTargetMatch && isAttendanceDateMatch && isAttendanceStatusMatch

      if (!isValidResponse) {
        if (hasMemberObj && !isMemberIdMatch) {
          console.error('HIGH-SEVERITY IDENTITY MISMATCH: RPC returned member ID', data.member?.id, 'expected', memberId)
        }
        console.error('set_member_attendance_from_logical_month RPC error or invalid response:', error || data?.error_message || data)
        const msg = `${memberNameHint} could not be added. No member data was changed.`
        toast.error(msg)
        return { success: false, error_message: msg, serverError: error?.message || data?.error_message }
      }

      // Local-first immediate merge from confirmed RPC response ONLY
      const rawMember = data.member
      const normalizedMember = normalizeMemberRecord(rawMember)
      const codeAss = data.code_assignment
      const isPresentBool = normStatus === 'Present'

      // 1. Merge member into active members state (match strictly by canonical UUID)
      setMembers((prev) => {
        const exists = prev.some((m) => String(m.id) === String(memberId))
        if (exists) {
          return prev.map((m) => (String(m.id) === String(memberId) ? { ...m, ...normalizedMember } : m))
        }
        return [normalizedMember, ...prev]
      })

      // 2. Merge code assignment if available
      if (codeAss && codeAss.current_code) {
        writeWorkspaceMemberCodeAssignmentsCache(targetOwnerId, [codeAss])
        setWorkspaceMemberCodeAssignments((prev) => ({
          ...prev,
          [codeAss.member_id]: codeAss
        }))
      }

      // 3. Update local attendanceData (true if Present, false if Absent)
      setAttendanceData((prev) => ({
        ...prev,
        [dateStr]: {
          ...(prev[dateStr] || {}),
          [normalizedMember.id]: isPresentBool
        }
      }))

      // 4. Update local IndexedDB cache
      persistMemberPreviewIndex(targetTable, [normalizedMember], {
        workspaceScope: workspaceCacheScope
      }).catch(() => {})

      invalidateRequestScope(`${targetOwnerId || 'guest'}:${targetTable}`, 'attendance-reconciliation')

      // 5. Toast message
      const memberName = getSearchableMemberName(normalizedMember)
      const monthLabel = targetTable.replace('_', ' ')
      const actionText = isPresentBool ? 'present' : 'absent'
      if (data.status === 'already_present_in_month') {
        toast.success(`${memberName} was marked ${actionText}.`)
      } else {
        toast.success(`${memberName} was added to ${monthLabel} and marked ${actionText}.`)
      }

      return {
        success: true,
        status: data.status,
        member: normalizedMember,
        memberCode: data.member_code || codeAss?.current_code || ''
      }
    } catch (err) {
      console.error('setMemberAttendanceFromOtherMonth error:', err)
      const msg = 'The secure attendance update is not available yet. No member data was changed.'
      toast.error(msg)
      return { success: false, error_message: msg }
    } finally {
      globalThis.__crossMonthInFlightRequests?.delete(singleFlightKey)
    }
  }, [currentTable, dataOwnerId, selectedAttendanceDate, user?.id, workspaceCacheScope])

  const presentMemberFromOtherMonth = setMemberAttendanceFromOtherMonth



  // Validate member data for missing fields
  const validateMemberData = useCallback((member) => {
    const missingFields = []

    if (!member['Phone Number'] || member['Phone Number'] === null) {
      missingFields.push('Phone Number')
    }
    if (!member['Gender'] || member['Gender'] === null || member['Gender'] === '') {
      missingFields.push('Gender')
    }
    if (!member['Age'] || member['Age'] === null || member['Age'] === '') {
      missingFields.push('Age')
    }
    if (!member['Current Level'] || member['Current Level'] === null || member['Current Level'] === '') {
      missingFields.push('Current Level')
    }
    if (!member['date_of_birth'] || member['date_of_birth'] === null || member['date_of_birth'] === '') {
      missingFields.push('Date of Birth')
    }
    if (!member['parent_name_1'] || member['parent_name_1'] === null || member['parent_name_1'] === '') {
      missingFields.push('Parent Name 1')
    }
    if (!member['parent_phone_1'] || member['parent_phone_1'] === null) {
      missingFields.push('Parent Phone 1')
    }

    return missingFields
  }, [])

  // Get all past Sundays from the beginning of the month to today
  const getPastSundays = useCallback(() => {
    try {
      // Parse table name to get month and year (e.g., "December_2025" -> "December", 2025)
      const [monthName, year] = currentTable.split('_')
      const yearNum = parseInt(year)

      if (!monthName || isNaN(yearNum)) {
        console.error('Invalid table format:', currentTable)
        return []
      }

      const allSundays = getSundaysInMonth(monthName, yearNum)

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      // Filter to only past Sundays (including today)
      return allSundays.filter(sunday => sunday <= today)
    } catch (error) {
      console.error('Error getting past Sundays:', error)
      return []
    }
  }, [currentTable, getSundaysInMonth])

  // Get missing attendance for a member for past Sundays
  const getMissingAttendance = useCallback((memberId, pastSundays) => {
    const missingDates = []

    pastSundays.forEach(sunday => {
      const dateKey = getLocalDateString(sunday)
      const attendanceMap = attendanceData[dateKey] || {}
      const status = attendanceMap[memberId]

      // If status is undefined/null, it's missing
      if (status === undefined || status === null) {
        missingDates.push(sunday)
      }
    })

    return missingDates
  }, [attendanceData])
  // Wrapper function to set attendance date and save to localStorage
  const setAndSaveAttendanceDate = useCallback((date, tableName = currentTable) => {
    const effectiveTable = tableName || currentTable
    const normalizedDate = normalizeDateToSundayForTable(date, effectiveTable)
    if (!normalizedDate) return

    setSelectedAttendanceDate(normalizedDate)
    const savedDateKey = `selectedAttendanceDate_${effectiveTable}`
    localStorage.setItem(savedDateKey, normalizedDate.toISOString())
  }, [currentTable])

  const syncCalendarToToday = useCallback(async ({ forceAuto = false } = {}) => {
    if (import.meta.env.MODE === 'test') return
    if (!currentTable || authLoading) return
    // This is a local reconciliation path. Explicit admin override actions own
    // persistence; automatic calendar changes must not create background writes.
    if (!isBackendHealthy()) return

    const now = new Date()
    const currentDateKey = selectedAttendanceDate ? getLocalDateString(selectedAttendanceDate) : null

    // Admin override mode: keep the manually locked date/month for everyone.
    if (!forceAuto && !isCollaborator && lockedDefaultDate) {
      const [y, m, d] = lockedDefaultDate.split('-').map(Number)
      const lockedDate = new Date(y, m - 1, d)
      const activeLockedSunday = normalizeDateToSundayForTable(lockedDate, currentTable)
      if (!activeLockedSunday) return

      const lockedDateKey = getLocalDateString(activeLockedSunday)
      if (currentDateKey !== lockedDateKey) {
        setAndSaveAttendanceDate(activeLockedSunday, currentTable)
      }

      return
    }

    if (!forceAuto && isPersonalManualMode) {
      const targetTable = manualMonthTable && (monthlyTables.length <= 1 || monthlyTables.includes(manualMonthTable))
        ? manualMonthTable
        : currentTable
      const fallbackDate = manualSundayDate || selectedAttendanceDate || getSundayDefaultForTable(targetTable, now)
      const manualDate = normalizeDateToSundayForTable(fallbackDate, targetTable)
      const manualDateKey = manualDate ? getLocalDateString(manualDate) : null

      if (targetTable && currentTable !== targetTable) {
        changeCurrentTable(targetTable)
      }

      if (manualDate && currentDateKey !== manualDateKey) {
        setAndSaveAttendanceDate(manualDate, targetTable)
      }
      return
    }

    const todayTable = `${MONTHS_IN_YEAR[now.getMonth()]}_${now.getFullYear()}`
    const monthExists = monthlyTables.includes(todayTable)
    if (!monthExists) return

    const nextTable = todayTable
    const activeSunday = getSundayDefaultForTable(nextTable, now)
    if (!activeSunday) return

    const activeSundayKey = getLocalDateString(activeSunday)

    if (currentTable !== nextTable) {
      changeCurrentTable(nextTable)
    }

    if (currentDateKey !== activeSundayKey) {
      setAndSaveAttendanceDate(activeSunday, nextTable)
    }
  }, [
    authLoading,
    currentTable,
    selectedAttendanceDate,
    lockedDefaultDate,
    monthlyTables,
    changeCurrentTable,
    setAndSaveAttendanceDate,
    isCollaborator,
    isPersonalManualMode,
    manualMonthTable,
    manualSundayDate
  ])

  // Coalesces concurrent/re-entrant calendar saves with the same intent so a
  // duplicate invocation (double wrap, effect re-entry, repeated click) cannot
  // issue a second save_personal_preferences for the same action.
  const personalCalendarSavesRef = useRef(null)

  const setPersonalCalendarMode = useCallback(async ({
    mode = 'auto',
    tableName = currentTable,
    date,
    durationMs = PERSONAL_MANUAL_DURATION_MS,
    silent = false,
    persistPreference = true
  } = {}) => {
    const nextMode = mode === 'manual' ? 'manual' : 'auto'

    if (nextMode === 'manual' && collaboratorLockedByOwner) {
      if (!silent) {
        toast.info('Manual mode is locked while the workspace owner override is active.')
      }
      return false
    }

    // Never attempt (or toast about) an explicit calendar save while the
    // personal preference bundle is still hydrating. The UI disables the
    // controls, but this guards any path that calls in before that resolves.
    if (!preferencesHydrated) {
      console.warn('[AppContext] setPersonalCalendarMode skipped until preference hydration completes.')
      return false
    }

    // A Manual commit is only legitimate when the user explicitly chose a
    // Sunday. A bare/stale call (no explicit date) must never fall back to the
    // default month/date (January_2026 / its first Sunday) and persist stale
    // values — i.e. clicking Manual alone must not produce a save.
    if (nextMode === 'manual') {
      const explicitDate = (date instanceof Date) && !Number.isNaN(date.getTime())
      if (!explicitDate) {
        if (!silent) console.warn('[AppContext] Manual calendar save requires an explicit Sunday date; skipped.')
        return false
      }
    }

    // A while-waiting duplicate of the same calendar intent must not issue a
    // second RPC write. Reuse the in-flight save when the action matches.
    const toDateKeyArg = (value) => value instanceof Date
      ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
      : (value ? String(value) : '')
    const saveKey = nextMode === 'manual'
      ? `manual:${String(tableName || currentTable || '')}:${toDateKeyArg(date)}`
      : 'auto'
    const inflight = personalCalendarSavesRef.current
    if (inflight && inflight.key === saveKey) {
      return inflight.promise
    }

    const perform = (async () => {
    try {
      if (nextMode === 'manual') {
        const targetTable = tableName || currentTable || getCurrentMonthTable()
        const targetDate = normalizeDateToSundayForTable(
          date || selectedAttendanceDate || getSundayDefaultForTable(targetTable, new Date()),
          targetTable
        )

        if (!targetDate) {
          throw new Error('Could not find a Sunday for manual mode')
        }

      const expiresAt = new Date(Date.now() + durationMs)
        const nextPreferences = buildManualCalendarPreferences({
          tableName: targetTable,
          dateKey: getLocalDateString(targetDate),
          expiresAt: expiresAt.toISOString()
        })

        // Preference writes return false for a refused, unhealthy, or
        // unhydrated backend instead of always throwing.  Do not update the
        // visible month until the authoritative personal preference confirms.
        if (persistPreference) {
          if (!authContext?.savePersonalPreferences) {
            throw new Error('Calendar preferences are not ready to save yet')
          }
          const saved = await authContext.savePersonalPreferences(nextPreferences, {
            requireServerConfirmation: true
          })
          if (!saved) {
            if (!silent) toast.error('Manual month and Sunday were not saved. Please try again.')
            return false
          }
        }

        setConfirmedCalendarPreferenceOverride(nextPreferences)
        changeCurrentTable(targetTable, { persistPreference: false })
        setAndSaveAttendanceDate(targetDate, targetTable)
        setPersonalManualDeadlineAt(expiresAt.getTime())
        setPersonalManualExpiryWarning(false)

        return true
      }

      if (persistPreference) {
        if (!authContext?.savePersonalPreferences) {
          throw new Error('Calendar preferences are not ready to save yet')
        }
        const saved = await authContext.savePersonalPreferences(buildAutoCalendarPreferences(), {
          requireServerConfirmation: true
        })
        if (!saved) {
          if (!silent) toast.error('Auto mode was not saved. Please try again.')
          return false
        }
      }

      setConfirmedCalendarPreferenceOverride(buildAutoCalendarPreferences())
      await syncCalendarToToday({ forceAuto: true })
      setPersonalManualExpiryWarning(false)
      // Returning to Auto cancels any still-armed manual expiry timer so the
      // background expiry effect cannot later issue a redundant auto write.
      setPersonalManualDeadlineAt(null)
      return true
    } catch (error) {
      console.error('Error updating personal calendar mode:', error)
      if (!silent) {
        toast.error(error.message || 'Failed to update calendar mode')
      }
      return false
    }
    })()

    personalCalendarSavesRef.current = { key: saveKey, promise: perform }
    perform.finally(() => {
      if (personalCalendarSavesRef.current?.key === saveKey) personalCalendarSavesRef.current = null
    }).catch(() => {})
    return perform
  }, [
    authContext,
    collaboratorLockedByOwner,
    currentTable,
    selectedAttendanceDate,
    changeCurrentTable,
    setAndSaveAttendanceDate,
    syncCalendarToToday,
    preferencesHydrated
  ])

  const refreshPersonalManualInactivity = useCallback(() => {
    if (personalCalendarMode !== 'manual' || collaboratorLockedByOwner) return
    setPersonalManualDeadlineAt(getPersonalManualDeadline())
    setPersonalManualExpiryWarning(false)
  }, [personalCalendarMode, collaboratorLockedByOwner])

  const isPersonalManualExpiryBlocked = useCallback(() => {
    if (typeof document === 'undefined') return false

    // Open forms/modals, explicit in-flight actions, and marked unsaved form
    // state are all safe reasons to postpone automatic local expiry.
    return Boolean(document.querySelector(
      '[role="dialog"], [aria-modal="true"], [data-unsaved="true"], [data-saving="true"], [data-pending="true"], [aria-busy="true"]'
    ))
  }, [])

  useEffect(() => {
    if (!isPersonalManualMode || !effectiveManualDeadlineAt) return

    let timeoutId
    const scheduleExpiry = () => {
      const now = Date.now()
      const remainingMs = effectiveManualDeadlineAt - now
      const phase = getPersonalManualExpiryPhase({
        isManualMode: isPersonalManualMode,
        deadlineAt: effectiveManualDeadlineAt,
        now,
        isBlocked: isPersonalManualExpiryBlocked()
      })
      if (phase === 'active') {
        timeoutId = window.setTimeout(scheduleExpiry, remainingMs - PERSONAL_MANUAL_WARNING_MS)
        return
      }

      if (phase === 'warning') {
        setPersonalManualExpiryWarning(true)
        timeoutId = window.setTimeout(scheduleExpiry, remainingMs)
        return
      }

      if (phase === 'deferred') {
        setPersonalManualExpiryWarning(true)
        timeoutId = window.setTimeout(scheduleExpiry, 5000)
        return
      }

      setPersonalManualExpiryWarning(false)
      // Expiring Manual is a LOCAL state transition and must NOT write
      // preferences automatically. The reconciliation effect moves the visible
      // month back to the live month; no timer/background effect may issue a
      // save_personal_preferences write on its own.
      setConfirmedCalendarPreferenceOverride(buildAutoCalendarPreferences())
      setPersonalManualDeadlineAt(null)
    }

    scheduleExpiry()
    return () => window.clearTimeout(timeoutId)
  }, [effectiveManualDeadlineAt, isPersonalManualExpiryBlocked, isPersonalManualMode, setPersonalCalendarMode])

  useEffect(() => {
    if (!isPersonalManualMode || typeof document === 'undefined') return
    const refresh = () => refreshPersonalManualInactivity()
    document.addEventListener('pointerdown', refresh, { passive: true, capture: true })
    document.addEventListener('keydown', refresh, true)
    document.addEventListener('touchstart', refresh, { passive: true, capture: true })
    return () => {
      document.removeEventListener('pointerdown', refresh, true)
      document.removeEventListener('keydown', refresh, true)
      document.removeEventListener('touchstart', refresh, true)
    }
  }, [isPersonalManualMode, refreshPersonalManualInactivity])

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return
    if (!isPersonalManualMode) return

    const targetTable = manualMonthTable && monthlyTables.includes(manualMonthTable)
      ? manualMonthTable
      : currentTable
    const fallbackDate = manualSundayDate || selectedAttendanceDate || getSundayDefaultForTable(targetTable, new Date())
    const normalizedDate = normalizeDateToSundayForTable(fallbackDate, targetTable)
    const normalizedDateKey = normalizedDate ? getLocalDateString(normalizedDate) : null
    const currentDateKey = selectedAttendanceDate ? getLocalDateString(selectedAttendanceDate) : null

    if (targetTable && currentTable !== targetTable) {
      changeCurrentTable(targetTable)
      return
    }

    if (normalizedDate && currentDateKey !== normalizedDateKey) {
      setAndSaveAttendanceDate(normalizedDate, targetTable)
    }
  }, [
    isPersonalManualMode,
    manualMonthTable,
    monthlyTables,
    manualSundayDate,
    currentTable,
    selectedAttendanceDate,
    changeCurrentTable,
    setAndSaveAttendanceDate
  ])


  const setCollaboratorOverride = useCallback(async ({ enabled, tableName = currentTable, date = selectedAttendanceDate } = {}) => {
    const canAdmin = isAdminCollaborator && dataOwnerId
    console.log('[OVERRIDE] setCollaboratorOverride called:', { enabled, tableName, canAdmin, isCollaborator })
    
    if ((isCollaborator && !canAdmin) || !isSupabaseConfigured() || !user?.id) {
      console.log('[OVERRIDE] Permission check failed', { isCollaborator, canAdmin, isSupabaseConfigured: isSupabaseConfigured() })
      return false
    }

    const targetTable = tableName || currentTable
    if (!targetTable) {
      console.log('[OVERRIDE] No target table')
      return false
    }
    const targetOwnerId = canAdmin ? dataOwnerId : user.id
    console.log('[OVERRIDE] Target month:', targetTable)

    if (!enabled) {
      const previousDate = lockedDefaultDate
      setLockedDefaultDate(null)

      try {
        console.log('[OVERRIDE] Disabling override via RPC/upsert')
        const { data } = await executeSupabaseWrite(
          () => supabase.rpc('update_owner_admin_override', {
            p_owner_id: targetOwnerId,
            p_month_table: null,
            p_year: null,
            p_sunday_dates: null,
            p_locked_date: null
          }),
          { action: 'Disable workspace override' }
        )
        if (data && data.success === false) {
          throw new Error(data.error || 'Override update was rejected')
        }

        console.log('[OVERRIDE] Successfully disabled override')
        liveCalendarBroadcastRef.current = { table: null, date: null }
        await syncCalendarToToday({ forceAuto: true })
        return true
      } catch (err) {
        console.error('[OVERRIDE] Error disabling collaborator override:', err)
        setLockedDefaultDate(previousDate)
        return false
      }
    }

    const normalizedDate = normalizeDateToSundayForTable(date || new Date(), targetTable)
    if (!normalizedDate) {
      console.log('[OVERRIDE] Could not normalize date for override:', date, targetTable)
      return false
    }

    const dateKey = getLocalDateString(normalizedDate)
    const [, yearStr] = targetTable.split('_')
    const yearNum = parseInt(yearStr, 10) || normalizedDate.getFullYear()

    console.log('[OVERRIDE] Enabling override:', { dateKey, yearNum })

    const previousDate = lockedDefaultDate
    setLockedDefaultDate(dateKey)
    changeCurrentTable(targetTable)
    setAndSaveAttendanceDate(normalizedDate, targetTable)

    try {
      const rpcPayload = {
        p_owner_id: targetOwnerId,
        p_month_table: targetTable,
        p_year: yearNum,
        p_sunday_dates: [dateKey],
        p_locked_date: dateKey
      }
      
      const { data } = await executeSupabaseWrite(
        () => supabase.rpc('update_owner_admin_override', rpcPayload),
        { action: 'Enable workspace override' }
      )
      if (data && data.success === false) {
        throw new Error(data.error || 'Override update was rejected')
      }

      console.log('[OVERRIDE] Successfully enabled override, broadcasting...')
      sendAdminPeriodBroadcast({
        targetTable,
        targetDate: dateKey
      })

      liveCalendarBroadcastRef.current = { table: targetTable, date: dateKey }
      console.log('[OVERRIDE] Override enabled and broadcasted')
      return true
    } catch (err) {
      console.error('[OVERRIDE] Error enabling collaborator override:', err)
      console.error('[OVERRIDE] Error details:', err?.message, err?.code)
      setLockedDefaultDate(previousDate)
      return false
    }
  }, [
    currentTable,
    selectedAttendanceDate,
    lockedDefaultDate,
    isCollaborator,
    isAdminCollaborator,
    dataOwnerId,
    isSupabaseConfigured,
    user?.id,
    changeCurrentTable,
    setAndSaveAttendanceDate,
    sendAdminPeriodBroadcast,
    syncCalendarToToday
  ])

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return
    if (isCollaborator || !lockedDefaultDate) return

    const [yearNum, monthNum, dayNum] = lockedDefaultDate.split('-').map(Number)
    if (Number.isNaN(yearNum) || Number.isNaN(monthNum) || Number.isNaN(dayNum)) return

    const overrideEnd = new Date(yearNum, monthNum - 1, dayNum + 1)
    const noticeKey = `override_notice_${lockedDefaultDate}`

    const checkOverrideWindow = async () => {
      const now = new Date()
      if (now.getTime() >= overrideEnd.getTime()) {
        const ok = await setCollaboratorOverride({ enabled: false })
        if (ok) {
          toast.info('Override ended. Auto mode is active again.')
        }
        return
      }

      const todayKey = getLocalDateString(now)
      if (todayKey !== lockedDefaultDate) {
        localStorage.removeItem(noticeKey)
        return
      }

      if (localStorage.getItem(noticeKey) === 'true') return

      const hoursLeft = Math.max(1, Math.ceil((overrideEnd.getTime() - now.getTime()) / (60 * 60 * 1000)))
      toast.info(`Override is active for today and will turn off in about ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}.`)
      localStorage.setItem(noticeKey, 'true')
    }

    checkOverrideWindow().catch((err) => {
      console.error('Error checking override window:', err)
    })

    const intervalId = setInterval(() => {
      checkOverrideWindow().catch((err) => {
        console.error('Error checking override window:', err)
      })
    }, 30 * 60 * 1000)

    return () => clearInterval(intervalId)
  }, [isCollaborator, lockedDefaultDate, setCollaboratorOverride])

  // Auto-sync month/date with the real calendar for all signed-in users.
  useEffect(() => {
    if (import.meta.env.MODE === 'test') return
    const run = () => {
      syncCalendarToToday().catch((err) => {
        console.error('Live calendar sync failed:', err)
      })
    }

    run()
    const intervalId = setInterval(run, 30000)
    return () => clearInterval(intervalId)
  }, [syncCalendarToToday])

  const acknowledgeAdminSync = useCallback(async () => {
    if (!adminSyncNotice) return
    const { targetTable, targetDate, blocking } = adminSyncNotice
    setAdminSyncNotice(null)
    const applyDate = async () => {
      if (!targetDate) return
      const [y, m, d] = targetDate.split('-').map(Number)
      if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return
      const dateObj = new Date(y, m - 1, d)
      const normalizedDate = normalizeDateToSundayForTable(dateObj, targetTable || currentTable)
      if (!normalizedDate) return

      setAndSaveAttendanceDate(normalizedDate, targetTable || currentTable)
      const attendanceMap = await fetchAttendanceForDate(normalizedDate)
      const dateKey = getLocalDateString(normalizedDate)
      setAttendanceData(prev => ({
        ...prev,
        [dateKey]: attendanceMap
      }))
    }

    try {
      if (targetTable && targetTable !== currentTable) {
        changeCurrentTable(targetTable)
        if (import.meta.env.MODE === 'test') {
          await applyDate()
        } else {
          setTimeout(() => {
            applyDate()
          }, 200)
        }
      } else {
        await applyDate()
      }

      await logActivity('admin_period_refresh_ack', {
        targetTable,
        targetDate,
        blocking
      })
    } catch (err) {
      console.error('Error acknowledging admin sync:', err)
    }
  }, [
    adminSyncNotice,
    currentTable,
    changeCurrentTable,
    setAndSaveAttendanceDate,
    fetchAttendanceForDate,
    logActivity
  ])

  // Fetch monthly tables when dependencies change (e.g., collaborator status)
  useEffect(() => {
    fetchMonthlyTables()
  }, [fetchMonthlyTables])

  // Restore saved month or fall back to a valid table on load
  useEffect(() => {
    if (monthlyTables.length > 0) {
      // If the user is not authenticated locally, prefer a known-safe default table
      if (!authContext?.user) {
        if (monthlyTables.includes(DEFAULT_TABLE)) {
          setCurrentTable(DEFAULT_TABLE)
          localStorage.setItem('selectedMonthTable', DEFAULT_TABLE)
          return
        }
      }
      // If the current table is valid, keep it
      if (currentTable && monthlyTables.includes(currentTable)) {
        return
      }
      // Current table is invalid - try localStorage for active workspace, then owner sticky month, then DEFAULT_TABLE, then latest
      const storageKey = isCollaborator && dataOwnerId ? `selectedMonthTable_${dataOwnerId}` : 'selectedMonthTable'
      const saved = (typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null) ||
        (typeof window !== 'undefined' ? localStorage.getItem('selectedMonthTable') : null) ||
        ownerStickyMonth ||
        authContext?.preferences?.current_month_table
      // Only override if we have real data from Supabase (not just fallback)
      // If saved month exists and we're still on fallback, wait for real data to load
      if (saved && !monthlyTables.includes(saved) && monthlyTables.length === 1 && monthlyTables[0] === DEFAULT_TABLE) {
        return // Don't override yet, real tables are still loading
      }
      if (saved && monthlyTables.includes(saved)) {
        setCurrentTable(saved)
      } else if (monthlyTables.includes(DEFAULT_TABLE)) {
        setCurrentTable(DEFAULT_TABLE)
        localStorage.setItem(storageKey, DEFAULT_TABLE)
      } else {
        const latest = monthlyTables[monthlyTables.length - 1]
        setCurrentTable(latest)
        localStorage.setItem(storageKey, latest)
      }
    }
  }, [authContext?.preferences?.current_month_table, authContext?.user, currentTable, dataOwnerId, isCollaborator, monthlyTables, ownerStickyMonth])

  // Fetch members on component mount and when current table changes
  // Wait for auth AND month resolution before fetching to avoid the
  // January-provisional-fetch race (provisional table → render → restored month → refetch).
  useEffect(() => {
    if (authLoading || !currentTable || !monthResolved) {
      return // Don't fetch while auth is still loading, table is null, or month not resolved
    }
    fetchMembers()
  }, [currentTable, authLoading, dataOwnerId, monthResolved, user?.id])

  // Initialize attendance dates when current table or collaborator sticky Sundays change
  useEffect(() => {
    if (!currentTable) return
    initializeAttendanceDates()
  }, [currentTable, ownerStickySundays, isCollaborator])

  // Check for badge processing after attendance data is loaded
  useEffect(() => {
    if (!badgeProcessingEnabled) return
    if (!currentTable || processedEndOfMonthRef.current.has(currentTable)) return
    if (Object.keys(attendanceData).length === 0) return

    const timeoutId = setTimeout(() => {
      if (isMonthAttendanceComplete()) {
        console.log('Month has 40+ members marked, processing badges...')
        processEndOfMonthBadges()
      }
    }, 1000)

    return () => clearTimeout(timeoutId)
  }, [attendanceData, isMonthAttendanceComplete, processEndOfMonthBadges, currentTable, badgeProcessingEnabled])

  // Badge filter functions
  const toggleBadgeFilter = (badgeType) => {
    setBadgeFilter(prev => {
      const newFilter = prev.includes(badgeType)
        ? prev.filter(type => type !== badgeType)
        : [...prev, badgeType]

      // Save to localStorage
      localStorage.setItem('badgeFilter', JSON.stringify(newFilter))
      return newFilter
    })
  }

  // Helper function to check if member has a specific badge
  const memberHasBadge = (member, badgeType) => {
    // Guard against undefined member objects (e.g., during fast search renders)
    if (!member) {
      console.warn('memberHasBadge: member is undefined for badgeType', badgeType)
      return false
    }

    // Check both the Supabase columns and Manual Badges array for compatibility
    let hasSupabaseBadge = false
    let hasManualBadge = false

    switch (badgeType) {
      case 'member':
        hasSupabaseBadge = member['Member'] === 'Yes'
        hasManualBadge = (member['Manual Badges'] || []).includes('member')
        break
      case 'regular':
        hasSupabaseBadge = member['Regular'] === 'Yes'
        hasManualBadge = (member['Manual Badges'] || []).includes('regular')
        break
      case 'newcomer':
        hasSupabaseBadge = member['Newcomer'] === 'Yes'
        hasManualBadge = (member['Manual Badges'] || []).includes('newcomer')
        break
      default:
        return false
    }

    const result = hasSupabaseBadge || hasManualBadge
    return result
  }

  // Load all attendance data for all Sunday dates in the current month
  const loadAllAttendanceData = useCallback(async (options = {}) => {
    const { forceOnline = false } = options
    const ownerId = dataOwnerId || user?.id
    const requestScope = `${ownerId || 'guest'}:${currentTable}`
    try {
      if (shouldUseOfflineData && !forceOnline) {
        const snapshotRecord = await getOfflineSnapshot().catch(() => null)
        const snapshot = snapshotRecord?.snapshot
        if (snapshot?.attendanceData && applyOfflineSnapshot(snapshotRecord)) {
          return snapshot.attendanceData
        }
      }

      if (isDeveloperBypass || !isSupabaseConfigured()) {
        console.log('Demo mode - attendance data will be managed locally')
        return attendanceDataRef.current
      }

      devCountersRef.current.attendanceFetchCount = (devCountersRef.current.attendanceFetchCount || 0) + 1

      const attendanceColumns = getAttendanceColumnsForMonthTable(currentTable)
      const attendanceColNames = (attendanceColumns || []).map(c => `"${c.column_name}"`)
      const attendanceSelect = ['id', ...attendanceColNames].join(',')

      const allData = await runScopedRequest(
        requestScope,
        'attendance-reconciliation',
        async () => {
          const rows = []
          let offset = 0
          const PAGE_SIZE = 1000
          while (true) {
            // Project only id and attendance columns for this month table
            let query = attendanceColNames.length > 0
              ? supabase.from(currentTable).select(attendanceSelect)
              : supabase.from(currentTable).select('*')
            if (ownerId) query = query.eq('workspace_owner_id', ownerId)
            if (typeof query.is === 'function') {
              query = query.is('deleted_at', null)
            } else if (typeof query.filter === 'function') {
              query = query.filter('deleted_at', 'is', null)
            }
            let { data: page, error: pageError } = await query.range(offset, offset + PAGE_SIZE - 1)
            if (pageError && attendanceColNames.length > 0) {
              // Retry with select('*') if custom column projection failed (e.g. legacy table schema)
              let fallbackQuery = supabase.from(currentTable).select('*')
              if (ownerId) fallbackQuery = fallbackQuery.eq('workspace_owner_id', ownerId)
              if (typeof fallbackQuery.is === 'function') {
                fallbackQuery = fallbackQuery.is('deleted_at', null)
              }
              const fallbackRes = await fallbackQuery.range(offset, offset + PAGE_SIZE - 1)
              page = fallbackRes.data
              pageError = fallbackRes.error
            }
            if (pageError) throw pageError
            if (!page?.length) break
            rows.push(...page)
            if (page.length < PAGE_SIZE) break
            offset += PAGE_SIZE
          }
          return rows
        },
        { force: forceOnline, cacheResult: true }
      )

      // Transform data into the format expected by the UI
      const newAttendanceData = {}

      attendanceColumns.forEach(col => {
        const columnName = col.column_name
        const colNameLower = columnName.toLowerCase()

        let dateKey = null

        // NEW format: attendance_2025_12_07
        const newMatch = colNameLower.match(/attendance_(\d{4})_(\d{2})_(\d{2})/)
        if (newMatch) {
          const year = parseInt(newMatch[1])
          const month = parseInt(newMatch[2]) - 1 // 0-indexed
          const day = parseInt(newMatch[3])
          const date = new Date(year, month, day)
          dateKey = getLocalDateString(date)
        }

        // OLD format: Attendance 7th, Attendance 14th
        if (!dateKey) {
          const oldMatch = columnName.match(/(\d+)(st|nd|rd|th)/)
          if (oldMatch) {
            const day = parseInt(oldMatch[1])
            // Get current month and year from table name
            const [monthName, year] = currentTable.split('_')
            const monthIndex = [
              'January', 'February', 'March', 'April', 'May', 'June',
              'July', 'August', 'September', 'October', 'November', 'December'
            ].indexOf(monthName)

            if (monthIndex !== -1) {
              const date = new Date(parseInt(year), monthIndex, day)
              dateKey = getLocalDateString(date)
            }
          }
        }

        if (dateKey) {
          newAttendanceData[dateKey] = {}

          allData.forEach(record => {
            const val = record[columnName]
            // Include both Present (true) and Absent (false) records
            if (val === 'Present' || val === 'Absent') {
              newAttendanceData[dateKey][record.id] = val === 'Present'
            }
          })
        }
      })

      const pendingChanges = pendingSyncCount > 0
        ? await getPendingOfflineChanges().catch(() => [])
        : []
      const reconciledAttendanceData = pendingChanges.length > 0
        ? applyPendingAttendanceChanges(newAttendanceData, pendingChanges, currentTable)
        : newAttendanceData

      // Update attendance data state cleanly
      setAttendanceData(prev => {
        const next = { ...prev }
        Object.keys(reconciledAttendanceData).forEach(dk => {
          next[dk] = { ...(next[dk] || {}), ...reconciledAttendanceData[dk] }
        })
        attendanceDataRef.current = next
        return next
      })
      console.log('Loaded attendance data for all dates:', Object.keys(reconciledAttendanceData), 'from', allData.length, 'rows')
      return reconciledAttendanceData

    } catch (error) {
      console.error('Error loading attendance data:', error)
      return attendanceDataRef.current
    }
  }, [applyOfflineSnapshot, currentTable, dataOwnerId, isDeveloperBypass, pendingSyncCount, shouldUseOfflineData, user?.id])

  // Load all badge data for the current table
  const loadAllBadgeData = useCallback(async ({ force = false } = {}) => {
    try {
      if (isDeveloperBypass || !isSupabaseConfigured()) {
        console.log('Demo mode - badge data will be managed locally')
        return
      }
      if (!isBackendHealthy()) return
      const ownerId = dataOwnerId || user?.id
      const requestScope = `${ownerId || 'guest'}:${currentTable}`

      await runScopedRequest(
        requestScope,
        'badge-reconciliation',
        async () => {
          appContextLog('Loading badge data from Supabase...')

          let { data, error } = await supabase
            .from(currentTable)
            .select(MEMBER_BADGE_SELECT)

          if (error) {
            const message = error.message?.toLowerCase() || ''
            const missingColumn =
              error.code === 'PGRST100' ||
              error.code === '42703' ||
              message.includes('failed to parse') ||
              message.includes('does not exist') ||
              message.includes('column')

            if (missingColumn) {
              console.warn('Badge columns not fully available; retrying with legacy badge columns:', error)
              const fallback = await supabase
                .from(currentTable)
                .select('id,"Member","Regular","Newcomer"')
              data = fallback.data
              error = fallback.error
            }
          }

          if (error) {
            if (isBackendDegradedError(error)) markBackendDegraded(error)
            console.error('Error loading badge data:', error)

            // Only treat as missing table if it's actually a missing TABLE error
            const missingTable =
              error.code === '42P01' || // undefined_table
              error.code === 'PGRST205' ||
              (error.message?.includes('relation') && error.message?.includes('does not exist'))

            if (missingTable) {
              console.warn('Table appears to be missing during badge load:', currentTable)
            }
            return null
          }

          appContextLog('Badge data loaded:', data?.slice(0, 3))

          // Update members with badge data
          if (Array.isArray(data)) {
            setMembers(prev => prev.map(member => {
              const badgeData = data.find(d => d.id === member.id)
              if (badgeData) {
                return {
                  ...member,
                  'Member': badgeData.Member,
                  'Regular': badgeData.Regular,
                  'Newcomer': badgeData.Newcomer,
                  'Manual Badge': badgeData['Manual Badge'],
                  'Badge Type': badgeData['Badge Type']
                }
              }
              return member
            }))
          }
          return data
        },
        { force, cacheResult: true }
      )

    } catch (error) {
      console.error('Error loading badge data:', error)
    }
  }, [currentTable, dataOwnerId, isDeveloperBypass, isSupabaseConfigured, user?.id])

  const prepareOfflineData = async () => {
    if (!isOnline) {
      toast.error('Go online before preparing offline data.')
      return { success: false, error: 'offline' }
    }

    setIsPreparingOffline(true)
    try {
      const localMembersBeforeRefresh = (members || []).map(normalizeMemberRecord)
      const indexedMembersBeforeRefresh = currentTable
        ? await readMemberPreviewIndex(currentTable).catch(() => [])
        : []
      const pendingChangesBeforeRefresh = await getPendingOfflineChanges().catch(() => [])
      let snapshotMembers = localMembersBeforeRefresh
      let snapshotAttendanceData = attendanceData
      if (currentTable) {
        const [freshMembers, freshAttendance] = await Promise.all([
          fetchMembers(currentTable, {
            forceRefresh: true,
            background: true,
            forceOnline: true,
            fullSnapshot: true
          }).catch((error) => {
            console.warn('Offline preparation could not refresh members:', error)
            return null
          }),
          loadAllAttendanceData({ forceOnline: true }).catch((error) => {
            console.warn('Offline preparation could not refresh attendance:', error)
            return null
          })
        ])
        if (Array.isArray(freshMembers)) {
          snapshotMembers = mergeMemberSnapshotSources(
            freshMembers,
            indexedMembersBeforeRefresh,
            localMembersBeforeRefresh
          )
        }
        snapshotMembers = applyPendingChangesToMemberSnapshot(
          snapshotMembers,
          pendingChangesBeforeRefresh,
          currentTable
        )
        if (freshAttendance && typeof freshAttendance === 'object') {
          const hasPendingAttendanceChanges = pendingChangesBeforeRefresh.some((change) => (
            change?.action_type === 'attendance_mark' || change?.action_type === 'bulk_attendance_mark'
          ))
          snapshotAttendanceData = hasPendingAttendanceChanges
            ? applyPendingAttendanceChanges(freshAttendance, pendingChangesBeforeRefresh, currentTable)
            : freshAttendance
        }

        const latestSnapshotUpdate = snapshotMembers.reduce((latest, member) => {
          const updated = getMemberFreshnessTime(member)
          return updated > latest ? updated : latest
        }, 0)

        setMembers(snapshotMembers)
        setAttendanceData(snapshotAttendanceData)
        setMembersTotalCount(snapshotMembers.length)
        setMembersLoadedAll(true)
        persistLoadedMemberPreview(currentTable, snapshotMembers, {
          totalCount: snapshotMembers.length,
          loadedAll: true
        })
        await persistMemberPreviewIndex(currentTable, snapshotMembers, {
          cachedCount: snapshotMembers.length,
          totalCount: snapshotMembers.length,
          source: 'offline-prepare'
        })
        applyAttendanceColumnsFromMemberRows(snapshotMembers, currentTable)
        markMemberPreviewSyncComplete(currentTable, {
          cachedCount: snapshotMembers.length,
          totalCount: snapshotMembers.length,
          source: 'offline-prepare',
          lastSyncAt: new Date().toISOString(),
          lastRemoteUpdatedAt: latestSnapshotUpdate
            ? new Date(latestSnapshotUpdate).toISOString()
            : new Date().toISOString()
        })
      }

      const cachedAt = await saveOfflineSnapshot({
        members: snapshotMembers,
        monthlyTables,
        currentTable,
        attendanceData: snapshotAttendanceData,
        selectedAttendanceDate: selectedAttendanceDate ? getLocalDateString(selectedAttendanceDate) : null,
        preferences: preferences || null,
        guidedFormSettings,
        workspace: preferences?.workspace_name || null,
        authenticated_user_id: user?.id || null,
        data_owner_id: dataOwnerId || user?.id || null,
        is_collaborator: isCollaborator,
        is_admin_collaborator: isAdminCollaborator,
        owner_email: ownerEmail || null,
        saved_at: new Date().toISOString()
      })

      await refreshOfflineStatus()
      setOfflineStatusMessage('Offline data is ready.')
      notify.success('You can now use the app without internet.', {
        title: 'Offline data is ready.'
      })
      return { success: true, cachedAt }
    } catch (error) {
      console.error('Failed to prepare offline data:', error)
      toast.error(error?.message || 'Failed to prepare offline data.')
      return { success: false, error }
    } finally {
      setIsPreparingOffline(false)
    }
  }

  useEffect(() => {
    if (!user?.id || !hasAccess || loading) return undefined
    if (offlineMode !== 'auto') return undefined
    if (!isOnline || pendingSyncCount > 0) return undefined
    if (!currentTable || isPreparingOffline || isSyncingOffline) return undefined
    if (autoPrepareOfflineRef.current.running) return undefined

    const cachedAt = offlineCacheMeta?.cached_at ? Date.parse(offlineCacheMeta.cached_at) : 0
    const cachedMemberCount = Number(offlineCacheMeta?.member_count || 0)
    const expectedMemberCount = Math.max(
      Number.isFinite(membersTotalCount) ? membersTotalCount : 0,
      Array.isArray(members) ? members.length : 0
    )
    const cacheAgeMs = cachedAt > 0 ? Date.now() - cachedAt : Number.POSITIVE_INFINITY
    const missingCache = !offlineCacheMeta || cachedMemberCount <= 0
    const memberCacheBehind = expectedMemberCount > 0 && cachedMemberCount + 3 < expectedMemberCount
    const cacheVeryOld = cacheAgeMs > 1000 * 60 * 60 * 12

    if (!missingCache && !memberCacheBehind && !cacheVeryOld) return undefined

    const signature = [
      user.id,
      dataOwnerId || user.id,
      currentTable,
      cachedMemberCount,
      expectedMemberCount,
      missingCache ? 'missing' : cacheVeryOld ? 'old' : 'behind'
    ].join(':')

    if (autoPrepareOfflineRef.current.signature === signature) return undefined
    autoPrepareOfflineRef.current.signature = signature

    const timer = setTimeout(async () => {
      if (autoPrepareOfflineRef.current.running) return
      autoPrepareOfflineRef.current.running = true
      try {
        const result = await prepareOfflineData()
        if (result?.success === false) {
          autoPrepareOfflineRef.current.signature = ''
          setOfflineStatusMessage('Auto refresh failed - use Refresh data to try again.')
        }
      } catch (error) {
        console.warn('Automatic offline data preparation failed:', error)
        autoPrepareOfflineRef.current.signature = ''
        setOfflineStatusMessage('Auto refresh failed - use Refresh data to try again.')
      } finally {
        autoPrepareOfflineRef.current.running = false
      }
    }, missingCache ? 900 : 1800)

    return () => clearTimeout(timer)
  }, [
    user?.id,
    dataOwnerId,
    hasAccess,
    loading,
    isOnline,
    offlineMode,
    pendingSyncCount,
    currentTable,
    isPreparingOffline,
    isSyncingOffline,
    offlineCacheMeta,
    membersTotalCount,
    members
  ])

  const clearOfflineCacheData = async () => {
    setIsPreparingOffline(true)
    try {
      await clearAllOfflineData()
      clearMemberPreviewLocalStorage()
      await refreshOfflineStatus()
      setOfflineStatusMessage('Offline cache cleared.')
      toast.success('Offline cache cleared.')
      return { success: true }
    } catch (error) {
      console.error('Failed to clear offline cache:', error)
      toast.error(error?.message || 'Failed to clear offline cache.')
      return { success: false, error }
    } finally {
      setIsPreparingOffline(false)
    }
  }

  const syncOfflineChanges = async (options = {}) => {
    const { manual = false } = options
    if (offlineSyncInFlightRef.current) {
      return { success: false, syncing: true }
    }
    if (!isOnline || !isBrowserOnline()) {
      toast.info('You are offline. Sync will be available when the connection returns.')
      return { success: false, error: 'offline' }
    }
    if (offlineMode === 'offline') {
      toast.info('Switch to Auto or Online before syncing saved changes.')
      return { success: false, error: 'forced-offline' }
    }
    if (!isBackendHealthy()) {
      setOfflineStatusMessage('Service is temporarily unavailable. Saved offline changes will retry after recovery.')
      return { success: false, error: 'service-unavailable', queued: true }
    }

    offlineSyncInFlightRef.current = true
    setIsSyncingOffline(true)
    let shouldPullPreviewSync = false
    try {
      const pendingChanges = await getPendingOfflineChanges()
      let synced = 0
      let conflicts = 0
      let failed = 0

      for (const change of pendingChanges) {
        if (!change || change.sync_status === 'conflict') {
          conflicts += 1
          continue
        }
        if (['unsupported', 'superseded'].includes(change.sync_status)) {
          continue
        }
        // Automatic flushes only attempt changes within the retry budget and
        // after the backoff window has elapsed. Manual syncs bypass the gate so
        // the user can always recover budget-exhausted work explicitly.
        if (!manual && !isChangeRetryEligible(change, Date.now())) {
          continue
        }

        if (change.action_type === 'preferences_update') {
          try {
            const preferenceUserId = change.user_id || user?.id
            if (!preferenceUserId) throw new Error('Missing user for preference sync.')
            // Workspace member-code format and length are changed only through
            // the locked configuration RPC. An older offline preference queue
            // must never revert a confirmed workspace conversion.
            const { member_code_format: _queuedFormat, member_code_length: _queuedLength, ...safeQueuedPreferences } = change.preferences || {}
            await executeSupabaseWrite(
              () => supabase
                .from('user_preferences')
                .upsert({
                  ...safeQueuedPreferences,
                  user_id: preferenceUserId,
                  updated_at: new Date().toISOString()
                }, {
                  onConflict: 'user_id'
                }),
              { action: 'Sync offline preferences' }
            )
            await removeOfflineChange(change.local_change_id)
            synced += 1
          } catch (error) {
            const failureState = getNextFailureSyncStatus(change, { transient: isTransientSupabaseError(error) })
            await updateOfflineChangeStatus(change.local_change_id, {
              sync_status: failureState.sync_status,
              retry_count: failureState.retry_count,
              error: failureState.error || error?.message || 'Preference sync failed.'
            })
            failed += 1
          }
          continue
        }

        if (['member_add', 'member_update', 'member_delete'].includes(change.action_type)) {
          try {
            const changeTable = change.table_name || currentTable
            if (!changeTable) throw new Error('Missing monthly table for member sync.')
            if (change.action_type === 'member_add') {
              // A queued add must never resurrect a row that was deleted on the
              // server (same id, deleted_at set). Reconcile instead of upserting.
              const { data: addExistingRows, error: addCheckError } = await supabase
                .from(changeTable)
                .select('id, deleted_at')
                .eq('id', change.member_id)
                .limit(1)
              if (addCheckError) throw addCheckError
              const addResolution = resolveServerDeletedMemberChange(change, addExistingRows?.[0])
              if (addResolution.action === 'fail') {
                addMemberDeleteTombstone(change.member_id, addExistingRows?.[0]?.deleted_at || null, changeTable)
                await updateOfflineChangeStatus(change.local_change_id, {
                  sync_status: 'failed',
                  error: addResolution.error
                })
                failed += 1
                continue
              }
              const queuedMember = sanitizeQueuedMemberInsert(change.member_data || {})
              await executeSupabaseWrite(
                () => supabase
                  .from(changeTable)
                  .upsert([queuedMember], { onConflict: 'id' }),
                { action: `Sync offline member add in ${changeTable}` }
              )
              setMembers(prev => prev.map(member => (
                member.id === change.member_id
                  ? normalizeMemberRecord({ ...member, __offline_status: null })
                  : member
              )))
            } else if (change.action_type === 'member_update') {
              await updateMember(change.member_id, change.updates || {}, {
                silent: true,
                flushMode: true,
                skipRefresh: changeTable !== currentTable,
                targetTable: changeTable,
                ownerId: change.owner_id,
                identity: change.identity
              })
            } else if (change.action_type === 'member_delete') {
              // A delete of a row that is already gone (missing or deleted_at)
              // is idempotent success: retire the queued delete instead of
              // failing forever. The tombstone keeps local caches in sync.
              const { data: deleteExistingRows, error: deleteCheckError } = await supabase
                .from(changeTable)
                .select('id, deleted_at')
                .eq('id', change.member_id)
                .limit(1)
              if (deleteCheckError) throw deleteCheckError
              const deleteResolution = resolveServerDeletedMemberChange(change, deleteExistingRows?.[0])
              if (deleteResolution.action === 'remove') {
                addMemberDeleteTombstone(change.member_id, deleteExistingRows?.[0]?.deleted_at || new Date().toISOString(), changeTable)
                await removeOfflineChange(change.local_change_id)
                synced += 1
                continue
              }
              const deletedAt = new Date().toISOString()
              const deleteResult = await executeSupabaseWrite(
                () => supabase
                  .from(changeTable)
                  .update({ deleted_at: deletedAt, updated_at: deletedAt })
                  .eq('id', change.member_id)
                  .select('id'),
                { action: `Sync offline member delete in ${changeTable}` }
              )
              assertSupabaseMutationAffected(deleteResult, 'Offline member delete')
            }

            await removeOfflineChange(change.local_change_id)
            synced += 1
          } catch (error) {
            // The row vanished between our pre-check and the write; a delete
            // that affects no rows is already achieved server-side.
            if (change.action_type === 'member_delete' && error?.code === 'DATSER_NO_ROWS') {
              addMemberDeleteTombstone(change.member_id, new Date().toISOString(), changeTable)
              await removeOfflineChange(change.local_change_id)
              synced += 1
              continue
            }
            // Update/add/attendance against a member proven deleted on the
            // server cannot apply and must not resurrect it. Reconcile to a
            // terminal, recoverable state (tombstone + failed, no auto-retry).
            if (error?.code === 'DATSER_NO_ROWS' && ['member_update', 'member_add'].includes(change.action_type)) {
              const { data: verifyRows } = await supabase
                .from(changeTable)
                .select('id, deleted_at')
                .eq('id', change.member_id)
                .limit(1)
                .catch(() => ({ data: null }))
              if (!verifyRows?.[0] || verifyRows[0].deleted_at) {
                addMemberDeleteTombstone(change.member_id, verifyRows?.[0]?.deleted_at || null, changeTable)
                await updateOfflineChangeStatus(change.local_change_id, {
                  sync_status: 'failed',
                  error: 'Member was deleted on the server. This change is kept locally and will not auto-retry.'
                })
                failed += 1
                continue
              }
            }
            const failureState = getNextFailureSyncStatus(change, { transient: isTransientSupabaseError(error) })
            await updateOfflineChangeStatus(change.local_change_id, {
              sync_status: failureState.sync_status,
              retry_count: failureState.retry_count,
              error: failureState.error || error?.message || 'Member sync failed.'
            })
            failed += 1
          }
          continue
        }

        if (change.action_type !== 'attendance_mark' && change.action_type !== 'bulk_attendance_mark') {
          await updateOfflineChangeStatus(change.local_change_id, {
            sync_status: 'unsupported',
            error: 'This offline change type is not supported yet.'
          })
          failed += 1
          continue
        }

        const changeTable = change.table_name || currentTable
        const effectiveDate = normalizeDateToSundayForTable(new Date(change.service_date), changeTable)
        if (!effectiveDate) {
          await updateOfflineChangeStatus(change.local_change_id, {
            sync_status: 'failed',
            error: 'Could not resolve the attendance Sunday for this change.'
          })
          failed += 1
          continue
        }

        try {
          let attendanceColumn = await findAttendanceColumnForDateInTable(effectiveDate, changeTable)
          if (!attendanceColumn) {
            attendanceColumn = getAttendanceColumnNameForDate(effectiveDate)
            const { error: columnError } = await supabase.rpc('add_attendance_column', {
              table_name: changeTable,
              column_name: attendanceColumn
            })
            if (columnError) throw columnError
          }

          const { data: serverRows, error: serverError } = await supabase
            .from(changeTable)
            .select(`id,${attendanceColumn},deleted_at`)
            .eq('id', change.member_id)
            .limit(1)
          if (serverError) throw serverError

          // Attendance against a member deleted on the server can never apply
          // and must not resurrect it: reconcile to a terminal recoverable
          // state (tombstone + failed, no auto-retry).
          const attendanceResolution = resolveServerDeletedMemberChange(change, serverRows?.[0])
          if (attendanceResolution.action === 'fail') {
            addMemberDeleteTombstone(change.member_id, serverRows?.[0]?.deleted_at || null, changeTable)
            await updateOfflineChangeStatus(change.local_change_id, {
              sync_status: 'failed',
              error: attendanceResolution.error
            })
            failed += 1
            continue
          }

          const rawServerValue = serverRows?.[0]?.[attendanceColumn]
          const serverValue = rawServerValue === 'Present' ? true : rawServerValue === 'Absent' ? false : undefined
          const queuedPresent = normalizeQueuedAttendanceValue(change.present)

          if (isOfflineAttendanceConflict(
            serverValue,
            queuedPresent,
            change.base_present,
            change.has_base_value === true
          )) {
            await updateOfflineChangeStatus(change.local_change_id, {
              sync_status: 'conflict',
              server_value: serverValue,
              error: 'Server attendance changed while this device was offline.'
            })
            conflicts += 1
            continue
          }

          if (isAttendanceAlreadySynced(serverValue, queuedPresent)) {
            await removeOfflineChange(change.local_change_id)
            synced += 1
            continue
          }

          const attendanceUpdatedAt = new Date().toISOString()
          const attendanceResult = await executeSupabaseWrite(
            () => supabase
              .from(changeTable)
              .update({
                [attendanceColumn]: queuedPresent === null ? null : queuedPresent ? 'Present' : 'Absent',
                updated_at: attendanceUpdatedAt
              })
              .eq('id', change.member_id)
              .select('id'),
            { action: `Sync offline attendance in ${changeTable}` }
          )
          assertSupabaseMutationAffected(attendanceResult, 'Offline attendance sync')
          syncNormalizedAttendanceRecord(change.member_id, effectiveDate, queuedPresent).catch((error) => {
            console.warn('Background normalized attendance sync failed:', error)
          })
          await removeOfflineChange(change.local_change_id)
          invalidateRequestScope(`${dataOwnerId || user?.id || 'guest'}:${changeTable}`, 'attendance-reconciliation')
          synced += 1
        } catch (error) {
          // The member disappeared between the pre-check and the write.
          if (error?.code === 'DATSER_NO_ROWS') {
            addMemberDeleteTombstone(change.member_id, new Date().toISOString(), changeTable)
            await updateOfflineChangeStatus(change.local_change_id, {
              sync_status: 'failed',
              error: 'Member was deleted on the server. This change is kept locally and will not auto-retry.'
            })
            failed += 1
            continue
          }
          const failureState = getNextFailureSyncStatus(change, { transient: isTransientSupabaseError(error) })
          await updateOfflineChangeStatus(change.local_change_id, {
            sync_status: failureState.sync_status,
            retry_count: failureState.retry_count,
            error: failureState.error || error?.message || 'Sync failed.'
          })
          failed += 1
        }
      }

      await refreshOfflineStatus()

      const showSyncResultNotice = shouldShowOfflineSaveNotice()
      if ((conflicts || failed) && showSyncResultNotice) {
        notify.error('Changes are still saved locally.', {
          title: 'Sync failed',
          toastId: 'offline-sync-failed',
          autoClose: 2600
        })
      } else if (showSyncResultNotice) {
        notify.sync(synced ? 'All offline changes synced.' : 'No offline changes to sync.', {
          title: synced ? 'Sync complete' : 'Sync status',
          toastId: 'offline-sync-complete',
          autoClose: 1600
        })
      }

      setOfflineStatusMessage(conflicts || failed
        ? 'Sync failed - changes are still saved locally.'
        : (synced ? 'All offline changes synced.' : 'No offline changes to sync.'))
      shouldPullPreviewSync = synced > 0
      return { success: conflicts === 0 && failed === 0, synced, conflicts, failed, waitingForMonth: 0 }
    } finally {
      offlineSyncInFlightRef.current = false
      setIsSyncingOffline(false)
      if (shouldPullPreviewSync && currentTable) {
        startMemberPreviewBackgroundSync(currentTable, {
          force: true,
          source: 'offline-flush'
        })
      }
    }
  }
  syncOfflineChangesRef.current = syncOfflineChanges

  useEffect(() => {
    if (!isOnline || offlineMode === 'offline' || pendingSyncCount <= 0 || isSyncingOffline || !backendHealthy) return undefined

    const syncableChanges = offlinePendingChanges.filter(isChangeSyncable)
    if (syncableChanges.length === 0) return undefined

    const now = Date.now()
    const eligibleNow = syncableChanges.some((change) => isChangeRetryEligible(change, now))
    if (!eligibleNow) {
      // Every change is backing off or has spent its retry budget. Wait for
      // the earliest next allowed attempt instead of hammering.
      const delay = getSyncableChangesNextAttemptDelayMs(syncableChanges, now)
      if (delay !== null && !getActiveSyncFlushScheduler().isPending()) {
        getActiveSyncFlushScheduler().schedule(delay)
      }
      return undefined
    }

    if (getActiveSyncFlushScheduler().isPending()) {
      return undefined
    }
    getActiveSyncFlushScheduler().schedule(AUTO_SYNC_DEBOUNCE_MS)
    return undefined
  }, [isOnline, offlineMode, pendingSyncCount, offlinePendingChanges, isSyncingOffline, backendHealthy])

  const refreshSyncedDataInBackground = useCallback(async (source = 'background', options = {}) => {
    if (!currentTable || isDeveloperBypass || !isSupabaseConfigured() || shouldUseOfflineData) return
    if (offlineMode === 'online' && !isOnline) return
    if (!isBackendHealthy()) {
      setMemberPreviewSyncStatus(prev => ({ ...prev, isSyncing: false, source: 'paused-degraded' }))
      return
    }

    const now = Date.now()
    const minGapMs = options.force ? 0 : 15000
    if (backgroundRefreshRef.current.running) return
    if (!options.force && now - backgroundRefreshRef.current.lastRun < minGapMs) return

    backgroundRefreshRef.current = { running: true, lastRun: now }
    try {
      setMemberPreviewSyncStatus(prev => ({
        ...prev,
        source,
        isSyncing: true
      }))
      await Promise.all([
        fetchMembers(currentTable, {
          forceRefresh: options.force || false,
          background: true,
          forceOnline: options.force || false
        }).catch((error) => {
          console.warn(`Background member refresh failed (${source}):`, error)
          return null
        }),
        loadAllAttendanceData({ forceOnline: options.force || false }).catch((error) => {
          console.warn(`Background attendance refresh failed (${source}):`, error)
          return null
        })
      ])
      setMemberPreviewSyncStatus(prev => ({
        ...prev,
        source,
        isSyncing: false,
        lastSyncedAt: new Date().toISOString()
      }))
    } finally {
      backgroundRefreshRef.current = {
        running: false,
        lastRun: Date.now()
      }
    }
  }, [currentTable, isDeveloperBypass, isOnline, isSupabaseConfigured, loadAllAttendanceData, offlineMode, shouldUseOfflineData])

  useEffect(() => {
    if (typeof window === 'undefined' || import.meta.env.MODE === 'test') return undefined

    const runResumeSync = async (source = 'resume') => {
      if (document.visibilityState === 'hidden' || !isBrowserOnline()) return { skipped: 'offline-or-hidden' }
      if (!isBackendHealthy()) return { skipped: 'backend-degraded' }

      // Session confirmation is silent and never replaces the visible app with a loader.
      if (!isDeveloperBypass && isSupabaseConfigured()) {
        await supabase.auth.getSession().catch((error) => {
          console.warn(`Silent session confirmation failed (${source}):`, error)
        })
      }

      if (isCollaborator && dataOwnerId && isSupabaseConfigured()) {
        await fetchOwnerStickyDefaults(dataOwnerId).catch((error) => {
          console.warn(`Could not refresh workspace defaults (${source}):`, error)
        })
      }

      if (offlineMode !== 'offline' && !offlineSyncInFlightRef.current) {
        const pendingChanges = await getPendingOfflineChanges().catch(() => [])
        const now = Date.now()
        const hasEligibleChanges = pendingChanges.some((change) => isChangeRetryEligible(change, now))
        if (hasEligibleChanges && !getActiveSyncFlushScheduler().isPending()) {
          getActiveSyncFlushScheduler().schedule(AUTO_SYNC_DEBOUNCE_MS)
        }
      }

      if (currentTable && !isDeveloperBypass && isSupabaseConfigured() && !shouldUseOfflineData) {
        memberPreviewBackgroundSyncRunnerRef.current?.(currentTable, { source })
        await loadAllAttendanceData().catch((error) => {
          console.warn(`Resume attendance refresh failed (${source}):`, error)
          return null
        })
      }
      return { success: true }
    }

    resumeSyncCallbackRef.current = runResumeSync

    if (!resumeSyncCoordinatorRef.current) {
      resumeSyncCoordinatorRef.current = createResumeSyncCoordinator({
        refresh: (source, options) => resumeSyncCallbackRef.current?.(source, options),
        cooldownMs: 15000
      })
    }
    const coordinator = resumeSyncCoordinatorRef.current
    const trigger = (source, options) => coordinator.trigger(source, options)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') trigger('visible')
    }
    const handlePageShow = (event) => trigger(event?.persisted ? 'pageshow-cache' : 'pageshow')
    const handleFocus = () => trigger('focus')
    const handleOnline = () => trigger('online', { force: true })

    if (!hasInitialAppLoadRunRef.current) {
      hasInitialAppLoadRunRef.current = true
      trigger('app-load')
    }
    const intervalId = window.setInterval(() => trigger('interval'), MEMBER_PREVIEW_BACKGROUND_SYNC_TTL_MS)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)
    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisible)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [currentTable, dataOwnerId, fetchOwnerStickyDefaults, isCollaborator, isDeveloperBypass, isSupabaseConfigured, loadAllAttendanceData, offlineMode, shouldUseOfflineData])

  // Reconcile attendance once for the active workspace/month. The shared
  // registry coalesces StrictMode and provider re-entry into one request.
  useEffect(() => {
    const ownerId = dataOwnerId || user?.id
    if (!currentTable || (!ownerId && !isDeveloperBypass && isSupabaseConfigured())) return
    loadAllAttendanceData()
  }, [currentTable, dataOwnerId, isDeveloperBypass, loadAllAttendanceData, user?.id])

  // QR-based member lookup. Passes are evergreen: the active table and Sunday
  // come from the scanner's current workspace, never from an old shared image.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const consumed = consumeMemberCheckInUrl(window.location.href)
      if (!consumed) return
      if (!currentTable) return
      const { memberId: qrMark, code: codeParam, workspaceId: qrWorkspaceId } = consumed.request
      const activeWorkspaceId = dataOwnerId || user?.id
      if (qrWorkspaceId && activeWorkspaceId && String(qrWorkspaceId) !== String(activeWorkspaceId)) {
        toast.error('This member pass belongs to a different workspace.')
        window.history.replaceState({}, document.title, consumed.cleanUrl)
        return
      }
      const runKey = `${currentTable}:${qrMark}:${codeParam}`
      if (qrCheckInRunRef.current.running || qrCheckInRunRef.current.key === runKey) return
      qrCheckInRunRef.current = { key: runKey, running: true }

      // Claim the URL before any async state update can retrigger this effect.
      window.history.replaceState({}, document.title, consumed.cleanUrl)

        ; (async () => {
          try {
            const scannedMember = members.find((member) => String(member.id) === String(qrMark)) || await refreshMemberPreviewById(qrMark, {
              tableName: currentTable,
              source: 'qr-check-in',
              skipBackgroundSync: true
            })
            if (!scannedMember) {
              try { toast.error('Member pass could not be found in this workspace', { toastId: `qr-member-missing-${qrMark}` }) } catch { }
              return
            }

            let targetDate = selectedAttendanceDate ? new Date(selectedAttendanceDate) : null
            if (!targetDate && currentTable) {
              targetDate = getSundayDefaultForTable(currentTable, new Date())
            }
            if (!targetDate) targetDate = new Date()
            const normalizedTargetDate = normalizeDateToSundayForTable(targetDate, currentTable) || targetDate
            const targetDateKey = getLocalDateString(normalizedTargetDate)

            if (targetDateKey && currentTable) {
              setAndSaveAttendanceDate(normalizedTargetDate, currentTable)
            }

            const memberName = scannedMember.full_name || scannedMember['Full Name'] || scannedMember.name || scannedMember.Name || codeParam || 'Member'
            setSearchTerm(memberName)
            setDashboardTab('all')

            const turboCheckInEnabled = preferences?.member_code_turbo_enabled === true
            if (!turboCheckInEnabled) {
              toast.info(`${memberName} ready — choose Present or Absent`, {
                toastId: `qr-member-ready-${qrMark}`
              })
              return
            }

            const currentStatus = attendanceData[targetDateKey]?.[qrMark]
            if (currentStatus === true) {
              try { toast.info(`${memberName} is already present for this Sunday`, { toastId: `qr-already-present-${qrMark}-${targetDateKey}` }) } catch { }
            } else {
              const result = await markAttendance(qrMark, normalizedTargetDate, true)
              if (result?.success === false) return
              try { toast.success(`${memberName} marked present`, { toastId: `qr-present-${qrMark}-${targetDateKey}` }) } catch { }
            }
          } catch (err) {
            console.error('QR mark processing failed', err)
          } finally {
            qrCheckInRunRef.current.running = false
          }
        })()
    } catch (e) {
      console.error('Failed to parse QR params', e)
    }
  }, [attendanceData, currentTable, dataOwnerId, markAttendance, members, preferences?.member_code_turbo_enabled, refreshMemberPreviewById, selectedAttendanceDate, setAndSaveAttendanceDate, user?.id])

  const signalRealtimeSyncStatus = useCallback((source = 'realtime-update') => {
    const now = new Date().toISOString()
    setMemberPreviewSyncStatus((prev) => ({
      ...prev,
      isSyncing: true,
      source,
      lastRemoteUpdatedAt: now
    }))

    if (realtimeSyncStatusTimerRef.current) {
      clearTimeout(realtimeSyncStatusTimerRef.current)
    }

    realtimeSyncStatusTimerRef.current = setTimeout(() => {
      setMemberPreviewSyncStatus((prev) => ({
        ...prev,
        isSyncing: false,
        source,
        lastSyncedAt: now,
        lastSyncAt: now
      }))
      realtimeSyncStatusTimerRef.current = null
    }, 650)
  }, [])

  const prepareRealtimeMember = useCallback((rawMember) => {
    const normalized = normalizeMemberRecord(rawMember, {
      tableName: currentTable,
      ownerId: dataOwnerId || user?.id
    })
    return mergeRealtimeMemberWithPending(
      normalized,
      offlinePendingChangesRef.current,
      currentTable
    )
  }, [currentTable, dataOwnerId, user?.id])

  useEffect(() => {
    const ownerId = dataOwnerId || user?.id
    if (!ownerId || !currentTable || isDeveloperBypass || !isSupabaseConfigured() || shouldUseOfflineData) return undefined

    const scopeKey = `${ownerId}:${currentTable}`
    const channelName = `workspace:${ownerId}:${currentTable}`

    const handleMemberPayload = (payload) => {
      signalRealtimeSyncStatus(`members-${String(payload.eventType || 'change').toLowerCase()}`)
      invalidateRequestScope(scopeKey, 'attendance-reconciliation')
      if (payload.eventType === 'INSERT') {
        const prepared = prepareRealtimeMember(payload.new)
        const incoming = prepared.member
        if (prepared.shouldRemove || incoming?.deleted_at) {
          setDeletedMemberSearchTombstones((prev) => [...prev.filter((member) => String(member.id) !== String(incoming.id)), incoming].slice(-100))
          setMembers((prevMembers) => prevMembers.filter((member) => member.id !== incoming.id))
          setServerSearchResults((prev) => prev ? prev.filter((member) => member.id !== incoming.id) : prev)
          searchCacheRef.current.clear()
          deleteMemberPreviewMember(workspaceCacheScope, currentTable, incoming.id)
            .catch((error) => console.warn('Could not remove realtime deleted member from index:', error))
          markMemberPreviewSyncComplete(currentTable, {
            cachedCount: Math.max(0, membersTotalCount - 1),
            totalCount: Math.max(0, membersTotalCount - 1),
            source: 'realtime-delete',
            lastSyncAt: incoming.updated_at || new Date().toISOString()
          })
          return
        }
        setDeletedMemberSearchTombstones((prev) => prev.filter((member) => String(member.id) !== String(incoming.id)))
        setServerSearchResults((prev) => prev ? prev.map((member) => member.id === incoming.id ? incoming : member) : prev)
        searchCacheRef.current.clear()
        setMembers((prevMembers) => {
          const exists = prevMembers.some(member => member.id === incoming.id)
          const nextMembers = exists
            ? prevMembers.map(member => member.id === incoming.id ? { ...member, ...incoming } : member)
            : [...prevMembers, incoming]
          membersCacheRef.current.set(currentTable || 'default', { data: nextMembers, ts: Date.now() })
          persistMemberPreviewIndex(currentTable, [incoming], {
            cachedCount: nextMembers.length,
            totalCount: Math.max(membersTotalCount || prevMembers.length, nextMembers.length),
            source: 'realtime-insert'
          }).catch((error) => console.warn('Could not index realtime member insert:', error))
          applyAttendanceColumnsFromMemberRows([incoming], currentTable)
          markMemberPreviewSyncComplete(currentTable, {
            cachedCount: nextMembers.length,
            totalCount: Math.max(membersTotalCount || prevMembers.length, nextMembers.length),
            source: 'realtime-insert',
            lastSyncAt: incoming.updated_at || new Date().toISOString()
          })
          return nextMembers
        })
      } else if (payload.eventType === 'UPDATE') {
        const prepared = prepareRealtimeMember(payload.new)
        const incoming = prepared.member
        if (prepared.shouldRemove || incoming?.deleted_at) {
          setDeletedMemberSearchTombstones((prev) => [...prev.filter((member) => String(member.id) !== String(incoming.id)), incoming].slice(-100))
          setServerSearchResults((prev) => prev ? prev.filter((member) => member.id !== incoming.id) : prev)
          searchCacheRef.current.clear()
          setMembers((prevMembers) => {
            const nextMembers = prevMembers.filter((member) => member.id !== incoming.id)
            membersCacheRef.current.set(currentTable || 'default', { data: nextMembers, ts: Date.now() })
            return nextMembers
          })
          deleteMemberPreviewMember(workspaceCacheScope, currentTable, incoming.id)
            .catch((error) => console.warn('Could not remove realtime soft-deleted member from index:', error))
          markMemberPreviewSyncComplete(currentTable, {
            cachedCount: Math.max(0, membersTotalCount - 1),
            totalCount: Math.max(0, membersTotalCount - 1),
            source: 'realtime-delete',
            lastSyncAt: incoming.updated_at || new Date().toISOString()
          })
          return
        }
        setDeletedMemberSearchTombstones((prev) => prev.filter((member) => String(member.id) !== String(incoming.id)))
        setServerSearchResults((prev) => prev ? prev.map((member) => member.id === incoming.id ? { ...member, ...incoming } : member) : prev)
        searchCacheRef.current.clear()
        setMembers((prevMembers) => {
          const exists = prevMembers.some((member) => member.id === incoming.id)
          const nextMembers = exists
            ? prevMembers.map((member) => member.id === incoming.id ? { ...member, ...incoming } : member)
            : [...prevMembers, incoming]
          membersCacheRef.current.set(currentTable || 'default', { data: nextMembers, ts: Date.now() })
          persistMemberPreviewIndex(currentTable, [incoming], {
            cachedCount: nextMembers.length,
            totalCount: Math.max(membersTotalCount || prevMembers.length, nextMembers.length),
            source: 'realtime-update'
          }).catch((error) => console.warn('Could not index realtime member update:', error))
          applyAttendanceColumnsFromMemberRows([incoming], currentTable)
          markMemberPreviewSyncComplete(currentTable, {
            cachedCount: nextMembers.length,
            totalCount: Math.max(membersTotalCount || prevMembers.length, nextMembers.length),
            source: 'realtime-update',
            lastSyncAt: incoming.updated_at || new Date().toISOString()
          })
          return nextMembers
        })
      } else if (payload.eventType === 'DELETE') {
        const pendingDeleteMerge = prepareRealtimeMember(payload.old)
        if (pendingDeleteMerge.pendingCount > 0 && !pendingDeleteMerge.shouldRemove) {
          setMembers((prevMembers) => prevMembers.map((member) => (
            member.id === payload.old.id
              ? { ...member, __offline_status: 'conflict', __remote_deleted_at: new Date().toISOString() }
              : member
          )))
          setOfflineStatusMessage('A remote delete conflicts with a saved offline change. Review and retry the pending change.')
          return
        }
        setDeletedMemberSearchTombstones((prev) => [...prev.filter((member) => String(member.id) !== String(payload.old.id)), { ...payload.old, deleted_at: new Date().toISOString() }].slice(-100))
        setServerSearchResults((prev) => prev ? prev.filter((member) => member.id !== payload.old.id) : prev)
        searchCacheRef.current.clear()
        setMembers((prevMembers) => {
          const nextMembers = prevMembers.filter((member) => member.id !== payload.old.id)
          membersCacheRef.current.set(currentTable || 'default', { data: nextMembers, ts: Date.now() })
          return nextMembers
        })
        deleteMemberPreviewMember(workspaceCacheScope, currentTable, payload.old.id)
          .catch((error) => console.warn('Could not remove realtime member from index:', error))
        removeMemberFromAttendanceData(payload.old.id)
        markMemberPreviewSyncComplete(currentTable, {
          cachedCount: Math.max(0, membersTotalCount - 1),
          totalCount: Math.max(0, membersTotalCount - 1),
          source: 'realtime-delete',
          lastSyncAt: new Date().toISOString()
        })
      }
    }

    const handleMemberCodePayload = (payload) => {
      const row = payload?.new || payload?.old
      if (!row?.member_id) return
      invalidateRequestScope(`${ownerId}:workspace`, 'member-code-assignments')
      setWorkspaceMemberCodeAssignments((previous) => {
        const updated = { ...previous }
        if (payload.eventType === 'DELETE') {
          delete updated[row.member_id]
        } else {
          updated[row.member_id] = {
            member_id: row.member_id,
            current_code: row.current_code,
            ordinal: row.ordinal,
            legacy_code: row.legacy_code,
            aliases: row.aliases || [],
            updated_at: row.updated_at || null
          }
        }
        workspaceMemberCodeAssignmentsRef.current = updated
        writeWorkspaceMemberCodeAssignmentsCache(workspaceCacheScope, updated)
        return updated
      })
    }

    const handlePreferencePayload = (payload) => {
      const nextStickyMonth = payload?.new?.admin_sticky_month || null
      const nextStickySundays = Array.isArray(payload?.new?.admin_sticky_sundays)
        ? payload.new.admin_sticky_sundays
        : []
      const nextLockedDate = payload?.new?.locked_default_date || null
      setOwnerStickyMonth(nextStickyMonth)
      setOwnerStickySundays(nextStickySundays)
      setLockedDefaultDate(nextLockedDate)
      setOwnerMemberCodePreferences(pickWorkspaceMemberCodePreferences(payload?.new || {}))
      updateAdminSyncNotice(nextStickyMonth, nextStickySundays)
      // Owners read the workspace preference bundle from AuthContext. Refresh it
      // after this existing realtime event so another signed-in client sees the
      // confirmed shared name style without a manual reload. Collaborators are
      // already updated above from the owner-scoped payload.
      if (!isCollaborator && typeof authContext?.loadUserPreferences === 'function' && ownerId) {
        void authContext.loadUserPreferences(ownerId).catch((error) => {
          console.warn('Could not refresh workspace preferences after realtime update:', error)
        })
      }
    }

    const releaseRealtime = acquireRealtimeChannel({
      client: supabase,
      scopeKey,
      channelName,
      bindings: [
        { key: 'members', table: currentTable },
        { key: 'member-codes', table: 'workspace_member_codes', filter: `workspace_owner_id=eq.${ownerId}` },
        { key: 'preferences', table: 'user_preferences', filter: `user_id=eq.${ownerId}` }
      ],
      handlers: {
        members: handleMemberPayload,
        'member-codes': handleMemberCodePayload,
        preferences: handlePreferencePayload
      },
      onStatus: (status) => {
        if (status === 'SUBSCRIBED') {
          devCountersRef.current.realtimeSubscribedCount = (devCountersRef.current.realtimeSubscribedCount || 0) + 1
          signalRealtimeSyncStatus('realtime-connected')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[RealtimeManager] Channel ${channelName} status: ${status}`)
        }
      }
    })

    return () => {
      releaseRealtime()
    }
  }, [authContext?.loadUserPreferences, currentTable, dataOwnerId, isCollaborator, isDeveloperBypass, isSupabaseConfigured, shouldUseOfflineData, user?.id])

  // UI action signaling for cross-component coordination
  const [uiAction, setUiAction] = useState(null)
  const focusDateSelector = () => {
    setUiAction({ type: 'focusDateSelector', ts: Date.now() })
  }

  // Update workspace name across all tables
  const updateWorkspaceForAllTables = async (newName) => {
    try {
      if (!isSupabaseConfigured()) {
        toast.info('Workspace updated (Demo Mode)')
        return true
      }

      console.log(`Updating workspace to "${newName}" across all tables...`)

      const { error } = await supabase.rpc('update_user_workspace_name', {
        new_name: newName
      })

      if (error) {
        if (error.message?.includes('function') || error.code === '42883') {
          throw new Error('Please run the "Complete Workspace Features" migration first')
        }
        throw error
      }

      toast.success('Workspace updated across all records!')
      return true
    } catch (error) {
      console.error('Error updating workspace:', error)
      toast.error(error.message || 'Failed to update workspace records')
      return false
    }
  }

  // One explicit, bounded re-read of the preference bundle used by the calendar
  // control's Retry. It never writes preferences.
  const retryPreferenceHydration = useCallback(async () => {
    const owner = dataOwnerId || user?.id
    if (!owner || typeof authContext?.loadUserPreferences !== 'function') return false
    try {
      await authContext.loadUserPreferences(owner)
      return true
    } catch {
      return false
    }
  }, [dataOwnerId, user?.id, authContext?.loadUserPreferences])

  // Memoize context value to prevent unnecessary re-renders of consumers
  const value = useMemo(() => ({
    checkCollaboratorStatus,
    logActivity,
    updateWorkspaceForAllTables,
    members,
    membersTotalCount,
    membersLoadedAll,
    memberPreviewSyncStatus,
    recentMemberEdits,
    recordRecentMemberEdit,
    filteredMembers,
    loading,
    memberHydrationState,
    preferences,
    memberNameStyle,
    formatMemberName: formatDisplayMemberName,
    memberCodeFormat,
    memberCodeLength,
    workspaceMemberCodeAssignments,
    workspaceMemberCodeStatus,
    loadWorkspaceMemberCodes,
    ensureMemberCodeAssignment,
    convertWorkspaceMemberCodeFormat,
    searchTerm,
    setSearchTerm,
    refreshSearch,
    serverSearchResults,
    searchResultSections,
    forceRefreshMembers,
    forceRefreshMembersSilent,
    refreshMemberPreviewById,
    searchMemberAcrossAllTables,
    setMemberAttendanceFromOtherMonth,
    presentMemberFromOtherMonth,
    addMember,
    updateMember,
    deleteMember,
    fetchMembers,
    fetchMoreMembers,
    attendanceData,
    setAttendanceData,
    markAttendance,
    bulkAttendance,
    fetchAttendanceForDate,
    fetchAttendanceForDateInTable,
    fetchAndApplyAttendanceForDate,
    loadAllAttendanceData,
    loadAllBadgeData,
    currentTable,
    monthlyTables,
    setCurrentTable: changeCurrentTable,
    createNewMonth,
    deleteMonthTable,
    fetchMonthlyTables,
    getAttendanceColumns,
    getAvailableAttendanceDates,
    findAttendanceColumnForDate,
    calculateAttendanceRate,
    calculateMemberBadge,
    updateMemberBadges,
    processEndOfMonthBadges,
    isMonthAttendanceComplete,
    toggleMemberBadge,
    memberHasBadge,
    selectedAttendanceDate,
    setSelectedAttendanceDate,
    setAndSaveAttendanceDate,
    availableSundayDates,
    getAvailableSundayDates,
    initializeAttendanceDates,
    getSundaysInMonth,
    badgeFilter,
    toggleBadgeFilter,
    isSupabaseConfigured,
    dashboardTab,
    setDashboardTab,
    uiAction,
    focusDateSelector,
    validateMemberData,
    getPastSundays,
    getMissingAttendance,
    autoAllDatesEnabled,
    setAutoAllDatesEnabled,
    missingInfoPromptEnabled,
    setMissingInfoPromptEnabled,
    guidedFormSettings,
    setGuidedFormSetting,
    isOnline,
    offlineMode,
    setOfflineMode,
    offlineSaveNoticeThreshold,
    setOfflineSaveNoticeThreshold,
    notificationDurationMs,
    setNotificationDurationMs,
    searchSuggestionView,
    setSearchSuggestionView,
    shouldUseOfflineData,
    isOfflineModeActive,
    offlineModeStatus,
    offlineCacheMeta,
    pendingSyncCount,
    offlinePendingChanges,
    offlineStatusMessage,
    isPreparingOffline,
    isSyncingOffline,
    prepareOfflineData,
    clearOfflineCacheData,
    syncOfflineChanges,
    refreshOfflineStatus,
    isDeveloperBypass,
    hasAccess,
    isCollaborator,
    isAdminCollaborator,
    dataOwnerId,
    personalCalendarMode,
    isPersonalManualMode,
    manualMonthTable,
    manualSundayDate,
    manualOverrideUntil,
    personalManualExpiryWarning,
    setPersonalCalendarMode,
    refreshPersonalManualInactivity,
    ownerStickyMonth,
    ownerStickySundays,
    adminSyncNotice,
    acknowledgeAdminSync,
    lockedDefaultDate,
    saveLockedDefaultDate,
    setCollaboratorOverride,
    fetchLockedDefaultDate,
    sendAdminPeriodBroadcast,
    historicalSearchSettings,
    saveHistoricalSearchSettings,
    preferencesHydrated,
    preferencesLoading,
    preferencesError,
    retryPreferenceHydration,
    getDevCounters: () => devCountersRef.current
  }), [
    members, membersTotalCount, membersLoadedAll, memberPreviewSyncStatus, recentMemberEdits, recordRecentMemberEdit, filteredMembers, loading, memberHydrationState, preferences, memberNameStyle, formatDisplayMemberName, memberCodeFormat, memberCodeLength, workspaceMemberCodeAssignments, workspaceMemberCodeStatus, loadWorkspaceMemberCodes, ensureMemberCodeAssignment, convertWorkspaceMemberCodeFormat, searchTerm, serverSearchResults, searchResultSections,
    attendanceData, currentTable, monthlyTables, selectedAttendanceDate,
    availableSundayDates, badgeFilter, dashboardTab, uiAction,
    logActivity, checkCollaboratorStatus, updateWorkspaceForAllTables,
    refreshSearch, forceRefreshMembers, forceRefreshMembersSilent, refreshMemberPreviewById,
    searchMemberAcrossAllTables, setMemberAttendanceFromOtherMonth, presentMemberFromOtherMonth, addMember, updateMember, deleteMember,
    fetchMembers, fetchMoreMembers, markAttendance, bulkAttendance, fetchAttendanceForDate, fetchAttendanceForDateInTable, fetchAndApplyAttendanceForDate,
    loadAllAttendanceData, loadAllBadgeData, changeCurrentTable, createNewMonth,
    deleteMonthTable, fetchMonthlyTables, getAttendanceColumns, getAvailableAttendanceDates,
    findAttendanceColumnForDate, calculateAttendanceRate, calculateMemberBadge,
    updateMemberBadges, processEndOfMonthBadges, isMonthAttendanceComplete,
    toggleMemberBadge, memberHasBadge, setAndSaveAttendanceDate,
    initializeAttendanceDates, getSundaysInMonth, toggleBadgeFilter,
    focusDateSelector, validateMemberData, getPastSundays, getMissingAttendance,
    autoAllDatesEnabled, setAutoAllDatesEnabled, missingInfoPromptEnabled, setMissingInfoPromptEnabled, guidedFormSettings, setGuidedFormSetting, isDeveloperBypass,
    isOnline, offlineMode, setOfflineMode, offlineSaveNoticeThreshold, setOfflineSaveNoticeThreshold, notificationDurationMs, setNotificationDurationMs, searchSuggestionView, setSearchSuggestionView, shouldUseOfflineData, isOfflineModeActive, offlineModeStatus,
    offlineCacheMeta, pendingSyncCount, offlinePendingChanges, offlineStatusMessage, isPreparingOffline, isSyncingOffline,
    prepareOfflineData, clearOfflineCacheData, syncOfflineChanges, refreshOfflineStatus,
    hasAccess, isCollaborator, isAdminCollaborator, dataOwnerId, personalCalendarMode, isPersonalManualMode, manualMonthTable, manualSundayDate, manualOverrideUntil,
    setPersonalCalendarMode, ownerStickyMonth, ownerStickySundays, adminSyncNotice, acknowledgeAdminSync,
    lockedDefaultDate, saveLockedDefaultDate, setCollaboratorOverride, fetchLockedDefaultDate, sendAdminPeriodBroadcast,
    historicalSearchSettings, saveHistoricalSearchSettings, preferencesHydrated, preferencesLoading, preferencesError, retryPreferenceHydration
  ])

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  )
}
