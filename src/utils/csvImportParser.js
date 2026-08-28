// CSV Import Parser — parses raw CSV text into canonical import rows.
// Handles header mapping, name/phone/attendance normalization, sheet grouping,
// and stable row-ID generation.

// ─── Column header mapping ──────────────────────────────────────────────────
const HEADER_ALIASES = {
  sheet: ['sheet', 'sheet_name', 'sheetname', 'sheet name', 'page'],
  row_number: ['row_number', 'rownumber', 'row number', 'row', '#', 'no', 'number', 'sn', 's/n'],
  full_name: ['full_name', 'fullname', 'full name', 'name', 'member name', 'student name', 'child name'],
  phone_number: ['phone_number', 'phonenumber', 'phone number', 'phone', 'tel', 'telephone', 'mobile', 'contact'],
  age: ['age', 'years'],
  gender: ['gender', 'sex'],
  educational_level: ['educational_level', 'educationallevel', 'educational level', 'education', 'level', 'current level', 'class', 'grade', 'current_level'],
  parent_guardian_name: ['parent_guardian_name', 'parentguardianname', 'parent guardian name', 'parent name', 'guardian name', 'parent', 'guardian', 'parent_name_1', 'parent_name'],
  parent_guardian_phone: ['parent_guardian_phone', 'parentguardianphone', 'parent guardian phone', 'parent phone', 'guardian phone', 'parent_phone_1', 'parent_phone', 'guardian_phone'],
  member_code: ['member_code', 'membercode', 'member code', 'code', 'id code', 'badge'],
  notes: ['notes', 'note', 'remarks', 'comment', 'comments'],
  sunday_1: ['sunday_1', 'sunday1', 'sunday 1', 's1', 'sun1', 'sun 1', 'week1', 'week 1', 'wk1', 'wk 1', '1st sunday', '1st'],
  sunday_2: ['sunday_2', 'sunday2', 'sunday 2', 's2', 'sun2', 'sun 2', 'week2', 'week 2', 'wk2', 'wk 2', '2nd sunday', '2nd'],
  sunday_3: ['sunday_3', 'sunday3', 'sunday 3', 's3', 'sun3', 'sun 3', 'week3', 'week 3', 'wk3', 'wk 3', '3rd sunday', '3rd'],
  sunday_4: ['sunday_4', 'sunday4', 'sunday 4', 's4', 'sun4', 'sun 4', 'week4', 'week 4', 'wk4', 'wk 4', '4th sunday', '4th'],
  sunday_5: ['sunday_5', 'sunday5', 'sunday 5', 's5', 'sun5', 'sun 5', 'week5', 'week 5', 'wk5', 'wk 5', '5th sunday', '5th'],
}

export const CSV_IMPORT_MODE = {
  FULL_REGISTER: 'full_register',
  SUNDAY_NAMES: 'sunday_names',
}

const NAMES_ONLY_FIELDS = new Set(['sheet', 'row_number', 'full_name', 'phone_number', 'member_code', 'notes'])

const normalizeHeader = (raw) => String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const resolveHeaderField = (rawHeader) => {
  const normalized = normalizeHeader(rawHeader)
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return field
  }
  return null
}

