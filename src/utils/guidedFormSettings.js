export const GUIDED_FORM_SETTINGS_KEY = 'datserGuidedFormAssistantSettings'

const getGuidedFormSettingsKey = (scope) => (
  scope ? `${GUIDED_FORM_SETTINGS_KEY}:${scope}` : null
)

export const GUIDED_FORM_FIELD_ORDER = [
  'full-name',
  'gender',
  'phone',
  'dob',
  'age',
  'level',
  'tags',
  'attendance',
  'parent',
  'notes'
]

export const GUIDED_FORM_FIELD_LABELS = {
  'full-name': 'Full Name',
  gender: 'Gender',
  phone: 'Phone Number',
  dob: 'Date of Birth',
  age: 'Age',
  level: 'Current Level',
  tags: 'Tags',
  attendance: 'Sunday Attendance',
  parent: 'Parent/Guardian Info',
  notes: 'Notes'
}

export const DEFAULT_GUIDED_FORM_SETTINGS = {
  enabled: true,
  highlightNotes: false,
  highlightTags: false,
  autoFocusNextField: false,
  autoScrollToActiveField: true,
  showNextButton: false,
  pulseNextButton: true,
  manualNextAfterTyping: false,
  showInAddMember: true,
  showInEditMember: true,
  showInMissingInfo: true,
  attendanceAutoPresent: true,
  showVisitorField: false,
  showTagsField: false,
  showNotesField: false,
  guidedOrder: GUIDED_FORM_FIELD_ORDER
}

export const normalizeGuidedOrder = (order) => {
  const incoming = Array.isArray(order) ? order : []
  const known = new Set(GUIDED_FORM_FIELD_ORDER)
  const deduped = incoming.filter((id, index) => known.has(id) && incoming.indexOf(id) === index)
  return [
    ...deduped,
    ...GUIDED_FORM_FIELD_ORDER.filter(id => !deduped.includes(id))
  ]
}

export const sortGuidedSteps = (steps = [], settings = DEFAULT_GUIDED_FORM_SETTINGS) => {
  const order = normalizeGuidedOrder(settings?.guidedOrder)
  const orderIndex = new Map(order.map((id, index) => [id, index]))
  return steps
    .filter(Boolean)
    .map((step, index) => ({ step, index }))
    .sort((a, b) => {
      const aOrder = orderIndex.has(a.step.id) ? orderIndex.get(a.step.id) : Number.MAX_SAFE_INTEGER
      const bOrder = orderIndex.has(b.step.id) ? orderIndex.get(b.step.id) : Number.MAX_SAFE_INTEGER
      return aOrder === bOrder ? a.index - b.index : aOrder - bOrder
    })
    .map(({ step }) => step)
}

export const readGuidedFormSettings = (scope = null) => {
  if (typeof window === 'undefined') return DEFAULT_GUIDED_FORM_SETTINGS

  try {
    const storageKey = getGuidedFormSettingsKey(scope)
    const raw = storageKey ? window.localStorage.getItem(storageKey) : null
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      ...DEFAULT_GUIDED_FORM_SETTINGS,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      guidedOrder: normalizeGuidedOrder(parsed?.guidedOrder)
    }
  } catch {
    return DEFAULT_GUIDED_FORM_SETTINGS
  }
}

export const writeGuidedFormSettings = (settings, scope = null) => {
  if (typeof window === 'undefined' || !scope) return
  window.localStorage.setItem(getGuidedFormSettingsKey(scope), JSON.stringify(settings))
}
