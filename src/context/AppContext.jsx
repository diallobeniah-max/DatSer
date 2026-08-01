import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'
import {
  assertSupabaseMutationAffected,
  executeSupabaseWrite,
  isTransientSupabaseError
} from '../utils/supabaseWrite'
import { useAuth } from './AuthContext'
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
import { normalizeGuidedOrder, readGuidedFormSettings, writeGuidedFormSettings } from '../utils/guidedFormSettings'
import { DEV_BYPASS_STORAGE_KEY, isLocalWebDeveloperModeAllowed } from '../utils/developerMode'
import { mergeAttendanceMapWithPending, mergeRealtimeMemberWithPending } from '../utils/realtimeMerge'
import { classifyMemberSearch, normalizeSearchText } from '../utils/memberSearch'
import { createAttendanceSnapshotVersionRegistry } from '../utils/attendanceSnapshot'
import { createResumeSyncCoordinator } from '../utils/appResumeSync'
import {
  isAttendanceAlreadySynced,
  isOfflineAttendanceConflict,
  normalizeQueuedAttendanceValue
} from '../utils/attendanceRecords'
import {
  clearAllOfflineData,
  deleteMemberPreviewMember,
  getOfflineSnapshot,
  getMemberPreviewMembers,
  isOfflineStoreAvailable,
  getPendingOfflineChanges,
  queueOfflineChange,
  removeOfflineChange,
  saveMemberPreviewMembers,
  saveOfflineSnapshot,
  updateOfflineChangeStatus
} from '../utils/offlineStore'

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
const MEMBER_PREVIEW_CACHE_TTL_MS = 30 * 60 * 1000
const MEMBER_PREVIEW_BACKGROUND_SYNC_TTL_MS = 90 * 1000
const MEMBER_PREVIEW_SYNC_OVERLAP_MS = 5000
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

const PERSONAL_MANUAL_OVERRIDE_HOURS = 12

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