// ─── Name normalization ─────────────────────────────────────────────────────
export const toTitleCase = (value) => {
  if (!value || typeof value !== 'string') return ''
  return value
    .trim()
    .toLowerCase()
    .replace(/(?:^|\s|[-'])\S/g, (char) => char.toUpperCase())
}

// ─── Attendance normalization ───────────────────────────────────────────────
const PRESENT_VALUES = new Set(['p', 'present', '1', 'yes', 'y', 'true', '✓', '✔', 'x'])
const ABSENT_VALUES = new Set(['a', 'absent', '0', 'no', 'n', 'false', '✗', '✘'])

export const normalizeAttendanceValue = (raw) => {
  if (raw === null || raw === undefined) return 'UNSPECIFIED'
  const trimmed = String(raw).trim()
  if (trimmed === '') return 'UNSPECIFIED'
  const lower = trimmed.toLowerCase()
  if (PRESENT_VALUES.has(lower)) return 'PRESENT'
  if (ABSENT_VALUES.has(lower)) return 'ABSENT'
  return 'UNKNOWN'
}

// ─── Phone normalization ────────────────────────────────────────────────────
export const normalizePhone = (value) => {
  if (value === undefined || value === null) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (!digits) return raw
  if (digits.startsWith('233') && digits.length >= 12) return `0${digits.slice(3)}`
  if (digits.startsWith('0')) return digits
  return digits.length >= 9 ? `0${digits}` : digits
}

// ─── CSV text parsing ───────────────────────────────────────────────────────
const parseCSVLine = (line) => {
  const fields = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields
}

export const detectCSVImportMode = (csvText) => {
  const lines = String(csvText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return { mode: null, confidence: 'none', reason: 'Empty input' }

  const firstFields = parseCSVLine(lines[0])
  const mapped = firstFields.map(resolveHeaderField).filter(Boolean)
  const hasHeader = mapped.includes('full_name')
  if (hasHeader) {
    const namesOnly = mapped.every((field) => NAMES_ONLY_FIELDS.has(field))
    return namesOnly
      ? { mode: CSV_IMPORT_MODE.SUNDAY_NAMES, confidence: 'high', reason: 'Only name-list columns were found' }
      : { mode: CSV_IMPORT_MODE.FULL_REGISTER, confidence: 'high', reason: 'Register or attendance columns were found' }
  }

  const looksLikePlainNames = lines.length >= 1 && lines.every((line) => {
    if (parseCSVLine(line).length !== 1) return false
    const words = line.split(/\s+/).filter(Boolean)
    return words.length >= 2 && words.every((word) => /[\p{L}'-]/u.test(word))
  })
  return looksLikePlainNames
    ? { mode: CSV_IMPORT_MODE.SUNDAY_NAMES, confidence: 'high', reason: 'One name was found on each line' }
    : { mode: null, confidence: 'ambiguous', reason: 'Choose a workflow before importing this input' }
}

// ─── Gender normalization ───────────────────────────────────────────────────
const normalizeGender = (raw) => {
  if (!raw) return ''
  const lower = String(raw).trim().toLowerCase()
  if (lower === 'm' || lower === 'male') return 'Male'
  if (lower === 'f' || lower === 'female') return 'Female'
  return String(raw).trim()
}

// ─── Sheet label formatting ─────────────────────────────────────────────────
export const formatSheetLabel = (sheetValue) => {
  if (!sheetValue) return 'Sheet 1'
  const trimmed = String(sheetValue).trim()
  if (/^\d+$/.test(trimmed)) return `Sheet ${trimmed}`
  return trimmed
}

// ─── Stable row ID generation ───────────────────────────────────────────────
const makeImportRowId = (sessionId, sheet, rowNumber) =>
  `${sessionId}__${String(sheet).replace(/\s+/g, '_')}__row${rowNumber}`

// ─── Main parser ────────────────────────────────────────────────────────────
/**
 * Parse CSV text into an array of canonical import rows.
 *
 * @param {string} csvText — Raw CSV string (UTF-8)
 * @param {string} sessionId — Unique import session identifier
 * @returns {{ rows: Array, errors: Array, headers: Array, sheets: Array }}
 */
export const parseCSVText = (csvText, sessionId, options = {}) => {
  if (!csvText || typeof csvText !== 'string') {
    return { rows: [], errors: [{ message: 'Empty or invalid CSV input' }], headers: [], sheets: [] }
  }

  const requestedMode = options.mode || CSV_IMPORT_MODE.FULL_REGISTER
  let lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const plainNames = requestedMode === CSV_IMPORT_MODE.SUNDAY_NAMES && !resolveHeaderField(parseCSVLine(lines.find((line) => line.trim()) || '')[0])
  if (plainNames) lines = ['full_name', ...lines]
  if (lines.filter((line) => line.trim()).length < 2) {
    return { rows: [], errors: [{ message: 'CSV must have at least a header row and one data row' }], headers: [], sheets: [] }
  }

  // Parse header row
  const rawHeaders = parseCSVLine(lines[0])
  const headerMap = {} // index -> canonical field name
  const unmappedHeaders = []

  rawHeaders.forEach((rawHeader, index) => {
    const field = resolveHeaderField(rawHeader)
    if (field) {
      headerMap[index] = field
    } else if (rawHeader.trim()) {
      unmappedHeaders.push(rawHeader.trim())
    }
  })

  const mappedFields = new Set(Object.values(headerMap))
  if (!mappedFields.has('full_name')) {
    return { rows: [], errors: [{ message: 'CSV must contain a "full_name" or "name" column' }], headers: rawHeaders, sheets: [] }
  }

  // Parse data rows
  const rows = []
  const errors = []
  const sheetCounters = {} // sheet -> running row counter
  const sheetsSet = new Set()

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim()
    if (!line) continue

    const fields = parseCSVLine(line)

    // Build raw object from header mapping
    const raw = {}
    Object.entries(headerMap).forEach(([index, field]) => {
      raw[field] = (fields[Number(index)] || '').trim()
    })

    // Skip rows with no meaningful name
    if (!raw.full_name || !raw.full_name.trim()) continue

    // Determine sheet
    const rawSheet = raw.sheet || '1'
    const sheetLabel = formatSheetLabel(rawSheet)
    sheetsSet.add(sheetLabel)

    // Determine row number
    if (!sheetCounters[sheetLabel]) sheetCounters[sheetLabel] = 0
    sheetCounters[sheetLabel] += 1
    const rowNumber = raw.row_number ? parseInt(raw.row_number, 10) || sheetCounters[sheetLabel] : sheetCounters[sheetLabel]

    const importRowId = makeImportRowId(sessionId, sheetLabel, rowNumber)

    // Normalize attendance values and flag unknowns
    const sundayFields = {}
    const attendanceFlags = {}
    for (let s = 1; s <= 5; s += 1) {
      const key = `sunday_${s}`
      const rawVal = raw[key] || ''
      const normalized = normalizeAttendanceValue(rawVal)
      sundayFields[key] = normalized
      if (normalized === 'UNKNOWN') {
        attendanceFlags[key] = { raw: rawVal, message: `Unknown attendance value: "${rawVal}"` }
      }
    }

    const importRow = {
      importRowId,
      mode: requestedMode,
      sheet: sheetLabel,
      rowNumber,

      raw: { ...raw },
      rawFullName: raw.full_name,

      edited: {
        fullName: toTitleCase(raw.full_name),
        phoneNumber: normalizePhone(raw.phone_number),
        age: raw.age ? String(raw.age).trim() : '',
        gender: normalizeGender(raw.gender),
        educationalLevel: raw.educational_level ? String(raw.educational_level).trim() : '',
        parentGuardianName: raw.parent_guardian_name ? toTitleCase(raw.parent_guardian_name) : '',
        parentGuardianPhone: normalizePhone(raw.parent_guardian_phone),
        memberCode: raw.member_code ? String(raw.member_code).trim().toUpperCase() : '',
        notes: raw.notes || '',
        sunday_1: sundayFields.sunday_1,
        sunday_2: sundayFields.sunday_2,
        sunday_3: sundayFields.sunday_3,
        sunday_4: sundayFields.sunday_4,
        sunday_5: sundayFields.sunday_5,
      },

      match: {
        status: 'pending', // pending | exact | possible | new | unmatched | invalid
        selectedMemberId: null,
        candidates: [],
        matchedMember: null,
      },

      fieldResolution: {
        fullName: 'csv',
        phoneNumber: 'csv',
        age: 'csv',
        gender: 'csv',
        educationalLevel: 'csv',
        parentGuardianName: 'csv',
        parentGuardianPhone: 'csv',
      },

      saveStatus: 'pending', // pending | saving | saved | failed | skipped
      saveError: null,
      // Notes are deterministic review flags. The note remains in `edited`
      // after verification so saved history retains the original audit text.
      attentionVerified: false,
      attendanceFlags,
      duplicateOfRowId: null,
      allowNamesOnlyCreate: false,
    }

    rows.push(importRow)
  }

  return {
    rows,
    errors,
    headers: rawHeaders,
    sheets: [...sheetsSet].sort(),
  }
}

/**
 * Read a File object and return the text content.
 */
export const readCSVFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = (event) => resolve(event.target.result)
  reader.onerror = () => reject(new Error('Failed to read file'))
  reader.readAsText(file, 'UTF-8')
})
