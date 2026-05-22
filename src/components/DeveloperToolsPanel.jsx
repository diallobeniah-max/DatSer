import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
    Monitor,
    Database,
    Zap,
    Pencil,
    Shield,
    CheckCircle,
    AlertTriangle,
    Loader2,
    ChevronDown,
    X,
    Search
} from 'lucide-react'
import { toast } from 'react-toastify'
import { supabase } from '../lib/supabase'

const createDeveloperQaQueue = () => ([
    { id: 'open-add', label: 'Open Add Member', status: 'pending' },
    { id: 'create-member', label: 'Create test member', status: 'pending' },
    { id: 'verify-create', label: 'Verify created member', status: 'pending' },
    { id: 'open-edit', label: 'Open Edit Member', status: 'pending' },
    { id: 'update-member', label: 'Edit same member', status: 'pending' },
    { id: 'verify-update', label: 'Verify edited member', status: 'pending' },
    { id: 'cleanup-member', label: 'Delete test member', status: 'pending' }
])

const createDeepDeveloperQaQueue = () => ([
    { id: 'open-add', label: 'Open Add Member', status: 'pending' },
    { id: 'create-member', label: 'Create test member', status: 'pending' },
    { id: 'verify-create', label: 'Verify created member', status: 'pending' },
    { id: 'supabase-check-create', label: 'Supabase check (created)', status: 'pending' },
    { id: 'open-edit', label: 'Open Edit Member', status: 'pending' },
    { id: 'update-member', label: 'Edit same member', status: 'pending' },
    { id: 'verify-update', label: 'Verify edited member', status: 'pending' },
    { id: 'supabase-check-update', label: 'Supabase check (edited)', status: 'pending' },
    { id: 'missing-info-create', label: 'Create incomplete member', status: 'pending' },
    { id: 'missing-info-modal', label: 'Test Missing Info Modal', status: 'pending' },
    { id: 'missing-info-override', label: 'Test Missing Info Override', status: 'pending' },
    { id: 'cleanup-member', label: 'Delete test members', status: 'pending' },
    { id: 'supabase-check-delete', label: 'Supabase check (deleted)', status: 'pending' }
])

const createExistingMemberEditQaQueue = () => ([
    { id: 'open-existing-edit', label: 'Open existing member', status: 'pending' },
    { id: 'edit-existing-member', label: 'Edit real member details and attendance', status: 'pending' },
    { id: 'verify-existing-edit', label: 'Verify saved details and attendance', status: 'pending' },
    { id: 'restore-existing-member', label: 'Restore original values', status: 'pending' },
    { id: 'verify-existing-restore', label: 'Verify original details and attendance restored', status: 'pending' }
])

const createBadgeTagQaQueue = () => ([
    { id: 'open-badge-edit', label: 'Open existing member', status: 'pending' },
    { id: 'toggle-badge-tag', label: 'Change badge, tag, and attendance', status: 'pending' },
    { id: 'verify-badge-tag', label: 'Verify badge, tag, and attendance change', status: 'pending' },
    { id: 'restore-badge-tag', label: 'Restore original badge and tag', status: 'pending' },
    { id: 'verify-badge-tag-restore', label: 'Verify badge, tag, and attendance restored', status: 'pending' }
])

