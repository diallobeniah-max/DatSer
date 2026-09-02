import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Upload, FileSpreadsheet, Search, ChevronDown, ChevronLeft, ChevronRight,
  Check, CheckCircle, X, AlertTriangle, Loader2, User, Users,
  Eye, Pencil, RefreshCw, Sparkles, Filter, Image as ImageIcon,
  Calendar, ArrowRight, Save, Download, Info, XCircle, UserPlus, History, GripVertical, RotateCcw, MessageSquare, ShieldCheck, Trash2, MousePointer
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'
import { CSV_IMPORT_MODE, detectCSVImportMode, parseCSVText, readCSVFile, toTitleCase, normalizeAttendanceValue, formatSheetLabel } from '../utils/csvImportParser'
import { matchAllImportRows, searchDatSerMembers, compareFieldsToMember, CSV_MATCH_STATUS } from '../utils/csvImportMatching'
import { filterCsvImportReviewRows, getCsvImportNote, getCsvImportReviewStatusCounts, getCsvImportUnresolvedAttentionCount, isCsvImportAttentionUnresolved, isCsvImportRowReady, isCsvImportRowSafeForBatch, markCsvImportAttentionVerified, searchCsvImportReviewRows } from '../utils/csvImportReview'
import { buildSundayDateMap, getSundaysForTable, buildCsvSavePlan, buildSundayNamesSavePlan, executeCsvSavePlan, buildCsvPreviewSummary, CSV_SAVE_STATUS } from '../services/csvImportSave'
import { applyCsvBulkCreateResult, buildCsvBulkCreatePlan, executeCsvBulkCreatePlan, getCsvBulkCreateSummary } from '../services/csvImportBulkCreate'
import { attachCsvImportImageDescriptors, deleteCsvImportDraft, deleteCsvImportSession, getCsvImportSourceUrl, listCsvImportSessions, persistCsvImportSession, renameCsvImportSession, restoreCsvImportSession, updateCsvImportBatchMetadata, updateCsvImportReviewRows } from '../services/csvImportHistory'
import { countPersistedCsvImportImages } from '../services/csvImportHistory'
import { deriveCsvImportMemberProvenance, rememberCsvImportMemberProvenance } from '../utils/csvImportMemberProvenance'
import CsvSourceCompare from './CsvSourceCompare'
import CsvImportBatchWorkspace from './CsvImportBatchWorkspace'
import CsvPossibleMatchResolver from './CsvPossibleMatchResolver'
import { CSV_BATCH_STATUS, createCsvBatchId, csvBatchEntryFromSession, csvFileBasename, deriveCsvBatchStatus, findNextCsvBatchEntry, getCsvBatchIssueQueue, getCsvBatchReviewSummary, groupCsvBatchSessions, isCsvBatchEntryCompleted, mergeCsvBatchFiles, normalizeCsvBatchBasename } from '../utils/csvImportBatch'
import { DEFAULT_AFFECTED_REPAIR_SHEETS, extractSheetNumber, isEntryInRepairList, prepareCsvBatchForReprocess } from '../utils/csvImportBatchRepair'
import { getCsvImportReviewColumnMinimum, getCsvImportReviewColumnWidth, getCsvImportReviewColumns } from '../utils/csvImportReviewLayout'

// ─── Step constants ─────────────────────────────────────────────────────────
const STEPS = {
  IMPORT: 'import',
  REVIEW: 'review',
  MONTH: 'month',
  PREVIEW: 'preview',
  SAVING: 'saving',
  RESULTS: 'results',
}

const STEP_LABELS = {
  [STEPS.IMPORT]: 'Import',
  [STEPS.REVIEW]: 'Review',
  [STEPS.MONTH]: 'Month & Sundays',
  [STEPS.PREVIEW]: 'Preview',
  [STEPS.SAVING]: 'Saving',
  [STEPS.RESULTS]: 'Results',
}

// ─── Filter constants ───────────────────────────────────────────────────────
const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'exact', label: 'Exact' },
  { key: 'possible', label: 'Possible' },
  { key: 'new', label: 'New' },
  { key: 'invalid', label: 'Invalid' },
  { key: 'attention', label: 'Needs Attention' },
  { key: 'saved', label: 'Saved' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'failed', label: 'Failed' },
]

const REVIEW_PROFILE_FIELDS = new Set([
  'fullName', 'phoneNumber', 'age', 'gender', 'educationalLevel',
  'parentGuardianName', 'parentGuardianPhone', 'notes',
])

const getSavedImportName = (savedImport) => {
  const name = String(savedImport?.name || '').trim()
  if (name) return name
  if (Number.isInteger(savedImport?.sequence_number)) return `Sheet ${savedImport.sequence_number}`
  return 'Saved Import'
}