const buildMemberTableRow = (memberData = {}, { id = null, workspaceName = null, userId = null } = {}) => {
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
  const personalPreferences = authContext?.preferences || null
  const authLoading = authContext?.loading
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
  const tableColumnCacheRef = useRef(new Map())
  const realtimeChannelRef = useRef(null)
  const realtimeScopeRef = useRef('')
  const devCountersRef = useRef({
    syncStarted: 0,
    syncCoalesced: 0,
    schemaFetchCount: 0,
    attendanceFetchCount: 0,
    staleResultIgnored: 0,
    realtimeSubscribedCount: 0
  })
  const membersCacheRef = useRef(new Map()) // tableName -> { data, ts }
  const memberPreviewSyncRef = useRef(new Map())
  const memberPreviewSchemaReadyRef = useRef(new Map())
  const memberPreviewBackgroundSyncRunnerRef = useRef(null)
  const searchRequestRef = useRef(0)
  const attendanceSnapshotVersionRef = useRef(createAttendanceSnapshotVersionRegistry())
  const qrCheckInRunRef = useRef({ key: '', running: false })
  const workspaceCacheScope = useMemo(() => getWorkspaceCacheScope({
    userId: user?.id,
    dataOwnerId,
    isCollaborator
  }), [dataOwnerId, isCollaborator, user?.id])
  const [attendanceData, setAttendanceData] = useState({})
  const [currentTable, setCurrentTable] = useState(getLatestTable())

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
  const [workspaceMemberCodeAssignments, setWorkspaceMemberCodeAssignments] = useState({})
  const [workspaceMemberCodeStatus, setWorkspaceMemberCodeStatus] = useState('idle')
  const workspaceMemberCodeRequestRef = useRef({ ownerId: null, sequence: 0 })
  const workspaceMemberCodeAssignmentsRef = useRef({})
  const workspaceMemberCodeReadRef = useRef({ ownerId: null, promise: null })
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
  const adminBroadcastRef = useRef({ month: null, date: null })
  const adminRealtimeChannelRef = useRef(null)
  const adminRealtimeStatusRef = useRef('CLOSED')
  const pendingAdminBroadcastRef = useRef(null)
  const liveCalendarBroadcastRef = useRef({ table: null, date: null })

  // Load saved month from user preferences on app startup
  useEffect(() => {
    const loadSavedMonth = async () => {
      if (!user || authLoading) return

      try {
        const storageKey = isCollaborator && dataOwnerId ? `selectedMonthTable_${dataOwnerId}` : 'selectedMonthTable'
        const localSaved = localStorage.getItem(storageKey)

        if (isCollaborator && ownerStickyMonth && !localSaved && !authContext?.preferences?.current_month_table) {
          setCurrentTable(ownerStickyMonth)
          localStorage.setItem(storageKey, ownerStickyMonth)
          return
        }

        // Try to load from Supabase preferences first (persisted across devices)
        if (authContext?.preferences?.current_month_table) {
          const savedMonth = authContext.preferences.current_month_table
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
      }
    }

    loadSavedMonth()
  }, [user, authLoading, authContext?.preferences?.current_month_table, isCollaborator, dataOwnerId, ownerStickyMonth])
  const [monthlyTables, setMonthlyTables] = useState(FALLBACK_MONTHLY_TABLES)
  const [selectedAttendanceDate, setSelectedAttendanceDate] = useState(null)
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
  const autoSyncTimerRef = useRef(null)
  const autoSyncSignatureRef = useRef({ signature: '', at: 0 })
  const autoSnapshotTimerRef = useRef(null)
  const autoPrepareOfflineRef = useRef({ signature: '', running: false })
  const backgroundRefreshRef = useRef({ running: false, lastRun: 0 })
  const realtimeAttendanceRefreshTimerRef = useRef(null)
  const realtimeSyncStatusTimerRef = useRef(null)
  const normalizedAttendanceBackendAvailableRef = useRef(null)
  const syncOfflineChangesRef = useRef(null)
  const offlineSyncInFlightRef = useRef(false)
  const applyOfflineSnapshotRef = useRef(null)
  const searchDisplayPromptQueuedRef = useRef(false)

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
      setMembers(snapshot.members)
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

  const [guidedFormSettingsState, setGuidedFormSettingsState] = useState(() => readGuidedFormSettings())

  useEffect(() => {
    setGuidedFormSettingsState(readGuidedFormSettings(workspaceCacheScope))
  }, [workspaceCacheScope])
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
        if (isCollaborator && dataOwnerId) {
          if (!isAdminCollaborator) {
            throw new Error('Only a workspace owner or admin collaborator can change shared form visibility')
          }
          const result = await executeSupabaseWrite(
            () => supabase
              .from('user_preferences')
              .update({
                guided_form_settings: nextSettings,
                updated_at: new Date().toISOString()
              })
              .eq('user_id', dataOwnerId)
              .select('user_id'),
            { action: 'Save workspace form visibility settings' }
          )
          assertSupabaseMutationAffected(result, 'Form settings update')
        } else {
          await authContext?.updatePreference?.('guided_form_settings', nextSettings, { throwOnError: true })
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
        members,
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
  const personalCalendarMode = preferences?.calendar_mode === 'manual' ? 'manual' : 'auto'
  const manualMonthTable = preferences?.manual_month_table || null
  const manualSundayDateValue = preferences?.manual_sunday_date || null
  const manualOverrideUntil = preferences?.manual_override_until || null
  const manualSundayDate = useMemo(() => parseStoredCalendarDate(manualSundayDateValue), [manualSundayDateValue])
  const manualOverrideUntilDate = useMemo(() => parseStoredCalendarDate(manualOverrideUntil), [manualOverrideUntil])
  const isManualOverrideExpired = Boolean(manualOverrideUntilDate && manualOverrideUntilDate.getTime() <= Date.now())
  const collaboratorLockedByOwner = Boolean(isCollaborator && lockedDefaultDate)
  const isPersonalManualMode = personalCalendarMode === 'manual' && !isManualOverrideExpired && !collaboratorLockedByOwner

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
      const { error } = await supabase
        .from('user_preferences')
        .update({ locked_default_date: dateStr || null })
        .eq('user_id', user.id)

      if (!error) {
        return true
      }

      // Revert on error
      console.error('Error saving locked default date:', error)
      setLockedDefaultDate(previousDateStr)
      return false
    } catch (err) {
      // Revert on error
      console.error('Error saving locked default date:', err)
      setLockedDefaultDate(previousDateStr)
      return false
    }
  }, [user?.id, isCollaborator, lockedDefaultDate, currentTable])

  const getMonthStorageKey = useCallback(() => {
    if (isCollaborator && dataOwnerId) {
      return `selectedMonthTable_${dataOwnerId}`
    }
    return 'selectedMonthTable'
  }, [isCollaborator, dataOwnerId])

  const changeCurrentTable = useCallback((tableName) => {
    setCurrentTable(tableName)
    const storageKey = getMonthStorageKey()
    if (tableName) {
      localStorage.setItem(storageKey, tableName)
    } else {
      localStorage.removeItem(storageKey)
    }
    // Also persist to Supabase so the selection survives across devices/sessions
    if (tableName && authContext?.updatePreference) {
      authContext.updatePreference('current_month_table', tableName)
    }
  }, [getMonthStorageKey, authContext?.updatePreference])

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

      setOwnerStickyMonth(null)
      setOwnerStickySundays([])
      setLockedDefaultDate(null)
      setOwnerMemberCodePreferences({})
      return null
    } catch (err) {
      console.error('Error fetching owner sticky defaults:', err)
      setOwnerStickyMonth(null)
      setOwnerStickySundays([])
      setLockedDefaultDate(null)
      setOwnerMemberCodePreferences({})
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

  const readConfirmedWorkspaceMemberCodeAssignments = useCallback(async (ownerId) => {
    const activeRead = workspaceMemberCodeReadRef.current
    if (activeRead.ownerId === ownerId && activeRead.promise) return activeRead.promise

    const promise = readWorkspaceMemberCodeAssignments(ownerId)
      .finally(() => {
        if (workspaceMemberCodeReadRef.current.ownerId === ownerId) {
          workspaceMemberCodeReadRef.current = { ownerId: null, promise: null }
        }
      })
    workspaceMemberCodeReadRef.current = { ownerId, promise }
    return promise
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

  const loadWorkspaceMemberCodes = useCallback(async ({ ensure = false, membersToEnsure = [] } = {}) => {
    const ownerId = dataOwnerId || user?.id
    if (!ownerId || isDeveloperBypass || !isSupabaseConfigured()) return []
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
      }
      const data = await readConfirmedWorkspaceMemberCodeAssignments(ownerId)
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

  // Realtime member-code updates are managed by the unified workspace Realtime manager.

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
    if (!isCollaborator) return

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
  }, [isCollaborator, currentTable, changeCurrentTable, selectedAttendanceDate])

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
    if (isCollaborator || !isSupabaseConfigured() || !user?.id || !currentTable) return
    if (!lockedDefaultDate) return
    if (adminBroadcastRef.current.month === currentTable) return

    const [monthName, yearStr] = currentTable.split('_')
    const yearNum = parseInt(yearStr, 10)
    if (!monthName || Number.isNaN(yearNum)) return

    adminBroadcastRef.current.month = currentTable
    ;(async () => {
      try {
        await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            admin_sticky_month: currentTable,
            admin_sticky_year: yearNum,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id'
          })
        sendAdminPeriodBroadcast({
          targetTable: currentTable,
          targetDate: null
        })
      } catch (err) {
        console.error('Error broadcasting admin month change:', err)
      }
    })()
  }, [isCollaborator, isSupabaseConfigured, user?.id, currentTable, lockedDefaultDate, sendAdminPeriodBroadcast])

  useEffect(() => {
    if (isCollaborator || !isSupabaseConfigured() || !user?.id || !selectedAttendanceDate) return
    if (!lockedDefaultDate) return
    if (suppressDateBroadcastRef.current) return
    if (selectedAttendanceDate.getDay() !== 0) return

    const dateStr = getLocalDateString(selectedAttendanceDate)
    if (!dateStr) return
    if (lockedDefaultDate !== dateStr) {
      setLockedDefaultDate(dateStr)
    }
    if (adminBroadcastRef.current.date === dateStr) return

    adminBroadcastRef.current.date = dateStr
    ;(async () => {
      try {
        const [monthName, yearStr] = currentTable.split('_')
        const currentYear = parseInt(yearStr, 10)
        const currentMonthIndex = MONTHS_IN_YEAR.indexOf(monthName) + 1
        const nextStickySundays = [
          dateStr,
          ...ownerStickySundays.filter((savedDate) => {
            const [y, m] = savedDate.split('-').map(Number)
            return y !== currentYear || m !== currentMonthIndex
          })
        ].filter((savedDate) => {
          const [y, m, d] = savedDate.split('-').map(Number)
          const dateObj = new Date(y, m - 1, d)
          return !Number.isNaN(dateObj.getTime()) && dateObj.getDay() === 0
        })
        await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            admin_sticky_month: currentTable,
            admin_sticky_year: currentYear,
            admin_sticky_sundays: nextStickySundays,
            locked_default_date: dateStr,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id'
          })
        sendAdminPeriodBroadcast({
          targetTable: currentTable,
          targetDate: dateStr
        })
      } catch (err) {
        console.error('Error broadcasting admin date change:', err)
      }
    })()
  }, [isCollaborator, isSupabaseConfigured, user?.id, selectedAttendanceDate, currentTable, ownerStickySundays, lockedDefaultDate, sendAdminPeriodBroadcast])

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
        setDataOwnerId(snapshot.data_owner_id || user.id)
        setOwnerEmail(snapshot.owner_email || null)
        setHasAccess(true)
        setOfflineStatusMessage('Offline Mode - using saved local data.')
        return snapshot.data_owner_id || user.id
      }
    }

    try {
      const normalizedEmail = user.email?.trim().toLowerCase()
      let data = null
      let error = null

      const { data: accessContext, error: accessContextError } = await supabase.rpc('get_current_user_access_context')
      if (!accessContextError && accessContext) {
        appContextLog('Access context RPC result:', accessContext)
        if (!accessContext.has_access) {
          setIsCollaborator(false)
          setIsAdminCollaborator(false)
          setDataOwnerId(null)
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

      if (error || !data) {
        // Not a collaborator - verify they are an actual owner with data
        appContextLog('User is NOT a collaborator. Checking if they are an owner...')

        // Check if this user has any month tables (i.e., they are a real owner)
        const { data: ownerTables, error: ownerError } = await supabase
          .from('user_month_tables')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)

        // Also check if they have user_preferences (created during onboarding)
        const { data: prefs, error: prefsError } = await supabase
          .from('user_preferences')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)

        if (ownerError || prefsError) {
          console.warn('Owner access check failed; keeping access open until the next retry.', ownerError || prefsError)
          setIsCollaborator(false)
          setIsAdminCollaborator(false)
          setDataOwnerId(user.id)
          setOwnerEmail(null)
          setHasAccess(true)
          return user.id
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

      // Sync Workspace Name from Owner
      if (authContext?.updatePreference) {
        const { data: ownerWsName, error: wsError } = await supabase.rpc('get_owner_workspace_name', {
          owner_uuid: data.owner_id
        })

        if (!wsError && ownerWsName) {
          const currentWs = authContext.preferences?.workspace_name
          if (currentWs !== ownerWsName) {
            appContextLog('Syncing workspace name from owner:', ownerWsName)
            authContext.updatePreference('workspace_name', ownerWsName)
          }
        }
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
        setDataOwnerId(snapshot.data_owner_id || user.id)
        setOwnerEmail(snapshot.owner_email || null)
        setHasAccess(true)
        setOfflineStatusMessage('Offline Mode - using saved local data.')
        return snapshot.data_owner_id || user.id
      }

      // On transient access-check errors, avoid a false Access Denied state.
      setIsCollaborator(false)
      setIsAdminCollaborator(false)
      setDataOwnerId(user?.id || null)
      setOwnerEmail(null)
      setHasAccess(true)
      return user?.id || null
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

  // Realtime preference updates are managed by the unified workspace Realtime manager.

  useEffect(() => {
    updateAdminSyncNotice(ownerStickyMonth, ownerStickySundays)
  }, [ownerStickyMonth, ownerStickySundays, updateAdminSyncNotice])

  // Activity Logging Helper
  const logActivity = useCallback(async (action, details) => {
    if (!isSupabaseConfigured() || !user) return

    try {
      // Determine the owner of the workspace being affected
      // If I am a collaborator, I am affecting the 'dataOwnerId' workspace
      // If I am the owner, I am affecting my own workspace (user.id)
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
      // Do not throw; logging failure should not break the app
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
    return query.eq('user_id', ownerId)
  }, [dataOwnerId, user?.id])

  const fetchMemberPreviewPage = async (tableName, offset = 0) => {
    const from = Math.max(0, offset)
    const to = from + MEMBER_PREVIEW_PAGE_SIZE - 1
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
    const normalizedMembers = (payload?.data || []).filter((member) => !member?.deleted_at).map((member) => normalizeMemberRecord(member, {
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
    membersCacheRef.current.set(tableName || 'default', cachePayload)
    writeMemberPreviewCache(workspaceCacheScope, tableName, cachePayload)

    if (!background) {
      setLoading(false)
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
      const normalizedMembers = nextMembers.map(normalizeMemberRecord)
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
    if (tableName) {
      memberPreviewSchemaReadyRef.current.set(tableName, true)
    }
    return true
  }, [])

  const readMemberPreviewIndex = useCallback(async (tableName = currentTable) => {
    if (!tableName) return []
    if (!isOfflineStoreAvailable()) return []
    try {
      const cachedMembers = await getMemberPreviewMembers(workspaceCacheScope, tableName)
      return (cachedMembers || []).filter((member) => !member?.deleted_at).map(normalizeMemberRecord)
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

    const syncKey = `${workspaceCacheScope}::${tableName || 'default'}`
    if (memberPreviewSyncRef.current.get(syncKey)) return
    memberPreviewSyncRef.current.set(syncKey, true)

    setMemberPreviewSyncStatus(prev => ({
      ...prev,
      isSyncing: true,
      source: options.source || 'background'
    }))

    ;(async () => {
      await ensureMemberPreviewSyncColumns(tableName)

      let offset = 0
      let remoteRows = []
      let latestRemoteUpdatedAt = syncSince || null
      let pageSize = MEMBER_PREVIEW_PAGE_SIZE
      let remoteTotalCount = 0

      while (pageSize === MEMBER_PREVIEW_PAGE_SIZE) {
        let data
        let error
        let count
        if (!syncSince) {
          ({ data, error, count } = await fetchMemberPreviewPage(tableName, offset))
        } else {
          let query = supabase
            .from(tableName)
            .select(MEMBER_PREVIEW_SELECT, { count: 'exact' })
            .order('updated_at', { ascending: true })
          query = applyWorkspaceOwnerFilter(query).gt('updated_at', syncSince)
          ;({ data, error, count } = await query.range(offset, offset + MEMBER_PREVIEW_PAGE_SIZE - 1))
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

        if (pageRows.length < MEMBER_PREVIEW_PAGE_SIZE) break
        offset += MEMBER_PREVIEW_PAGE_SIZE
        await sleep(60)
      }

      const deletedRows = remoteRows.filter((row) => row?.deleted_at)
      const deletedIds = deletedRows.map((row) => String(row.id))
      const activeRows = remoteRows.filter((row) => !row?.deleted_at)

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
      const filteredMembers = indexedMembers.filter((member) => !member?.deleted_at)
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
    })().catch((error) => {
      console.warn('Background member preview sync failed:', error)
      setMemberPreviewSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        source: 'error'
      }))
    }).finally(() => {
      memberPreviewSyncRef.current.delete(syncKey)
    })
  }

  memberPreviewBackgroundSyncRunnerRef.current = startMemberPreviewBackgroundSync

  // Fetch members from current monthly table or use mock data
  const fetchMembers = async (tableName = currentTable, options = {}) => {
    const { forceRefresh = false, background = false, forceOnline = false, fullSnapshot = false } = options
    if (!tableName) {
      console.warn('fetchMembers called with null/undefined tableName, skipping')
      setMembers([])
      setMembersTotalCount(0)
      setMembersLoadedAll(true)
      return
    }
    try {
      if (!background) {
        setLoading(true)
      }
      appContextLog(`Fetching members from table: ${tableName} for user: ${user?.id}`)

      if (shouldUseOfflineData && !forceOnline) {
        const snapshotRecord = await getOfflineSnapshot().catch(() => null)
        if (snapshotRecord && applyOfflineSnapshot(snapshotRecord)) {
          if (!background) {
            setLoading(false)
            setOfflineStatusMessage('Offline Mode - using saved local data.')
          }
          return snapshotRecord?.snapshot?.members || []
        }
        if (offlineMode === 'offline') {
          if (!background) {
            toast.warn('No offline cache found. Download offline data while online first.')
          }
          setLoading(false)
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
          if (!background) {
            setLoading(false)
          }
          return mockMembers
        }
        if (!user?.id) {
          appContextLog('No active session yet; waiting for login before loading members')
          setMembers([])
          if (!background) {
            setLoading(false)
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
          setMembers([])
          if (!background) {
            setLoading(false)
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

            const missingTable =
              error.code === 'PGRST205' ||
              error.code === 'PGRST116' ||
              error.message?.toLowerCase().includes('does not exist') ||
              error.message?.toLowerCase().includes('schema cache')

            if (missingTable) {
              await handleMissingTable(tableName)
              setMembers([])
              return []
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
        return applyMemberPreviewCache(tableName, cached, { background })
      }

      const persistedCache = readMemberPreviewCache(workspaceCacheScope, tableName)
      if (!forceRefresh && persistedCache && (now - persistedCache.ts) < MEMBER_PREVIEW_CACHE_TTL_MS) {
        appContextLog('Using persisted cached members for', cacheKey)
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
          startMemberPreviewBackgroundSync(tableName, {
            existingMembers: indexedMembers,
            silent: true
          })
          return indexedMembers
        }
      }

      appContextLog(`Querying first ${MEMBER_PREVIEW_PAGE_SIZE} members from ${tableName} with session user: ${session?.user?.id || user?.id || 'admin-code'}`)
      const { data, error, count } = await fetchMemberPreviewPage(tableName, 0)

      appContextLog(`Query result: ${data?.length || 0} rows, error: ${error?.message || 'none'}`)

      if (error) {
        console.error('Error fetching members:', error)
        appContextLog('Error details:', error.message, error.code)

        const missingTable =
          error.code === 'PGRST205' ||
          error.code === 'PGRST116' ||
          error.message?.toLowerCase().includes('does not exist') ||
          error.message?.toLowerCase().includes('schema cache')

        if (missingTable) {
          await handleMissingTable(tableName)
          setMembers([])
          return
        }

        if (isTransientSupabaseError(error) || !isBrowserOnline()) {
          const snapshotRecord = await getOfflineSnapshot().catch(() => null)
          if (snapshotRecord && applyOfflineSnapshot(snapshotRecord)) {
            setOfflineStatusMessage('Offline Mode - using saved local data.')
            return snapshotRecord?.snapshot?.members || []
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
        setMembers(normalizedMembers)
        setMembersTotalCount(totalCount)
        setMembersLoadedAll(loadedAll)
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
          setOfflineStatusMessage('Offline Mode - using saved local data.')
          return snapshotRecord?.snapshot?.members || []
        }
      }
      appContextLog('Preserving current members after unexpected fetch error')
      if (!background) {
        toast.error(`Unable to refresh saved data: ${error.message || 'unknown error'}`, { autoClose: 10000 })
      }
    } finally {
      if (!background) {
        setLoading(false)
      }
    }
  }

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
      console.log('[addMember] Received memberData:', JSON.stringify(memberData))
      const workspaceName = authContext?.preferences?.workspace_name || null
      const localId = makeLocalUuid()
      const transformedData = buildMemberTableRow(memberData, {
        id: localId,
        workspaceName,
        userId: dataOwnerId || user?.id
      })
      transformedDataForQueue = transformedData

      console.log('[addMember] Transformed data:', JSON.stringify(transformedData))

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

  // Get attendance column name for a given date
  const getAttendanceColumn = (date) => {
    const day = date.getDate()
    let suffix = 'th'
    if (day === 1 || day === 21 || day === 31) suffix = 'st'
    else if (day === 2 || day === 22) suffix = 'nd'
    else if (day === 3 || day === 23) suffix = 'rd'
    return `Attendance ${day}${suffix}`
  }

  const getTableColumnsCached = useCallback(async (tableName, { force = false } = {}) => {
    if (!tableName || isDeveloperBypass || !isSupabaseConfigured()) return []
    if (!force && tableColumnCacheRef.current.has(tableName)) {
      return tableColumnCacheRef.current.get(tableName)
    }
    try {
      const { data, error } = await supabase.rpc('get_table_columns', {
        table_name: tableName
      })
      if (error) {
        console.error('Error getting table columns:', error)
        return tableColumnCacheRef.current.get(tableName) || []
      }
      const columns = Array.isArray(data) ? data : []
      tableColumnCacheRef.current.set(tableName, columns)
      devCountersRef.current.schemaFetchCount = (devCountersRef.current.schemaFetchCount || 0) + 1
      return columns
    } catch (error) {
      console.error('Error getting table columns:', error)
      return tableColumnCacheRef.current.get(tableName) || []
    }
  }, [isDeveloperBypass, isSupabaseConfigured])

  // Get all attendance columns for the current table
  const getAttendanceColumns = useCallback(async () => {
    if (!currentTable) return []
    const data = await getTableColumnsCached(currentTable)
    return data.filter(col => {
      const name = col.column_name
      const nameLower = name.toLowerCase()
      const isOldFormat = name.startsWith('Attendance ')
      const isNewFormat = /^attendance_\d{4}_\d{2}_\d{2}$/.test(nameLower)
      return isOldFormat || isNewFormat
    })
  }, [currentTable, getTableColumnsCached])

  // Get available attendance dates for the current table
  const getAvailableAttendanceDates = async () => {
    try {
      const attendanceColumns = await getAttendanceColumns()

      // Extract dates from column names and sort them
      // Support both OLD format (Attendance 7th) and NEW format (attendance_2025_12_07)
      const dates = attendanceColumns
        .map(col => {
          const colName = col.column_name.toLowerCase()

          // NEW format: attendance_2025_12_07
          const newMatch = colName.match(/attendance_(\d{4})_(\d{2})_(\d{2})/)
          if (newMatch) {
            return parseInt(newMatch[3]) // Return day of month
          }

          // OLD format: Attendance 7th, attendance_7th
          const oldMatch = col.column_name.match(/[Aa]ttendance[_ ](\d+)(st|nd|rd|th)?/)
          if (oldMatch) {
            return parseInt(oldMatch[1])
          }

          return null
        })
        .filter(date => date !== null)
        .sort((a, b) => a - b)

      return dates
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
      console.log(`Toggling ${badgeType} badge for member ${memberId}`)
      console.log('Supabase configured:', isSupabaseConfigured())
      console.log('Current table:', currentTable)

      // Find the member and log their current badge status
      const member = members.find(m => m.id === memberId)
      const memberName = member ? (member['Full Name'] || member['full_name']) : 'Member'
      console.log('Member found:', memberName)
      console.log('Current badge values:', {
        Member: member?.Member,
        Regular: member?.Regular,
        Newcomer: member?.Newcomer,
        'Manual Badges': member?.['Manual Badges']
      })

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
      console.log('Updating member ID:', memberId)

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

  const findAttendanceColumnForDate = async (date) => {
    try {
      const attendanceColumns = await getAttendanceColumns()
      const dayOfMonth = date.getDate()
      const month = date.getMonth() + 1 // 0-indexed to 1-indexed
      const year = date.getFullYear()

      // Find the column that matches this date
      const matchingColumn = attendanceColumns.find(col => {
        const colName = col.column_name.toLowerCase()

        // NEW format: attendance_2025_12_07 (year_month_day)
        const newFormatMatch = colName.match(/attendance_(\d{4})_(\d{2})_(\d{2})/)
        if (newFormatMatch) {
          const [, colYear, colMonth, colDay] = newFormatMatch
          return parseInt(colYear) === year &&
            parseInt(colMonth) === month &&
            parseInt(colDay) === dayOfMonth
        }

        // OLD format: Attendance 7th, attendance_7th
        const oldFormatMatch = col.column_name.match(/[Aa]ttendance[_ ](\d+)(st|nd|rd|th)?/)
        if (oldFormatMatch) {
          return parseInt(oldFormatMatch[1]) === dayOfMonth
        }

        return false
      })

      return matchingColumn ? matchingColumn.column_name : null
    } catch (error) {
      console.error('Error finding attendance column for date:', error)
      return null
    }
  }

  const getAttendanceColumnsForTable = useCallback(async (tableName) => {
    if (!tableName) return []
    const data = await getTableColumnsCached(tableName)
    return data.filter(col => {
      const name = col.column_name
      const nameLower = name.toLowerCase()
      const isOldFormat = name.startsWith('Attendance ')
      const isNewFormat = /^attendance_\d{4}_\d{2}_\d{2}$/.test(nameLower)
      return isOldFormat || isNewFormat
    })
  }, [getTableColumnsCached])

  const findAttendanceColumnForDateInTable = useCallback(async (date, tableName) => {
    try {
      const attendanceColumns = await getAttendanceColumnsForTable(tableName)
      const dayOfMonth = date.getDate()
      const month = date.getMonth() + 1
      const year = date.getFullYear()

      const matchingColumn = attendanceColumns.find(col => {
        const colName = col.column_name.toLowerCase()
        const newFormatMatch = colName.match(/attendance_(\d{4})_(\d{2})_(\d{2})/)
        if (newFormatMatch) {
          const [, colYear, colMonth, colDay] = newFormatMatch
          return parseInt(colYear) === year &&
            parseInt(colMonth) === month &&
            parseInt(colDay) === dayOfMonth
        }

        const oldFormatMatch = col.column_name.match(/[Aa]ttendance[_ ](\d+)(st|nd|rd|th)?/)
        if (oldFormatMatch) {
          return parseInt(oldFormatMatch[1]) === dayOfMonth
        }

        return false
      })

      return matchingColumn ? matchingColumn.column_name : null
    } catch (error) {
      console.error('Error finding attendance column for date:', error)
      return null
    }
  }, [getAttendanceColumnsForTable])

  // Check if attendance column exists in the current table
  const checkAttendanceColumnExists = async (attendanceColumn) => {
    try {
      if (!isSupabaseConfigured()) return true

      // Get all attendance columns and check if the requested one exists
      const attendanceColumns = await getAttendanceColumns()
      return attendanceColumns.some(col => col.column_name === attendanceColumn)
    } catch (error) {
      console.error('Error checking attendance column:', error)
      return false
    }
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

      return {
        ...prev,
        [dateKey]: dateAttendance
      }
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
            console.log(`Assigned regular badge to ${member['full_name'] || member['Full Name']}`)
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
    try {
      const effectiveDate = normalizeDateToSundayForTable(date, currentTable)
      if (!effectiveDate) {
        return { success: false, error: 'No valid Sunday found for this month' }
      }

      if (shouldUseOfflineData) {
        return queueOfflineAttendanceChanges(memberIds, effectiveDate, present, 'bulk_attendance_mark')
      }

      if (offlineMode === 'online' && !isOnline) {
        toast.warn('Online mode selected, but internet is unavailable.')
      }

      if (!isSupabaseConfigured()) {
        // Demo mode - update local state
        applyLocalAttendanceState(memberIds, effectiveDate, present)
        toast.success('Bulk attendance marked! (Demo Mode)')
        return { success: true }
      }

      rollbackDate = effectiveDate
      const optimisticColumn = getAttendanceColumnNameForDate(effectiveDate)
      const dateKey = getLocalDateString(effectiveDate)
      const previousDateAttendance = attendanceData?.[dateKey] || {}
      rollbackState = {
        byId: Object.fromEntries(memberIds.map((memberId) => {
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
      applyLocalAttendanceState(memberIds, effectiveDate, present, optimisticColumn)

      const attendanceColumn = await findAttendanceColumnForDate(effectiveDate)

      if (!attendanceColumn) {
        throw new Error(`No attendance column found for this date in ${currentTable}`)
      }

      const attendanceValue = present ? 'Present' : 'Absent'
      const bulkAttendanceUpdatedAt = new Date().toISOString()
      const canWritePreviewSyncColumns = await ensureMemberPreviewSyncColumns(currentTable)

      // Update each member's attendance in the monthly table
      const updatePromises = memberIds.map(async (memberId) => {
        const result = await executeSupabaseWrite(
          () => supabase
            .from(currentTable)
            .update({
              [attendanceColumn]: attendanceValue,
              ...(canWritePreviewSyncColumns ? { updated_at: bulkAttendanceUpdatedAt } : {})
            })
            .eq('id', memberId)
            .select('id'),
          { action: `Save bulk attendance in ${currentTable}` }
        )
        return assertSupabaseMutationAffected(result, 'Bulk attendance save')
      })

      await Promise.all(updatePromises)

      // Update local state for members and attendanceData (for real-time UI updates)
      applyLocalAttendanceState(memberIds, effectiveDate, present, attendanceColumn)

      const bulkAttendanceValue = present ? 'Present' : 'Absent'
      const updatedBulkAttendanceMembers = memberIds.map((memberId) => normalizeMemberRecord({
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

      toast.success(`Bulk attendance marked successfully for ${memberIds.length} members!`)
      return { success: true }
    } catch (error) {
      console.error('Error marking bulk attendance:', error)
      if (rollbackDate && rollbackState) {
        rollbackLocalAttendanceState(memberIds, rollbackDate, rollbackState)
      }
      toast.error('Failed to mark bulk attendance')
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
        if (ownerId) query = query.eq('user_id', ownerId)
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
    try {
      if (!isSupabaseConfigured()) {
        const dateKey = getLocalDateString(date)
        return attendanceData[dateKey] || {}
      }
      if (!tableName) return {}

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
        if (ownerId) query = query.eq('user_id', ownerId)
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

      return attendanceMap
    } catch (error) {
      console.error('Error fetching attendance:', error)
      const dateKey = getLocalDateString(date)
      return attendanceData[dateKey] || {}
    }
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

    setAttendanceData((previous) => ({
      ...previous,
      [dateKey]: attendanceMap || {}
    }))
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
      console.log('[updateMember] Incoming name value:', incomingName)
      if (incomingName !== undefined) {
        normalized = { ...normalized, [nameCol]: incomingName }
        // Only delete the keys that are different from nameCol to avoid deleting the value we just set
        if (nameCol !== 'full_name') delete normalized.full_name
        if (nameCol !== 'Full Name') delete normalized['Full Name']
      }
      console.log('[updateMember] Normalized updates to send:', normalized)

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

      // Get existing columns from the table to filter out non-existent fields
      let validColumns = null
      try {
        const columnRows = await getTableColumnsCached(targetTable)
        if (Array.isArray(columnRows) && columnRows.length > 0) {
          validColumns = new Set(columnRows.map((column) => column.column_name).filter(Boolean))
          console.log('[updateMember] Valid columns in table:', Array.from(validColumns))
        }
      } catch (e) {
        console.warn('Could not fetch table schema, proceeding with all fields:', e)
      }

      // If validColumns not found (empty table or error), fallback to snake_case for standard fields
      if (!validColumns) {
        if (normalized['Phone Number'] !== undefined) {
          normalized['phone_number'] = normalized['Phone Number']
          delete normalized['Phone Number']
        }
        if (normalized['Age'] !== undefined) {
          normalized['age'] = normalized['Age']
          delete normalized['Age']
        }
        if (normalized['Gender'] !== undefined) {
          normalized['gender'] = normalized['Gender']
          delete normalized['Gender']
        }
        if (normalized['Current Level'] !== undefined) {
          normalized['current_level'] = normalized['Current Level']
          delete normalized['Current Level']
        }
        if (normalized['Full Name'] !== undefined) {
          // Only rename if 'Full Name' is present (fallback from resolveNameColumn)
          normalized['full_name'] = normalized['Full Name']
          delete normalized['Full Name']
        }
        if (normalized['Member'] !== undefined) {
          normalized['member'] = normalized['Member']
          delete normalized['Member']
        }
        if (normalized['Regular'] !== undefined) {
          normalized['regular'] = normalized['Regular']
          delete normalized['Regular']
        }
        if (normalized['Newcomer'] !== undefined) {
          normalized['newcomer'] = normalized['Newcomer']
          delete normalized['Newcomer']
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
      console.log('[updateMember] Final normalized data to send:', normalized)

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
        
        console.log('Updating member in state:', id, 'with name:', finalName)
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
          console.log('Merged member after update:', merged)
          recentEditedMember = merged
          return merged
        })
        console.log('Updated members array:', updatedMembers)
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

  // Delete member
  const deleteMember = async (memberId) => {
    console.log(`[DELETE] Starting deletion for member ID: ${memberId}`)

    // Validate memberId
    if (!memberId) {
      console.error('[DELETE] Error: No member ID provided')
      toast.error('Error: Invalid member ID')
      return { success: false }
    }

    // Support deletion in demo mode by updating local state so mobile users on static deployments can manage entries
    if (isDeveloperBypass || !isSupabaseConfigured()) {
      console.log(`[DELETE] Demo mode - deleting member ${memberId} from local state`)
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
      console.log(`[DELETE] Attempting soft delete in table: ${currentTable}, member ID: ${memberId}`)

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

      console.log(`[DELETE] VERIFIED - member ${memberId} successfully soft-deleted from ${currentTable}`)

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
      console.log(`[DELETE] Member ${memberId} deleted successfully and UI updated`)
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
  const fetchMonthlyTables = useCallback(async () => {
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
      const { data, error } = await supabase.rpc('get_available_month_tables', {
        target_user_id: ownerId
      })

      if (error) {
        // If RPC is missing (legacy), try fallback to direct select if we are the owner
        // For collaborators, direct select will fail RLS, so we rely on RPC.
        console.error('Error fetching monthly tables via RPC:', error)

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

      await fetchMonthlyTables()
      toast.success(`Deleted ${tableName.replace('_', ' ')}`)
      if (dropWarning) {
        toast.warn(dropWarning, { autoClose: 7000 })
      }
      return { success: true }
    } catch (error) {
      console.error('Error deleting month table:', error)
      const normalized = error?.message?.toLowerCase?.() || ''
      const missingTable =
        error?.code === 'PGRST205' ||
        error?.code === 'PGRST116' ||
        normalized.includes('does not exist') ||
        normalized.includes('schema cache')

      if (missingTable) {
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

    if (isSupabaseConfigured() && user?.id) {
      try {
        await supabase
          .from('user_month_tables')
          .delete()
          .eq('user_id', user.id)
          .eq('table_name', tableName)
      } catch (error) {
        console.warn('Could not prune user_month_tables entry:', error)
      }
    }

    pruneMissingTable(tableName)
    toast.warn(`${tableName.replace('_', ' ')} no longer exists in Supabase. Please recreate it if needed.`)
    await fetchMonthlyTables()
  }, [currentTable, changeCurrentTable, fetchMonthlyTables, isSupabaseConfigured, pruneMissingTable, supabase, user?.id])

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
        // Sort tables to find the most recent one
        const sortedTables = [...monthlyTables].sort((a, b) => {
          const [monthA, yearA] = a.split('_')
          const [monthB, yearB] = b.split('_')

          if (yearA !== yearB) {
            return parseInt(yearB) - parseInt(yearA) // Descending (most recent first)
          }

          const monthIndexA = MONTHS_IN_YEAR.indexOf(monthA)
          const monthIndexB = MONTHS_IN_YEAR.indexOf(monthB)
          return monthIndexB - monthIndexA // Descending (most recent first)
        })

        // Use the most recent table as source
        if (sortedTables.length > 0) {
          sourceTable = sortedTables[0]
        }
      }

      console.log(`Creating new month table: ${monthIdentifier}`)
      console.log(`Copying from most recent table: ${sourceTable}`)
      console.log(`New month will have ${sundays.length} Sundays:`, sundays.map(s => s.toISOString().split('T')[0]))

      // Format Sunday dates as YYYY-MM-DD strings for the database function
      const sundayDates = sundays.map(sunday => sunday.toISOString().split('T')[0])

      // Use RPC function to create month table by copying from most recent month
      // This will also enable RLS and copy all policies automatically
      const { data: result, error: createError } = await supabase.rpc(
        'create_month_from_current',
        {
          source_table: sourceTable,
          new_table_name: monthIdentifier,
          sunday_dates: sundayDates
        }
      )

      if (createError) {
        console.error('Error creating month table:', createError)
        throw new Error(`Failed to create month table: ${createError.message}`)
      }

      console.log('Month table creation result:', result)

      await ensureTableReady(monthIdentifier)

      if (resolvedCopyMode === 'custom' || resolvedCopyMode === 'empty') {
        const { error: clearError } = await supabase.rpc(
          'reset_month_members',
          { target_table: monthIdentifier }
        )

        if (clearError) {
          console.error('Failed clearing auto-copied rows:', clearError)
          throw new Error(`Failed to reset new month data: ${clearError.message}`)
        }
      }

      if (resolvedCopyMode === 'custom' && selectedMemberIds.length > 0) {
        const { data: insertedCount, error: insertError } = await supabase.rpc(
          'insert_selected_members',
          {
            source_table: sourceTable,
            target_table: monthIdentifier,
            member_ids: selectedMemberIds
          }
        )

        if (insertError) {
          console.error('Failed inserting selected members:', insertError)
          throw new Error(`Failed to insert selected members: ${insertError.message}`)
        }

        if (insertedCount === 0) {
          throw new Error('No members were inserted. Please confirm your selection.')
        }
      }


      const { error: ownerAssignError } = await supabase.rpc(
        'set_month_owner_user',
        {
          target_table: monthIdentifier,
          owner_user_id: ownerId
        }
      )

      if (ownerAssignError) {
        console.error('Failed to assign owner user_id on new month rows:', ownerAssignError)
        throw new Error(`Failed to finalize month ownership: ${ownerAssignError.message}`)
      }

      const { error: registerError } = await supabase
        .from('user_month_tables')
        .upsert({
          user_id: ownerId,
          table_name: monthIdentifier,
          month_year: `${monthName} ${year}`
        }, {
          onConflict: 'user_id,table_name'
        })

      if (registerError) {
        console.warn('Could not register month table for user:', registerError)
      }

      // Auto-register all invited collaborators for this new month
      try {
        const { data: registeredCount, error: collabRegError } = await supabase.rpc(
          'register_collaborators_for_month',
          {
            p_owner_id: ownerId,
            p_table_name: monthIdentifier,
            p_month_year: `${monthName} ${year}`
          }
        )

        if (collabRegError) {
          console.warn('Error calling register_collaborators_for_month:', collabRegError)
          // Don't throw - collaborators can still use RLS, they just won't see it in the list immediately
        } else if (registeredCount > 0) {
          console.log(`Successfully registered ${registeredCount} collaborators for ${monthIdentifier}`)
        }
      } catch (collabRegError) {
        console.warn('Could not register collaborators for new month:', collabRegError)
      }


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
      await fetchMonthlyTables()

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

    // Quick attendance keywords
    const kw = trimmed.toLowerCase()
    if (kw === 'present' || kw === 'absent') {
      await quickMarkAttendanceFromKeyword(kw)
      if (isCurrentRequest()) setServerSearchResults(null)
      return
    }

    // When workspace members are available in memory (cached or synced),
    // local search on activeMembers is 100% immediate and authoritative.
    // Typing must perform zero network requests.
    if (activeMembers.length > 0 || membersLoadedAll) {
      if (isCurrentRequest()) setServerSearchResults(null)
      return
    }

    const CACHE_DURATION = 10 * 60 * 1000
    const cacheKey = `${currentTable}::${trimmed}`
    const hit = searchCacheRef.current.get(cacheKey)
    const now = Date.now()
    // A cached partial result from the first preview page is useful for instant
    // feedback, but it must not prevent the first full search hydration.
    if (hit && now - hit.timestamp < CACHE_DURATION && membersLoadedAll) {
      if (isCurrentRequest()) setServerSearchResults(hit.data || [])
      return
    }

    const localMatches = await searchMemberPreviewIndex(trimmed, currentTable)
    if (!isCurrentRequest()) return
    if (localMatches.length > 0) {
      searchCacheRef.current.set(cacheKey, { timestamp: now, data: localMatches })
      setServerSearchResults(localMatches)
      if (isSupabaseConfigured() && isOnline && !shouldUseOfflineData && !membersLoadedAll) {
        startMemberPreviewBackgroundSync(currentTable, { source: 'search-refresh' })
      }
      // Once the local index is complete it is authoritative for search. Until
      // then, keep the instant local result visible while a single full index
      // read validates the result set without asking the user to type again.
      if (membersLoadedAll) return
      await sleep(140)
      if (!isCurrentRequest()) return
    }
    if (!isSupabaseConfigured() || !isOnline || shouldUseOfflineData) {
      if (isCurrentRequest()) setServerSearchResults([])
      return
    }

    // A new device only has the first visible page in memory. Hydrate a narrow
    // read-only search index before declaring a name or guardian phone missing.
    // This keeps desktop, Android tablet, and compact keyboard results on the
    // same matcher instead of relying on schema-specific ILIKE expressions.
    let offset = 0
    const candidates = []
    while (true) {
      const { data, error } = await fetchMemberPreviewPage(currentTable, offset)
      if (!isCurrentRequest()) return
      if (error) {
        console.error('Server search index fetch failed', error)
        setServerSearchResults(null)
        return
      }
      const page = (data || []).map(normalizeMemberRecord)
      candidates.push(...page)
      if (page.length < MEMBER_PREVIEW_PAGE_SIZE) break
      offset += MEMBER_PREVIEW_PAGE_SIZE
    }
    const candidateCodeMap = buildMemberIndexCodeMap(candidates, {
      format: memberCodeFormat,
      codeLength: memberCodeLength,
      persistedCodes: workspaceMemberCodeAssignments,
      allowLegacyFallback: false
    })
    const sorted = classifyMemberSearch({
      members: candidates,
      query: trimmed,
      getCode: (member) => getMemberIndexCode(member, candidateCodeMap) || member?.member_code || '',
      getCodeAliases: (member) => getMemberIndexCodeAliases(member, candidateCodeMap),
      codeLength: memberCodeLength
    }).visible.slice().sort((a, b) => {
      const an = (getMemberDisplayNameForRecentEdit(a) || '').toString().toLowerCase()
      const bn = (getMemberDisplayNameForRecentEdit(b) || '').toString().toLowerCase()
      if (an < bn) return -1
      if (an > bn) return 1
      return 0
    })
    if (!isCurrentRequest()) return
    searchCacheRef.current.set(cacheKey, { timestamp: now, data: sorted })
    await persistMemberPreviewIndex(currentTable, candidates, {
      cachedCount: candidates.length,
      totalCount: candidates.length,
      source: 'search-index'
    })
    if (isCurrentRequest()) {
      setMembers((prev) => mergeMemberPreviewPages(prev, candidates))
      setMembersTotalCount(candidates.length)
      setMembersLoadedAll(true)
    }
    if (isCurrentRequest()) setServerSearchResults(sorted)
  }, [currentTable, isOnline, memberCodeFormat, memberCodeLength, membersLoadedAll, membersTotalCount, persistMemberPreviewIndex, searchMemberPreviewIndex, shouldUseOfflineData, workspaceMemberCodeAssignments])

  useEffect(() => {
    performServerSearch(searchTerm)
  }, [searchTerm, currentTable, performServerSearch])

  const quickMarkAttendanceFromKeyword = useCallback(async (kw) => {
    const list = serverSearchResults && serverSearchResults.length > 0 ? serverSearchResults : filteredMembers
    const first = list && list.length ? list[0] : null
    if (!first) return
      const statusBool = kw === 'present'
    try {
      const dateObj = selectedAttendanceDate ? new Date(selectedAttendanceDate) : new Date()
      await markAttendance(first.id, dateObj, statusBool)
    } catch (e) {
      console.error('Quick mark attendance failed', e)
    }
  }, [serverSearchResults, filteredMembers, selectedAttendanceDate, markAttendance])

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

    if (!isDeveloperBypass && isSupabaseConfigured() && isBrowserOnline() && !shouldUseOfflineData) {
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

  // Function to search for a member across all monthly tables
  const searchMemberAcrossAllTables = useCallback(async (searchName) => {
    console.log('=== SEARCHING ACROSS ALL TABLES ===')
    console.log('Looking for:', searchName)

    const searchTerm = searchName.toLowerCase().trim()
    const foundInTables = []

    for (const tableName of monthlyTables) {
      try {
        console.log(`Checking table: ${tableName}`)

        if (isSupabaseConfigured()) {
          const safe = searchTerm.replace(/%/g, '').replace(/_/g, '').trim()
          await ensureMemberPreviewSyncColumns(tableName)
          let { data, error } = await applyDeletedAtFilter(
            supabase
              .from(tableName)
              .select(MEMBER_PREVIEW_SELECT)
          )
            .ilike('Full Name', `%${safe}%`)
            .limit(20)

          if (error) {
            const message = error.message?.toLowerCase() || ''
            const missingColumn =
              error.code === 'PGRST100' ||
              error.code === '42703' ||
              message.includes('failed to parse') ||
              message.includes('does not exist') ||
              message.includes('column')

            if (missingColumn) {
              const nameCol = await resolveNameColumn(tableName)
              const fallback = await applyDeletedAtFilter(
                supabase
                  .from(tableName)
                  .select(MEMBER_PREVIEW_SELECT)
              )
                .ilike(nameCol, `%${safe}%`)
                .limit(20)
              data = fallback.data
              error = fallback.error
            }
          }

          if (error) {
            console.log(`Error accessing ${tableName}:`, error.message)
            continue
          }

          const foundMembers = data?.map(normalizeMemberRecord).filter(member => {
            const fullName = (
              (typeof member['full_name'] === 'string' ? member['full_name'] : '') ||
              (typeof member['Full Name'] === 'string' ? member['Full Name'] : '') ||
              ''
            ).toLowerCase()

            return fullName.includes(searchTerm)
          }) || []

          if (foundMembers.length > 0) {
            console.log(`Found ${foundMembers.length} matches in ${tableName}:`)
            foundMembers.forEach(member => {
              console.log(`  - ${member['Full Name'] || member['full_name']}`)
            })
            foundInTables.push({ table: tableName, members: foundMembers })
          }
        }
      } catch (error) {
        console.log(`Error searching ${tableName}:`, error.message)
      }
    }

    console.log('=== SEARCH RESULTS ===')
    if (foundInTables.length === 0) {
      console.log('Member not found in any table')
      toast.error(`"${searchName}" not found in any monthly table`)
    } else {
      console.log(`Found in ${foundInTables.length} table(s):`)
      foundInTables.forEach(({ table, members }) => {
        console.log(`  ${table}: ${members.length} match(es)`)
      })
      toast.success(`Found "${searchName}" in ${foundInTables.length} table(s)`)
    }

    return foundInTables
  }, [monthlyTables, isSupabaseConfigured, resolveNameColumn])

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

      if (user?.id && isSupabaseConfigured()) {
        const shouldPersist =
          liveCalendarBroadcastRef.current.table !== currentTable ||
          liveCalendarBroadcastRef.current.date !== lockedDateKey

        if (!shouldPersist) return

        try {
          const [, yearStr] = currentTable.split('_')
          await supabase
            .from('user_preferences')
            .upsert({
              user_id: user.id,
              admin_sticky_month: currentTable,
              admin_sticky_year: parseInt(yearStr, 10) || now.getFullYear(),
              admin_sticky_sundays: [lockedDateKey],
              locked_default_date: lockedDateKey,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'user_id'
            })

          sendAdminPeriodBroadcast({
            targetTable: currentTable,
            targetDate: lockedDateKey
          })
        } catch (err) {
          console.error('Error syncing override calendar defaults:', err)
        }

        liveCalendarBroadcastRef.current = { table: currentTable, date: lockedDateKey }
      }
      return
    }

    if (!forceAuto && isPersonalManualMode) {
      const targetTable = manualMonthTable && monthlyTables.includes(manualMonthTable)
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

    // Owner updates shared "live" Sunday so collaborators stay in sync.
    if (!isCollaborator && user?.id && isSupabaseConfigured()) {
      const shouldPersist =
        liveCalendarBroadcastRef.current.table !== nextTable ||
        liveCalendarBroadcastRef.current.date !== activeSundayKey

      if (!shouldPersist) return

      try {
        await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            admin_sticky_month: nextTable,
            admin_sticky_year: now.getFullYear(),
            admin_sticky_sundays: [activeSundayKey],
            locked_default_date: null,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id'
          })

        sendAdminPeriodBroadcast({
          targetTable: nextTable,
          targetDate: activeSundayKey
        })
      } catch (err) {
        console.error('Error syncing live calendar defaults:', err)
      }

      liveCalendarBroadcastRef.current = { table: nextTable, date: activeSundayKey }
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
    manualSundayDate,
    user?.id,
    isSupabaseConfigured,
    sendAdminPeriodBroadcast
  ])

  const setPersonalCalendarMode = useCallback(async ({
    mode = 'auto',
    tableName = currentTable,
    date = selectedAttendanceDate,
    durationHours = PERSONAL_MANUAL_OVERRIDE_HOURS,
    silent = false
  } = {}) => {
    const nextMode = mode === 'manual' ? 'manual' : 'auto'

    if (nextMode === 'manual' && collaboratorLockedByOwner) {
      if (!silent) {
        toast.info('Manual mode is locked while the workspace owner override is active.')
      }
      return false
    }

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

        const expiresAt = new Date(Date.now() + (durationHours * 60 * 60 * 1000))
        const nextPreferences = {
          calendar_mode: 'manual',
          current_month_table: targetTable,
          manual_month_table: targetTable,
          manual_sunday_date: getLocalDateString(targetDate),
          manual_override_until: expiresAt.toISOString()
        }

        changeCurrentTable(targetTable)
        setAndSaveAttendanceDate(targetDate, targetTable)

        if (authContext?.saveUserPreferences) {
          await authContext.saveUserPreferences(nextPreferences)
        }

        return true
      }

      if (authContext?.saveUserPreferences) {
        await authContext.saveUserPreferences({
          calendar_mode: 'auto',
          manual_month_table: null,
          manual_sunday_date: null,
          manual_override_until: null
        })
      }

      await syncCalendarToToday({ forceAuto: true })
      return true
    } catch (error) {
      console.error('Error updating personal calendar mode:', error)
      if (!silent) {
        toast.error(error.message || 'Failed to update calendar mode')
      }
      return false
    }
  }, [
    authContext,
    collaboratorLockedByOwner,
    currentTable,
    selectedAttendanceDate,
    changeCurrentTable,
    setAndSaveAttendanceDate,
    syncCalendarToToday
  ])

  useEffect(() => {
    if (personalCalendarMode !== 'manual' || !manualOverrideUntilDate) return

    const remainingMs = manualOverrideUntilDate.getTime() - Date.now()
    if (remainingMs <= 0) {
      setPersonalCalendarMode({ mode: 'auto', silent: true })
      return
    }

    const timeoutId = window.setTimeout(() => {
      setPersonalCalendarMode({ mode: 'auto', silent: true })
    }, remainingMs)

    return () => window.clearTimeout(timeoutId)
  }, [personalCalendarMode, manualOverrideUntilDate, setPersonalCalendarMode])

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
      console.log('[OVERRIDE] Permission check failed', { isCollaborator, canAdmin, isSupabaseConfigured: isSupabaseConfigured(), userId: user?.id })
      return false
    }

    const targetTable = tableName || currentTable
    if (!targetTable) {
      console.log('[OVERRIDE] No target table')
      return false
    }
    const targetOwnerId = canAdmin ? dataOwnerId : user.id
    console.log('[OVERRIDE] Target:', { targetTable, targetOwnerId })

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

    console.log('[OVERRIDE] Enabling override:', { dateKey, yearNum, targetOwnerId })

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
      console.log('[OVERRIDE] Calling RPC with payload:', rpcPayload)
      
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
      // Current table is invalid - try localStorage, then DEFAULT_TABLE, then latest
      const saved = localStorage.getItem('selectedMonthTable')
      // Only override if we have real data from Supabase (not just fallback)
      // If saved month exists and we're still on fallback, wait for real data to load
      if (saved && !monthlyTables.includes(saved) && monthlyTables.length === 1 && monthlyTables[0] === DEFAULT_TABLE) {
        return // Don't override yet, real tables are still loading
      }
      if (saved && monthlyTables.includes(saved)) {
        setCurrentTable(saved)
      } else if (monthlyTables.includes(DEFAULT_TABLE)) {
        setCurrentTable(DEFAULT_TABLE)
        localStorage.setItem('selectedMonthTable', DEFAULT_TABLE)
      } else {
        const latest = monthlyTables[monthlyTables.length - 1]
        setCurrentTable(latest)
        localStorage.setItem('selectedMonthTable', latest)
      }
    }
  }, [monthlyTables])

  // Fetch members on component mount and when current table changes
  // Wait for auth to finish loading before fetching to avoid race condition
  useEffect(() => {
    if (authLoading || !currentTable) {
      return // Don't fetch while auth is still loading or table is null
    }
    fetchMembers()
  }, [currentTable, authLoading])

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
    console.log(`memberHasBadge(${member?.['Full Name'] || member?.['full_name']}, ${badgeType}):`, {
      hasSupabaseBadge,
      hasManualBadge,
      result,
      supabaseValue: member?.[badgeType === 'member' ? 'Member' : badgeType === 'regular' ? 'Regular' : 'Newcomer'],
      manualBadges: member?.['Manual Badges']
    })

    return result
  }

  // Load all attendance data for all Sunday dates in the current month
  const loadAllAttendanceData = async (options = {}) => {
    try {
      const { forceOnline = false } = options
      if (shouldUseOfflineData && !forceOnline) {
        const snapshotRecord = await getOfflineSnapshot().catch(() => null)
        const snapshot = snapshotRecord?.snapshot
      if (snapshot?.attendanceData && applyOfflineSnapshot(snapshotRecord)) {
          return snapshot.attendanceData
        }
      }

      if (isDeveloperBypass || !isSupabaseConfigured()) {
        console.log('Demo mode - attendance data will be managed locally')
        return attendanceData
      }

      devCountersRef.current.attendanceFetchCount = (devCountersRef.current.attendanceFetchCount || 0) + 1

      // Get all attendance columns for the current table
      const attendanceColumns = await getAttendanceColumns()

      if (attendanceColumns.length === 0) {
        appContextLog('No attendance columns found in current table')
        setAttendanceData({})
        return {}
      }

      // Build select query for all attendance columns
      const selectColumns = ['id', ...attendanceColumns.map(col => `"${col.column_name}"`)]

      // Fetch all rows - use high limit to avoid Supabase default 1000-row cap
      let allData = []
      let offset = 0
      const PAGE_SIZE = 1000
      while (true) {
        let query = supabase
          .from(currentTable)
          .select(selectColumns.join(', '))
        const ownerId = dataOwnerId || user?.id
        if (ownerId) query = query.eq('user_id', ownerId)
        query = query.is('deleted_at', null)
        const { data: page, error: pageError } = await query
          .range(offset, offset + PAGE_SIZE - 1)

        if (pageError) throw pageError
        if (!page || page.length === 0) break
        allData = allData.concat(page)
        if (page.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

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

      // Update attendance data state
      setAttendanceData(reconciledAttendanceData)
      console.log('Loaded attendance data for all dates:', Object.keys(reconciledAttendanceData), 'from', allData.length, 'rows')
      return reconciledAttendanceData

    } catch (error) {
      console.error('Error loading attendance data:', error)
      return attendanceData
    }
  }

  // Load all badge data for the current table
  const loadAllBadgeData = async () => {
    try {
      if (isDeveloperBypass || !isSupabaseConfigured()) {
        console.log('Demo mode - badge data will be managed locally')
        return
      }

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
        console.error('Error loading badge data:', error)

        // Only treat as missing table if it's actually a missing TABLE error
        const missingTable =
          error.code === '42P01' || // undefined_table
          error.code === 'PGRST205' ||
          (error.message?.includes('relation') && error.message?.includes('does not exist'))

        if (missingTable) {
          console.warn('Table appears to be missing during badge load:', currentTable)
          // Don't trigger full table deletion here to be safe
        }
        return
      }

      appContextLog('Badge data loaded:', data?.slice(0, 3))

      // Update members with badge data
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

    } catch (error) {
      console.error('Error loading badge data:', error)
    }
  }

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

  const syncOfflineChanges = async () => {
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
            await updateOfflineChangeStatus(change.local_change_id, {
              sync_status: isTransientSupabaseError(error) ? 'pending' : 'failed',
              error: error?.message || 'Preference sync failed.'
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
                skipRefresh: changeTable !== currentTable,
                targetTable: changeTable,
                ownerId: change.owner_id,
                identity: change.identity
              })
            } else if (change.action_type === 'member_delete') {
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
            await updateOfflineChangeStatus(change.local_change_id, {
              sync_status: isTransientSupabaseError(error) ? 'pending' : 'failed',
              error: error?.message || 'Member sync failed.'
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
            .select(`id,${attendanceColumn}`)
            .eq('id', change.member_id)
            .limit(1)
          if (serverError) throw serverError
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
          synced += 1
        } catch (error) {
          await updateOfflineChangeStatus(change.local_change_id, {
            sync_status: 'failed',
            error: error?.message || 'Sync failed.'
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
    if (!isOnline || offlineMode === 'offline' || pendingSyncCount <= 0 || isSyncingOffline) return undefined

    const syncableChanges = offlinePendingChanges.filter((change) => (
      change?.sync_status === 'pending' || change?.sync_status === 'waiting_for_month'
    ))
    if (syncableChanges.length === 0) return undefined

    const signature = syncableChanges
      // Retry bookkeeping updates `updated_at`; including it here made every
      // failed attempt look like a new change and bypassed the cooldown.
      .map((change) => `${change.local_change_id}:${change.sync_status}`)
      .sort()
      .join('|')
    const now = Date.now()
    const lastAttempt = autoSyncSignatureRef.current
    if (lastAttempt.signature === signature && now - lastAttempt.at < 60000) {
      return undefined
    }

    if (autoSyncTimerRef.current) {
      clearTimeout(autoSyncTimerRef.current)
    }

    autoSyncTimerRef.current = setTimeout(() => {
      autoSyncSignatureRef.current = { signature, at: Date.now() }
      syncOfflineChangesRef.current?.().catch((error) => {
        console.warn('Automatic offline sync failed:', error)
      })
    }, 1200)

    return () => {
      if (autoSyncTimerRef.current) {
        clearTimeout(autoSyncTimerRef.current)
        autoSyncTimerRef.current = null
      }
    }
  }, [isOnline, offlineMode, pendingSyncCount, offlinePendingChanges, isSyncingOffline])

  const refreshSyncedDataInBackground = useCallback(async (source = 'background', options = {}) => {
    if (!currentTable || isDeveloperBypass || !isSupabaseConfigured() || shouldUseOfflineData) return
    if (offlineMode === 'online' && !isOnline) return

    const now = Date.now()
    const minGapMs = options.force ? 0 : 3500
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
          forceRefresh: true,
          background: true,
          forceOnline: true
        }).catch((error) => {
          console.warn(`Background member refresh failed (${source}):`, error)
          return null
        }),
        loadAllAttendanceData({ forceOnline: true }).catch((error) => {
          console.warn(`Background attendance refresh failed (${source}):`, error)
          return null
        }),
        loadAllBadgeData().catch((error) => {
          console.warn(`Background badge refresh failed (${source}):`, error)
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
  }, [currentTable, isDeveloperBypass, isOnline, isSupabaseConfigured, offlineMode, shouldUseOfflineData])

  useEffect(() => {
    if (typeof window === 'undefined' || import.meta.env.MODE === 'test') return undefined

    const runResumeSync = async (source = 'resume') => {
      if (document.visibilityState === 'hidden' || !isBrowserOnline()) return { skipped: 'offline-or-hidden' }

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
        const hasSyncableChanges = pendingChanges.some((change) => (
          change?.sync_status === 'pending' || change?.sync_status === 'waiting_for_month'
        ))
        if (hasSyncableChanges) {
          await syncOfflineChangesRef.current?.().catch((error) => {
            console.warn(`Could not flush pending changes (${source}):`, error)
          })
        }
      }

      if (currentTable && !isDeveloperBypass && isSupabaseConfigured() && !shouldUseOfflineData) {
        memberPreviewBackgroundSyncRunnerRef.current?.(currentTable, { source })
        await refreshSyncedDataInBackground(source)
      }
      return { success: true }
    }

    const coordinator = createResumeSyncCoordinator({
      refresh: runResumeSync,
      cooldownMs: 1800
    })
    const trigger = (source, options) => coordinator.trigger(source, options)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') trigger('visible')
    }
    const handlePageShow = (event) => trigger(event?.persisted ? 'pageshow-cache' : 'pageshow')
    const handleFocus = () => trigger('focus')
    const handleOnline = () => trigger('online', { force: true })

    trigger('app-load', { force: true })
    const intervalId = window.setInterval(() => trigger('interval'), MEMBER_PREVIEW_BACKGROUND_SYNC_TTL_MS)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)
    window.addEventListener('pageshow', handlePageShow)
    document.addEventListener('visibilitychange', handleVisible)

    return () => {
      coordinator.dispose()
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('pageshow', handlePageShow)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [currentTable, dataOwnerId, fetchOwnerStickyDefaults, isCollaborator, isDeveloperBypass, isSupabaseConfigured, offlineMode, refreshSyncedDataInBackground, shouldUseOfflineData])

  // Load attendance and badge data when table changes
  useEffect(() => {
    if (currentTable) {
      loadAllAttendanceData()
      loadAllBadgeData()
    }
  }, [currentTable])

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
    if (realtimeScopeRef.current === scopeKey && realtimeChannelRef.current) {
      return undefined
    }

    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current)
      realtimeChannelRef.current = null
    }

    realtimeScopeRef.current = scopeKey
    const channelName = `workspace:${ownerId}:${currentTable}`
    let disposed = false

    const scheduleAttendanceRefresh = (serviceDate, source = 'attendance-realtime') => {
      const targetDateKey = serviceDate || (selectedAttendanceDate ? getLocalDateString(selectedAttendanceDate) : null)
      if (!targetDateKey) return
      if (realtimeAttendanceRefreshTimerRef.current) {
        clearTimeout(realtimeAttendanceRefreshTimerRef.current)
      }
      realtimeAttendanceRefreshTimerRef.current = setTimeout(async () => {
        if (disposed) return
        const snapshotVersion = attendanceSnapshotVersionRef.current.startRead(currentTable, targetDateKey)
        signalRealtimeSyncStatus(source)
        const date = new Date(`${targetDateKey}T12:00:00`)
        const remoteAttendance = await fetchAttendanceForDateInTable(date, currentTable)
        if (disposed) return
        if (!attendanceSnapshotVersionRef.current.canApplyRead(currentTable, targetDateKey, snapshotVersion)) return
        const mergedAttendance = mergeAttendanceMapWithPending(
          remoteAttendance,
          offlinePendingChangesRef.current,
          { tableName: currentTable, serviceDate: targetDateKey }
        )
        setAttendanceData((previous) => ({
          ...previous,
          [targetDateKey]: mergedAttendance
        }))
      }, 250)
    }

    const channel = supabase
      .channel(channelName)
      // 1. Monthly member table (e.g. August_2026)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: currentTable },
        (payload) => {
          signalRealtimeSyncStatus(`members-${String(payload.eventType || 'change').toLowerCase()}`)
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
              const nextMembers = prevMembers.map((member) =>
                member.id === incoming.id ? { ...member, ...incoming } : member
              )
              membersCacheRef.current.set(currentTable || 'default', { data: nextMembers, ts: Date.now() })
              persistMemberPreviewIndex(currentTable, [incoming], {
                cachedCount: nextMembers.length,
                totalCount: membersTotalCount || nextMembers.length,
                source: 'realtime-update'
              }).catch((error) => console.warn('Could not index realtime member update:', error))
              applyAttendanceColumnsFromMemberRows([incoming], currentTable)
              markMemberPreviewSyncComplete(currentTable, {
                cachedCount: nextMembers.length,
                totalCount: membersTotalCount || nextMembers.length,
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
      )
      // 2. Member codes (workspace_member_codes)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workspace_member_codes', filter: `workspace_owner_id=eq.${ownerId}` },
        (payload) => {
          const row = payload?.new
          if (!row || !row.member_id) return
          setWorkspaceMemberCodeAssignments((prev) => {
            const updated = {
              ...prev,
              [row.member_id]: {
                member_id: row.member_id,
                current_code: row.current_code,
                ordinal: row.ordinal,
                legacy_code: row.legacy_code,
                aliases: row.aliases || []
              }
            }
            writeStoredWorkspaceMemberCodeAssignments(workspaceCacheScope, updated)
            return updated
          })
        }
      )
      // 3. User preferences (user_preferences)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_preferences', filter: `user_id=eq.${ownerId}` },
        (payload) => {
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
        }
      )
      // 4. Attendance records / sessions
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_records' },
        (payload) => {
          const row = payload?.new || payload?.old
          if (row?.owner_id && String(row.owner_id) !== String(ownerId)) return
          let serviceDate = row?.service_date || null
          scheduleAttendanceRefresh(serviceDate, 'attendance-records-realtime')
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_sessions' },
        (payload) => {
          const row = payload?.new || payload?.old
          if (row?.owner_id && String(row.owner_id) !== String(ownerId)) return
          scheduleAttendanceRefresh(row?.service_date, 'attendance-sessions-realtime')
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          devCountersRef.current.realtimeSubscribedCount = (devCountersRef.current.realtimeSubscribedCount || 0) + 1
          signalRealtimeSyncStatus('realtime-connected')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[RealtimeManager] Channel ${channelName} status: ${status}`)
        }
      })

    realtimeChannelRef.current = channel

    return () => {
      disposed = true
      if (realtimeAttendanceRefreshTimerRef.current) {
        clearTimeout(realtimeAttendanceRefreshTimerRef.current)
        realtimeAttendanceRefreshTimerRef.current = null
      }
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current)
        realtimeChannelRef.current = null
        realtimeScopeRef.current = ''
      }
    }
  }, [applyAttendanceColumnsFromMemberRows, currentTable, dataOwnerId, fetchAttendanceForDateInTable, isDeveloperBypass, isSupabaseConfigured, membersTotalCount, persistMemberPreviewIndex, prepareRealtimeMember, removeMemberFromAttendanceData, selectedAttendanceDate, shouldUseOfflineData, signalRealtimeSyncStatus, updateAdminSyncNotice, user?.id, workspaceCacheScope])

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
    preferences,
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
    setPersonalCalendarMode,
    ownerStickyMonth,
    ownerStickySundays,
    adminSyncNotice,
    acknowledgeAdminSync,
    lockedDefaultDate,
    saveLockedDefaultDate,
    setCollaboratorOverride,
    fetchLockedDefaultDate,
    sendAdminPeriodBroadcast,
    getDevCounters: () => devCountersRef.current
  }), [
    members, membersTotalCount, membersLoadedAll, memberPreviewSyncStatus, recentMemberEdits, recordRecentMemberEdit, filteredMembers, loading, preferences, memberCodeFormat, memberCodeLength, workspaceMemberCodeAssignments, workspaceMemberCodeStatus, loadWorkspaceMemberCodes, ensureMemberCodeAssignment, convertWorkspaceMemberCodeFormat, searchTerm, serverSearchResults, searchResultSections,
    attendanceData, currentTable, monthlyTables, selectedAttendanceDate,
    availableSundayDates, badgeFilter, dashboardTab, uiAction,
    logActivity, checkCollaboratorStatus, updateWorkspaceForAllTables,
    refreshSearch, forceRefreshMembers, forceRefreshMembersSilent, refreshMemberPreviewById,
    searchMemberAcrossAllTables, addMember, updateMember, deleteMember,
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
    lockedDefaultDate, saveLockedDefaultDate, setCollaboratorOverride, fetchLockedDefaultDate, sendAdminPeriodBroadcast
  ])

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  )
}