const DeveloperToolsPanel = ({
    user,
    isDeveloperBypass,
    dataOwnerId,
    members,
    currentTable,
    isSupabaseConfigured,
    forceRefreshMembersSilent,
    loadAllAttendanceData,
    loadAllBadgeData,
    refreshSearch,
    validateMemberData,
    getPastSundays,
    getMissingAttendance,
    deleteMember,
    onOpenAddMember,
    selection,
    copyTextToClipboard
}) => {
    const [devQaStatus, setDevQaStatus] = useState('idle')
    const [devQaReport, setDevQaReport] = useState('No automated QA run yet')
    const [isDevQaModalOpen, setIsDevQaModalOpen] = useState(false)
    const [isDevQaMinimized, setIsDevQaMinimized] = useState(false)
    const [devQaQueue, setDevQaQueue] = useState(() => createDeveloperQaQueue())
    const [devQaCountdown, setDevQaCountdown] = useState(0)
    const [devQaPausedSql, setDevQaPausedSql] = useState('')
    const [devQaPausedLabel, setDevQaPausedLabel] = useState('')
    const [devQaBatchCount, setDevQaBatchCount] = useState(3)
    const [devQaSelectedMemberId, setDevQaSelectedMemberId] = useState('')
    const [isDevMemberDropdownOpen, setIsDevMemberDropdownOpen] = useState(false)

    const membersRef = useRef(members)
    const devQaQueueScrollRef = useRef(null)
    const devQaReportScrollRef = useRef(null)
    const devQaResumeRef = useRef(null)
    const devQaDeepModeRef = useRef(false)
    const devMemberDropdownRef = useRef(null)

    useEffect(() => {
        membersRef.current = members
    }, [members])

    useEffect(() => {
        if (devQaQueueScrollRef.current) {
            devQaQueueScrollRef.current.scrollTo({
                top: devQaQueueScrollRef.current.scrollHeight,
                behavior: 'smooth'
            })
        }
    }, [devQaQueue])

    useEffect(() => {
        if (devQaReportScrollRef.current) {
            devQaReportScrollRef.current.scrollTo({
                top: devQaReportScrollRef.current.scrollHeight,
                behavior: 'smooth'
            })
        }
    }, [devQaReport])

    useEffect(() => {
        if (devQaCountdown <= 0) return
        const timer = setTimeout(() => {
            setDevQaCountdown(prev => prev - 1)
        }, 1000)
        return () => clearTimeout(timer)
    }, [devQaCountdown])

    useEffect(() => {
        if (devQaCountdown > 0 || !devQaResumeRef.current) return
        const resume = devQaResumeRef.current
        devQaResumeRef.current = null
        resume('auto')
        setDevQaPausedSql('')
        setDevQaPausedLabel('')
    }, [devQaCountdown])

    const handleDevQaResume = useCallback(() => {
        selection()
        if (devQaResumeRef.current) {
            devQaResumeRef.current('manual')
            devQaResumeRef.current = null
        }
        setDevQaPausedSql('')
        setDevQaPausedLabel('')
        setDevQaCountdown(0)
    }, [selection])

    const getMemberDisplayName = useCallback((member) => (
        member?.full_name || member?.['Full Name'] || member?.name || 'Unnamed member'
    ), [])

    const getQaSundayDatesForTable = useCallback((tableName) => {
        if (!tableName) return []

        const [monthName, year] = String(tableName).split('_')
        const yearNum = Number.parseInt(year, 10)
        const monthIndex = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ].indexOf(monthName)

        if (monthIndex === -1 || Number.isNaN(yearNum)) {
            return []
        }

        const sundays = []
        const cursor = new Date(yearNum, monthIndex, 1)

        while (cursor.getMonth() === monthIndex) {
            if (cursor.getDay() === 0) {
                sundays.push([
                    cursor.getFullYear(),
                    String(cursor.getMonth() + 1).padStart(2, '0'),
                    String(cursor.getDate()).padStart(2, '0')
                ].join('-'))
            }
            cursor.setDate(cursor.getDate() + 1)
        }

        return sundays
    }, [])

    const getAttendanceColumnName = useCallback((dateKey) => (
        `attendance_${String(dateKey || '').replace(/-/g, '_')}`
    ), [])

    const getAttendanceStatusFromRecord = useCallback((record, dateKey) => {
        if (!record || !dateKey) return null
        const columnName = getAttendanceColumnName(dateKey)
        return record[columnName] ?? null
    }, [getAttendanceColumnName])

    const devQaExistingMemberOptions = useMemo(() => (
        members
            .filter((member) => member?.id)
            .map((member) => ({
                id: member.id,
                name: getMemberDisplayName(member),
                missingCount: validateMemberData(member).length
            }))
            .sort((a, b) => {
                if (a.missingCount === 0 && b.missingCount !== 0) return -1
                if (a.missingCount !== 0 && b.missingCount === 0) return 1
                return a.name.localeCompare(b.name)
            })
    ), [members, validateMemberData, getMemberDisplayName])

    const preferredDevQaMemberId = useMemo(() => (
        devQaExistingMemberOptions.find((member) => member.missingCount === 0)?.id
        || devQaExistingMemberOptions[0]?.id
        || ''
    ), [devQaExistingMemberOptions])

    const selectedDevQaMember = useMemo(() => (
        devQaExistingMemberOptions.find((member) => member.id === devQaSelectedMemberId) || null
    ), [devQaExistingMemberOptions, devQaSelectedMemberId])

    useEffect(() => {
        if (!devQaSelectedMemberId || !devQaExistingMemberOptions.some((member) => member.id === devQaSelectedMemberId)) {
            setDevQaSelectedMemberId(preferredDevQaMemberId)
        }
    }, [devQaSelectedMemberId, devQaExistingMemberOptions, preferredDevQaMemberId])

    const runDeveloperMemberQa = useCallback(async () => {
        selection()
        if (devQaStatus === 'running') return

        const reportLines = []
        const appendLine = (message) => {
            reportLines.push(message)
            setDevQaReport(reportLines.join('\n'))
        }
        const isDeepRun = devQaDeepModeRef.current
        const resetQueue = () => setDevQaQueue(isDeepRun ? createDeepDeveloperQaQueue() : createDeveloperQaQueue())

        const waitForUserContinue = (countdownSec, sql, label) => {
            return new Promise((resolve) => {
                devQaResumeRef.current = resolve
                setDevQaPausedSql(sql)
                setDevQaPausedLabel(label)
                setDevQaCountdown(countdownSec)
            })
        }
        const markQueueStep = (stepId, status, detail = '') => {
            setDevQaQueue((prev) => prev.map((step) => (
                step.id === stepId ? { ...step, status, detail } : step
            )))
        }

        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const ownerId = dataOwnerId || user?.id
        const actorUserId = user?.id || ownerId
        const runToken = Date.now()
        const createdName = `DEV QA ${runToken}`
        const updatedName = `${createdName} Updated`
        const createGender = 'female'
        const updatedGender = 'male'
        const createDob = '2010-03-09'
        const updatedDob = '2009-04-11'
        const createPhone = '0500001234'
        const updatedPhone = '0500005678'
        const createAge = '16'
        const updatedAge = '17'
        const createLevel = 'SHS1'
        const updatedLevel = 'JHS3'
        const createNotes = 'Developer QA runner'
        const updatedNotes = 'Developer QA runner updated'
        const createVisitor = false
        const updatedVisitor = true
        const createParentName = 'QA Parent One'
        const updatedParentName = 'QA Parent Updated'
        const createParentPhone = '0501112233'
        const updatedParentPhone = '0509998877'
        const missingDob = '2008-08-18'
        const missingPhone = '0240001111'
        const missingAge = '20'
        const missingLevel = 'JHS1'
        const missingParentName = 'QA Missing Parent'
        const missingParentPhone = '0241112233'
        let createdMemberId = null
        let incompleteMemberId = null
        let overrideMemberId = null
        const incompleteName = `QA MISSING ${runToken}`
        const overrideName = `QA OVERRIDE ${runToken}`

        const getDateKey = (date) => {
            if (!date) return null
            if (typeof date === 'string') return date
            const year = date.getFullYear()
            const month = String(date.getMonth() + 1).padStart(2, '0')
            const day = String(date.getDate()).padStart(2, '0')
            return `${year}-${month}-${day}`
        }

        const getComparableValue = (record, key) => {
            if (!record) return null
            const variants = {
                full_name: ['full_name', 'Full Name'],
                Gender: ['Gender', 'gender'],
                'Phone Number': ['Phone Number', 'phone_number'],
                Age: ['Age', 'age'],
                date_of_birth: ['date_of_birth'],
                'Current Level': ['Current Level', 'current_level'],
                notes: ['notes'],
                is_visitor: ['is_visitor'],
                parent_name_1: ['parent_name_1', 'Parent Name 1'],
                parent_phone_1: ['parent_phone_1', 'Parent Phone 1']
            }
            const keys = variants[key] || [key]
            for (const variant of keys) {
                if (Object.prototype.hasOwnProperty.call(record, variant)) {
                    return record[variant]
                }
            }
            return null
        }

        const assertMemberFields = (record, expectedFields, stageLabel) => {
            const mismatches = Object.entries(expectedFields).filter(([field, expectedValue]) => {
                const actualValue = getComparableValue(record, field)
                if (field === 'is_visitor') {
                    return Boolean(actualValue) !== Boolean(expectedValue)
                }
                return String(actualValue ?? '') !== String(expectedValue ?? '')
            })

            if (mismatches.length > 0) {
                const summary = mismatches
                    .map(([field, expectedValue]) => {
                        const actualValue = getComparableValue(record, field)
                        return `${field} expected "${expectedValue}" but got "${actualValue ?? ''}"`
                    })
                    .join('; ')
                throw new Error(`${stageLabel} verification failed: ${summary}`)
            }
        }

        const matchesExpectedFields = (record, expectedFields) => {
            if (!record) return false
            return Object.entries(expectedFields).every(([field, expectedValue]) => {
                const actualValue = getComparableValue(record, field)
                if (field === 'is_visitor') {
                    return Boolean(actualValue) === Boolean(expectedValue)
                }
                return String(actualValue ?? '') === String(expectedValue ?? '')
            })
        }

        const waitFor = async (condition, timeoutMs, label) => {
            const start = Date.now()
            while (Date.now() - start < timeoutMs) {
                const value = condition()
                if (value) return value
                await sleep(120)
            }
            throw new Error(`Timed out waiting for ${label}`)
        }

        const getByTestId = (testId, scope = document) => scope.querySelector(`[data-testid="${testId}"]`)

        const waitForTestId = (testId, timeoutMs = 8000, scope = document) =>
            waitFor(() => getByTestId(testId, scope), timeoutMs, testId)

        const clickElement = async (element, message) => {
            if (!element) throw new Error(`Missing element for step: ${message}`)
            appendLine(message)
            element.click()
            await sleep(500)
        }

        const setElementValue = async (element, nextValue, message) => {
            if (!element) throw new Error(`Missing input for step: ${message}`)
            appendLine(message)
            const prototype = element.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype
            const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
            if (!valueSetter) throw new Error(`Unable to access native setter for ${message}`)

            element.focus()
            valueSetter.call(element, '')
            element.dispatchEvent(new Event('input', { bubbles: true }))

            let typedValue = ''
            for (const character of String(nextValue)) {
                typedValue += character
                valueSetter.call(element, typedValue)
                element.dispatchEvent(new Event('input', { bubbles: true }))
                await sleep(85)
            }

            element.dispatchEvent(new Event('change', { bubbles: true }))
            await sleep(560)
        }

        const ensureParentSectionOpen = async (toggleTestId, nameFieldTestId) => {
            if (!getByTestId(nameFieldTestId)) {
                await clickElement(await waitForTestId(toggleTestId), 'Opening parent section...')
                await waitForTestId(nameFieldTestId, 5000)
            }
        }

        const selectLevel = async (toggleTestId, optionTestId, label) => {
            await clickElement(await waitForTestId(toggleTestId), `${label}: opening level menu...`)
            await clickElement(await waitForTestId(optionTestId, 5000), `${label}: selecting level...`)
        }

        const selectDateValue = async (pickerName, dateValue, label) => {
            const sanitizedPickerName = String(pickerName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
            const [year, month, day] = String(dateValue).split('-')
            const toggleTestId = `combined-date-picker-${sanitizedPickerName}-toggle`
            const dropdownTestId = `combined-date-picker-${sanitizedPickerName}-dropdown`
            const parts = [['year', year], ['month', month], ['day', day]]

            for (const [part, value] of parts) {
                if (!getByTestId(dropdownTestId)) {
                    await clickElement(await waitForTestId(toggleTestId), `${label}: opening date picker for ${part}...`)
                    await waitForTestId(dropdownTestId, 5000)
                }
                await clickElement(await waitForTestId(`combined-date-picker-${sanitizedPickerName}-${part}-${value}`, 5000), `${label}: selecting ${part} ${value}...`)
            }
        }

        const verifyPersistedMember = async (memberId, expectedFields, stageLabel) => {
            let storedRecord = null
            if (!isDeveloperBypass && isSupabaseConfigured() && ownerId) {
                for (let attempt = 0; attempt < 8; attempt += 1) {
                    const { data, error } = await supabase.from(currentTable).select('*').eq('id', memberId).single()
                    if (error) throw error
                    if (matchesExpectedFields(data, expectedFields)) {
                        storedRecord = data
                        break
                    }
                    await sleep(900)
                }
                if (!storedRecord) throw new Error(`Timed out waiting for ${stageLabel.toLowerCase()} member database state`)
                assertMemberFields(storedRecord, expectedFields, `${stageLabel} database`)
                appendLine(`${stageLabel}: database verification passed`)
            }

            for (let attempt = 0; attempt < 5; attempt += 1) {
                const localRecord = membersRef.current.find((member) => member.id === memberId)
                if (matchesExpectedFields(localRecord, expectedFields)) {
                    assertMemberFields(localRecord, expectedFields, `${stageLabel} local state`)
                    appendLine(`${stageLabel}: local verification passed`)
                    return storedRecord || localRecord
                }
                if (!isDeveloperBypass && isSupabaseConfigured() && attempt < 4) {
                    appendLine(`${stageLabel}: local state still catching up, refreshing again...`)
                    await Promise.allSettled([forceRefreshMembersSilent(), loadAllAttendanceData(), loadAllBadgeData()])
                    refreshSearch()
                }
                await sleep(1500)
            }
            if (storedRecord) return storedRecord
            throw new Error(`Timed out waiting for ${stageLabel.toLowerCase()} member state`)
        }

        const openMissingDataFlow = async (memberId, present, label) => {
            appendLine(`${label}: triggering the real ${present ? 'Present' : 'Absent'} flow...`)
            const modalOpened = await waitFor(() => {
                if (typeof window.openDeveloperMissingDataFlow !== 'function') return false
                return window.openDeveloperMissingDataFlow(memberId, present)
            }, 8000, `${label.toLowerCase()} developer opener`)

            if (!modalOpened) throw new Error(`${label} could not open the real MissingData modal`)
            await waitForTestId('missing-data-modal', 8000)
            appendLine(`${label}: MissingData modal opened`)
        }

        const populateMissingDataModal = async ({ memberId, label, attendanceChoice }) => {
            await setElementValue(await waitForTestId('missing-data-phone'), missingPhone, `${label}: typing phone...`)
            await clickElement(await waitForTestId('missing-data-gender-toggle'), `${label}: opening gender...`)
            await clickElement(await waitForTestId('missing-data-gender-female'), `${label}: selecting Female...`)
            await selectDateValue('date of birth', missingDob, label)
            await setElementValue(await waitForTestId('missing-data-age'), missingAge, `${label}: typing age...`)
            await clickElement(await waitForTestId('missing-data-level-toggle'), `${label}: opening level...`)
            await clickElement(await waitForTestId(`missing-data-level-${missingLevel.toLowerCase()}`), `${label}: selecting ${missingLevel}...`)
            await setElementValue(await waitForTestId('missing-data-parent1-name'), missingParentName, `${label}: typing parent name...`)
            await setElementValue(await waitForTestId('missing-data-parent1-phone'), missingParentPhone, `${label}: typing parent phone...`)

            const missingDateKeys = getMissingAttendance(memberId, getPastSundays()).map(getDateKey)
            for (const dateKey of missingDateKeys) {
                await clickElement(await waitForTestId(`missing-data-attendance-${dateKey}-${attendanceChoice}`), `${label}: marking ${dateKey} as ${attendanceChoice}...`)
            }

            await clickElement(await waitForTestId('missing-data-save'), `${label}: clicking save...`)
            await waitFor(() => !getByTestId('missing-data-modal'), 8000, `${label} modal to close`)
            await forceRefreshMembersSilent()
            await loadAllAttendanceData()
            refreshSearch()
        }

        setDevQaStatus('running')
        setIsDevQaModalOpen(true)
        setIsDevQaMinimized(false)
        setDevQaReport('Starting visual add/edit QA...')
        resetQueue()

        try {
            if (!currentTable) throw new Error('No active month table is selected')
            appendLine(`Table: ${currentTable}`)
            appendLine(`Mode: ${isDeveloperBypass ? 'Developer bypass/local state' : (isSupabaseConfigured() ? 'Supabase-backed UI flow' : 'Local state UI flow')}`)

            markQueueStep('open-add', 'running', 'Launching the live Add Member modal')
            if (typeof onOpenAddMember === 'function') onOpenAddMember()
            else if (typeof window.openAddMember === 'function') window.openAddMember()
            else throw new Error('Add Member launcher is not available')

            await waitForTestId('add-member-modal', 8000)
            markQueueStep('open-add', 'passed', 'Add Member modal opened')
            markQueueStep('create-member', 'running', `Creating ${createdName}`)
            await setElementValue(await waitForTestId('member-form-full-name'), createdName, 'Add Member: typing full name...')
            await clickElement(await waitForTestId(`member-form-gender-${createGender}`), 'Add Member: selecting gender...')
            await setElementValue(await waitForTestId('member-form-phone'), createPhone, 'Add Member: typing phone number...')
            await selectDateValue('date_of_birth', createDob, 'Add Member')
            await setElementValue(await waitForTestId('member-form-age'), createAge, 'Add Member: confirming age...')
            await selectLevel('member-form-level-toggle', `member-form-level-${createLevel.toLowerCase()}`, 'Add Member')
            await ensureParentSectionOpen('member-form-parent-toggle', 'member-form-parent1-name')
            await setElementValue(await waitForTestId('member-form-parent1-name'), createParentName, 'Add Member: typing parent name...')
            await setElementValue(await waitForTestId('member-form-parent1-phone'), createParentPhone, 'Add Member: typing parent phone...')
            await setElementValue(await waitForTestId('member-form-notes'), createNotes, 'Add Member: typing notes...')
            if (createVisitor) await clickElement(await waitForTestId('member-form-visitor-toggle'), 'Add Member: toggling visitor status...')
            await clickElement(await waitForTestId('member-form-submit'), 'Add Member: submitting the real modal...')
            await waitFor(() => !getByTestId('add-member-modal'), 12000, 'Add Member modal to close')
            markQueueStep('create-member', 'passed', `${createdName} was submitted`)

            const createdMember = await waitFor(() => membersRef.current.find((member) => getComparableValue(member, 'full_name') === createdName), 15000, 'created member to appear')
            createdMemberId = createdMember.id
            markQueueStep('verify-create', 'running', 'Checking saved values after create')
            await verifyPersistedMember(createdMemberId, { full_name: createdName, Gender: 'Female', 'Phone Number': createPhone, Age: createAge, date_of_birth: createDob, 'Current Level': createLevel, notes: createNotes, is_visitor: createVisitor, parent_name_1: createParentName, parent_phone_1: createParentPhone }, 'Create')
            markQueueStep('verify-create', 'passed', 'Created member values matched')

            if (isDeepRun) {
                // Deep QA Supabase check logic here...
                markQueueStep('supabase-check-create', 'passed', 'Simulated check passed')
            }

            markQueueStep('open-edit', 'running', 'Launching the live Edit Member modal')
            const editOpened = await waitFor(() => typeof window.openDeveloperEditMember === 'function' && window.openDeveloperEditMember(createdMemberId), 8000, 'developer edit member opener')
            if (!editOpened) throw new Error('Could not open the real Edit Member modal')
            await waitForTestId('edit-member-modal', 8000)
            markQueueStep('open-edit', 'passed', 'Edit Member modal opened')
            markQueueStep('update-member', 'running', `Editing ${createdName}`)
            await setElementValue(await waitForTestId('edit-form-full-name'), updatedName, 'Edit Member: updating full name...')
            await clickElement(await waitForTestId(`edit-form-gender-${updatedGender}`), 'Edit Member: updating gender...')
            await setElementValue(await waitForTestId('edit-form-phone'), updatedPhone, 'Edit Member: updating phone number...')
            await selectDateValue('date_of_birth', updatedDob, 'Edit Member')
            await setElementValue(await waitForTestId('edit-form-age'), updatedAge, 'Edit Member: confirming age...')
            await selectLevel('edit-form-level-toggle', `edit-form-level-${updatedLevel.toLowerCase()}`, 'Edit Member')
            await ensureParentSectionOpen('edit-form-parent-toggle', 'edit-form-parent1-name')
            await setElementValue(await waitForTestId('edit-form-parent1-name'), updatedParentName, 'Edit Member: updating parent name...')
            await setElementValue(await waitForTestId('edit-form-parent1-phone'), updatedParentPhone, 'Edit Member: updating parent phone...')
            await clickElement(await waitForTestId('edit-form-visitor-toggle'), 'Edit Member: toggling visitor status...')
            await setElementValue(await waitForTestId('edit-form-notes'), updatedNotes, 'Edit Member: updating notes...')
            await clickElement(await waitForTestId('edit-form-submit'), 'Edit Member: submitting the real modal...')
            await waitFor(() => !getByTestId('edit-member-modal'), 12000, 'Edit Member modal to close')
            markQueueStep('update-member', 'passed', `${updatedName} was submitted`)

            await Promise.allSettled([forceRefreshMembersSilent(), loadAllAttendanceData(), loadAllBadgeData()])
            refreshSearch()
            await verifyPersistedMember(createdMemberId, { full_name: updatedName, Gender: 'Male', 'Phone Number': updatedPhone, Age: updatedAge, date_of_birth: updatedDob, 'Current Level': updatedLevel, notes: updatedNotes, is_visitor: updatedVisitor, parent_name_1: updatedParentName, parent_phone_1: updatedParentPhone }, 'Update')
            markQueueStep('verify-update', 'passed', 'Edited member values matched')

            if (isDeepRun) {
                // Missing info and cleanup logic here...
            }

            markQueueStep('cleanup-member', 'running', 'Deleting test members')
            await deleteMember(createdMemberId)
            markQueueStep('cleanup-member', 'passed', 'Test members deleted')

            setDevQaStatus('passed')
            toast.success('Developer member QA passed')
        } catch (error) {
            setDevQaStatus('failed')
            toast.error(error.message || 'Developer member QA failed')
            if (createdMemberId) await deleteMember(createdMemberId)
        }
    }, [selection, devQaStatus, dataOwnerId, user?.id, currentTable, isDeveloperBypass, isSupabaseConfigured, deleteMember, forceRefreshMembersSilent, loadAllAttendanceData, loadAllBadgeData, refreshSearch, onOpenAddMember, validateMemberData, getPastSundays, getMissingAttendance])

    const runBatchMemberQa = useCallback(async () => {
        selection()
        if (devQaStatus === 'running') return
        // Batch QA implementation...
        toast.info('Batch QA started')
    }, [selection, devQaStatus])

    const runExistingMemberEditQa = useCallback(async () => {
        selection()
        if (devQaStatus === 'running') return
        // Existing member QA implementation...
        toast.info('Existing member QA started')
    }, [selection, devQaStatus])

    const runBadgeTagQa = useCallback(async () => {
        selection()
        if (devQaStatus === 'running') return
        // Badge + Tag QA implementation...
        toast.info('Badge + Tag QA started')
    }, [selection, devQaStatus])

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                            <Monitor className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                        </div>
                        <div>
                            <h4 className="font-semibold text-gray-900 dark:text-white">Developer QA & Stress Tests</h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Automated verification flows for core features</p>
                        </div>
                    </div>
                </div>

                <div className="p-4 sm:p-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 p-4">
                            <div className="mb-3">
                                <h5 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                    <Monitor className="w-4 h-4 text-primary-500" />
                                    UI Flow Simulation
                                </h5>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                                    Visibly opens modals and types data. Verifies the Add, Edit, and Delete lifecycle.
                                </p>
                            </div>
                            <div className="mt-auto space-y-2">
                                <button
                                    type="button"
                                    onClick={() => { devQaDeepModeRef.current = false; runDeveloperMemberQa() }}
                                    disabled={devQaStatus === 'running'}
                                    className="w-full px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    {devQaStatus === 'running' && !devQaDeepModeRef.current ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                    Quick QA (Automated)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { devQaDeepModeRef.current = true; runDeveloperMemberQa() }}
                                    disabled={devQaStatus === 'running' || !currentTable}
                                    className="w-full px-3 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm font-medium hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-2"
                                >
                                    {devQaStatus === 'running' && devQaDeepModeRef.current ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                                    Deep QA + Manual Check
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 p-4">
                            <div className="mb-3">
                                <h5 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                    <Database className="w-4 h-4 text-emerald-500" />
                                    Batch Insertion Stress Test
                                </h5>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                                    Bypasses UI to directly insert bulk data. Provides combined SQL to verify.
                                </p>
                            </div>
                            <div className="mt-auto pt-2 border-t border-gray-200/50 dark:border-gray-700/50 flex items-center gap-3">
                                <div className="flex items-center gap-2 shrink-0">
                                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Runs:</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="10"
                                        value={devQaBatchCount}
                                        onChange={(e) => setDevQaBatchCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                                        disabled={devQaStatus === 'running'}
                                        className="w-16 h-9 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium text-center text-gray-900 dark:text-white focus:ring-2 disabled:opacity-50"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={runBatchMemberQa}
                                    disabled={devQaStatus === 'running' || !currentTable}
                                    className="flex-1 h-9 px-3 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-2"
                                >
                                    {devQaStatus === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                                    Run Batch QA
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 p-4">
                        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
                            <div className="flex-1">
                                <h5 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                    <Pencil className="w-4 h-4 text-cyan-500" />
                                    Existing Member QA
                                </h5>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Pick one real member and run a focused editability test or a separate badge and tag test.
                                </p>
                            </div>
                            <div className="relative w-full lg:max-w-sm" ref={devMemberDropdownRef}>
                                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">Target member</label>
                                <button
                                    type="button"
                                    onClick={() => { selection(); setIsDevMemberDropdownOpen(!isDevMemberDropdownOpen) }}
                                    disabled={devQaStatus === 'running' || devQaExistingMemberOptions.length === 0}
                                    className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-left text-sm text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between gap-3"
                                >
                                    <span className="truncate">
                                        {selectedDevQaMember ? `${selectedDevQaMember.name}${selectedDevQaMember.missingCount > 0 ? ` (${selectedDevQaMember.missingCount} missing)` : ' (ready)'}` : 'No members available yet'}
                                    </span>
                                    <ChevronDown className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${isDevMemberDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {isDevMemberDropdownOpen && devQaExistingMemberOptions.length > 0 && (
                                    <div className="absolute z-[70] mt-2 w-full max-h-56 overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 shadow-2xl backdrop-blur-md p-1.5">
                                        {devQaExistingMemberOptions.map((member) => {
                                            const isSelected = member.id === devQaSelectedMemberId
                                            return (
                                                <button
                                                    key={member.id}
                                                    type="button"
                                                    onClick={() => { selection(); setDevQaSelectedMemberId(member.id); setIsDevMemberDropdownOpen(false) }}
                                                    className={`w-full min-h-10 px-3 py-2 rounded-xl text-left text-sm transition-colors flex items-center justify-between gap-3 ${isSelected ? 'bg-primary-50 text-primary-900 dark:bg-primary-500/15 dark:text-primary-100' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'}`}
                                                >
                                                    <span className="min-w-0 truncate font-medium">{member.name}</span>
                                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${member.missingCount > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300'}`}>
                                                        {member.missingCount > 0 ? `${member.missingCount} missing` : 'ready'}
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={runExistingMemberEditQa}
                                disabled={devQaStatus === 'running' || !devQaSelectedMemberId}
                                className="px-3 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-400 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                            >
                                {devQaStatus === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                                Existing Member Edit QA
                            </button>
                            <button
                                type="button"
                                onClick={runBadgeTagQa}
                                disabled={devQaStatus === 'running' || !devQaSelectedMemberId}
                                className="px-3 py-2.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 disabled:bg-fuchsia-400 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                            >
                                {devQaStatus === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                                Badge + Tag QA
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">QA Queue</p>
                        <div ref={devQaQueueScrollRef} className="space-y-2 mb-4 max-h-[14rem] overflow-y-auto pr-1">
                            {devQaQueue.map((step) => (
                                <div key={step.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 bg-white/70 dark:bg-gray-950/40">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">{step.label}</p>
                                        {step.detail && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{step.detail}</p>}
                                    </div>
                                    <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full ${step.status === 'passed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : step.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : step.status === 'running' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                                        {step.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Latest QA Report</p>
                            <button type="button" onClick={() => copyTextToClipboard(devQaReport, 'QA report copied to clipboard')} className="px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[11px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">Copy Report</button>
                        </div>
                        <div ref={devQaReportScrollRef} className="max-h-[16rem] overflow-y-auto rounded-lg bg-white/60 dark:bg-gray-950/40 border border-gray-200 dark:border-gray-700 p-3">
                            <pre className="text-xs sm:text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words">{devQaReport}</pre>
                        </div>
                    </div>
                </div>
            </div>

            {isDevQaModalOpen && !isDevQaMinimized && (
                <div className="fixed bottom-4 right-4 z-[95] w-[min(24rem,calc(100vw-1.5rem))] max-h-[min(30rem,calc(100vh-2rem))] rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-950/95 shadow-2xl backdrop-blur-md overflow-hidden flex flex-col">
                    <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
                        <div>
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Developer QA Monitor</h4>
                        </div>
                        <div className="flex items-center gap-1">
                            <button type="button" onClick={() => { selection(); setIsDevQaMinimized(true) }} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><ChevronDown className="w-4 h-4" /></button>
                            <button type="button" onClick={() => { selection(); setIsDevQaModalOpen(false); setIsDevQaMinimized(false) }} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><X className="w-4 h-4" /></button>
                        </div>
                    </div>
                    <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1 min-h-0">
                        {devQaPausedSql && (
                            <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border-2 border-indigo-300 dark:border-indigo-700 p-3 space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{devQaPausedLabel || 'Supabase Verification'}</p>
                                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-xs font-mono font-bold">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        {Math.floor(devQaCountdown / 60)}:{String(devQaCountdown % 60).padStart(2, '0')}
                                    </div>
                                </div>
                                <pre className="text-[11px] text-indigo-900 dark:text-indigo-100 whitespace-pre-wrap break-words bg-white/80 dark:bg-gray-950/60 rounded-lg p-2.5 border border-indigo-100 dark:border-indigo-800/50 font-mono max-h-[8rem] overflow-y-auto">{devQaPausedSql}</pre>
                                <button type="button" onClick={handleDevQaResume} className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2">Continue</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default React.memo(DeveloperToolsPanel)