const getSavedImportRowCount = (savedImport) => {
  if (Array.isArray(savedImport?.import_rows)) return savedImport.import_rows.length
  if (Array.isArray(savedImport?.save_result?.results)) return savedImport.save_result.results.length
  return 0
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function SettingsCsvImport() {
  const {
    members, currentTable, monthlyTables, isOnline, dataOwnerId,
    preferences, formatMemberName, searchMemberAcrossAllTables,
    setMemberAttendanceFromOtherMonth, forceRefreshMembers,
    fetchMembers, loadAllAttendanceData,
    isCollaborator,
  } = useApp()
  const { user } = useAuth()

  // ─── Core state ─────────────────────────────────────────────────────────
  const [step, setStep] = useState(STEPS.IMPORT)
  const [sessionId] = useState(() => `csv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  const [importRows, setImportRows] = useState([])
  const [parseErrors, setParseErrors] = useState([])
  const [parsedSheets, setParsedSheets] = useState([])
  const [csvText, setCsvText] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [importMode, setImportMode] = useState(CSV_IMPORT_MODE.FULL_REGISTER)
  const [modeWasChosen, setModeWasChosen] = useState(false)
  const [selectedSundayDate, setSelectedSundayDate] = useState('')

  // Target month
  const [targetTable, setTargetTable] = useState(currentTable || '')

  // Sunday mapping
  const [enabledSundays, setEnabledSundays] = useState({
    sunday_1: true, sunday_2: true, sunday_3: true, sunday_4: true, sunday_5: true,
  })

  // Review state
  const [filter, setFilter] = useState('all')
  const [sheetFilter, setSheetFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedRowId, setExpandedRowId] = useState(null)
  const [manualSearchRowId, setManualSearchRowId] = useState(null)
  const [manualSearchQuery, setManualSearchQuery] = useState('')
  const [compactView, setCompactView] = useState(false)
  const [columnWidths, setColumnWidths] = useState({})
  const [isMonthMenuOpen, setIsMonthMenuOpen] = useState(false)
  const [batchId, setBatchId] = useState(createCsvBatchId)
  const [batchName, setBatchName] = useState(() => `Batch ${new Date().toLocaleDateString()}`)
  const [batchEntries, setBatchEntries] = useState([])
  const [batchProgress, setBatchProgress] = useState({ csvDone: 0, csvTotal: 0, imageDone: 0, imageTotal: 0 })
  const [activeBatchEntryId, setActiveBatchEntryId] = useState(null)
  const [activeBatchIssue, setActiveBatchIssue] = useState(null)
  const [isBatchPreviewOpen, setIsBatchPreviewOpen] = useState(false)
  const [isBatchRepairOpen, setIsBatchRepairOpen] = useState(false)
  const [repairSelectedSheets, setRepairSelectedSheets] = useState(DEFAULT_AFFECTED_REPAIR_SHEETS)
  const [isSavingBatchReady, setIsSavingBatchReady] = useState(false)
  const [batchSaveSummary, setBatchSaveSummary] = useState(null)
  const [batchSaveProgress, setBatchSaveProgress] = useState(null)
  const [isBulkCreateConfirmOpen, setIsBulkCreateConfirmOpen] = useState(false)
  const [bulkCreateProgress, setBulkCreateProgress] = useState(null)
  const [bulkCreateResult, setBulkCreateResult] = useState(null)

  // Historical members cache
  const [allKnownMembers, setAllKnownMembers] = useState([])
  const [isLoadingMembers, setIsLoadingMembers] = useState(false)
  const [membersLoadedForMatching, setMembersLoadedForMatching] = useState(false)

  // Save state
  const [isSaving, setIsSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState({ completed: 0, total: 0 })
  const [saveResults, setSaveResults] = useState(null)
  const [savedImportId, setSavedImportId] = useState(null)
  const [savedImports, setSavedImports] = useState([])
  const [isSavedImportsOpen, setIsSavedImportsOpen] = useState(false)
  const [isLoadingSavedImports, setIsLoadingSavedImports] = useState(false)
  const [isRestoringImport, setIsRestoringImport] = useState(false)
  const [isPersistingHistory, setIsPersistingHistory] = useState(false)
  const [historyPersistenceError, setHistoryPersistenceError] = useState(null)
  const [renamingImportId, setRenamingImportId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [isRenamingImport, setIsRenamingImport] = useState(false)
  const [deleteConfirmImportId, setDeleteConfirmImportId] = useState(null)
  const [isDeletingSavedImport, setIsDeletingSavedImport] = useState(false)

  // Source images
  const [sheetImages, setSheetImages] = useState({}) // sheet -> File[]
  const [imageUploadStates, setImageUploadStates] = useState({})
  const [isComparingSource, setIsComparingSource] = useState(false)
  const [viewingImage, setViewingImage] = useState(null)

  const fileInputRef = useRef(null)
  const imageInputRef = useRef(null)
  const batchCsvInputRef = useRef(null)
  const batchImageInputRef = useRef(null)
  const reviewTableScrollRef = useRef(null)
  const reviewTopScrollRef = useRef(null)
  const resizeStateRef = useRef(null)
  const targetMonthMenuRef = useRef(null)
  const pendingImageAutoAssignmentRef = useRef(false)
  const batchNavWheelRef = useRef(null)
  const lastBatchWheelTimeRef = useRef(0)
  // Review edits are intentionally persisted through the existing import-row
  // JSON, never through member or attendance RPCs. Keep the latest canonical
  // rows in a ref so an async save cannot read an older React closure.
  const importRowsRef = useRef(importRows)
  const reviewSaveQueueRef = useRef(Promise.resolve())
  const reviewSaveTimerRef = useRef(null)
  const reviewSaveRequestRef = useRef({})
  const reviewSessionCreateRef = useRef(null)
  const savedImportIdRef = useRef(savedImportId)
  const flushReviewAutosavesRef = useRef(async () => true)
  const issueAutoAdvanceRef = useRef(null)
  const [reviewSaveState, setReviewSaveState] = useState({})
  const ownerId = dataOwnerId || user?.id
  const resolveCsvImportImage = useCallback((image) => getCsvImportSourceUrl({ supabase, image }), [])

  useEffect(() => {
    importRowsRef.current = importRows
  }, [importRows])

  useEffect(() => {
    savedImportIdRef.current = savedImportId
  }, [savedImportId])

  useEffect(() => () => {
    if (reviewSaveTimerRef.current) clearTimeout(reviewSaveTimerRef.current)
  }, [step])

  const loadSavedImports = useCallback(async () => {
    if (!user?.id || !ownerId) return
    setIsLoadingSavedImports(true)
    try {
      const sessions = await listCsvImportSessions({ supabase })
      setSavedImports(sessions)
      const groups = groupCsvBatchSessions(sessions)
      if (groups.length > 0) {
        const active = groups.find((group) => group.id === batchId) || groups[0]
        setBatchId(active.id)
        setBatchName(active.name)
        setBatchEntries(active.entries)
      }
    } catch (error) {
      toast.error(error?.message || 'Could not load saved imports.')
    } finally {
      setIsLoadingSavedImports(false)
    }
  }, [batchId, ownerId, user?.id])

  useEffect(() => {
    if (user?.id && ownerId) loadSavedImports()
  }, [loadSavedImports, ownerId, user?.id])

  const openSavedImports = useCallback(async () => {
    try {
      await flushReviewAutosavesRef.current()
    } catch (error) {
      toast.error(error?.message || 'Could not save review changes. Please retry before opening another import.')
      return
    }
    setIsSavedImportsOpen(true)
    await loadSavedImports()
  }, [loadSavedImports])

  const resetImport = useCallback(() => {
    setImportRows([])
    setCsvText('')
    setParsedSheets([])
    setParseErrors([])
    setSaveResults(null)
    setSavedImportId(null)
    setHistoryPersistenceError(null)
    setSheetImages({})
    setImageUploadStates({})
    setIsComparingSource(false)
    setFilter('all')
    setSheetFilter('all')
    setSearchQuery('')
    setExpandedRowId(null)
    setManualSearchRowId(null)
    setSelectedSundayDate('')
    setStep(STEPS.IMPORT)
  }, [])

  const openSavedImport = useCallback(async (historyId) => {
    // Saved sessions open into the complete review, not the post-save Results
    // screen. Results offers a deliberate "View Saved Rows" shortcut that
    // narrows the filter; history must never inherit that shortcut's state.
    try {
      await flushReviewAutosavesRef.current()
    } catch (error) {
      toast.error(error?.message || 'Could not save review changes. Please retry before opening another import.')
      return
    }
    setFilter('all')
    setSheetFilter('all')
    setSearchQuery('')
    setExpandedRowId(null)
    setManualSearchRowId(null)
    setIsRestoringImport(true)
    try {
      const { session, sheetImages: restoredImages } = await restoreCsvImportSession({ supabase, sessionId: historyId })
      setSavedImportId(session.id)
      setCsvText(session.source_csv || '')
      setParsedSheets(Array.isArray(session.parsed_sheets) ? session.parsed_sheets : [])
      const restoredRows = Array.isArray(session.import_rows) ? session.import_rows : []
      importRowsRef.current = restoredRows
      setImportRows(restoredRows)
      rememberCsvImportMemberProvenance({ ownerId, sessionId: session.id, rows: restoredRows })
      setTargetTable(session.target_table || currentTable || '')
      setEnabledSundays(session.enabled_sundays || {})
      const restoredMode = session.enabled_sundays?.__mode || session.import_rows?.[0]?.mode || CSV_IMPORT_MODE.FULL_REGISTER
      setImportMode(restoredMode)
      setModeWasChosen(true)
      setSelectedSundayDate(session.enabled_sundays?.__selected_sunday || '')
      setSaveResults(session.save_result?.results ? session.save_result : null)
      const restoredBatchEntry = csvBatchEntryFromSession(session)
      if (restoredBatchEntry) {
        setBatchId(restoredBatchEntry.batchId)
        setBatchName(restoredBatchEntry.batchName || batchName)
        setActiveBatchEntryId(session.id)
      } else {
        setActiveBatchEntryId(null)
      }
      setHistoryPersistenceError(null)
      setSheetImages(restoredImages)
      setImageUploadStates(Object.fromEntries(Object.entries(restoredImages).flatMap(([sheet, images]) => images.map((_, index) => [`${sheet}:${index}`, { status: 'saved' }]))))
      setParseErrors([])
      setIsSavedImportsOpen(false)
      setStep(STEPS.REVIEW)
      toast.success('Saved import opened')
    } catch (error) {
      toast.error(error?.message || 'Could not open this saved import.')
    } finally {
      setIsRestoringImport(false)
    }
  }, [batchName, currentTable, ownerId])

  useEffect(() => {
    if (!isSavedImportsOpen || typeof document === 'undefined') return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isSavedImportsOpen])

  const startRenamingSavedImport = useCallback((savedImport) => {
    setRenamingImportId(savedImport.id)
    setRenameDraft(getSavedImportName(savedImport))
  }, [])

  const cancelRenamingSavedImport = useCallback(() => {
    if (isRenamingImport) return
    setRenamingImportId(null)
    setRenameDraft('')
  }, [isRenamingImport])

  const saveSavedImportName = useCallback(async (savedImport) => {
    const nextName = renameDraft.trim()
    if (!nextName) {
      toast.error('Enter a name for this saved import.')
      return false
    }
    if (nextName.length > 120) {
      toast.error('Saved import names can be up to 120 characters.')
      return false
    }

    setIsRenamingImport(true)
    try {
      const updated = await renameCsvImportSession({ supabase, sessionId: savedImport.id, name: nextName })
      setSavedImports((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item))
      setRenamingImportId(null)
      setRenameDraft('')
      toast.success('Saved import renamed')
      return true
    } catch (error) {
      toast.error(error?.message || 'Could not rename this saved import.')
      return false
    } finally {
      setIsRenamingImport(false)
    }
  }, [renameDraft])

  const requestSavedImportDeletion = useCallback((savedImport) => {
    if (isRestoringImport || isRenamingImport || isDeletingSavedImport) return
    setRenamingImportId(null)
    setDeleteConfirmImportId(savedImport.id)
  }, [isDeletingSavedImport, isRenamingImport, isRestoringImport])

  const cancelSavedImportDeletion = useCallback(() => {
    if (!isDeletingSavedImport) setDeleteConfirmImportId(null)
  }, [isDeletingSavedImport])

  const confirmSavedImportDeletion = useCallback(async (savedImport) => {
    setIsDeletingSavedImport(true)
    try {
      const { storageWarning } = await deleteCsvImportSession({ supabase, sessionId: savedImport.id })
      setSavedImports((current) => current.filter((item) => item.id !== savedImport.id))
      setBatchEntries((current) => current.filter((entry) => entry.sessionId !== savedImport.id && entry.id !== savedImport.id))
      if (activeBatchEntryId === savedImport.id) setActiveBatchEntryId(null)
      if (savedImportId === savedImport.id) resetImport()
      setDeleteConfirmImportId(null)
      toast.success('Saved import deleted')
      if (storageWarning) toast.warn(`Saved import deleted. ${storageWarning}`)
    } catch (error) {
      toast.error(error?.message || 'Could not delete this saved import.')
    } finally {
      setIsDeletingSavedImport(false)
    }
  }, [activeBatchEntryId, resetImport, savedImportId])

  const persistHistorySnapshot = useCallback(async ({
    rows = importRows,
    results = saveResults,
  } = {}) => {
    if (!results) return false
    setIsPersistingHistory(true)
    setHistoryPersistenceError(null)
    try {
      const activeBatchEntry = batchEntries.find((entry) => entry.sessionId === savedImportId || entry.id === activeBatchEntryId)
      const batch = activeBatchEntry ? {
        id: activeBatchEntry.batchId || batchId, name: batchName,
        normalizedBasename: activeBatchEntry.normalizedBasename,
        displayBasename: activeBatchEntry.displayBasename,
        originalCsvFilename: activeBatchEntry.originalCsvFilename,
        mode: importMode,
        status: results.failCount > 0 ? 'partial' : CSV_BATCH_STATUS.SAVED,
      } : results.batch
      const savedSession = await persistCsvImportSession({
        supabase,
        existingSessionId: savedImportId,
        userId: user?.id,
        ownerId,
        csvText,
        parsedSheets,
        importRows: rows,
        targetTable,
        enabledSundays: importMode === CSV_IMPORT_MODE.SUNDAY_NAMES
          ? { __mode: importMode, __selected_sunday: selectedSundayDate }
          : enabledSundays,
        saveResults: { ...results, ...(batch ? { batch } : {}) },
        sheetImages,
        onImageStatus: ({ key, ...status }) => setImageUploadStates((current) => ({ ...current, [key]: status })),
      })
      setSavedImportId(savedSession.id)
      if (batch) setBatchEntries((current) => current.map((entry) => entry.sessionId === savedSession.id ? { ...entry, status: batch.status, rows, imageFiles: savedSession.source_images || entry.imageFiles, persistedImageCount: savedSession.source_images?.length || entry.persistedImageCount } : entry))
      await loadSavedImports()
      return true
    } catch (historyError) {
      const message = historyError?.message || 'Unknown error'
      if (historyError?.historySessionId) setSavedImportId(historyError.historySessionId)
      setHistoryPersistenceError(message)
      toast.warn(`Rows were saved, but history needs attention: ${message}`)
      return false
    } finally {
      setIsPersistingHistory(false)
    }
  }, [
    activeBatchEntryId, batchEntries, batchId, batchName, csvText, enabledSundays, importMode, selectedSundayDate, importRows, loadSavedImports, ownerId, parsedSheets,
    saveResults, savedImportId, sheetImages, targetTable, user?.id,
  ])

  const persistReviewRows = useCallback(async (rows) => {
    let activeSessionId = savedImportIdRef.current
    if (!activeSessionId) {
      // Multiple fast edits can arrive before the first history row exists.
      // Share the creation request so they all continue with the same session.
      if (!reviewSessionCreateRef.current) {
        reviewSessionCreateRef.current = persistCsvImportSession({
          supabase,
          existingSessionId: null,
          userId: user?.id,
          ownerId,
          csvText,
          parsedSheets,
          importRows: rows,
          targetTable,
          enabledSundays: importMode === CSV_IMPORT_MODE.SUNDAY_NAMES
            ? { __mode: importMode, __selected_sunday: selectedSundayDate }
            : enabledSundays,
          saveResults: saveResults || {},
          sheetImages,
          onImageStatus: ({ key, ...status }) => setImageUploadStates((current) => ({ ...current, [key]: status })),
        }).then((session) => {
          savedImportIdRef.current = session.id
          setSavedImportId(session.id)
          return session.id
        }).finally(() => {
          reviewSessionCreateRef.current = null
        })
      }
      activeSessionId = await reviewSessionCreateRef.current
    }

    const saved = await updateCsvImportReviewRows({ supabase, sessionId: activeSessionId, importRows: rows })
    setSavedImports((current) => current.map((item) => item.id === activeSessionId ? { ...item, import_rows: saved.import_rows, updated_at: saved.updated_at } : item))
    setBatchEntries((current) => current.map((entry) => (
      entry.sessionId === activeSessionId || entry.id === activeBatchEntryId
        ? { ...entry, sessionId: activeSessionId, rows }
        : entry
    )))
    return activeSessionId
  }, [activeBatchEntryId, csvText, enabledSundays, importMode, ownerId, parsedSheets, saveResults, selectedSundayDate, sheetImages, targetTable, user?.id])

  const saveReviewRowsNow = useCallback((rowId) => {
    if (!savedImportIdRef.current && (!user?.id || !ownerId)) return Promise.reject(new Error('Sign in to save review changes.'))
    const request = (reviewSaveRequestRef.current[rowId] || 0) + 1
    reviewSaveRequestRef.current[rowId] = request
    setReviewSaveState((current) => ({ ...current, [rowId]: { status: 'saving', request } }))
    const run = async () => {
      const rows = importRowsRef.current
      try {
        await persistReviewRows(rows)
        // A newer save may already be queued. Do not let this older response
        // replace its status or make an unsaved change look durable.
        if (request === reviewSaveRequestRef.current[rowId]) {
          setReviewSaveState((current) => ({ ...current, [rowId]: { status: 'saved', request } }))
        }
        return true
      } catch (error) {
        if (request === reviewSaveRequestRef.current[rowId]) {
          setReviewSaveState((current) => ({ ...current, [rowId]: { status: 'failed', request, message: error?.message || 'Could not save changes.' } }))
        }
        throw error
      }
    }
    reviewSaveQueueRef.current = reviewSaveQueueRef.current.catch(() => undefined).then(run)
    return reviewSaveQueueRef.current
  }, [ownerId, persistReviewRows, user?.id])

  const scheduleReviewAutosave = useCallback((rowId, { immediate = false } = {}) => {
    if (reviewSaveTimerRef.current) clearTimeout(reviewSaveTimerRef.current)
    if (immediate) return saveReviewRowsNow(rowId)
    setReviewSaveState((current) => ({ ...current, [rowId]: { status: 'saving' } }))
    reviewSaveTimerRef.current = setTimeout(() => {
      reviewSaveTimerRef.current = null
      saveReviewRowsNow(rowId).catch((error) => {
        toast.error(error?.message || 'Could not save review changes. Retry before leaving this import.')
      })
    }, 450)
    return Promise.resolve(true)
  }, [saveReviewRowsNow])

  const flushReviewAutosaves = useCallback(async (rowId = expandedRowId) => {
    if (reviewSaveTimerRef.current) {
      clearTimeout(reviewSaveTimerRef.current)
      reviewSaveTimerRef.current = null
      await saveReviewRowsNow(rowId || 'review')
    }
    await reviewSaveQueueRef.current
    const failed = Object.values(reviewSaveState).some((state) => state.status === 'failed')
    if (failed) throw new Error('Review changes still need to be saved.')
    return true
  }, [expandedRowId, reviewSaveState, saveReviewRowsNow])

  useEffect(() => {
    flushReviewAutosavesRef.current = flushReviewAutosaves
  }, [flushReviewAutosaves])

  const updateCanonicalRows = useCallback((nextRows, rowId, { immediate = false } = {}) => {
    importRowsRef.current = nextRows
    setImportRows(nextRows)
    setBatchEntries((current) => current.map((entry) => (
      entry.sessionId === savedImportIdRef.current || entry.id === activeBatchEntryId
        ? { ...entry, rows: nextRows }
        : entry
    )))
    scheduleReviewAutosave(rowId, { immediate })
    return nextRows
  }, [activeBatchEntryId, scheduleReviewAutosave])

  const navigateAfterReviewSave = useCallback(async (nextStep) => {
    try {
      await flushReviewAutosaves()
      setStep(nextStep)
    } catch (error) {
      toast.error(error?.message || 'Could not save review changes. Please retry before leaving this step.')
    }
  }, [flushReviewAutosaves])

  const reviewColumns = useMemo(() => getCsvImportReviewColumns({ compactView, parsedSheets, sheetFilter }), [compactView, parsedSheets, sheetFilter])
  const getReviewColumnWidth = useCallback((column) => (
    columnWidths[column.key] || getCsvImportReviewColumnWidth(column, compactView)
  ), [columnWidths, compactView])

  const reviewTableWidth = useMemo(() => reviewColumns.reduce(
    (total, column) => total + getReviewColumnWidth(column), 0
  ), [getReviewColumnWidth, reviewColumns])

  // ─── Derived values ─────────────────────────────────────────────────────
  const sundayDates = useMemo(() => getSundaysForTable(targetTable), [targetTable])

  useEffect(() => {
    if (importMode !== CSV_IMPORT_MODE.SUNDAY_NAMES || !selectedSundayDate) return
    const validDates = sundayDates.map((date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`)
    if (!validDates.includes(selectedSundayDate)) setSelectedSundayDate('')
  }, [importMode, selectedSundayDate, sundayDates])

  const sundayDateMap = useMemo(
    () => buildSundayDateMap(targetTable, enabledSundays),
    [targetTable, enabledSundays]
  )

  const statusCounts = useMemo(
    () => getCsvImportReviewStatusCounts(importRows),
    [importRows]
  )

  const bulkCreateSummary = useMemo(
    () => getCsvBulkCreateSummary(importRows),
    [importRows]
  )

  const sheetCounts = useMemo(() => {
    const counts = {}
    importRows.forEach((row) => {
      counts[row.sheet] = (counts[row.sheet] || 0) + 1
    })
    return counts
  }, [importRows])

  const visibleRows = useMemo(() => {
    let rows = filterCsvImportReviewRows(importRows, filter)

    // Apply sheet filter
    if (sheetFilter !== 'all') {
      rows = rows.filter((row) => row.sheet === sheetFilter)
    }

    // Apply search
    rows = searchCsvImportReviewRows(rows, searchQuery)

    return rows
  }, [importRows, filter, sheetFilter, searchQuery])

  // Batch projections deliberately read the same persisted rows that power the
  // sheet review. They never mutate sessions just because an operator filters.
  const batchIssueQueue = useMemo(() => getCsvBatchIssueQueue(batchEntries), [batchEntries])
  const batchReviewSummary = useMemo(() => getCsvBatchReviewSummary(batchEntries), [batchEntries])

  // ─── Load all known members (current + historical) ──────────────────────
  const loadAllMembers = useCallback(async (rowsToMatch = importRows) => {
    setIsLoadingMembers(true)
    setMembersLoadedForMatching(false)
    try {
      // Start with current month members
      const currentMembers = [...(members || [])]

      // Reuse the workspace's schema-tolerant cross-month lookup rather than
      // querying legacy month tables with a modern fixed column list.
      const historicalQueries = [...new Set(rowsToMatch.flatMap((row) => [
        row.edited?.memberCode,
        row.edited?.phoneNumber,
        row.edited?.fullName,
      ]).map((value) => String(value || '').trim()).filter((value) => value.length >= 2))]

      const allHistorical = []
      if (searchMemberAcrossAllTables && historicalQueries.length > 0) {
        const batches = await Promise.all(historicalQueries.map(async (query) => {
          try {
            return await searchMemberAcrossAllTables(query)
          } catch (_err) {
            return []
          }
        }))

        batches.flat().forEach((member) => {
          if (!member?.canonical_member_id) return
          allHistorical.push({
            id: member.canonical_member_id,
            'Full Name': member.full_name || '',
            'Phone Number': member.phone_number || '',
            'Gender': member.gender || '',
            'Age': member.age || '',
            'Current Level': member.current_level || '',
            member_code: member.member_code || '',
            __source_table: member.source_table || '',
          })
        })
      }

      // Deduplicate by member ID, preferring current month
      const byId = new Map()
      currentMembers.forEach((m) => { if (m?.id) byId.set(String(m.id), m) })
      allHistorical.forEach((m) => { if (m?.id && !byId.has(String(m.id))) byId.set(String(m.id), m) })

      setAllKnownMembers([...byId.values()])
    } catch (err) {
      toast.error('Failed to load member data for matching')
    } finally {
      setIsLoadingMembers(false)
      setMembersLoadedForMatching(true)
    }
  }, [members, importRows, searchMemberAcrossAllTables])

  // ─── Parse CSV ──────────────────────────────────────────────────────────
  const handleParse = useCallback((text) => {
    if (!text?.trim()) return

    setIsParsing(true)
    try {
      const detection = detectCSVImportMode(text)
      if (!modeWasChosen && !detection.mode) {
        setParseErrors([{ message: 'This input is ambiguous. Choose Full Register or Sunday Names List, then try again.' }])
        return
      }
      const effectiveMode = modeWasChosen ? importMode : detection.mode
      setImportMode(effectiveMode)
      const result = parseCSVText(text, sessionId, { mode: effectiveMode })
      if (result.errors.length > 0 && result.rows.length === 0) {
        setParseErrors(result.errors)
        setImportRows([])
        setParsedSheets([])
        toast.error(result.errors[0]?.message || 'CSV parsing failed')
        return
      }

      setParseErrors(result.errors)
      setParsedSheets(result.sheets)
      importRowsRef.current = result.rows
      setImportRows(result.rows)

      if (result.rows.length > 0) {
        toast.success(`Parsed ${result.rows.length} rows from ${result.sheets.length} sheet${result.sheets.length !== 1 ? 's' : ''}`)
        setStep(effectiveMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? STEPS.MONTH : STEPS.REVIEW)
        // Trigger member matching
        loadAllMembers(result.rows)
      }
    } catch (err) {
      toast.error('Failed to parse CSV')
      setParseErrors([{ message: err.message }])
    } finally {
      setIsParsing(false)
    }
  }, [sessionId, loadAllMembers, importMode, modeWasChosen])

  const handleFileUpload = useCallback(async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await readCSVFile(file)
      setCsvText(text)
      handleParse(text)
    } catch (err) {
      toast.error('Failed to read file')
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [handleParse])

  const persistBatchEntry = useCallback(async (entry) => {
    const batch = {
      id: batchId, name: batchName.trim() || 'Batch import',
      normalizedBasename: entry.normalizedBasename, displayBasename: entry.displayBasename,
      originalCsvFilename: entry.csvFiles?.[0]?.name || entry.originalCsvFilename || null,
      mode: entry.mode || null, status: entry.status, sheetMismatch: !!entry.sheetMismatch,
      error: entry.error || null,
    }
    const session = await persistCsvImportSession({
      supabase, existingSessionId: entry.sessionId, userId: user?.id, ownerId,
      csvText: entry.csvText || '', parsedSheets: entry.parsedSheets || [], importRows: entry.rows || [],
      targetTable: entry.targetTable || targetTable || null,
      enabledSundays: entry.enabledSundays || { __mode: entry.mode || null },
      saveResults: { successCount: entry.status === CSV_BATCH_STATUS.SAVED ? entry.rows?.length || 0 : 0, results: [], batch },
      sheetImages: entry.imageFiles?.length ? { [entry.displayBasename]: entry.imageFiles } : {},
    })
    if (session.name !== entry.displayBasename) await renameCsvImportSession({ supabase, sessionId: session.id, name: entry.displayBasename })
    return {
      ...entry, id: session.id, sessionId: session.id, originalCsvFilename: batch.originalCsvFilename,
      imageFiles: session.source_images || [], persistedImageCount: session.source_images?.length || 0,
      isPersisting: false,
    }
  }, [batchId, batchName, ownerId, targetTable, user?.id])

  const persistBatchEntries = useCallback(async (entries, ids) => {
    let working = entries
    for (const id of ids) {
      const index = working.findIndex((entry) => entry.id === id || entry.normalizedBasename === id)
      if (index < 0) continue
      const pending = { ...working[index], isPersisting: true }
      working = working.map((entry, entryIndex) => entryIndex === index ? pending : entry)
      setBatchEntries(working)
      try {
        const saved = await persistBatchEntry(pending)
        working = working.map((entry, entryIndex) => entryIndex === index ? saved : entry)
      } catch (error) {
        working = working.map((entry, entryIndex) => entryIndex === index ? { ...entry, isPersisting: false, status: CSV_BATCH_STATUS.FAILED, error: error.message } : entry)
      }
      setBatchEntries(working)
    }
    await loadSavedImports()
    return working
  }, [loadSavedImports, persistBatchEntry])

  const handleBatchCsvUpload = useCallback(async (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    let working = mergeCsvBatchFiles(batchEntries, { batchId, csvFiles: files })
    setBatchProgress((current) => ({ ...current, csvDone: 0, csvTotal: files.length }))
    setBatchEntries(working)
    const affected = new Set(files.map((file) => normalizeCsvBatchBasename(file.name)))
    for (const basename of affected) {
      const index = working.findIndex((entry) => entry.normalizedBasename === basename)
      if (index < 0) continue
      const entry = working[index]
      if (entry.csvFiles.length > 1) {
        working[index] = { ...entry, status: CSV_BATCH_STATUS.DUPLICATE_CSV, error: 'Duplicate CSV name' }
      } else {
        try {
          const file = entry.csvFiles[0]
          const text = await readCSVFile(file)
          const detection = detectCSVImportMode(text)
          const effectiveMode = detection.mode || (modeWasChosen ? importMode : null)
          if (!effectiveMode) throw new Error('Ambiguous CSV mode — choose Full Register or Sunday Names List')
          const result = parseCSVText(text, `${batchId}_${entry.normalizedBasename}`, { mode: effectiveMode })
          if (!result.rows.length) throw new Error(result.errors[0]?.message || 'CSV contains no valid rows')
          const hasSheetColumn = result.headers.some((header) => String(header).trim().toLocaleLowerCase() === 'sheet')
          const sheetMismatch = hasSheetColumn && result.sheets.some((sheet) => normalizeCsvBatchBasename(sheet) !== entry.normalizedBasename)
          const next = { ...entry, csvText: text, rows: result.rows, parsedSheets: result.sheets, mode: effectiveMode, parseErrors: result.errors, sheetMismatch, error: sheetMismatch ? 'Filename / CSV sheet mismatch' : null }
          next.status = sheetMismatch ? CSV_BATCH_STATUS.MISMATCH : deriveCsvBatchStatus(next)
          working[index] = next
        } catch (error) {
          working[index] = { ...entry, invalid: true, status: CSV_BATCH_STATUS.INVALID, error: error.message }
        }
      }
      setBatchProgress((current) => ({ ...current, csvDone: current.csvDone + entry.csvFiles.length }))
      setBatchEntries([...working])
    }
    working = await persistBatchEntries(working, [...affected])
    setBatchEntries(working)
    if (batchCsvInputRef.current) batchCsvInputRef.current.value = ''
  }, [batchEntries, batchId, importMode, modeWasChosen, persistBatchEntries])

  const handleBatchImageUpload = useCallback(async (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    let working = mergeCsvBatchFiles(batchEntries, { batchId, imageFiles: files })
    setBatchEntries(working)
    setBatchProgress((current) => ({ ...current, imageDone: 0, imageTotal: files.length }))
    const affected = [...new Set(files.map((file) => normalizeCsvBatchBasename(file.name)))]
    working = await persistBatchEntries(working, affected)
    setBatchProgress((current) => ({ ...current, imageDone: files.length }))
    setBatchEntries(working)
    if (batchImageInputRef.current) batchImageInputRef.current.value = ''
  }, [batchEntries, batchId, persistBatchEntries])

  const reviewBatchEntry = useCallback(async (entryId) => {
    const nextEntries = batchEntries.map((entry) => entry.id === entryId && entry.status !== CSV_BATCH_STATUS.SAVED
      ? { ...entry, status: CSV_BATCH_STATUS.REVIEWED }
      : entry)
    setBatchEntries(nextEntries)
    const persisted = await persistBatchEntries(nextEntries, [entryId])
    const entry = persisted.find((candidate) => candidate.id === entryId || candidate.sessionId === entryId)
    if (entry?.sessionId) openSavedImport(entry.sessionId)
  }, [batchEntries, openSavedImport, persistBatchEntries])

  const retryBatchEntry = useCallback(async (entryId) => {
    const entry = batchEntries.find((candidate) => candidate.id === entryId)
    if (!entry) return
    const next = await persistBatchEntries(batchEntries, [entryId])
    setBatchEntries(next)
  }, [batchEntries, persistBatchEntries])

  const openBatchIssue = useCallback(async (issue, issueIndex = 0) => {
    if (!issue) return
    setActiveBatchIssue({ entryId: issue.entryId, rowId: issue.rowId, index: issueIndex })
    if (!issue.entry?.sessionId || !issue.rowId) {
      await reviewBatchEntry(issue.entryId)
      return
    }
    await openSavedImport(issue.entry.sessionId)
    setFilter('all')
    setSheetFilter(issue.sheet || 'all')
    setExpandedRowId(issue.rowId)
    setManualSearchRowId(null)
    setIsComparingSource(true)
  }, [openSavedImport, reviewBatchEntry])

  const reviewBatchIssues = useCallback(() => {
    if (!batchIssueQueue.length) {
      toast.success('This batch has no unresolved issues.')
      return
    }
    openBatchIssue(batchIssueQueue[0], 0)
  }, [batchIssueQueue, openBatchIssue])

  const navigateBatchIssue = useCallback((direction) => {
    if (!batchIssueQueue.length) return
    const currentIndex = activeBatchIssue
      ? batchIssueQueue.findIndex((issue) => issue.entryId === activeBatchIssue.entryId && issue.rowId === activeBatchIssue.rowId)
      : -1
    const index = currentIndex >= 0 ? currentIndex : (activeBatchIssue?.index ?? 0)
    const nextIndex = (index + direction + batchIssueQueue.length) % batchIssueQueue.length
    openBatchIssue(batchIssueQueue[nextIndex], nextIndex)
  }, [activeBatchIssue, batchIssueQueue, openBatchIssue])

  const handleSaveAllReady = useCallback(async () => {
    if (!isOnline) {
      toast.error('Save All Ready requires an active internet connection.')
      return
    }
    setIsSavingBatchReady(true)
    const totals = { saved: 0, skipped: 0, failed: 0, processedSheets: 0 }
    let working = [...batchEntries]
    try {
      // Flush the currently open sheet before reading its canonical batch row.
      // This keeps the batch executor from saving stale in-memory edits.
      await flushReviewAutosaves()
      const remainingEntries = working.filter((entry) => entry.sessionId && !isCsvBatchEntryCompleted(entry))
      setBatchSaveProgress({ completed: 0, total: remainingEntries.length })
      for (const entry of remainingEntries) {
        if (!entry.sessionId || isCsvBatchEntryCompleted(entry)) continue
        const entryTargetTable = entry.targetTable || targetTable
        const entryMode = entry.mode || importMode
        if (!entryTargetTable) continue
        const completedRowIds = new Set((entry.rows || []).filter((row) => row.saveStatus === 'saved' || row.saveStatus === 'skipped').map((row) => row.importRowId))
        const fullPlan = entryMode === CSV_IMPORT_MODE.SUNDAY_NAMES
          ? buildSundayNamesSavePlan({
              importRows: entry.rows || [], targetTable: entryTargetTable,
              selectedSundayDate: entry.enabledSundays?.__selected_sunday || selectedSundayDate,
              ownerId, workspaceName: preferences?.workspace_name || '', completedRowIds,
              allowSafeNew: true,
              processRemaining: true,
            })
          : buildCsvSavePlan({
              importRows: entry.rows || [], targetTable: entryTargetTable,
              sundayDateMap: buildSundayDateMap(entryTargetTable, entry.enabledSundays || enabledSundays),
              ownerId, workspaceName: preferences?.workspace_name || '', completedRowIds,
              allowSafeNew: true,
              processRemaining: true,
            })
        // Only valid actionable steps enter the production save executor.
        const plan = fullPlan.filter((item) => item.action !== 'skip' && item.action !== 'unresolved')
        if (!plan.length) continue
        const result = await executeCsvSavePlan({
          plan, targetTable: entryTargetTable, ownerId, sessionId: entry.sessionId, supabase,
          onProgress: () => undefined, ensureMemberCodeAssignment: null,
          setMemberAttendanceFromOtherMonth, forceRefreshMembers,
        })
        const resultByRow = new Map(result.results.map((item) => [item.importRowId, item]))
        const rows = (entry.rows || []).map((row) => {
          const rowResult = resultByRow.get(row.importRowId)
          if (!rowResult) return row
          const isCreated = rowResult.action === 'created' && rowResult.memberId
          const updatedRow = {
            ...row,
            saveStatus: rowResult.status === CSV_SAVE_STATUS.SAVED ? 'saved'
              : rowResult.status === CSV_SAVE_STATUS.FAILED ? 'failed'
                : rowResult.status === CSV_SAVE_STATUS.SKIPPED ? 'skipped' : row.saveStatus,
            saveError: rowResult.error || null,
            processedAsEntered: isCsvImportAttentionUnresolved(row) ? true : row.processedAsEntered,
          }
          if (isCreated) {
            return applyCsvBulkCreateResult({
              row: updatedRow,
              result: rowResult,
              sessionId: entry.sessionId,
              batchId: entry.batchId || batchId,
            })
          }
          return updatedRow
        })
        const batch = {
          id: entry.batchId || batchId, name: batchName, normalizedBasename: entry.normalizedBasename,
          displayBasename: entry.displayBasename, originalCsvFilename: entry.originalCsvFilename,
          mode: entryMode, status: result.failCount > 0 ? 'partial' : CSV_BATCH_STATUS.SAVED,
          sheetMismatch: !!entry.sheetMismatch, error: result.failCount > 0 ? 'Some rows failed' : null,
        }
        await persistCsvImportSession({
          supabase, existingSessionId: entry.sessionId, userId: user?.id, ownerId,
          csvText: entry.csvText || '', parsedSheets: entry.parsedSheets || [], importRows: rows,
          targetTable: entryTargetTable, enabledSundays: entry.enabledSundays || {},
          saveResults: { ...result, batch }, sheetImages: {},
        })
        rememberCsvImportMemberProvenance({ ownerId, sessionId: entry.sessionId, rows })
        totals.saved += result.successCount
        totals.skipped += result.skipCount
        totals.failed += result.failCount
        totals.processedSheets += 1
        setBatchSaveProgress({ completed: totals.processedSheets, total: remainingEntries.length })
        working = working.map((candidate) => candidate.id === entry.id || candidate.sessionId === entry.sessionId
          ? { ...candidate, rows, status: batch.status, error: batch.error }
          : candidate)
        setBatchEntries(working)
      }
      setBatchSaveSummary(totals)
      setIsBatchPreviewOpen(false)
      await loadSavedImports()
      await forceRefreshMembers?.()
      if (typeof fetchMembers === 'function' && targetTable) {
        await fetchMembers(targetTable, { forceRefresh: true, forceOnline: true })
      }
      if (typeof loadAllAttendanceData === 'function') {
        await loadAllAttendanceData()
      }
      totals.failed
        ? toast.warn(totals.saved + ' saved, ' + totals.skipped + ' skipped, ' + totals.failed + ' failed')
        : toast.success(totals.saved + ' saved' + (totals.skipped ? ', ' + totals.skipped + ' already current' : ''))
    } catch (error) {
      toast.error(error?.message || 'Process Remaining Sheets could not finish. Completed rows remain safe; retry only the remaining work.')
    } finally {
      setIsSavingBatchReady(false)
      setBatchSaveProgress(null)
    }
  }, [batchEntries, batchId, batchName, currentTable, enabledSundays, fetchMembers, flushReviewAutosaves, forceRefreshMembers, importMode, isOnline, loadAllAttendanceData, loadSavedImports, ownerId, preferences?.workspace_name, selectedSundayDate, setMemberAttendanceFromOtherMonth, targetTable, user?.id])

  const handlePrepareBatchRepair = useCallback(async () => {
    try {
      const repaired = prepareCsvBatchForReprocess(batchEntries, repairSelectedSheets)
      const affectedEntries = repaired.filter((entry, idx) => isEntryInRepairList(entry, repairSelectedSheets, idx))
      const affectedIds = affectedEntries.map((e) => e.sessionId || e.id)

      setBatchEntries(repaired)
      setIsBatchRepairOpen(false)

      await persistBatchEntries(repaired, affectedIds)

      toast.success(`Prepared ${affectedEntries.length} sheets for reprocessing. Click "Process Remaining Sheets" to save.`)
    } catch (err) {
      toast.error(err?.message || 'Failed to prepare sheets for reprocessing')
    }
  }, [batchEntries, persistBatchEntries, repairSelectedSheets])

  // Advance only after the existing autosave queue confirms persistence.
  useEffect(() => {
    if (!activeBatchIssue?.rowId) return
    const key = activeBatchIssue.entryId + ':' + activeBatchIssue.rowId
    const stillOpen = batchIssueQueue.some((issue) => issue.entryId === activeBatchIssue.entryId && issue.rowId === activeBatchIssue.rowId)
    const saved = reviewSaveState[activeBatchIssue.rowId]?.status === 'saved'
    if (stillOpen || !saved || issueAutoAdvanceRef.current === key) return
    issueAutoAdvanceRef.current = key
    const nextIndex = Math.min(activeBatchIssue.index, Math.max(0, batchIssueQueue.length - 1))
    const nextIssue = batchIssueQueue[nextIndex]
    if (nextIssue) {
      openBatchIssue(nextIssue, nextIndex)
      return
    }
    setActiveBatchIssue(null)
    toast.success('All batch issues are resolved. Review the batch preview when ready.')
  }, [activeBatchIssue, batchIssueQueue, openBatchIssue, reviewSaveState])

  const persistBatchName = useCallback(async () => {
    const name = batchName.trim() || 'Batch import'
    const persistedEntries = batchEntries.filter((entry) => entry.sessionId)
    if (!persistedEntries.length) return
    try {
      await Promise.all(persistedEntries.map((entry) => updateCsvImportBatchMetadata({
        supabase,
        sessionId: entry.sessionId,
        batch: {
          id: entry.batchId || batchId,
          name,
          normalizedBasename: entry.normalizedBasename,
          displayBasename: entry.displayBasename,
          originalCsvFilename: entry.originalCsvFilename || entry.csvFiles?.[0]?.name || null,
          mode: entry.mode || null,
          status: entry.status,
          sheetMismatch: !!entry.sheetMismatch,
          error: entry.error || null,
        },
      })))
      setBatchName(name)
    } catch (error) {
      toast.error(error.message || 'Could not save the batch name.')
    }
  }, [batchEntries, batchId, batchName])

  const removeBatchEntry = useCallback(async (entryId) => {
    const entry = batchEntries.find((candidate) => candidate.id === entryId)
    if (!entry || isCsvBatchEntryCompleted(entry)) return
    try {
      if (entry.sessionId) await deleteCsvImportDraft({ supabase, sessionId: entry.sessionId })
      setBatchEntries((current) => current.filter((candidate) => candidate.id !== entryId))
      toast.success('Draft removed from this batch')
    } catch (error) {
      toast.error(error.message || 'Could not remove this draft.')
    }
  }, [batchEntries])

  const assignBatchImage = useCallback(async (sourceId, targetId) => {
    const source = batchEntries.find((entry) => entry.id === sourceId)
    const target = batchEntries.find((entry) => entry.id === targetId)
    if (!source?.sessionId || !target?.sessionId) return
    try {
      const updatedTarget = await attachCsvImportImageDescriptors({ supabase, sessionId: target.sessionId, images: source.imageFiles })
      await updateCsvImportBatchMetadata({ supabase, sessionId: source.sessionId, batch: {
        id: source.batchId, name: batchName, normalizedBasename: source.normalizedBasename,
        displayBasename: source.displayBasename, status: CSV_BATCH_STATUS.ASSIGNED, assignedTo: target.sessionId,
      } })
      setBatchEntries((current) => current.filter((entry) => entry.id !== sourceId).map((entry) => entry.id === targetId ? {
        ...entry, imageFiles: updatedTarget.source_images || [], persistedImageCount: updatedTarget.source_images?.length || 0,
        status: deriveCsvBatchStatus({ ...entry, imageFiles: updatedTarget.source_images || [] }),
      } : entry))
      toast.success(`Image assigned to ${target.displayBasename}`)
    } catch (error) {
      toast.error(error.message || 'Could not assign this image.')
    }
  }, [batchEntries, batchName])

  const openAdjacentBatchEntry = useCallback(async (direction = 1, unsavedOnly = false) => {
    if (!activeBatchEntryId) return
    const ordered = [...batchEntries]
    const currentIndex = ordered.findIndex((entry) => entry.sessionId === activeBatchEntryId || entry.id === activeBatchEntryId)
    const candidate = direction > 0
      ? findNextCsvBatchEntry(ordered, activeBatchEntryId, { unsavedOnly })
      : [...ordered].reverse().find((entry) => (entry.csvFiles?.length || entry.originalCsvFilename) && ordered.indexOf(entry) < currentIndex)
    if (!candidate?.sessionId) return
    try {
      await flushReviewAutosaves()
      await openSavedImport(candidate.sessionId)
    } catch (error) {
      toast.error(error?.message || 'Could not save review changes. Please retry before changing sheets.')
    }
  }, [activeBatchEntryId, batchEntries, flushReviewAutosaves, openSavedImport])

  // ─── Mouse wheel sheet navigation over batch & multi-sheet navigator ───────
  useEffect(() => {
    const element = batchNavWheelRef.current
    if (!element) return undefined

    const handleBatchWheel = (event) => {
      const delta = event.deltaY || event.deltaX
      if (Math.abs(delta) < 15) return

      const now = Date.now()
      if (now - lastBatchWheelTimeRef.current < 160) {
        event.preventDefault()
        return
      }

      event.preventDefault()
      lastBatchWheelTimeRef.current = now

      if (delta > 0) {
        // Next sheet
        if (activeBatchEntryId && batchEntries.length > 1) {
          openAdjacentBatchEntry(1)
        } else if (parsedSheets.length > 1) {
          const currentSheet = sheetFilter === 'all' ? parsedSheets[0] : sheetFilter
          const currentIndex = parsedSheets.indexOf(currentSheet)
          if (currentIndex >= 0 && currentIndex < parsedSheets.length - 1) {
            setSheetFilter(parsedSheets[currentIndex + 1])
          }
        }
      } else if (delta < 0) {
        // Previous sheet
        if (activeBatchEntryId && batchEntries.length > 1) {
          openAdjacentBatchEntry(-1)
        } else if (parsedSheets.length > 1) {
          const currentSheet = sheetFilter === 'all' ? parsedSheets[0] : sheetFilter
          const currentIndex = parsedSheets.indexOf(currentSheet)
          if (currentIndex > 0) {
            setSheetFilter(parsedSheets[currentIndex - 1])
          }
        }
      }
    }

    element.addEventListener('wheel', handleBatchWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleBatchWheel)
  }, [activeBatchEntryId, batchEntries.length, openAdjacentBatchEntry, parsedSheets, sheetFilter])

  // ─── Forward vertical wheel scrolling on table to vertical scroll owner ───
  useEffect(() => {
    const tableEl = reviewTableScrollRef.current
    if (!tableEl) return undefined

    const handleTableWheel = (event) => {
      if (Math.abs(event.deltaY) >= Math.abs(event.deltaX) && Math.abs(event.deltaY) > 0) {
        const owner = tableEl.closest('[data-review-vertical-scroll-owner]') || document.querySelector('[data-review-vertical-scroll-owner]')
        if (owner && owner.scrollHeight > owner.clientHeight) {
          event.preventDefault()
          owner.scrollTop += event.deltaY
        }
      }
    }

    tableEl.addEventListener('wheel', handleTableWheel, { passive: false })
    return () => tableEl.removeEventListener('wheel', handleTableWheel)
  }, [])

  // ─── Match rows when members load ───────────────────────────────────────
  useEffect(() => {
    if (membersLoadedForMatching && importRows.length > 0 && importRows.some((r) => r.match?.status === 'pending')) {
      const matched = matchAllImportRows(importRows, allKnownMembers, { mode: importMode })
      setImportRows(matched)
    }
  }, [allKnownMembers, importRows, membersLoadedForMatching, importMode])

  useEffect(() => {
    if (step === STEPS.REVIEW && importRows.some((row) => row.match?.status === 'pending') && !membersLoadedForMatching && !isLoadingMembers) loadAllMembers(importRows)
  }, [importRows, isLoadingMembers, loadAllMembers, membersLoadedForMatching, step])

  useEffect(() => {
    if (!isMonthMenuOpen) return undefined

    const closeMonthMenu = (event) => {
      if (!targetMonthMenuRef.current?.contains(event.target)) setIsMonthMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeMonthMenu)
    return () => document.removeEventListener('pointerdown', closeMonthMenu)
  }, [isMonthMenuOpen])

  // ─── Row editing ────────────────────────────────────────────────────────
  const updateRowField = useCallback((rowId, field, value, { immediate = false } = {}) => {
    const nextRows = importRowsRef.current.map((row) =>
      row.importRowId === rowId
        ? {
            ...row,
            edited: { ...row.edited, [field]: value },
            // A direct spreadsheet edit is an explicit operator choice. Keep
            // the selected match, but make the final save/preview use this value.
            fieldResolution: REVIEW_PROFILE_FIELDS.has(field)
              ? { ...row.fieldResolution, [field]: 'csv' }
              : row.fieldResolution,
          }
        : row
    )
    updateCanonicalRows(nextRows, rowId, { immediate })
  }, [updateCanonicalRows])

  const markAttentionVerified = useCallback(async (rowId) => {
    const previousRows = importRowsRef.current
    const nextRows = markCsvImportAttentionVerified(previousRows, rowId)
    importRowsRef.current = nextRows
    setImportRows(nextRows)
    setBatchEntries((current) => current.map((entry) => (
      entry.sessionId === savedImportIdRef.current || entry.id === activeBatchEntryId
        ? { ...entry, rows: nextRows }
        : entry
    )))
    if (reviewSaveTimerRef.current) {
      clearTimeout(reviewSaveTimerRef.current)
      reviewSaveTimerRef.current = null
    }
    try {
      await saveReviewRowsNow(rowId)
    } catch (error) {
      importRowsRef.current = previousRows
      setImportRows(previousRows)
      setBatchEntries((current) => current.map((entry) => (
        entry.sessionId === savedImportIdRef.current || entry.id === activeBatchEntryId
          ? { ...entry, rows: previousRows }
          : entry
      )))
      toast.error(error?.message || 'Could not save verification. Please retry.')
    }
  }, [activeBatchEntryId, saveReviewRowsNow])

  const syncReviewScroll = useCallback((source) => {
    const sourceEl = source === 'top' ? reviewTopScrollRef.current : reviewTableScrollRef.current
    const targetEl = source === 'top' ? reviewTableScrollRef.current : reviewTopScrollRef.current
    if (sourceEl && targetEl && targetEl.scrollLeft !== sourceEl.scrollLeft) {
      targetEl.scrollLeft = sourceEl.scrollLeft
    }
  }, [])

  const beginColumnResize = useCallback((event, column) => {
    event.preventDefault()
    event.stopPropagation()
    const startWidth = getReviewColumnWidth(column)
    resizeStateRef.current = { key: column.key, min: getCsvImportReviewColumnMinimum(column, compactView), startX: event.clientX, startWidth }

    const onMove = (moveEvent) => {
      const state = resizeStateRef.current
      if (!state) return
      setColumnWidths((previous) => ({
        ...previous,
        [state.key]: Math.max(state.min, state.startWidth + moveEvent.clientX - state.startX),
      }))
    }
    const onEnd = () => {
      resizeStateRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd, { once: true })
  }, [compactView, getReviewColumnWidth])

  const updateRowFieldResolution = useCallback((rowId, field, source) => {
    const nextRows = importRowsRef.current.map((row) =>
      row.importRowId === rowId
        ? { ...row, fieldResolution: { ...row.fieldResolution, [field]: source } }
        : row
    )
    updateCanonicalRows(nextRows, rowId, { immediate: true })
  }, [updateCanonicalRows])

  const selectMatchForRow = useCallback((rowId, member) => {
    const nextRows = importRowsRef.current.map((row) => {
      if (row.importRowId !== rowId) return row
      return {
        ...row,
        match: {
          ...row.match,
          status: CSV_MATCH_STATUS.EXACT,
          selectedMemberId: String(member.id),
          matchedMember: member,
          candidates: [member, ...(row.match?.candidates || []).filter((c) => String(c.id) !== String(member.id))],
        },
        allowNamesOnlyCreate: false,
        fieldResolution: {
          fullName: 'datser',
          phoneNumber: 'datser',
          age: 'datser',
          gender: 'datser',
          educationalLevel: 'datser',
          parentGuardianName: 'datser',
          parentGuardianPhone: 'datser',
        },
      }
    })
    updateCanonicalRows(nextRows, rowId, { immediate: true })
    setManualSearchRowId(null)
    setManualSearchQuery('')
  }, [updateCanonicalRows])

  const setRowAsNew = useCallback((rowId) => {
    const nextRows = importRowsRef.current.map((row) => {
      if (row.importRowId !== rowId) return row
      return {
        ...row,
        match: {
          status: CSV_MATCH_STATUS.NEW,
          selectedMemberId: null,
          candidates: [],
          matchedMember: null,
        },
        newMemberConfirmed: true,
        allowNamesOnlyCreate: importMode === CSV_IMPORT_MODE.SUNDAY_NAMES,
        fieldResolution: {
          fullName: 'csv', phoneNumber: 'csv', age: 'csv',
          gender: 'csv', educationalLevel: 'csv',
          parentGuardianName: 'csv', parentGuardianPhone: 'csv',
        },
      }
    })
    updateCanonicalRows(nextRows, rowId, { immediate: true })
    setManualSearchRowId(null)
  }, [importMode, updateCanonicalRows])

  // ─── Image attachment ───────────────────────────────────────────────────
  const handleImageUpload = useCallback((event) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    const sheets = parsedSheets.length > 0 ? parsedSheets : ['Sheet 1']
    if (parsedSheets.length === 0) pendingImageAutoAssignmentRef.current = true
    // Associate images with sheets in order
    const newImages = { ...sheetImages }
    Array.from(files).forEach((file, idx) => {
      const sheet = sheets[idx] || sheets[sheets.length - 1]
      if (!newImages[sheet]) newImages[sheet] = []
      newImages[sheet].push(file)
    })
    setSheetImages(newImages)
    setImageUploadStates((current) => {
      const next = { ...current }
      Object.entries(newImages).forEach(([sheet, images]) => images.forEach((_, index) => {
        const key = `${sheet}:${index}`
        if (!next[key]) next[key] = { status: 'pending' }
      }))
      return next
    })
    toast.success(`Attached ${files.length} image${files.length !== 1 ? 's' : ''}`)
    if (imageInputRef.current) imageInputRef.current.value = ''
  }, [parsedSheets, sheetImages])

  useEffect(() => {
    if (!pendingImageAutoAssignmentRef.current || parsedSheets.length === 0) return
    pendingImageAutoAssignmentRef.current = false
    setSheetImages((current) => {
      const images = Object.values(current).flat()
      const assigned = {}
      images.forEach((image, index) => {
        const sheet = parsedSheets[index] || parsedSheets[parsedSheets.length - 1]
        assigned[sheet] = [...(assigned[sheet] || []), image]
      })
      return assigned
    })
    setImageUploadStates({})
  }, [parsedSheets])

  const moveSourceImage = useCallback((fromSheet, index, toSheet) => {
    if (!toSheet || fromSheet === toSheet) return
    setSheetImages((current) => {
      const moving = current[fromSheet]?.[index]
      if (!moving) return current
      const next = Object.fromEntries(Object.entries(current).map(([sheet, images]) => [sheet, [...images]]))
      next[fromSheet].splice(index, 1)
      if (next[fromSheet].length === 0) delete next[fromSheet]
      next[toSheet] = [...(next[toSheet] || []), moving]
      return next
    })
    setImageUploadStates({})
  }, [])

  // ─── Save execution ─────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!isOnline) {
      toast.error('CSV Import requires an active internet connection.')
      return
    }
    if (!targetTable) {
      toast.error('Please select a target month.')
      return
    }

    try {
      await flushReviewAutosaves()
    } catch (error) {
      toast.error(error?.message || 'Could not save review changes. Resolve this before saving to DatSer.')
      return
    }

    const latestRows = importRowsRef.current
    setIsSaving(true)
    setStep(STEPS.SAVING)
    setSaveProgress({ completed: 0, total: 0 })

    try {
      const completedRowIds = new Set(
        latestRows.filter((r) => r.saveStatus === 'saved').map((r) => r.importRowId)
      )

      const plan = importMode === CSV_IMPORT_MODE.SUNDAY_NAMES
        ? buildSundayNamesSavePlan({
            importRows: latestRows, targetTable, selectedSundayDate, ownerId,
            workspaceName: preferences?.workspace_name || '', completedRowIds,
          })
        : buildCsvSavePlan({
            importRows: latestRows, targetTable, sundayDateMap, ownerId,
            workspaceName: preferences?.workspace_name || '', completedRowIds,
          })

      const { results, successCount, failCount, skipCount, unresolvedCount = 0 } = await executeCsvSavePlan({
        plan,
        targetTable,
        ownerId,
        sessionId,
        supabase,
        onProgress: (completed, total, _lastResult) => {
          setSaveProgress({ completed, total })
        },
        ensureMemberCodeAssignment: null, // Will be handled by the bundle RPC
        setMemberAttendanceFromOtherMonth,
        forceRefreshMembers,
      })

      // Update row save statuses before retaining the completed import as a
      // private, reopenable workspace record.
      const resultMap = new Map(results.map((r) => [r.importRowId, r]))
      const rowsWithSaveStatus = latestRows.map((row) => {
        const result = resultMap.get(row.importRowId)
        if (!result) return row
        return {
          ...row,
          saveStatus: result.status === CSV_SAVE_STATUS.SAVED ? 'saved'
            : result.status === CSV_SAVE_STATUS.FAILED ? 'failed'
            : result.status === CSV_SAVE_STATUS.SKIPPED ? 'skipped'
            : result.status === CSV_SAVE_STATUS.UNRESOLVED ? 'unresolved'
            : row.saveStatus,
          saveError: result.error || null,
        }
      })
      const nextSaveResults = { successCount, failCount, skipCount, unresolvedCount, results }
      importRowsRef.current = rowsWithSaveStatus
      setImportRows(rowsWithSaveStatus)

      setSaveResults(nextSaveResults)
      setStep(STEPS.RESULTS)

      // History is deliberately non-blocking: a completed member/attendance
      // save remains successful even if the private record or source images
      // cannot be retained.
      await persistHistorySnapshot({ rows: rowsWithSaveStatus, results: nextSaveResults })

      if (failCount === 0) {
        toast.success(`${successCount} saved${skipCount ? `, ${skipCount} skipped` : ''}`)
      } else {
        toast.warn(`${successCount} saved, ${skipCount} skipped, ${failCount} failed`)
      }
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'))
      setStep(STEPS.PREVIEW)
    } finally {
      setIsSaving(false)
    }
  }, [
    isOnline, targetTable, sundayDateMap, ownerId,
    preferences, sessionId, setMemberAttendanceFromOtherMonth,
    forceRefreshMembers, savedImportId, user?.id, csvText, parsedSheets,
    enabledSundays, importMode, selectedSundayDate, sheetImages, persistHistorySnapshot, flushReviewAutosaves,
  ])

  const openBulkCreateConfirmation = useCallback(() => {
    if (!isOnline) {
      toast.error('Bulk creation requires an active internet connection.')
      return
    }
    if (!targetTable) {
      toast.error('Select a target month before creating members.')
      return
    }
    if (bulkCreateSummary.safeNew === 0) {
      toast.info('There are no safe new members ready to create.')
      return
    }
    setBulkCreateResult(null)
    setIsBulkCreateConfirmOpen(true)
  }, [bulkCreateSummary.safeNew, isOnline, targetTable])

  const confirmBulkCreate = useCallback(async () => {
    if (!ownerId || !user?.id || !targetTable || bulkCreateSummary.safeNew === 0) return
    setIsBulkCreateConfirmOpen(false)
    setBulkCreateProgress({ completed: 0, total: bulkCreateSummary.safeNew, created: 0, failed: 0 })
    setBulkCreateResult(null)

    try {
      // Establish the saved-import record before any member RPC. It provides a
      // durable session key for both idempotency and the provenance written per
      // successful row.
      await persistReviewRows(importRowsRef.current)
      const importHistoryId = savedImportIdRef.current
      if (!importHistoryId) throw new Error('Could not create the saved import record. Retry bulk creation.')

      const plan = buildCsvBulkCreatePlan({
        importRows: importRowsRef.current,
        ownerId,
        workspaceName: preferences?.workspace_name || '',
      })
      if (plan.length === 0) {
        setBulkCreateProgress(null)
        return
      }

      let latestRows = importRowsRef.current
      const result = await executeCsvBulkCreatePlan({
        plan,
        targetTable,
        ownerId,
        sessionId: importHistoryId,
        supabase,
        onResult: async (rowResult, progress) => {
          if (rowResult.status === 'created') {
            const batchForProvenance = batchEntries.find((entry) => entry.sessionId === importHistoryId || entry.id === activeBatchEntryId)
            const rowsWithProvenance = latestRows.map((row) => (
              row.importRowId === rowResult.importRowId
                ? applyCsvBulkCreateResult({
                    row,
                    result: rowResult,
                    sessionId: importHistoryId,
                    batchId: batchForProvenance?.batchId || batchId,
                  })
                : row
            ))
            // Do not move to the next request until the created UUID and its
            // source sheet/row are durable in the existing session history.
            await persistReviewRows(rowsWithProvenance)
            latestRows = rowsWithProvenance
            importRowsRef.current = rowsWithProvenance
            setImportRows(rowsWithProvenance)
            rememberCsvImportMemberProvenance({ ownerId, sessionId: importHistoryId, rows: rowsWithProvenance })
          }
          setBulkCreateProgress({
            completed: progress.completed,
            total: progress.total,
            created: progress.createdCount,
            failed: progress.failCount,
          })
        },
      })

      if (result.createdCount > 0) {
        await forceRefreshMembers?.()
        await loadAllMembers(latestRows)
      }
      setBulkCreateResult(result)
      if (result.failCount) toast.warn(`${result.createdCount} members created, ${result.failCount} failed. Retry will only process rows not yet created.`)
      else toast.success(`${result.createdCount} new members created. Attendance was not changed.`)
    } catch (error) {
      toast.error(error?.message || 'Bulk creation paused. Retry to continue safely.')
    } finally {
      setBulkCreateProgress(null)
    }
  }, [activeBatchEntryId, batchEntries, batchId, bulkCreateSummary.safeNew, forceRefreshMembers, loadAllMembers, ownerId, persistReviewRows, preferences?.workspace_name, targetTable, user?.id])

  // ─── Retry failed ──────────────────────────────────────────────────────
  const handleRetryFailed = useCallback(() => {
    // Reset failed rows back to pending
    setImportRows((prev) => prev.map((row) =>
      row.saveStatus === 'failed'
        ? { ...row, saveStatus: 'pending', saveError: null }
        : row
    ))
    setStep(STEPS.PREVIEW)
  }, [])

  // ─── Preview summary ───────────────────────────────────────────────────
  const previewSummary = useMemo(() => {
    if (step !== STEPS.PREVIEW && step !== STEPS.SAVING && step !== STEPS.RESULTS) return null
    if (importMode === CSV_IMPORT_MODE.SUNDAY_NAMES) {
      const plan = buildSundayNamesSavePlan({ importRows, targetTable, selectedSundayDate, ownerId, workspaceName: preferences?.workspace_name || '' })
      const attentionCount = getCsvImportUnresolvedAttentionCount(importRows)
      return {
        totalRows: importRows.length,
        sheetCount: new Set(importRows.map((row) => row.sheet)).size,
        readyCount: plan.filter((item) => ['create', 'update', 'cross_month'].includes(item.action)).length,
        alreadyPresentCount: plan.filter((item) => item.reason === 'Already Present').length,
        duplicateCount: plan.filter((item) => item.reason?.startsWith('Duplicate')).length,
        unresolvedCount: plan.filter((item) => item.action === 'unresolved' && !isCsvImportAttentionUnresolved(item.row)).length,
        attentionCount,
        actionableCount: plan.filter((item) => ['create', 'update', 'cross_month'].includes(item.action)).length,
        selectedSundayDate,
      }
    }
    return buildCsvPreviewSummary({ importRows, sundayDateMap, targetTable })
  }, [importRows, sundayDateMap, targetTable, selectedSundayDate, importMode, ownerId, preferences?.workspace_name, step])

  // ─── Manual DatSer search results ──────────────────────────────────────
  const manualSearchResults = useMemo(() => {
    if (!manualSearchQuery.trim() || !manualSearchRowId) return null
    return searchDatSerMembers(manualSearchQuery, allKnownMembers)
  }, [manualSearchQuery, manualSearchRowId, allKnownMembers])

  const csvImportMemberProvenance = useMemo(
    () => deriveCsvImportMemberProvenance(importRows, savedImportIdRef.current),
    [importRows, savedImportId]
  )

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  // ─── Step indicator ─────────────────────────────────────────────────────
  const renderStepIndicator = () => {
    const stepKeys = importMode === CSV_IMPORT_MODE.SUNDAY_NAMES
      ? [STEPS.IMPORT, STEPS.MONTH, STEPS.REVIEW, STEPS.PREVIEW, STEPS.RESULTS]
      : [STEPS.IMPORT, STEPS.REVIEW, STEPS.MONTH, STEPS.PREVIEW, STEPS.RESULTS]
    const currentIdx = stepKeys.indexOf(step === STEPS.SAVING ? STEPS.PREVIEW : step)

    return (
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {stepKeys.map((s, idx) => {
          const isActive = s === step || (step === STEPS.SAVING && s === STEPS.PREVIEW)
          const isCompleted = idx < currentIdx
          return (
            <React.Fragment key={s}>
              {idx > 0 && <div className={`h-px flex-1 min-w-3 ${isCompleted ? 'bg-emerald-400' : 'bg-gray-200 dark:bg-gray-700'}`} />}
              <button
                type="button"
                disabled={idx > currentIdx || step === STEPS.SAVING}
                onClick={() => { if (idx <= currentIdx && step !== STEPS.SAVING) setStep(s) }}
                className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  isActive ? 'bg-emerald-600 text-white' :
                  isCompleted ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' :
                  'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {isCompleted && <Check className="h-3 w-3" />}
                {STEP_LABELS[s]}
              </button>
            </React.Fragment>
          )
        })}
      </div>
    )
  }

  // ─── STEP 1: Import ─────────────────────────────────────────────────────
  const renderImportStep = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Import CSV Data</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Upload a batch of CSVs and matching source images, or use the single-import tools below.
        </p>
      </div>

      <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50/55 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-black text-gray-900 dark:text-white">Multi-file batch</p><p className="text-xs text-gray-500 dark:text-gray-400">Select as many files as needed. Exact basenames pair automatically.</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => batchCsvInputRef.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white hover:bg-emerald-700"><FileSpreadsheet className="h-4 w-4"/>Upload CSV files</button>
            <button type="button" onClick={() => batchImageInputRef.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 text-sm font-black text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-[#111a16] dark:text-emerald-300"><ImageIcon className="h-4 w-4"/>Upload source images</button>
            <input ref={batchCsvInputRef} type="file" accept=".csv,text/csv" multiple onChange={handleBatchCsvUpload} className="hidden" />
            <input ref={batchImageInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={handleBatchImageUpload} className="hidden" />
          </div>
        </div>
      </div>

      <CsvImportBatchWorkspace batchName={batchName} onBatchNameChange={setBatchName} onBatchNameCommit={persistBatchName} entries={batchEntries} progress={batchProgress} onReview={reviewBatchEntry} onRetry={retryBatchEntry} onRemove={removeBatchEntry} onAssignImage={assignBatchImage} onReviewIssues={reviewBatchIssues} onPreviewBatch={() => setIsBatchPreviewOpen(true)} onOpenRepairModal={() => setIsBatchRepairOpen(true)} batchSaveSummary={batchSaveSummary} batchSaveProgress={batchSaveProgress} isSavingAllReady={isSavingBatchReady} />

      <div className="grid gap-2 rounded-2xl bg-emerald-50/70 p-1.5 sm:grid-cols-2 dark:bg-emerald-950/25" aria-label="CSV import workflow">
        {[
          { value: CSV_IMPORT_MODE.FULL_REGISTER, title: 'Full Register', body: 'Members, profile details, and Sunday columns' },
          { value: CSV_IMPORT_MODE.SUNDAY_NAMES, title: 'Sunday Names List', body: 'Names only, matched to one selected Sunday' },
        ].map((option) => (
          <button key={option.value} type="button" onClick={() => { setImportMode(option.value); setModeWasChosen(true); setParseErrors([]) }} className={`rounded-xl px-4 py-3 text-left transition ${importMode === option.value ? 'bg-emerald-600 text-white shadow-md' : 'bg-white text-gray-700 hover:bg-emerald-100 dark:bg-[#18231f] dark:text-gray-200 dark:hover:bg-emerald-950/60'}`}>
            <span className="block text-sm font-black">{option.title}</span>
            <span className={`mt-0.5 block text-xs ${importMode === option.value ? 'text-emerald-50' : 'text-gray-500 dark:text-gray-400'}`}>{option.body}</span>
          </button>
        ))}
      </div>

      {/* Upload button */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 transition-colors shadow-sm"
        >
          <Upload className="h-4 w-4" />
          Upload .csv file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileUpload}
          className="hidden"
        />

        {/* Image attachment */}
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <ImageIcon className="h-4 w-4" />
          Attach source images
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageUpload}
          className="hidden"
        />
      </div>

      {/* Attached images summary */}
      {Object.keys(sheetImages).length > 0 && (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/45 p-3 dark:border-emerald-900/70 dark:bg-emerald-950/20">
          <p className="mb-2 text-xs font-black text-gray-700 dark:text-gray-200">Source-image assignment</p>
          <div className="space-y-2">
            {Object.entries(sheetImages).flatMap(([sheet, files]) => files.map((file, index) => {
              const status = imageUploadStates[`${sheet}:${index}`]?.status || (file.path ? 'saved' : 'pending')
              return <div key={file.path || `${sheet}-${file.name}-${file.lastModified || index}`} className="flex flex-wrap items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs dark:bg-[#111a16]">
                <ImageIcon className="h-4 w-4 text-emerald-500" />
                <span className="min-w-0 flex-1 truncate font-bold text-gray-800 dark:text-gray-100">{file.name || `Source ${index + 1}`}</span>
                <span className={`rounded-full px-2 py-1 text-[10px] font-black ${status === 'saved' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/45 dark:text-emerald-300' : status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}`}>{status}</span>
                {parsedSheets.length > 1 ? <select value={sheet} onChange={(event) => moveSourceImage(sheet, index, event.target.value)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-200" aria-label={`Sheet for ${file.name || `source ${index + 1}`}`}>{parsedSheets.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <span className="font-bold text-gray-500">{sheet}</span>}
              </div>
            }))}
          </div>
        </div>
      )}

      {/* Paste area */}
      <div>
        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
          Or paste CSV text below
        </label>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? 'Ama Serwaa\nKojo Mensah\nAbena Owusu' : 'sheet,full_name,phone_number,age,gender,educational_level,sunday_1,sunday_2,sunday_3,sunday_4,sunday_5\n1,Kwame Mensah,0244123456,14,Male,JHS2,P,P,A,P,P'}
          rows={12}
          className="w-full rounded-xl border border-gray-300 bg-white p-4 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
        />
      </div>

      <button
        type="button"
        onClick={() => handleParse(csvText)}
        disabled={!csvText.trim() || isParsing}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
      >
        {isParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        {isParsing ? 'Parsing…' : importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? 'Continue to Sunday' : 'Parse CSV'}
      </button>

      {/* Parse errors */}
      {parseErrors.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-bold text-red-700 dark:text-red-300">Parse errors:</p>
          <ul className="mt-2 list-disc list-inside text-sm text-red-600 dark:text-red-400">
            {parseErrors.map((err, idx) => (
              <li key={idx}>{err.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Format reference */}
      <details className="rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
        <summary className="cursor-pointer p-4 text-sm font-bold text-gray-700 dark:text-gray-300">
          CSV format reference
        </summary>
        <div className="border-t border-gray-200 p-4 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400 space-y-2">
          <p><strong>Required:</strong> {importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? 'one name per line, or a full_name column' : 'full_name'}</p>
          <p><strong>Optional columns:</strong> sheet, row_number, phone_number, age, gender, educational_level, parent_guardian_name, parent_guardian_phone, member_code, notes</p>
          {importMode === CSV_IMPORT_MODE.FULL_REGISTER && <p><strong>Attendance:</strong> sunday_1 through sunday_5</p>}
          {importMode === CSV_IMPORT_MODE.FULL_REGISTER && <p><strong>Attendance values:</strong> P/Present/1 = Present, A/Absent/0 = Absent, blank = no change</p>}
          <p><strong>Sheet:</strong> Numeric values (1, 2, 3) displayed as Sheet 1, Sheet 2, Sheet 3</p>
        </div>
      </details>
    </div>
  )

  // ─── Status badge ───────────────────────────────────────────────────────
  const StatusBadge = ({ status, small = false }) => {
    const config = {
      exact: { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300', label: 'Exact' },
      possible: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300', label: 'Possible' },
      new: { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300', label: 'New' },
      invalid: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300', label: 'Invalid' },
      pending: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', label: 'Pending' },
      saved: { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300', label: 'Saved' },
      failed: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300', label: 'Failed' },
      unmatched: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300', label: 'Not found' },
      unresolved: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300', label: 'Needs choice' },
    }
    const effectiveStatus = status === 'saved' || status === 'failed' ? status : status
    const c = config[effectiveStatus] || config.pending
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 ${small ? 'text-[10px]' : 'text-xs'} font-bold ${c.bg} ${c.text}`}>
        {c.label}
      </span>
    )
  }

  const renderBulkCreateReadiness = () => (
    <>
      <section className={`rounded-xl border border-emerald-200 bg-emerald-50/70 px-2.5 py-2 shadow-sm dark:border-emerald-900/70 dark:bg-emerald-950/20 ${isComparingSource ? 'mt-1' : 'mt-2'}`} aria-label="Bulk member creation readiness">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-xs font-black text-emerald-800 dark:text-emerald-200">Bulk new members <span className="font-medium text-emerald-700/80 dark:text-emerald-300/80">· no attendance is marked automatically</span></p>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <button type="button" onClick={openBulkCreateConfirmation} disabled={!bulkCreateSummary.safeNew || !!bulkCreateProgress} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
              {bulkCreateProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
              {bulkCreateProgress ? `Creating ${bulkCreateProgress.completed} of ${bulkCreateProgress.total}` : `Create ${bulkCreateSummary.safeNew} safe new ${bulkCreateSummary.safeNew === 1 ? 'member' : 'members'}`}
            </button>
            {bulkCreateSummary.possible > 0 && <button type="button" onClick={() => setFilter('possible')} className="min-h-10 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-300">Review {bulkCreateSummary.possible} possible</button>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1 text-[10px] font-bold">
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">{bulkCreateSummary.safeNew} safe new</span>
          <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700 dark:bg-gray-800 dark:text-gray-200">{bulkCreateSummary.exact} exact existing</span>
          {bulkCreateSummary.possible > 0 && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800 dark:bg-amber-900/45 dark:text-amber-200">{bulkCreateSummary.possible} possible</span>}
          {bulkCreateSummary.attention > 0 && <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-800 dark:bg-rose-900/45 dark:text-rose-200">{bulkCreateSummary.attention} need attention</span>}
          {bulkCreateSummary.invalid > 0 && <span className="rounded-full bg-red-100 px-2 py-1 text-red-800 dark:bg-red-900/45 dark:text-red-200">{bulkCreateSummary.invalid} invalid</span>}
          {bulkCreateSummary.completed > 0 && <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{bulkCreateSummary.completed} completed</span>}
        </div>
        {bulkCreateResult && <p className={`mt-1 text-xs font-bold ${bulkCreateResult.failCount ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{bulkCreateResult.createdCount} new {bulkCreateResult.createdCount === 1 ? 'member' : 'members'} created{bulkCreateResult.failCount ? ` · ${bulkCreateResult.failCount} failed and remain retryable` : ' · search for the green “New from import” badge before manually marking attendance'}</p>}
      </section>

      {isBulkCreateConfirmOpen && (
        <div className="fixed inset-0 z-[180] flex items-end bg-black/45 p-3 backdrop-blur-sm sm:items-center sm:justify-center" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="bulk-create-title" className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-5 shadow-2xl dark:border-emerald-900 dark:bg-[#151a17]">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-600">CSV Import</p>
            <h4 id="bulk-create-title" className="mt-1 text-lg font-black text-gray-900 dark:text-white">Create {bulkCreateSummary.safeNew} new {bulkCreateSummary.safeNew === 1 ? 'member' : 'members'}?</h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Only safe unmatched New rows will be created. No attendance will be marked.</p>
            <ul className="mt-3 space-y-1 text-xs text-gray-600 dark:text-gray-300">
              <li><strong className="text-emerald-700 dark:text-emerald-300">{bulkCreateSummary.safeNew}</strong> safe new members will be created.</li>
              <li><strong>{bulkCreateSummary.exact}</strong> exact matches keep their existing members.</li>
              <li><strong>{bulkCreateSummary.possible}</strong> possible matches still need review.</li>
              <li><strong>{bulkCreateSummary.attention + bulkCreateSummary.invalid}</strong> attention or invalid rows are excluded.</li>
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setIsBulkCreateConfirmOpen(false)} className="min-h-10 rounded-xl border border-gray-300 px-3.5 text-sm font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">Cancel</button>
              <button type="button" onClick={confirmBulkCreate} className="min-h-10 rounded-xl bg-emerald-600 px-3.5 text-sm font-black text-white hover:bg-emerald-700">Create {bulkCreateSummary.safeNew} members</button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  // ─── STEP 2: Review table ──────────────────────────────────────────────
  const renderFullRegisterReviewStep = () => {
    const showsSheetColumn = reviewColumns.some((column) => column.key === 'sheet')
    const showsGuardianColumns = reviewColumns.some((column) => column.key === 'parentGuardianName')
    return (
      <div className={isComparingSource ? 'space-y-2' : 'space-y-3.5'} data-review-scroll-region>
        <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between ${isComparingSource ? 'gap-2' : 'gap-3'}`}>
          <div className="min-w-0">
            <h3 className={`font-black text-gray-900 dark:text-white ${isComparingSource ? 'text-base' : 'text-lg'}`}>Review Import Data</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {importRows.length} rows from {parsedSheets.length} sheet{parsedSheets.length !== 1 ? 's' : ''}
              {isLoadingMembers && ' · Matching members…'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!isComparingSource && Object.values(sheetImages).some((images) => images.length > 0) && (
              <button
                type="button"
                onClick={() => setIsComparingSource(true)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-1.5 text-xs font-black text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-300"
              >
                <ImageIcon className="h-4 w-4"/>
                Compare source
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const rematched = matchAllImportRows(importRows, allKnownMembers, { mode: importMode })
                setImportRows(rematched)
                toast.success('Re-matched all rows')
              }}
              disabled={isLoadingMembers}
              className={`inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 ${
                isComparingSource ? 'min-h-[36px] px-2.5 py-1 text-xs' : 'min-h-[42px] px-3.5 py-2 text-sm'
              }`}
            >
              <RefreshCw className={`h-3 w-3 ${isLoadingMembers ? 'animate-spin' : ''}`} />
              Re-match
            </button>
            <button
              type="button"
              onClick={() => navigateAfterReviewSave(STEPS.MONTH)}
              className={`inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 font-bold text-white shadow-sm hover:bg-emerald-700 ${
                isComparingSource ? 'min-h-[36px] px-3.5 py-1 text-xs' : 'min-h-[42px] px-4 py-2 text-sm'
              }`}
            >
              Next: Month
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {renderBulkCreateReadiness()}

        {/* Status cards / Sleek horizontal pill strip in side mode */}
        {isComparingSource ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin] text-xs select-none" role="tablist" aria-label="Status filter pills">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFilter(opt.key)}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition-all ${
                  filter === opt.key
                    ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500/20'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-200/60 dark:border-gray-700/60'
                }`}
              >
                <span>{opt.label}</span>
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                  filter === opt.key ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                }`}>
                  {statusCounts[opt.key] || 0}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setFilter(opt.key)}
                className={`rounded-xl p-2 text-center transition-colors ${
                  filter === opt.key
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700'
                }`}
              >
                <span className="block text-lg font-black">{statusCounts[opt.key] || 0}</span>
                <span className="block text-[10px] font-bold">{opt.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Review workspace */}
        <div
          className={`rounded-[1.4rem] bg-white/95 shadow-lg shadow-gray-950/5 dark:bg-[#171a19] dark:shadow-black/25 ${
            isComparingSource
              ? 'overflow-visible space-y-1.5 p-2'
              : 'space-y-2.5 overflow-hidden p-3 md:max-h-[min(62dvh,760px)] md:overflow-y-auto md:overscroll-contain'
          }`}
          data-review-vertical-scroll-owner={isComparingSource ? undefined : ''}
        >
          {/* Integrated single-row compact toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {parsedSheets.length > 1 && (
              <select
                value={sheetFilter}
                onChange={(e) => setSheetFilter(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-semibold dark:border-gray-600 dark:bg-gray-800 dark:text-white shrink-0"
              >
                <option value="all">All Sheets</option>
                {parsedSheets.map((sheet) => (
                  <option key={sheet} value={sheet}>{sheet} ({sheetCounts[sheet] || 0})</option>
                ))}
              </select>
            )}
            <div className="relative min-w-[140px] flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, phone, code…"
                className="w-full rounded-lg border border-gray-300 bg-white py-1 pl-8 pr-3 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
              />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <div className="inline-flex rounded-lg bg-gray-200/70 p-0.5 dark:bg-gray-900" aria-label="Review table density">
                <button
                  type="button"
                  onClick={() => setCompactView(false)}
                  aria-pressed={!compactView}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                    !compactView
                      ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-white'
                      : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                  }`}
                >
                  Comfortable
                </button>
                <button
                  type="button"
                  onClick={() => setCompactView(true)}
                  aria-pressed={compactView}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                    compactView
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                  }`}
                >
                  Compact
                </button>
              </div>
              <button
                type="button"
                onClick={() => setColumnWidths({})}
                disabled={Object.keys(columnWidths).length === 0}
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-45 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Review table */}
          <div className="relative rounded-xl bg-gray-50/90 shadow-inner shadow-gray-950/5 dark:bg-black/20 dark:shadow-black/30">
            <div
              ref={reviewTopScrollRef}
              onScroll={() => syncReviewScroll('top')}
              className={`sticky z-30 overflow-x-auto overflow-y-hidden border-b border-gray-200 bg-gray-50 px-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-800 ${isComparingSource ? 'top-[52px]' : 'top-0'}`}
              aria-label="Horizontal table scroll"
              data-review-horizontal-scroll
            >
              <div className="h-2.5" style={{ width: `${reviewTableWidth}px` }} />
            </div>
            <div
              ref={reviewTableScrollRef}
              onScroll={() => syncReviewScroll('table')}
              className="overflow-x-auto overflow-y-visible"
              data-review-horizontal-scroll
            >
              <table className={`${compactView ? 'text-xs' : 'text-sm'}`} style={{ width: `${reviewTableWidth}px`, minWidth: `${reviewTableWidth}px` }}>
                <colgroup>
                  {reviewColumns.map((column) => (
                    <col key={column.key} style={{ width: `${getReviewColumnWidth(column)}px` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/80 text-left">
                    {reviewColumns.map((column) => (
                      <th
                        key={column.key}
                        className={`relative select-none whitespace-nowrap px-2 font-bold text-gray-600 dark:text-gray-400 text-xs ${compactView ? 'py-1.5' : 'py-2'} ${column.key.startsWith('sunday') ? 'text-center' : 'text-left'} ${compactView && column.key === 'actions' ? 'sticky right-0 z-30 bg-gray-50 shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.45)] dark:bg-gray-800/95' : ''}`}
                      >
                        {column.label}
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${column.label} column`}
                          onPointerDown={(event) => beginColumnResize(event, column)}
                          className="group absolute -right-1 top-0 z-20 flex h-full w-3 cursor-col-resize touch-none items-center justify-center rounded-sm hover:bg-emerald-100/80 dark:hover:bg-emerald-950/60"
                        >
                          <span className="h-4 w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-emerald-500" />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={reviewColumns.length} className="px-6 py-12 text-center text-gray-400">
                        <Users className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
                        <p className="font-semibold">No members match this filter</p>
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row) => (
                      <React.Fragment key={row.importRowId}>
                        <tr
                          onClick={() => setExpandedRowId(expandedRowId === row.importRowId ? null : row.importRowId)}
                          className={`cursor-pointer transition-colors border-l-4 ${
                            isCsvImportAttentionUnresolved(row)
                              ? 'border-l-rose-500 bg-gradient-to-r from-rose-50/90 via-red-50/40 to-white hover:from-rose-100/85 hover:via-red-50/55 dark:from-rose-950/30 dark:via-red-950/15 dark:to-gray-900 dark:hover:from-rose-950/45'
                              : expandedRowId === row.importRowId
                              ? 'border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30'
                              : 'border-l-transparent hover:bg-gray-50/80 dark:hover:bg-gray-800/40'
                          }`}
                        >
                          <td className={`sticky left-0 z-10 font-mono text-xs text-gray-500 shadow-[inset_-1px_0_0_rgba(244,63,94,0.10)] dark:text-gray-400 ${isCsvImportAttentionUnresolved(row) ? 'bg-rose-50 dark:bg-[#241719]' : 'bg-white dark:bg-gray-900'} ${compactView ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
                            {row.rowNumber}
                          </td>
                          {showsSheetColumn && <td className={`whitespace-nowrap text-xs text-gray-500 dark:text-gray-400 ${compactView ? 'px-1 py-1' : 'px-3 py-2'}`} title={row.sheet}>{row.sheet}</td>}
                          <td className={compactView ? 'px-1 py-1' : 'px-2 py-1.5'}><InlineTextCell value={row.edited.fullName} onCommit={(value) => updateRowField(row.importRowId, 'fullName', value)} compact={compactView} /></td>
                          <td className={`whitespace-nowrap text-gray-700 dark:text-gray-300 ${compactView ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
                            {row.match?.matchedMember ? (
                              <span className="flex min-w-0 items-center gap-1" title={formatMemberName(row.match.matchedMember['Full Name']) || 'Matched'}>
                                <User className="h-3 w-3 text-emerald-500 shrink-0" />
                                <span className="truncate">{formatMemberName(row.match.matchedMember['Full Name']) || 'Matched'}</span>
                              </span>
                            ) : row.match?.status === CSV_MATCH_STATUS.POSSIBLE ? (
                              <span className="text-amber-600 dark:text-amber-400">{row.match.candidates?.length || 0} candidates</span>
                            ) : row.match?.status === CSV_MATCH_STATUS.NEW ? (
                              <span className="text-emerald-600 dark:text-emerald-400">New member</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className={compactView ? 'px-2 py-1.5' : 'px-3 py-2'}>
                            <div className={`flex items-start gap-1 ${compactView ? 'min-w-0 flex-row flex-wrap' : 'min-w-[104px] flex-col'}`}>
                              <StatusBadge status={row.saveStatus !== 'pending' ? row.saveStatus : row.match?.status} small />
                              {isCsvImportAttentionUnresolved(row) && <AttentionBadge name={row.edited.fullName || `row ${row.rowNumber}`} onClick={(event) => { event.stopPropagation(); setExpandedRowId(row.importRowId) }} />}
                            {!isCsvImportAttentionUnresolved(row) && getCsvImportNote(row) && <span className={`${compactView ? '' : 'mt-1'} inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-300`}><ShieldCheck className="h-3 w-3"/>Verified</span>}
                            </div>
                          </td>
                          <td className={compactView ? 'px-1 py-1' : 'px-2 py-1.5'}><InlineTextCell value={row.edited.phoneNumber} onCommit={(value) => updateRowField(row.importRowId, 'phoneNumber', value)} compact={compactView} /></td>
                          <td className={compactView ? 'px-1 py-1' : 'px-2 py-1.5'}><InlineTextCell value={row.edited.age} onCommit={(value) => updateRowField(row.importRowId, 'age', value)} compact={compactView} inputMode="numeric" /></td>
                          <td className={compactView ? 'px-1 py-1' : 'px-2 py-1.5'}><InlineGenderCell value={row.edited.gender} onCommit={(value) => updateRowField(row.importRowId, 'gender', value, { immediate: true })} compact={compactView} /></td>
                          <td className={compactView ? 'px-1 py-1' : 'px-2 py-1.5'}><InlineTextCell value={row.edited.educationalLevel} onCommit={(value) => updateRowField(row.importRowId, 'educationalLevel', value)} compact={compactView} /></td>
                          {showsGuardianColumns && <><td className={compactView ? 'px-1 py-1' : 'px-2 py-1.5'}><InlineTextCell value={row.edited.parentGuardianName} onCommit={(value) => updateRowField(row.importRowId, 'parentGuardianName', value)} compact={compactView} /></td><td className={compactView ? 'px-1 py-1' : 'px-2 py-1.5'}><InlineTextCell value={row.edited.parentGuardianPhone} onCommit={(value) => updateRowField(row.importRowId, 'parentGuardianPhone', value)} compact={compactView} /></td></>}
                          {[1, 2, 3, 4, 5].map((n) => (
                            <td key={n} className={`text-center ${compactView ? 'px-1 py-1' : 'px-2 py-2'}`}>
                              <InlineAttendanceCell value={row.edited[`sunday_${n}`]} onCommit={(value) => updateRowField(row.importRowId, `sunday_${n}`, value, { immediate: true })} />
                            </td>
                          ))}
                          <td className={`${compactView ? 'sticky right-0 z-10 bg-white px-1 py-1 shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.45)] dark:bg-gray-900' : 'px-3 py-2'} ${isCsvImportAttentionUnresolved(row) && compactView ? 'bg-rose-50 dark:bg-[#241719]' : ''}`}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setManualSearchRowId(row.importRowId)
                                setManualSearchQuery('')
                              }}
                              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-bold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                            >
                              <Search className="h-3 w-3 inline" /> Match
                            </button>
                          </td>
                        </tr>

                        {/* Expanded row detail */}
                        {expandedRowId === row.importRowId && (
                          <tr>
                            <td colSpan={reviewColumns.length} className="bg-gray-50/50 dark:bg-gray-800/30 px-3 py-3">
                              <div className="sticky left-0 w-full max-w-[min(100%,calc(100vw-340px))] lg:max-w-full">
                                <RowDetail
                                  row={row}
                                  formatMemberName={formatMemberName}
                                  allKnownMembers={allKnownMembers}
                                  onUpdateField={updateRowField}
                                  onUpdateFieldResolution={updateRowFieldResolution}
                                  onSelectMatch={selectMatchForRow}
                                  onSetAsNew={setRowAsNew}
                                  sheetImages={sheetImages}
                                  onViewImage={setViewingImage}
                                  onMarkAttentionVerified={markAttentionVerified}
                                  reviewSaveState={reviewSaveState[row.importRowId]}
                                  onRetryReviewSave={() => saveReviewRowsNow(row.importRowId).catch((error) => toast.error(error?.message || 'Could not save review changes.'))}
                                  isComparingSource={isComparingSource}
                                />
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Manual search modal inline */}
                        {manualSearchRowId === row.importRowId && (
                          <tr>
                            <td colSpan={reviewColumns.length} className="bg-emerald-50/50 dark:bg-emerald-900/10 px-3 py-3">
                              <ManualSearchPanel
                                row={row}
                                formatMemberName={formatMemberName}
                                query={manualSearchQuery}
                                onQueryChange={setManualSearchQuery}
                                results={manualSearchResults}
                                provenanceByMemberId={csvImportMemberProvenance}
                                onSelect={(member) => selectMatchForRow(row.importRowId, member)}
                                onCreateNew={() => setRowAsNew(row.importRowId)}
                                onClose={() => setManualSearchRowId(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const namesFilterOptions = [
    { key: 'all', label: 'All' }, { key: 'exact', label: 'Exact' }, { key: 'possible', label: 'Possible' },
    { key: 'unmatched', label: 'Unmatched' }, { key: 'ready', label: 'Ready' }, { key: 'attention', label: 'Needs Attention' }, { key: 'saved', label: 'Saved' },
    { key: 'skipped', label: 'Skipped' }, { key: 'failed', label: 'Failed' },
  ]

  const renderNamesReviewStep = () => (
    <div className={isComparingSource ? 'space-y-2' : 'space-y-3.5'}>
      <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between ${isComparingSource ? 'gap-2' : 'gap-3'}`}>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-600">Sunday attendance</p>
          <h3 className={`font-black text-gray-900 dark:text-white ${isComparingSource ? 'text-base' : 'text-lg'}`}>Match names before saving</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{targetTable.replace('_', ' ')} · {selectedSundayDate} · no profile fields will be changed</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!isComparingSource && Object.values(sheetImages).some((images) => images.length > 0) && (
            <button
              type="button"
              onClick={() => setIsComparingSource(true)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-1.5 text-xs font-black text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-300"
            >
              Compare source
            </button>
          )}
          <button
            type="button"
            onClick={() => navigateAfterReviewSave(STEPS.MONTH)}
            className={`rounded-xl border border-gray-300 font-bold dark:border-gray-700 ${
              isComparingSource ? 'min-h-[36px] px-3 py-1 text-xs' : 'min-h-[42px] px-4 text-sm'
            }`}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => navigateAfterReviewSave(STEPS.PREVIEW)}
            className={`rounded-xl bg-emerald-600 font-black text-white hover:bg-emerald-700 ${
              isComparingSource ? 'min-h-[36px] px-3.5 py-1 text-xs' : 'min-h-[42px] px-5 text-sm'
            }`}
          >
            Preview ready rows
          </button>
        </div>
      </div>

      {renderBulkCreateReadiness()}

      {isComparingSource ? (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin] text-xs select-none" role="tablist" aria-label="Status filter pills">
          {namesFilterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition-all ${
                filter === option.key
                  ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500/20'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-200/60 dark:border-gray-700/60'
              }`}
            >
              <span>{option.label}</span>
              <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                filter === option.key ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
              }`}>
                {statusCounts[option.key] || 0}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {namesFilterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={`rounded-xl px-2 py-2 text-center ${
                filter === option.key ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              <span className="block text-lg font-black">{statusCounts[option.key] || 0}</span>
              <span className="text-[10px] font-bold">{option.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className={`rounded-[1.4rem] bg-white/95 shadow-lg dark:bg-[#171a19] ${isComparingSource ? 'p-2' : 'p-3'}`}>
        <div className="relative mb-2.5">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"/>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search source name, matched name, or member code…"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-xs dark:border-gray-700 dark:bg-black/20 dark:text-white"
          />
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-800">
              <tr>
                <th className="px-2.5 py-1.5">#</th>
                <th className="px-2.5 py-1.5">Sheet</th>
                <th className="px-2.5 py-1.5">Name from list</th>
                <th className="px-2.5 py-1.5">DatSer match</th>
                <th className="px-2.5 py-1.5">Status</th>
                <th className="px-2.5 py-1.5">Attendance</th>
                <th className="px-2.5 py-1.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {visibleRows.map((row) => {
                const matched = row.match?.matchedMember
                const status = row.saveStatus !== 'pending' ? row.saveStatus : row.duplicateOfRowId ? 'skipped' : row.match?.status
                return (
                  <React.Fragment key={row.importRowId}>
                    <tr onClick={() => setExpandedRowId(expandedRowId === row.importRowId ? null : row.importRowId)} className={`cursor-pointer border-l-4 ${isCsvImportAttentionUnresolved(row) ? 'border-l-rose-500 bg-gradient-to-r from-rose-50/90 via-red-50/40 to-white hover:from-rose-100/85 hover:via-red-50/55 dark:from-rose-950/30 dark:via-red-950/15 dark:to-gray-900 dark:hover:from-rose-950/45' : 'border-l-transparent hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20'}`}>
                      <td className="px-2.5 py-1.5 text-xs text-gray-500">{row.rowNumber}</td>
                      <td className="px-2.5 py-1.5 text-xs text-gray-500">{row.sheet}</td>
                      <td className="px-2.5 py-1.5"><span className="font-bold text-gray-900 dark:text-white">{row.rawFullName || row.edited.fullName}</span>{row.rawFullName && row.rawFullName !== row.edited.fullName && <span className="block text-[10px] text-gray-400">Display: {row.edited.fullName}</span>}</td>
                      <td className="px-2.5 py-1.5">{matched ? <span><span className="font-bold text-gray-800 dark:text-gray-100">{formatMemberName(matched['Full Name'])}</span><span className="block text-[10px] text-gray-400">{matched.member_code || matched.__source_table || 'Current register'}</span></span> : row.match?.candidates?.length ? <span className="text-amber-600">{row.match.candidates.length} possible matches</span> : <span className="text-gray-400">No member found</span>}</td>
                      <td className="px-2.5 py-1.5"><div className="flex min-w-[104px] flex-wrap items-center gap-1"><StatusBadge status={status} small/>{row.duplicateOfRowId && <span className="text-[10px] text-gray-400">Duplicate source row</span>}{isCsvImportAttentionUnresolved(row) && <AttentionBadge name={row.edited.fullName || `row ${row.rowNumber}`} onClick={(event) => { event.stopPropagation(); setExpandedRowId(row.importRowId) }} />}</div></td>
                      <td className="px-2.5 py-1.5"><span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Present</span></td>
                      <td className="px-2.5 py-1.5"><button type="button" onClick={(event) => { event.stopPropagation(); setManualSearchRowId(row.importRowId); setManualSearchQuery(row.edited.fullName) }} className="rounded-lg border border-emerald-200 px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300">{matched ? 'Change' : 'Match'}</button></td>
                    </tr>
                    {expandedRowId === row.importRowId && getCsvImportNote(row) && <tr><td colSpan="7" className="bg-red-50/80 p-3 dark:bg-red-950/25"><TranscriptionNote row={row} onMarkVerified={markAttentionVerified}/></td></tr>}
                    {manualSearchRowId === row.importRowId && <tr><td colSpan="7" className="bg-emerald-50/50 p-3 dark:bg-emerald-950/20"><ManualSearchPanel row={row} formatMemberName={formatMemberName} query={manualSearchQuery} onQueryChange={setManualSearchQuery} results={manualSearchResults} provenanceByMemberId={csvImportMemberProvenance} onSelect={(member) => selectMatchForRow(row.importRowId, member)} onCreateNew={() => setRowAsNew(row.importRowId)} onClose={() => setManualSearchRowId(null)}/></td></tr>}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )

  const renderBatchNavigation = () => {
    const isMultiBatch = Boolean(activeBatchEntryId && batchEntries.length > 1)
    const isMultiSheet = !isMultiBatch && parsedSheets.length > 1

    if (!isMultiBatch && !isMultiSheet) return null

    let currentIndex = -1
    let totalSheets = 0
    let sheetLabel = ''
    let canGoPrev = false
    let canGoNext = false

    if (isMultiBatch) {
      currentIndex = batchEntries.findIndex((entry) => entry.sessionId === activeBatchEntryId || entry.id === activeBatchEntryId)
      if (currentIndex < 0) return null
      totalSheets = batchEntries.length
      sheetLabel = `Sheet ${currentIndex + 1} of ${totalSheets}`
      canGoPrev = currentIndex > 0
      canGoNext = currentIndex < totalSheets - 1
    } else {
      const currentSheet = sheetFilter === 'all' ? parsedSheets[0] : sheetFilter
      currentIndex = parsedSheets.indexOf(currentSheet)
      if (currentIndex < 0) currentIndex = 0
      totalSheets = parsedSheets.length
      sheetLabel = `${currentSheet} (${currentIndex + 1} of ${totalSheets})`
      canGoPrev = currentIndex > 0
      canGoNext = currentIndex < totalSheets - 1
    }

    const onPrev = () => {
      if (isMultiBatch) openAdjacentBatchEntry(-1)
      else if (currentIndex > 0) setSheetFilter(parsedSheets[currentIndex - 1])
    }
    const onNext = () => {
      if (isMultiBatch) openAdjacentBatchEntry(1)
      else if (currentIndex < totalSheets - 1) setSheetFilter(parsedSheets[currentIndex + 1])
    }

    return (
      <div
        ref={batchNavWheelRef}
        className={`flex items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/75 dark:border-emerald-900/70 dark:bg-emerald-950/25 transition-all select-none ${
          isComparingSource ? 'sticky top-0 z-40 mb-2.5 p-1.5 px-2.5 shadow-md shadow-emerald-950/10 backdrop-blur-sm' : 'mb-4 p-2 px-3'
        }`}
        aria-label="Sheet navigation"
        data-sticky-review-navigation={isComparingSource ? 'true' : undefined}
        title="Hover and scroll mouse wheel up/down to switch sheets"
      >
        <button
          type="button"
          onClick={onPrev}
          disabled={!canGoPrev}
          className={`inline-flex items-center gap-1 rounded-xl font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-30 dark:text-emerald-300 transition-colors ${
            isComparingSource ? 'min-h-8 px-2 text-[11px]' : 'min-h-10 px-3 text-xs'
          }`}
        >
          <ChevronLeft className="h-4 w-4" />
          <span>Previous sheet</span>
        </button>

        <div className="text-center px-2">
          {isMultiBatch && (
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-400">
              {batchName}
            </p>
          )}
          <div className="flex items-center justify-center gap-1.5">
            <p className={`font-bold text-gray-800 dark:text-gray-100 ${isComparingSource ? 'text-xs' : 'text-xs'}`}>
              {sheetLabel}
            </p>
            <span className="hidden sm:inline-flex items-center rounded bg-emerald-100/80 dark:bg-emerald-900/50 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300" title="Hover and scroll mouse wheel to switch sheets">
              <MousePointer className="h-2.5 w-2.5 inline mr-0.5" /> Scroll to switch
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onNext}
          disabled={!canGoNext}
          className={`inline-flex items-center gap-1 rounded-xl font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-30 dark:text-emerald-300 transition-colors ${
            isComparingSource ? 'min-h-8 px-2 text-[11px]' : 'min-h-10 px-3 text-xs'
          }`}
        >
          <span>Next sheet</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    )
  }

  const renderIssueNavigator = () => {
    if (!activeBatchIssue) return null
    return <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 p-2.5 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-100 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">Review issues</p><p className="mt-0.5 text-xs font-black">Issue {(activeBatchIssue.index || 0) + 1} of {batchIssueQueue.length || 1} · {sheetFilter === 'all' ? 'Current sheet' : sheetFilter}</p></div><div className="flex gap-1.5"><button type="button" onClick={() => navigateBatchIssue(-1)} className="min-h-8 rounded-xl border border-emerald-300 bg-white px-2.5 text-xs font-black text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-[#111a16] dark:text-emerald-200">Previous issue</button><button type="button" onClick={() => navigateBatchIssue(1)} className="min-h-8 rounded-xl bg-emerald-600 px-2.5 text-xs font-black text-white hover:bg-emerald-700">Next issue</button></div></div>
  }

  const renderReviewStep = () => <>{renderBatchNavigation()}{renderIssueNavigator()}{importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? renderNamesReviewStep() : renderFullRegisterReviewStep()}</>

  // ─── STEP 3: Month & Sundays ───────────────────────────────────────────
  const renderMonthStep = () => (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Target Month & Sundays</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? 'Choose one Sunday. Every ready name will be marked Present on that date.' : 'Choose the DatSer month to import into and which Sundays to include.'}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => setStep(importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? STEPS.IMPORT : STEPS.REVIEW)}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 sm:flex-none"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <button
            type="button"
            onClick={() => setStep(importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? STEPS.REVIEW : STEPS.PREVIEW)}
            disabled={!targetTable || (importMode === CSV_IMPORT_MODE.SUNDAY_NAMES && !selectedSundayDate)}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 sm:flex-none"
          >
            {importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? 'Review matches' : 'Preview'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Month selector */}
      <div className="max-w-md">
        <label className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-300">Target Month</label>
        <div ref={targetMonthMenuRef} className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isMonthMenuOpen}
            onClick={() => setIsMonthMenuOpen((open) => !open)}
            className="group flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-2.5 text-left shadow-sm transition-all hover:border-emerald-300 hover:shadow-md focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-100 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-emerald-700 dark:focus:border-emerald-400 dark:focus:ring-emerald-900/40"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
              <Calendar className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500">Import into</span>
              <span className={`block truncate text-sm font-bold ${targetTable ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                {targetTable ? targetTable.replace('_', ' ') : 'Select a month'}
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-150 group-hover:text-emerald-600 dark:group-hover:text-emerald-300 ${isMonthMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {isMonthMenuOpen && (
            <div
              className="absolute z-30 mt-2 w-full overflow-hidden rounded-[1.15rem] border border-emerald-100 bg-white shadow-xl shadow-emerald-950/10 dark:border-emerald-900/70 dark:bg-gray-900 dark:shadow-black/30"
            >
              <div
                role="listbox"
                aria-label="Target month"
                className="max-h-72 overflow-y-auto overscroll-contain p-1.5 [scrollbar-color:transparent_transparent] [scrollbar-width:thin] hover:[scrollbar-color:rgba(52,211,153,0.55)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-emerald-400/70"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={!targetTable}
                  onClick={() => {
                    setTargetTable('')
                    setIsMonthMenuOpen(false)
                  }}
                  className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                    !targetTable
                      ? 'bg-emerald-50 font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                      : 'text-gray-500 hover:bg-emerald-50/70 dark:text-gray-400 dark:hover:bg-emerald-950/40'
                  }`}
                >
                  Select a month
                </button>
                {(monthlyTables || []).map((table) => {
                  const isSelected = table === targetTable
                  return (
                    <button
                      key={table}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setTargetTable(table)
                        setIsMonthMenuOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                        isSelected
                          ? 'bg-emerald-600 font-bold text-white'
                          : 'font-semibold text-gray-700 hover:bg-emerald-50 dark:text-gray-200 dark:hover:bg-emerald-950/40'
                      }`}
                    >
                      <Calendar className={`h-3.5 w-3.5 ${isSelected ? 'text-emerald-100' : 'text-emerald-500 dark:text-emerald-400'}`} />
                      <span className="flex-1">{table.replace('_', ' ')}</span>
                      {isSelected && <Check className="h-4 w-4" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sunday mapping */}
      {targetTable && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3">{importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? 'Select one Sunday' : 'Sunday Columns'}</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? 'Attendance will be Present only for the selected date.' : 'Choose which imported Sunday columns to include in this save.'}
          </p>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((n) => {
              const key = `sunday_${n}`
              const date = sundayDates[n - 1]
              const dateLabel = date
                ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : null

              return (
                <label
                  key={key}
                  className={`flex items-center gap-3 rounded-xl p-3 cursor-pointer transition-colors ${
                    (importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? selectedSundayDate === (date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '') : enabledSundays[key])
                      ? 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800'
                      : 'bg-gray-50 border border-gray-200 dark:bg-gray-800/50 dark:border-gray-700'
                  } ${!date ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type={importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? 'radio' : 'checkbox'}
                    name={importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? 'selected-sunday' : undefined}
                    checked={importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? selectedSundayDate === (date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '') : enabledSundays[key] && !!date}
                    onChange={(e) => importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? setSelectedSundayDate(date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '') : setEnabledSundays((prev) => ({ ...prev, [key]: e.target.checked }))}
                    disabled={!date}
                    className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-bold text-gray-900 dark:text-white">Sunday {n}</span>
                    {dateLabel ? (
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">— {dateLabel}</span>
                    ) : (
                      <span className="ml-2 text-xs text-red-500">Not available in this month</span>
                    )}
                  </div>
                  {date && importMode === CSV_IMPORT_MODE.FULL_REGISTER && (
                    <span className="text-xs text-gray-400">
                      {importRows.filter((r) => r.edited[key] === 'PRESENT').length}P / {importRows.filter((r) => r.edited[key] === 'ABSENT').length}A
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )

  // ─── STEP 4: Preview ───────────────────────────────────────────────────
  const renderPreviewStep = () => {
    if (!previewSummary) return null

    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Save Preview</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Review what will happen when you save.
            </p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() => setStep(importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? STEPS.REVIEW : STEPS.MONTH)}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 sm:flex-none"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isOnline || isSaving || previewSummary.actionableCount === 0}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-black text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50 sm:flex-none"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSaving ? 'Saving…' : importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? `Save ${previewSummary.actionableCount} Ready Rows` : `Save ${previewSummary.actionableCount} Rows`}
            </button>
          </div>
        </div>

        {/* Summary cards */}
        {importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard label="Total names" value={previewSummary.totalRows} />
            <SummaryCard label="Ready" value={previewSummary.readyCount} color="emerald" />
            <SummaryCard label="Will mark Present" value={previewSummary.readyCount} color="emerald" />
            <SummaryCard label="Already Present" value={previewSummary.alreadyPresentCount} />
            <SummaryCard label="Unresolved" value={previewSummary.unresolvedCount} color="amber" />
            <SummaryCard label="Duplicates" value={previewSummary.duplicateCount} />
            <SummaryCard label="Needs Attention" value={previewSummary.attentionCount} color="red" />
          </div>
        ) : <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3"><SummaryCard label="Total Rows" value={previewSummary.totalRows} /><SummaryCard label="Sheets" value={previewSummary.sheetCount} /><SummaryCard label="Exact Matches" value={previewSummary.exactCount} color="emerald" /><SummaryCard label="New Members" value={previewSummary.newCount} color="emerald" /></div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3"><SummaryCard label="Resolved Possible" value={previewSummary.possibleResolvedCount} color="amber" /><SummaryCard label="Unresolved" value={previewSummary.unresolvedCount} color="red" /><SummaryCard label="Needs Attention" value={previewSummary.attentionCount} color="red" /><SummaryCard label="Profile Updates" value={previewSummary.profileUpdateCount} color="purple" /><SummaryCard label="Invalid" value={previewSummary.invalidCount} color="red" /></div>
        </>}

        {/* Target info */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Target</h4>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <Calendar className="h-4 w-4 inline mr-1" />
            {targetTable.replace('_', ' ')}
            {importMode === CSV_IMPORT_MODE.SUNDAY_NAMES && <span className="ml-2 font-bold text-emerald-700 dark:text-emerald-300">· {selectedSundayDate} · Present only</span>}
          </p>
        </div>

        {/* Sunday breakdown */}
        {importMode === CSV_IMPORT_MODE.FULL_REGISTER && Object.keys(previewSummary.sundayStats || {}).length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Attendance Summary</h4>
            <div className="space-y-2">
              {Object.entries(previewSummary.sundayStats).map(([key, stats]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {key.replace('_', ' ').replace('sunday', 'Sunday')} — {stats.label}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    <span className="text-emerald-600">{stats.present}P</span>
                    {' · '}
                    <span className="text-red-500">{stats.absent}A</span>
                    {' · '}
                    <span className="text-gray-400">{stats.unspecified} skip</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warnings */}
        {previewSummary.unresolvedCount > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
            <p className="flex items-center gap-2 text-sm font-bold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              {previewSummary.unresolvedCount} unresolved {importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? 'name' : 'possible match'}{previewSummary.unresolvedCount !== 1 ? 's' : ''} will remain untouched.
            </p>
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Go back to Review to resolve them, or they will remain untouched.
            </p>
          </div>
        )}

        {previewSummary.attentionCount > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/70 dark:bg-red-950/25">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-sm font-bold text-red-700 dark:text-red-300"><AlertTriangle className="h-4 w-4"/>{previewSummary.attentionCount} row{previewSummary.attentionCount === 1 ? '' : 's'} still need verification.</p>
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">Those specific rows are not ready and will remain untouched until explicitly verified.</p>
              </div>
              <button type="button" onClick={() => { setFilter('attention'); setStep(STEPS.REVIEW) }} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-red-300 bg-white px-4 text-xs font-black text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">Return to review<ArrowRight className="h-3.5 w-3.5"/></button>
            </div>
          </div>
        )}

        {!isOnline && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="flex items-center gap-2 text-sm font-bold text-red-700 dark:text-red-300">
              <XCircle className="h-4 w-4" />
              You are offline. CSV Import requires an active internet connection.
            </p>
          </div>
        )}

      </div>
    )
  }

  // ─── STEP 5: Saving ────────────────────────────────────────────────────
  const renderSavingStep = () => (
    <div className="space-y-6 text-center py-12">
      <Loader2 className="h-12 w-12 animate-spin text-emerald-600 mx-auto" />
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Saving…</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {saveProgress.completed} of {saveProgress.total} rows processed
        </p>
      </div>
      {saveProgress.total > 0 && (
        <div className="max-w-sm mx-auto">
          <div className="h-3 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all duration-300"
              style={{ width: `${Math.round((saveProgress.completed / saveProgress.total) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {Math.round((saveProgress.completed / saveProgress.total) * 100)}%
          </p>
        </div>
      )}
    </div>
  )

  // ─── STEP 6: Results ───────────────────────────────────────────────────
  const renderResultsStep = () => {
    if (!saveResults) return null

    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{saveResults.failCount === 0 && !saveResults.unresolvedCount ? 'Import Complete' : 'Import Partially Complete'}</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Review saved rows or start another import.</p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setFilter('saved')
                setStep(STEPS.REVIEW)
              }}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 sm:flex-none"
            >
              <Eye className="h-4 w-4" />
              View Saved Rows
            </button>
            <button
              type="button"
              onClick={resetImport}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 sm:flex-none"
            >
              <Upload className="h-4 w-4" />
              New Import
            </button>
            {activeBatchEntryId && findNextCsvBatchEntry(batchEntries, activeBatchEntryId, { unsavedOnly: true }) && <button
              type="button"
              onClick={() => openAdjacentBatchEntry(1, true)}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-emerald-800 sm:flex-none"
            >
              Next unsaved sheet <ChevronRight className="h-4 w-4" />
            </button>}
          </div>
        </div>
        <div className="text-center py-6">
          {saveResults.failCount === 0 ? (
            <CheckCircle className="h-14 w-14 text-emerald-500 mx-auto mb-3" />
          ) : (
            <AlertTriangle className="h-14 w-14 text-amber-500 mx-auto mb-3" />
          )}
        </div>

        <div className={`grid gap-3 mx-auto ${importMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? 'max-w-2xl grid-cols-5' : 'max-w-md grid-cols-3'}`}>
          {importMode === CSV_IMPORT_MODE.SUNDAY_NAMES && <SummaryCard label="Total" value={importRows.length} />}
          <SummaryCard label="Saved" value={saveResults.successCount} color="emerald" />
          <SummaryCard label="Failed" value={saveResults.failCount} color="red" />
          <SummaryCard label="Skipped" value={saveResults.skipCount} color="gray" />
          {importMode === CSV_IMPORT_MODE.SUNDAY_NAMES && <SummaryCard label="Unresolved" value={saveResults.unresolvedCount || 0} color="amber" />}
        </div>

        {(historyPersistenceError || isPersistingHistory) && (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-900/20">
            <div>
              <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
                {isPersistingHistory ? 'Saving import history…' : 'Import history needs attention'}
              </p>
              {historyPersistenceError && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{historyPersistenceError}</p>}
            </div>
            {historyPersistenceError && (
              <button
                type="button"
                onClick={() => persistHistorySnapshot()}
                disabled={isPersistingHistory}
                className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-950/45"
              >
                {isPersistingHistory ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Retry saving history
              </button>
            )}
          </div>
        )}

        {/* Failed rows detail */}
        {saveResults.failCount > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20 space-y-3">
            <p className="text-sm font-bold text-red-700 dark:text-red-300">Failed rows:</p>
            <ul className="space-y-1 text-xs text-red-600 dark:text-red-400">
              {saveResults.results
                .filter((r) => r.status === CSV_SAVE_STATUS.FAILED)
                .slice(0, 20)
                .map((r) => {
                  const row = importRows.find((ir) => ir.importRowId === r.importRowId)
                  return (
                    <li key={r.importRowId}>
                      {row?.sheet} · Row {row?.rowNumber} — {row?.edited?.fullName}: {r.error}
                    </li>
                  )
                })}
            </ul>
            <button
              type="button"
              onClick={handleRetryFailed}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700"
            >
              <RefreshCw className="h-3 w-3" />
              Retry Failed
            </button>
          </div>
        )}

      </div>
    )
  }

  // ─── Image viewer modal ────────────────────────────────────────────────
  const renderImageViewer = () => {
    if (!viewingImage) return null
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={() => setViewingImage(null)}
      >
        <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setViewingImage(null)}
            className="absolute -top-3 -right-3 z-10 rounded-full bg-white p-2 shadow-lg dark:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
          <ManagedSourceImage image={viewingImage} resolveSourceUrl={resolveCsvImportImage} />
        </div>
      </div>
    )
  }

  const renderBatchPreview = () => {
    if (!isBatchPreviewOpen) return null
    return (
      <div className="fixed inset-0 z-[175] flex items-end bg-black/55 p-3 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-label="Process remaining sheets preview">
        <section className="w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-emerald-200 bg-white shadow-2xl dark:border-emerald-900/70 dark:bg-[#101814]">
          <div className="flex items-start justify-between border-b border-emerald-100 px-5 py-5 dark:border-emerald-900/60">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">Fast Bulk Import</p>
              <h3 className="mt-1 text-xl font-black text-gray-900 dark:text-white">Process Remaining Sheets</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Process {batchReviewSummary.remainingSheets} remaining sheet{batchReviewSummary.remainingSheets === 1 ? '' : 's'} ({batchReviewSummary.remainingRows} rows) as entered.</p>
            </div>
            <button type="button" onClick={() => setIsBatchPreviewOpen(false)} disabled={isSavingBatchReady} className="rounded-xl p-2 text-gray-500 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/50" aria-label="Close batch preview">
              <X className="h-5 w-5"/>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
            <SummaryCard label="Remaining Sheets" value={batchReviewSummary.remainingSheets}/>
            <SummaryCard label="Remaining Rows" value={batchReviewSummary.remainingRows}/>
            <SummaryCard label="Existing Exact" value={batchReviewSummary.exact} color="emerald"/>
            <SummaryCard label="Will Create As New" value={batchReviewSummary.willCreateNew} color="emerald"/>
          </div>
          <div className="mx-5 space-y-3 max-h-[22rem] overflow-y-auto pr-1">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/65 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
              <p className="text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300 mb-2">Member Breakdown</p>
              <div className="grid grid-cols-2 sm:grid-cols-2 gap-2 text-xs font-bold text-emerald-900 dark:text-emerald-100">
                <span className="flex items-center gap-1.5"><strong className="text-emerald-700 dark:text-emerald-300">{batchReviewSummary.exact}</strong> existing Exact members reused</span>
                <span className="flex items-center gap-1.5"><strong className="text-emerald-700 dark:text-emerald-300">{batchReviewSummary.willCreateNew}</strong> will be created as new members</span>
                <span className="flex items-center gap-1.5"><strong className="text-red-700 dark:text-red-300">{batchReviewSummary.invalid}</strong> technically invalid (missing name)</span>
                <span className="flex items-center gap-1.5"><strong className="text-gray-600 dark:text-gray-400">{batchReviewSummary.completedRows}</strong> already completed rows ({batchReviewSummary.completedSheets} sheet{batchReviewSummary.completedSheets === 1 ? '' : 's'})</span>
              </div>
            </div>

            {(batchReviewSummary.possible > 0 || batchReviewSummary.attention > 0) && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                <p className="text-xs font-black uppercase tracking-wider text-amber-800 dark:text-amber-300 mb-2">Warnings Being Accepted</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-bold text-amber-900 dark:text-amber-100">
                  {batchReviewSummary.possible > 0 && <span><strong>{batchReviewSummary.possible}</strong> possible matches (created as new, not auto-linked)</span>}
                  {batchReviewSummary.attention > 0 && <span><strong>{batchReviewSummary.attention}</strong> transcription notes (saved as entered)</span>}
                </div>
              </div>
            )}

            {(batchReviewSummary.presentCount > 0 || batchReviewSummary.absentCount > 0 || batchReviewSummary.blankCount > 0) && (
              <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-800 dark:bg-gray-900/40">
                <p className="text-xs font-black uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-2">Attendance Decisions (Remaining Sheets)</p>
                <div className="flex flex-wrap gap-4 text-xs font-bold text-gray-800 dark:text-gray-200">
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-500"></span>{batchReviewSummary.presentCount} Present</span>
                  <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300"><span className="h-2 w-2 rounded-full bg-red-500"></span>{batchReviewSummary.absentCount} Absent</span>
                  <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400"><span className="h-2 w-2 rounded-full bg-gray-400"></span>{batchReviewSummary.blankCount} blank / no change</span>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-emerald-200/80 bg-white p-3.5 text-xs text-gray-700 dark:border-emerald-900/60 dark:bg-[#15221c] dark:text-gray-300">
              <p className="font-bold text-gray-900 dark:text-white mb-1">DatSer will process all usable rows exactly as imported:</p>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] text-gray-600 dark:text-gray-400">
                <li>Existing Exact members will be reused.</li>
                <li>Unmatched members will be created as new.</li>
                <li>Possible matches will be created as new members rather than automatically linked to an uncertain candidate.</li>
                <li>Rows with transcription notes will still be saved as entered.</li>
                <li>{batchReviewSummary.completedSheets} already-completed sheet{batchReviewSummary.completedSheets === 1 ? '' : 's'} will not be processed again.</li>
              </ul>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 p-5 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setIsBatchPreviewOpen(false)} disabled={isSavingBatchReady} className="min-h-11 rounded-xl border border-gray-300 bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700 dark:bg-[#111a16] dark:text-gray-300">Cancel</button>
            {batchReviewSummary.issues > 0 && (
              <button type="button" onClick={() => { setIsBatchPreviewOpen(false); reviewBatchIssues() }} disabled={isSavingBatchReady} className="min-h-11 rounded-xl border border-emerald-300 bg-white px-4 text-sm font-black text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-emerald-800 dark:bg-[#111a16] dark:text-emerald-200">Review warnings ({batchReviewSummary.issues})</button>
            )}
            <button type="button" onClick={handleSaveAllReady} disabled={isSavingBatchReady || batchReviewSummary.remainingSheets === 0 || batchReviewSummary.processableRemainingRows === 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45">
              {isSavingBatchReady ? <Loader2 className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>}
              {isSavingBatchReady ? 'Processing remaining sheets…' : `Process Remaining ${batchReviewSummary.remainingSheets} Sheets`}
            </button>
          </div>
        </section>
      </div>
    )
  }

  const renderBatchRepairModal = () => {
    if (!isBatchRepairOpen) return null

    const selectedCount = repairSelectedSheets.length

    const toggleSheetSelection = (sheetNum) => {
      setRepairSelectedSheets((prev) =>
        prev.includes(sheetNum) ? prev.filter((n) => n !== sheetNum) : [...prev, sheetNum]
      )
    }

    const selectAllAffected = () => {
      const affectedInBatch = batchEntries
        .map((entry, idx) => extractSheetNumber(entry.displayBasename || entry.normalizedBasename, idx))
        .filter((num) => num !== null && DEFAULT_AFFECTED_REPAIR_SHEETS.includes(num))
      setRepairSelectedSheets(affectedInBatch)
    }

    return (
      <div className="fixed inset-0 z-[180] flex items-end bg-black/55 p-3 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-label="Repair and reprocess sheets">
        <section className="w-full max-w-xl overflow-hidden rounded-[1.75rem] border border-amber-200 bg-white shadow-2xl dark:border-amber-900/70 dark:bg-[#101814]">
          <div className="flex items-start justify-between border-b border-amber-100 px-5 py-5 dark:border-amber-900/60">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400">Attendance Repair</p>
              <h3 className="mt-1 text-xl font-black text-gray-900 dark:text-white">Repair / Reprocess Sheets</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Select previously saved sheets to retry with the corrected Sunday attendance mapping.</p>
            </div>
            <button type="button" onClick={() => setIsBatchRepairOpen(false)} className="rounded-xl p-2 text-gray-500 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/50" aria-label="Close repair modal">
              <X className="h-5 w-5"/>
            </button>
          </div>

          <div className="p-5 space-y-4 max-h-[22rem] overflow-y-auto">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              <p className="font-black text-sm mb-1">Reprocess {selectedCount} sheets?</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li><strong>Existing members will be reused</strong> — no member will be deleted or duplicated.</li>
                <li><strong>Attendance and imported profile data</strong> will be applied again using the corrected save logic.</li>
                <li>Sheets 1–4 remain completed and protected.</li>
              </ul>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-black uppercase tracking-wider text-gray-700 dark:text-gray-300">Select Sheets to Reprocess</span>
                <button type="button" onClick={selectAllAffected} className="text-xs font-bold text-emerald-600 hover:underline dark:text-emerald-400">
                  Select Affected 10 Sheets
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {batchEntries.map((entry, idx) => {
                  const sheetNum = extractSheetNumber(entry.displayBasename || entry.normalizedBasename, idx)
                  const isChecked = sheetNum !== null && repairSelectedSheets.includes(sheetNum)
                  const isProtected = sheetNum !== null && [1, 2, 3, 4].includes(sheetNum)
                  return (
                    <label key={entry.id || idx} className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                      isChecked
                        ? 'border-amber-300 bg-amber-50/80 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
                        : 'border-gray-200 bg-gray-50/60 text-gray-700 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-300'
                    }`}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => sheetNum !== null && toggleSheetSelection(sheetNum)}
                        className="rounded border-gray-300 text-amber-600 focus:ring-amber-500 h-4 w-4"
                      />
                      <span className="truncate">{entry.displayBasename || `Sheet ${idx + 1}`}</span>
                      {isProtected && <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 ml-auto">(Protected)</span>}
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-gray-100 p-5 dark:border-gray-800 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setIsBatchRepairOpen(false)} className="min-h-11 rounded-xl border border-gray-300 bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-[#111a16] dark:text-gray-300">
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePrepareBatchRepair}
              disabled={selectedCount === 0}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 text-sm font-black text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <RotateCcw className="h-4 w-4"/>
              Prepare {selectedCount} Sheet{selectedCount === 1 ? '' : 's'} for Reprocessing
            </button>
          </div>
        </section>
      </div>
    )
  }

  const renderSavedImports = () => {
    if (!isSavedImportsOpen) return null

    const modal = (
      <div className="fixed inset-0 z-[170] flex min-h-[100dvh] justify-end bg-black/45 p-3 backdrop-blur-sm sm:p-5" onClick={() => setIsSavedImportsOpen(false)} role="dialog" aria-modal="true" aria-label="Saved CSV imports">
        <aside
          className="flex h-full w-full max-w-md flex-col overflow-hidden rounded-[1.75rem] border border-emerald-200 bg-white shadow-2xl dark:border-emerald-900/70 dark:bg-[#101814]"
          onClick={(event) => event.stopPropagation()}
          aria-label="Saved CSV imports"
        >
          <div className="flex items-start justify-between border-b border-emerald-100 px-5 py-5 dark:border-emerald-900/60">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">CSV workspace history</p>
              <h3 className="mt-1 text-lg font-black text-gray-900 dark:text-white">Saved imports</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Open a completed import to review its rows, CSV, and private source images.</p>
            </div>
            <button type="button" onClick={() => setIsSavedImportsOpen(false)} className="rounded-xl p-2 text-gray-500 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-300" aria-label="Close saved imports">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {isLoadingSavedImports ? (
              <div className="flex h-40 items-center justify-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Loading saved imports…</div>
            ) : savedImports.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/60 p-6 text-center dark:border-emerald-900/70 dark:bg-emerald-950/20">
                <History className="mx-auto h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                <p className="mt-3 text-sm font-bold text-gray-900 dark:text-white">No saved imports yet</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Completed and partial CSV saves will appear here automatically.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {savedImports.map((savedImport) => {
                  const result = savedImport.save_result || {}
                  const dateLabel = savedImport.updated_at ? new Date(savedImport.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Saved import'
                  const isRenaming = renamingImportId === savedImport.id
                  const isConfirmingDeletion = deleteConfirmImportId === savedImport.id
                  const rowCount = getSavedImportRowCount(savedImport)
                  const targetLabel = savedImport.target_table ? savedImport.target_table.replace('_', ' ') : 'Unassigned month'
                  const savedMode = savedImport.enabled_sundays?.__mode || savedImport.import_rows?.[0]?.mode || CSV_IMPORT_MODE.FULL_REGISTER
                  return (
                    <div
                      key={savedImport.id}
                      className="group w-full rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50/70 disabled:cursor-wait dark:border-gray-800 dark:bg-[#121c17] dark:hover:border-emerald-800 dark:hover:bg-emerald-950/25"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {isRenaming ? (
                            <input
                              autoFocus
                              value={renameDraft}
                              maxLength={120}
                              disabled={isRenamingImport}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  saveSavedImportName(savedImport)
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault()
                                  cancelRenamingSavedImport()
                                }
                              }}
                              onBlur={() => {
                                if (renameDraft.trim()) saveSavedImportName(savedImport)
                                else cancelRenamingSavedImport()
                              }}
                              className="w-full rounded-lg border border-emerald-300 bg-white px-2 py-1 text-sm font-black text-gray-900 outline-none ring-2 ring-emerald-100 transition focus:border-emerald-500 dark:border-emerald-700 dark:bg-[#0d1511] dark:text-white dark:ring-emerald-950"
                              aria-label="Saved import name"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => openSavedImport(savedImport.id)}
                              disabled={isRestoringImport}
                              className="block max-w-full truncate text-left text-sm font-black text-gray-900 transition hover:text-emerald-700 disabled:cursor-wait dark:text-white dark:hover:text-emerald-300"
                            >
                              {getSavedImportName(savedImport)}
                            </button>
                          )}
                          <button type="button" onClick={() => openSavedImport(savedImport.id)} disabled={isRestoringImport || isRenaming} className="mt-1 block text-left text-xs text-gray-500 transition hover:text-emerald-700 disabled:cursor-wait dark:text-gray-400 dark:hover:text-emerald-300">
                            {rowCount} row{rowCount === 1 ? '' : 's'} · {targetLabel}{savedMode === CSV_IMPORT_MODE.SUNDAY_NAMES ? ` · ${savedImport.enabled_sundays?.__selected_sunday || 'Sunday list'}` : ''}
                          </button>
                          <button type="button" onClick={() => openSavedImport(savedImport.id)} disabled={isRestoringImport || isRenaming} className="mt-1 block text-left text-xs text-gray-500 transition hover:text-emerald-700 disabled:cursor-wait dark:text-gray-400 dark:hover:text-emerald-300">
                            {dateLabel}
                          </button>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {!isRenaming && (
                            <button type="button" onClick={() => startRenamingSavedImport(savedImport)} disabled={isRestoringImport} className="rounded-lg p-2 text-gray-500 transition hover:bg-emerald-100 hover:text-emerald-700 disabled:cursor-wait dark:text-gray-400 dark:hover:bg-emerald-900/45 dark:hover:text-emerald-300" aria-label={`Rename ${getSavedImportName(savedImport)}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {!isRenaming && !isConfirmingDeletion && (
                            <button type="button" onClick={() => requestSavedImportDeletion(savedImport)} disabled={isRestoringImport || isDeletingSavedImport} className="rounded-lg p-2 text-gray-500 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-wait dark:text-gray-400 dark:hover:bg-rose-950/45 dark:hover:text-rose-300" aria-label={`Delete ${getSavedImportName(savedImport)}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {isRenaming && (
                            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={cancelRenamingSavedImport} disabled={isRenamingImport} className="rounded-lg px-2 py-1 text-[10px] font-black text-gray-500 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
                              Cancel
                            </button>
                          )}
                          <button type="button" onClick={() => openSavedImport(savedImport.id)} disabled={isRestoringImport || isRenaming || isRenamingImport} className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-700 transition hover:bg-emerald-200 disabled:cursor-wait dark:bg-emerald-900/45 dark:text-emerald-300 dark:hover:bg-emerald-900/75">Open</button>
                        </div>
                      </div>
                      {isConfirmingDeletion && (
                        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/80 p-3 dark:border-rose-900/70 dark:bg-rose-950/30">
                          <p className="text-xs font-bold text-rose-900 dark:text-rose-100">Delete this saved import?</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">Its saved CSV history and private source images will be permanently removed. Member and attendance records will not change.</p>
                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button type="button" onClick={cancelSavedImportDeletion} disabled={isDeletingSavedImport} className="min-h-9 rounded-lg px-3 text-xs font-bold text-gray-600 transition hover:bg-white disabled:cursor-wait dark:text-gray-300 dark:hover:bg-gray-800">Cancel</button>
                            <button type="button" onClick={() => confirmSavedImportDeletion(savedImport)} disabled={isDeletingSavedImport} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-xs font-black text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-wait disabled:opacity-70"><Trash2 className="h-3.5 w-3.5" />{isDeletingSavedImport ? 'Deleting…' : 'Delete import'}</button>
                          </div>
                        </div>
                      )}
                      <button type="button" onClick={() => openSavedImport(savedImport.id)} disabled={isRestoringImport || isRenaming || isRenamingImport} className="mt-3 flex flex-wrap gap-2 text-left text-[11px] font-bold disabled:cursor-wait">
                        <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300">{result.successCount || 0} saved</span>
                        <span className="rounded-lg bg-gray-100 px-2 py-1 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{result.skipCount || 0} skipped</span>
                        <span className="rounded-lg bg-red-50 px-2 py-1 text-red-700 dark:bg-red-950/35 dark:text-red-300">{result.failCount || 0} failed</span>
                        <span className="rounded-lg bg-gray-100 px-2 py-1 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{countPersistedCsvImportImages(savedImport)} images</span>
                        {getCsvImportUnresolvedAttentionCount(savedImport.import_rows) > 0 && <span className="rounded-lg bg-red-50 px-2 py-1 text-red-700 dark:bg-red-950/45 dark:text-red-300">{getCsvImportUnresolvedAttentionCount(savedImport.import_rows)} need attention</span>}
                        {savedMode === CSV_IMPORT_MODE.SUNDAY_NAMES && <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300">Names list</span>}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    )

    return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
  }

  // ─── Main render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900 dark:text-white">CSV Import</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Import members and attendance from spreadsheet data
          </p>
        </div>
        <button
          type="button"
          onClick={openSavedImports}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-black text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-900/70 dark:bg-emerald-950/35 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
        >
          <History className="h-4 w-4" />
          Saved imports
        </button>
      </div>

      {renderStepIndicator()}

      <div className="min-h-[300px]">
        {step === STEPS.IMPORT && renderImportStep()}
        {step === STEPS.REVIEW && (
          isComparingSource ? (
            <CsvSourceCompare
              sheets={parsedSheets}
              sheetImages={sheetImages}
              activeSheet={sheetFilter === 'all' ? parsedSheets[0] : sheetFilter}
              onSheetChange={setSheetFilter}
              onClose={() => setIsComparingSource(false)}
              resolveSourceUrl={resolveCsvImportImage}
              onNextSheet={
                activeBatchEntryId && batchEntries.length > 1
                  ? () => openAdjacentBatchEntry(1)
                  : parsedSheets.length > 1
                    ? () => {
                        const current = sheetFilter === 'all' ? parsedSheets[0] : sheetFilter
                        const idx = parsedSheets.indexOf(current)
                        if (idx >= 0 && idx < parsedSheets.length - 1) setSheetFilter(parsedSheets[idx + 1])
                      }
                    : undefined
              }
              onPrevSheet={
                activeBatchEntryId && batchEntries.length > 1
                  ? () => openAdjacentBatchEntry(-1)
                  : parsedSheets.length > 1
                    ? () => {
                        const current = sheetFilter === 'all' ? parsedSheets[0] : sheetFilter
                        const idx = parsedSheets.indexOf(current)
                        if (idx > 0) setSheetFilter(parsedSheets[idx - 1])
                      }
                    : undefined
              }
              batchContext={
                activeBatchEntryId && batchEntries.length > 1
                  ? {
                      name: batchName,
                      index: batchEntries.findIndex((e) => e.sessionId === activeBatchEntryId || e.id === activeBatchEntryId),
                      total: batchEntries.length,
                    }
                  : null
              }
            >
              {renderReviewStep()}
            </CsvSourceCompare>
          ) : (
            renderReviewStep()
          )
        )}
        {step === STEPS.MONTH && renderMonthStep()}
        {step === STEPS.PREVIEW && renderPreviewStep()}
        {step === STEPS.SAVING && renderSavingStep()}
        {step === STEPS.RESULTS && renderResultsStep()}
      </div>

      {renderImageViewer()}
      {renderBatchPreview()}
      {renderBatchRepairModal()}
      {renderSavedImports()}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

// ─── Summary card ─────────────────────────────────────────────────────────
function SummaryCard({ label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700',
    emerald: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800',
    amber: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800',
    red: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800',
    purple: 'bg-purple-50 border-purple-200 dark:bg-purple-900/20 dark:border-purple-800',
  }
  return (
    <div className={`rounded-xl border p-3 text-center ${colors[color]}`}>
      <span className="block text-2xl font-black text-gray-900 dark:text-white">{value}</span>
      <span className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</span>
    </div>
  )
}

function ManagedSourceImage({ image, resolveSourceUrl }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    if (typeof image === 'string') {
      setUrl(image)
      return undefined
    }
    if (image?.previewUrl) {
      setUrl(image.previewUrl)
      return undefined
    }
    if (image?.path) {
      setUrl('')
      resolveSourceUrl(image).then((nextUrl) => { if (!cancelled) setUrl(nextUrl || '') }).catch(() => { if (!cancelled) setUrl('') })
      return () => { cancelled = true }
    }
    if (image && typeof URL !== 'undefined' && URL.createObjectURL) {
      const objectUrl = URL.createObjectURL(image)
      setUrl(objectUrl)
      return () => URL.revokeObjectURL(objectUrl)
    }
    setUrl('')
    return undefined
  }, [image, resolveSourceUrl])
  return url ? <img src={url} alt="Source sheet" className="max-h-[85vh] rounded-xl object-contain" /> : <div className="grid min-h-48 min-w-64 place-items-center rounded-xl bg-black/20 px-8 text-sm font-bold text-white">Loading source image…</div>
}

function InlineTextCell({ value, onCommit, compact = false, inputMode = 'text' }) {
  const [draft, setDraft] = useState(value || '')

  useEffect(() => {
    setDraft(value || '')
  }, [value])

  const commit = () => {
    if (draft !== (value || '')) onCommit(draft)
  }

  return (
    <input
      type="text"
      value={draft}
      title={draft}
      inputMode={inputMode}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        const nextValue = event.target.value
        setDraft(nextValue)
        if (nextValue !== (value || '')) onCommit(nextValue)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          setDraft(value || '')
          event.currentTarget.blur()
        }
      }}
      className={`w-full rounded border border-transparent bg-transparent text-gray-800 outline-none transition-colors hover:border-gray-200 hover:bg-white focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100 dark:text-gray-100 dark:hover:border-gray-700 dark:hover:bg-gray-800 dark:focus:border-emerald-500 dark:focus:bg-gray-900 dark:focus:ring-emerald-900/50 ${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm'}`}
    />
  )
}

function InlineGenderCell({ value, onCommit, compact = false, asFormField = false }) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState(null)
  const triggerRef = useRef(null)
  const menuId = useRef(`csv-gender-menu-${Math.random().toString(36).slice(2)}`).current

  useEffect(() => {
    if (!isOpen) return undefined

    const closeMenu = (event) => {
      if (!triggerRef.current?.contains(event.target) && !event.target.closest(`[data-csv-gender-menu="${menuId}"]`)) {
        setIsOpen(false)
      }
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen, menuId])

  const openMenu = (event) => {
    event.stopPropagation()
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setMenuPosition({ top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 132) })
    }
    setIsOpen((open) => !open)
  }

  const chooseGender = (nextValue) => {
    onCommit(nextValue)
    setIsOpen(false)
  }

  const options = ['', 'Male', 'Female', ...(value && !['Male', 'Female'].includes(value) ? [value] : [])]

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        aria-label="Gender"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={menuId}
        className={`group flex w-full items-center justify-between gap-1 text-left text-xs font-semibold text-gray-800 outline-none transition-colors dark:text-gray-100 ${
          asFormField
            ? 'rounded-lg border border-gray-200 bg-white px-2 py-1 hover:border-emerald-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-emerald-700'
            : `rounded-md border border-transparent bg-transparent hover:border-emerald-200 hover:bg-emerald-50/70 focus:border-emerald-400 focus:bg-emerald-50 focus:ring-2 focus:ring-emerald-100 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/30 ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'}`
        }`}
      >
        <span className="truncate">{value || '—'}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-gray-400 transition-transform group-hover:text-emerald-600 dark:group-hover:text-emerald-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && menuPosition && (
        <div
          id={menuId}
          role="listbox"
          data-csv-gender-menu={menuId}
          style={menuPosition}
          className="fixed z-[120] max-h-60 overflow-y-auto rounded-xl border border-emerald-100 bg-white p-1 shadow-xl shadow-emerald-950/15 dark:border-emerald-900/70 dark:bg-[#18231f] dark:shadow-black/40"
        >
          {options.map((option) => {
            const isSelected = (option || '') === (value || '')
            return (
              <button
                key={option || 'empty'}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => chooseGender(option)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition-colors ${
                  isSelected
                    ? 'bg-emerald-600 text-white'
                    : 'text-gray-700 hover:bg-emerald-50 dark:text-gray-200 dark:hover:bg-emerald-950/50'
                }`}
              >
                <span>{option || 'Not specified'}</span>
                {isSelected && <Check className="h-3.5 w-3.5" />}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

function InlineAttendanceCell({ value, onCommit }) {
  const nextValue = value === 'PRESENT' ? 'ABSENT' : value === 'ABSENT' ? '' : 'PRESENT'
  const config = value === 'PRESENT'
    ? { label: 'P', title: 'Present — click for Absent', className: 'bg-emerald-500 text-white hover:bg-emerald-600' }
    : value === 'ABSENT'
      ? { label: 'A', title: 'Absent — click for Unspecified', className: 'bg-red-500 text-white hover:bg-red-600' }
      : { label: '·', title: 'Unspecified — click for Present', className: 'bg-gray-100 text-gray-400 hover:bg-emerald-100 hover:text-emerald-700 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-300' }

  return (
    <button
      type="button"
      title={config.title}
      aria-label={config.title}
      onClick={(event) => { event.stopPropagation(); onCommit(nextValue) }}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black transition-colors ${config.className}`}
    >
      {config.label}
    </button>
  )
}

const AttendanceToggleCell = InlineAttendanceCell

const DATSER_EDUCATION_LEVELS = [
  'SHS1', 'SHS2', 'SHS3',
  'JHS1', 'JHS2', 'JHS3',
  'COMPLETED', 'UNIVERSITY',
]

function GreenSelectField({ value, displayValue, options, onSelect, ariaLabel, compact = false }) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState(null)
  const triggerRef = useRef(null)
  const menuId = useRef(`csv-select-${Math.random().toString(36).slice(2)}`).current

  useEffect(() => {
    if (!isOpen) return undefined
    const closeMenu = (event) => {
      if (!triggerRef.current?.contains(event.target) && !event.target.closest(`[data-csv-select-menu="${menuId}"]`)) setIsOpen(false)
    }
    const closeOnEscape = (event) => { if (event.key === 'Escape') setIsOpen(false) }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen, menuId])

  const openMenu = () => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setMenuPosition({ top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 240) })
    }
    setIsOpen((open) => !open)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`group flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-2 text-left text-xs font-semibold text-gray-800 outline-none transition-colors hover:border-emerald-300 hover:bg-emerald-50/70 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30 dark:focus:ring-emerald-900/50 ${compact ? 'py-1' : 'py-1.5'}`}
      >
        <span className="truncate">{displayValue}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-hover:text-emerald-600 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && menuPosition && (
        <div id={menuId} role="listbox" data-csv-select-menu={menuId} style={menuPosition} className="fixed z-[120] max-h-72 overflow-y-auto rounded-xl border border-emerald-100 bg-white p-1 shadow-xl shadow-emerald-950/15 dark:border-emerald-900/70 dark:bg-[#18231f] dark:shadow-black/40">
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <button key={option.value || 'empty'} type="button" role="option" aria-selected={isSelected} onClick={() => { onSelect(option.value); setIsOpen(false) }} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors ${isSelected ? 'bg-emerald-600 text-white' : 'text-gray-700 hover:bg-emerald-50 dark:text-gray-200 dark:hover:bg-emerald-950/50'}`}>
                <span>{option.label}</span>
                {isSelected && <Check className="h-3.5 w-3.5" />}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

function EducationLevelField({ value, matchedValue, onChange, compact = false }) {
  const suggestedLevels = useMemo(() => Array.from(new Set([
    matchedValue,
    ...DATSER_EDUCATION_LEVELS,
  ].filter(Boolean))), [matchedValue])
  const [isCustom, setIsCustom] = useState(() => Boolean(value && !suggestedLevels.includes(value)))

  useEffect(() => {
    setIsCustom(Boolean(value && !suggestedLevels.includes(value)))
  }, [suggestedLevels, value])

  const selectValue = isCustom ? '__custom__' : (value || '')
  const options = [
    { value: '', label: 'Choose DatSer level…' },
    ...suggestedLevels.map((level) => ({ value: level, label: level === matchedValue ? `Matched: ${level}` : level })),
    { value: '__custom__', label: 'Custom level…' },
  ]
  const displayValue = options.find((option) => option.value === selectValue)?.label || value || 'Choose DatSer level…'

  return (
    <div className="flex gap-1 items-center">
      {isCustom ? (
        <div className="flex-1 flex items-center gap-1">
          <input
            type="text"
            value={value || ''}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Type custom level"
            className="w-full rounded-lg border border-emerald-300 bg-emerald-50/50 px-2 py-1 text-xs font-semibold text-gray-800 outline-none placeholder:text-gray-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-200 dark:border-emerald-800 dark:bg-emerald-950/25 dark:text-gray-100"
          />
          <button
            type="button"
            onClick={() => {
              setIsCustom(false)
              onChange(suggestedLevels[0] || '')
            }}
            className="shrink-0 rounded px-1.5 py-1 text-[10px] font-bold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            title="Pick from standard levels"
          >
            Presets
          </button>
        </div>
      ) : (
        <GreenSelectField
          value={selectValue}
          displayValue={displayValue}
          options={options}
          ariaLabel="Education level"
          compact={compact}
          onSelect={(nextValue) => {
            if (nextValue === '__custom__') {
              setIsCustom(true)
              return
            }
            setIsCustom(false)
            onChange(nextValue)
          }}
        />
      )}
    </div>
  )
}

function AttentionBadge({ name, onClick }) {
  return <button type="button" onClick={onClick} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-100/80 px-2 py-1 text-[10px] font-black leading-none text-rose-800 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60 dark:border-rose-900/70 dark:bg-rose-950/55 dark:text-rose-200 dark:hover:bg-rose-950/80" aria-label={`Review note for ${name}`}><span className="grid h-4 w-4 place-items-center rounded-md bg-rose-500 text-white shadow-sm"><MessageSquare className="h-2.5 w-2.5"/></span><span className="whitespace-nowrap">Needs attention</span></button>
}

function TranscriptionNote({ row, onMarkVerified, reviewSaveState, onRetryReviewSave }) {
  const note = getCsvImportNote(row)
  if (!note) return null
  const unresolved = isCsvImportAttentionUnresolved(row)
  return (
    <section className={`rounded-xl border p-2 text-xs shadow-xs ${unresolved ? 'border-rose-200 bg-gradient-to-r from-rose-50/95 via-red-50/65 to-white dark:border-rose-900/70 dark:from-rose-950/35 dark:via-red-950/20 dark:to-gray-900' : 'border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/55'}`} aria-label="Transcription note">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider text-[9px] ${unresolved ? 'text-rose-700 dark:text-rose-300' : 'text-gray-500 dark:text-gray-400'}`}>
            <MessageSquare className="h-3 w-3" /> Note:
          </span>
          <span className="font-semibold text-gray-800 dark:text-gray-100 truncate">{note}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {reviewSaveState?.status === 'saving' && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500"><Loader2 className="h-3 w-3 animate-spin"/>Saving…</span>}
          {reviewSaveState?.status === 'saved' && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700"><Check className="h-3 w-3"/>Saved</span>}
          {unresolved ? (
            <button type="button" onClick={() => onMarkVerified(row.importRowId)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-emerald-700">
              <ShieldCheck className="h-3 w-3" /> Mark verified
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-gray-200 px-1.5 py-0.2 text-[9px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              <ShieldCheck className="h-2.5 w-2.5" /> Verified
            </span>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Row detail (expanded) ────────────────────────────────────────────────
function RowDetail({ row, allKnownMembers, formatMemberName = (value) => value, onUpdateField, onUpdateFieldResolution, onSelectMatch, onSetAsNew, sheetImages, onViewImage, onMarkAttentionVerified, reviewSaveState, onRetryReviewSave, isComparingSource = false }) {
  const matchedMember = row.match?.matchedMember
  const comparisons = matchedMember ? compareFieldsToMember(row, matchedMember) : null
  const [importPaneWidth, setImportPaneWidth] = useState(66)
  const [isResizing, setIsResizing] = useState(false)
  const splitContainerRef = useRef(null)

  const beginResize = useCallback((event) => {
    if (!matchedMember || window.innerWidth < 1280) return
    event.preventDefault()
    const bounds = splitContainerRef.current?.getBoundingClientRect()
    if (!bounds?.width) return
    setIsResizing(true)
    const updateWidth = (clientX) => setImportPaneWidth(Math.min(76, Math.max(46, Math.round(((clientX - bounds.left) / bounds.width) * 100))))
    const onMove = (moveEvent) => updateWidth(moveEvent.clientX)
    const onEnd = () => {
      setIsResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
    }
    updateWidth(event.clientX)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
  }, [matchedMember])

  const DETAIL_FIELDS = [
    { key: 'fullName', label: 'Full name', span: 'sm:col-span-2' },
    { key: 'phoneNumber', label: 'Phone', inputMode: 'tel' },
    { key: 'educationalLevel', label: 'Education', type: 'education' },
    { key: 'age', label: 'Age', inputMode: 'numeric' },
    { key: 'gender', label: 'Gender', type: 'gender' },
    { key: 'notes', label: 'Notes', span: 'sm:col-span-2' },
  ]
  const compactDetailFields = isComparingSource
    ? DETAIL_FIELDS.filter((field) => ['fullName', 'phoneNumber', 'educationalLevel', 'age', 'gender'].includes(field.key))
    : DETAIL_FIELDS

  const sheetImagesForRow = sheetImages[row.sheet] || []
  const rowDetailRef = useRef(null)

  // ─── Mouse wheel vertical scrolling over row detail area ───────────────────
  useEffect(() => {
    const element = rowDetailRef.current
    if (!element) return undefined

    const handleWheel = (event) => {
      if (Math.abs(event.deltaY) >= Math.abs(event.deltaX) && Math.abs(event.deltaY) > 0) {
        const owner = element.closest('[data-review-vertical-scroll-owner]') || document.querySelector('[data-review-vertical-scroll-owner]')
        if (owner && owner.scrollHeight > owner.clientHeight) {
          owner.scrollTop += event.deltaY
        }
      }
    }

    element.addEventListener('wheel', handleWheel, { passive: true })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <div ref={rowDetailRef} className={`min-w-0 select-text ${isComparingSource ? 'space-y-2' : 'space-y-3.5'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
          {row.sheet} · Row {row.rowNumber}
          {row.edited.memberCode && ` · Code: ${row.edited.memberCode}`}
        </span>
        <div className="flex items-center gap-2">
          {row.match?.candidates?.length > 0 && (
            <span className="text-xs text-gray-500">{row.match.candidates.length} candidate{row.match.candidates.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      <TranscriptionNote row={row} onMarkVerified={onMarkAttentionVerified} reviewSaveState={reviewSaveState} onRetryReviewSave={onRetryReviewSave} />

      {/* Source image thumbnail (only shown when side compare mode is NOT already open) */}
      {!isComparingSource && sheetImagesForRow.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {sheetImagesForRow.map((file, idx) => {
            const source = typeof file === 'string' ? file : file?.previewUrl || ''
            if (!source) return null
            return (
              <button
                key={file.path || idx}
                type="button"
                onClick={() => onViewImage(file)}
                className="shrink-0 h-16 w-24 rounded-lg border border-gray-200 overflow-hidden hover:ring-2 hover:ring-emerald-400 dark:border-gray-700"
                title={`View Source ${idx + 1}`}
              >
                <img src={source} alt={`Source ${idx + 1}`} className="h-full w-full object-cover" />
              </button>
            )
          })}
        </div>
      )}

      {/* Split layout: Balanced 2-column grid in side mode, resizable split in full mode */}
      {isComparingSource ? (
        <div className={`grid items-start ${matchedMember ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 max-w-2xl'} gap-2 min-w-0`}>
          {/* Column 1: Import values */}
          <details className="min-w-0 rounded-xl border border-gray-100 bg-white/75 shadow-sm shadow-gray-950/5 dark:border-gray-800 dark:bg-black/20">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 text-xs font-bold text-gray-700 marker:hidden dark:text-gray-200">
              <span className="truncate"><span className="mr-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">Import values</span>{row.edited.fullName || 'Unnamed row'}</span>
              <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Edit</span>
            </summary>
            <div className="grid grid-cols-1 gap-1 border-t border-gray-100 px-2 pb-2 pt-1.5 sm:grid-cols-2 dark:border-gray-800">
              {compactDetailFields.map((field) => {
                const comparison = comparisons?.[field.key]
                return (
                  <div key={field.key} className={`min-w-0 ${field.key === 'fullName' || field.key === 'notes' ? 'sm:col-span-2' : ''}`}>
                    <div className="mb-px flex items-center justify-between gap-1">
                      <label className="truncate text-[9px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{field.label}</label>
                      {comparison?.isDifferent && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onUpdateFieldResolution(row.importRowId, field.key, 'csv')}
                            className={`rounded px-1 py-px text-[9px] font-bold transition-colors ${
                              row.fieldResolution[field.key] === 'csv'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                            }`}
                            title={`Use imported ${field.label}`}
                          >
                            Import
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateFieldResolution(row.importRowId, field.key, 'datser')}
                            className={`rounded px-1 py-px text-[9px] font-bold transition-colors ${
                              row.fieldResolution[field.key] === 'datser'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                            }`}
                            title={`Keep DatSer ${field.label}`}
                          >
                            DatSer
                          </button>
                        </div>
                      )}
                    </div>
                    {field.type === 'education' ? (
                      <EducationLevelField
                        value={row.edited[field.key] || ''}
                        matchedValue={matchedMember?.['Current Level'] || ''}
                        onChange={(value) => onUpdateField(row.importRowId, field.key, value, { immediate: true })}
                        compact={true}
                      />
                    ) : field.type === 'gender' ? (
                      <InlineGenderCell
                        value={row.edited[field.key] || ''}
                        onCommit={(value) => onUpdateField(row.importRowId, field.key, value, { immediate: true })}
                        compact={true}
                        asFormField={true}
                      />
                    ) : (
                      <input
                        type="text"
                        inputMode={field.inputMode || 'text'}
                        value={row.edited[field.key] || ''}
                        onChange={(event) => onUpdateField(row.importRowId, field.key, event.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-xs font-semibold text-gray-800 outline-none transition-colors hover:border-emerald-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-emerald-700 dark:focus:border-emerald-500 dark:focus:ring-emerald-900/50"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </details>

          {/* Column 2: Matched DatSer Member */}
          {matchedMember && (
            <aside className="min-w-0 rounded-2xl bg-gradient-to-br from-emerald-50/90 to-white p-2.5 shadow-sm shadow-emerald-950/10 dark:from-emerald-950/35 dark:to-[#17201c] border border-emerald-100 dark:border-emerald-900/50">
              <div className="flex items-start gap-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm shadow-emerald-900/25">
                  <User className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300 truncate">Matched DatSer member</p>
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white"><CheckCircle className="h-3 w-3" /> Exact</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs font-bold text-gray-900 dark:text-white">{formatMemberName(matchedMember['Full Name'])}</p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-emerald-100/70 px-2 py-1 text-[10px] font-semibold text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100">
                <span className="truncate">{matchedMember['Phone Number'] || 'No phone'}</span>
                <span className="text-emerald-600/70 dark:text-emerald-300/70">•</span>
                <span>{[matchedMember.Age, matchedMember.Gender].filter(Boolean).join(' · ') || '—'}</span>
                <span className="text-emerald-600/70 dark:text-emerald-300/70">•</span>
                <span className="truncate">{matchedMember['Current Level'] || 'No level'}</span>
              </div>

              {comparisons && Object.values(comparisons).some((comparison) => comparison.isDifferent) && (
                <details className="mt-2 border-t border-emerald-200/70 pt-1.5 dark:border-emerald-800/70">
                  <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.12em] text-amber-700 marker:text-amber-500 dark:text-amber-300">{Object.values(comparisons).filter((comparison) => comparison.isDifferent).length} differences · open to compare</summary>
                  <div className="pt-1.5">
                  <div className="mb-1.5 flex items-center justify-between gap-1.5">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">Differences found</p>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => Object.keys(comparisons).forEach((key) => comparisons[key].isDifferent && onUpdateFieldResolution(row.importRowId, key, 'datser'))} className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-700">Use DatSer</button>
                      <button type="button" onClick={() => Object.keys(comparisons).forEach((key) => comparisons[key].isDifferent && onUpdateFieldResolution(row.importRowId, key, 'csv'))} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 shadow-sm hover:bg-emerald-50 dark:bg-black/20 dark:text-emerald-300">Use import</button>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                    {Object.entries(comparisons).filter(([, comparison]) => comparison.isDifferent).map(([, comparison]) => (
                      <div key={comparison.label} className="rounded-lg bg-white/80 p-1.5 text-[11px] border border-emerald-100 dark:bg-black/20 dark:border-emerald-900/40">
                        <span className="block font-bold text-gray-700 dark:text-gray-200 mb-0.5">{comparison.label}</span>
                        <div className="flex flex-wrap items-center gap-1 text-[10px]">
                          <span className="rounded bg-emerald-50 px-1.5 py-0.2 font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                            <span className="font-bold text-gray-400">Import:</span> {comparison.csvValue || '—'}
                          </span>
                          <span className="text-gray-300">·</span>
                          <span className="rounded bg-sky-50 px-1.5 py-0.2 font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
                            <span className="font-bold text-gray-400">DatSer:</span> {comparison.memberValue || '—'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  </div>
                </details>
              )}
            </aside>
          )}
        </div>
      ) : (
        <div ref={splitContainerRef} style={matchedMember ? { '--import-pane-width': `${importPaneWidth}%` } : undefined} className={`flex flex-col gap-4 xl:flex-row ${isResizing ? 'select-none' : ''}`}>
          <section className="min-w-0 rounded-2xl bg-white/70 p-3 shadow-sm shadow-gray-950/5 xl:w-[var(--import-pane-width)] xl:shrink-0 dark:bg-black/15">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">Import values</p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400">Edit any value before saving</span>
                {matchedMember && importPaneWidth !== 66 && (
                  <button type="button" onClick={() => setImportPaneWidth(66)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/45">
                    <RotateCcw className="h-3 w-3" /> Auto fit
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {compactDetailFields.map((field) => {
                const comparison = comparisons?.[field.key]
                return (
                  <div key={field.key} className={`min-w-0 ${field.span || ''}`}>
                    {field.type === 'education' ? (
                      <EducationLevelField
                        value={row.edited[field.key] || ''}
                        matchedValue={matchedMember?.['Current Level'] || ''}
                        onChange={(value) => onUpdateField(row.importRowId, field.key, value, { immediate: true })}
                        compact={false}
                      />
                    ) : (
                      <>
                        <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{field.label}</label>
                        {field.type === 'gender' ? (
                          <InlineGenderCell
                            value={row.edited[field.key] || ''}
                            onCommit={(value) => onUpdateField(row.importRowId, field.key, value, { immediate: true })}
                            compact={false}
                          />
                        ) : (
                          <input
                            type="text"
                            inputMode={field.inputMode || 'text'}
                            value={row.edited[field.key] || ''}
                            onChange={(event) => onUpdateField(row.importRowId, field.key, event.target.value)}
                            className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-xs font-semibold text-gray-800 outline-none transition-colors hover:border-emerald-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-emerald-700 dark:focus:border-emerald-500 dark:focus:ring-emerald-900/50"
                          />
                        )}
                      </>
                    )}
                    {comparison?.isDifferent && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onUpdateFieldResolution(row.importRowId, field.key, 'csv')}
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                            row.fieldResolution[field.key] === 'csv'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                          }`}
                        >
                          Use import
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateFieldResolution(row.importRowId, field.key, 'datser')}
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                            row.fieldResolution[field.key] === 'datser'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                          }`}
                        >
                          Use DatSer
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {matchedMember && (
            <div
              role="separator"
              aria-label="Resize import values and matched member panels"
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={beginResize}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') setImportPaneWidth((width) => Math.max(46, width - 2))
                if (event.key === 'ArrowRight') setImportPaneWidth((width) => Math.min(76, width + 2))
              }}
              className="group hidden w-5 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none xl:flex"
            >
              <div className={`flex h-full min-h-44 w-1.5 items-center justify-center rounded-full transition ${isResizing ? 'bg-emerald-500' : 'bg-emerald-200 group-hover:bg-emerald-400 dark:bg-emerald-900/80 dark:group-hover:bg-emerald-600'}`}>
                <GripVertical className="h-4 w-4 text-white opacity-0 transition group-hover:opacity-100" />
              </div>
            </div>
          )}

          {matchedMember && (
            <aside className="min-w-0 flex-1 rounded-2xl bg-gradient-to-br from-emerald-50 to-white p-3 shadow-sm shadow-emerald-950/10 dark:from-emerald-950/35 dark:to-[#17201c]">
              <div className="flex items-start gap-2.5">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm shadow-emerald-900/25">
                  <User className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">Matched DatSer member</p>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white"><CheckCircle className="h-3 w-3" /> Exact</span>
                  </div>
                  <p className="mt-1 truncate text-sm font-bold text-gray-900 dark:text-white">{formatMemberName(matchedMember['Full Name'])}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-white/70 px-2.5 py-2 dark:bg-black/15"><span className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">Phone</span><span className="mt-0.5 block truncate font-semibold text-gray-700 dark:text-gray-200">{matchedMember['Phone Number'] || '—'}</span></div>
                <div className="rounded-xl bg-white/70 px-2.5 py-2 dark:bg-black/15"><span className="block text-[10px] font-bold uppercase tracking-wide text-gray-400">Age · gender</span><span className="mt-0.5 block truncate font-semibold text-gray-700 dark:text-gray-200">{[matchedMember.Age, matchedMember.Gender].filter(Boolean).join(' · ') || '—'}</span></div>
                <div className="col-span-2 rounded-xl bg-emerald-100/70 px-2.5 py-2 dark:bg-emerald-900/30"><span className="block text-[10px] font-bold uppercase tracking-wide text-emerald-700/70 dark:text-emerald-300/70">Current level</span><span className="mt-0.5 block font-semibold text-emerald-900 dark:text-emerald-100">{matchedMember['Current Level'] || 'Not recorded'}</span></div>
              </div>

              {comparisons && Object.values(comparisons).some((comparison) => comparison.isDifferent) && (
                <div className="mt-3 border-t border-emerald-200/70 pt-3 dark:border-emerald-800/70">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">Differences found</p>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => Object.keys(comparisons).forEach((key) => comparisons[key].isDifferent && onUpdateFieldResolution(row.importRowId, key, 'datser'))} className="rounded-md bg-emerald-600 px-1.5 py-1 text-[10px] font-bold text-white hover:bg-emerald-700">Use DatSer</button>
                      <button type="button" onClick={() => Object.keys(comparisons).forEach((key) => comparisons[key].isDifferent && onUpdateFieldResolution(row.importRowId, key, 'csv'))} className="rounded-md bg-white px-1.5 py-1 text-[10px] font-bold text-emerald-700 shadow-sm hover:bg-emerald-50 dark:bg-black/20 dark:text-emerald-300">Use import</button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {Object.entries(comparisons).filter(([, comparison]) => comparison.isDifferent).map(([, comparison]) => (
                      <div key={comparison.label} className="grid grid-cols-[68px_minmax(0,1fr)] gap-1.5 text-[10px]">
                        <span className="font-bold text-gray-500 dark:text-gray-400">{comparison.label}</span>
                        <span className="truncate text-gray-600 dark:text-gray-300"><span className="text-emerald-700 dark:text-emerald-300">Import:</span> {comparison.csvValue} <span className="text-gray-400">·</span> <span className="text-emerald-700 dark:text-emerald-300">DatSer:</span> {comparison.memberValue}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      )}

      {/* Candidate selection for possible matches */}
      {row.match?.status === CSV_MATCH_STATUS.POSSIBLE && row.match.candidates?.length > 0 && (
        <CsvPossibleMatchResolver
          candidates={row.match.candidates}
          formatMemberName={formatMemberName}
          selectedMemberId={row.match.selectedMemberId}
          onSelect={(candidate) => onSelectMatch(row.importRowId, candidate)}
          onCreateNew={() => onSetAsNew(row.importRowId)}
        />
      )}

      {/* Attendance flags */}
      {Object.keys(row.attendanceFlags || {}).length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-1">Attendance flags:</p>
          {Object.entries(row.attendanceFlags).map(([key, flag]) => (
            <p key={key} className="text-xs text-amber-600 dark:text-amber-400">
              {key.replace('_', ' ')}: {flag.message}
            </p>
          ))}
        </div>
      )}

      {/* Save error */}
      {row.saveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-xs font-bold text-red-700 dark:text-red-300">Save error: {row.saveError}</p>
        </div>
      )}
    </div>
  )
}

// ─── Manual search panel ──────────────────────────────────────────────────
function ManualSearchPanel({ row, formatMemberName = (value) => value, query, onQueryChange, results, provenanceByMemberId = {}, onSelect, onCreateNew, onClose }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900 dark:text-white">
          Search DatSer for: <span className="text-emerald-600">{row.edited.fullName}</span>
        </p>
        <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-700">
          <X className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by name, phone, or code…"
          autoFocus
          className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
      </div>

      {results && results.visible && results.visible.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
          {results.visible.slice(0, 10).map((member) => {
            const provenance = provenanceByMemberId[String(member.id)]
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => onSelect(member)}
                className={`text-left rounded-xl border p-3 transition-colors ${provenance ? 'border-emerald-300 border-l-4 bg-emerald-50/80 hover:border-emerald-500 dark:border-emerald-700 dark:bg-emerald-950/30' : 'border-gray-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-emerald-600'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-bold text-gray-900 dark:text-white truncate">{formatMemberName(member['Full Name'] || member.full_name)}</p>
                  {provenance && <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">New from import</span>}
                </div>
                {member['Phone Number'] && <p className="text-xs text-gray-500 truncate">📞 {member['Phone Number']}</p>}
                {provenance?.sourceSheet && <p className="mt-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">{provenance.sourceSheet}{provenance.sourceRow ? ` · Row ${provenance.sourceRow}` : ''}</p>}
                {member.member_code && <p className="text-xs text-gray-400">Code: {member.member_code}</p>}
              </button>
            )
          })}
        </div>
      ) : query.trim() ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">No matches found for "{query}"</p>
      ) : null}

      <button
        type="button"
        onClick={onCreateNew}
        className="inline-flex items-center gap-1.5 rounded-lg border-2 border-dashed border-emerald-300 bg-emerald-50/50 px-4 py-2 text-xs font-bold text-emerald-700 hover:border-emerald-500 dark:border-emerald-700 dark:bg-emerald-900/10 dark:text-emerald-300"
      >
        <UserPlus className="h-3.5 w-3.5" />
        Create as new member
      </button>
    </div>
  )
}
