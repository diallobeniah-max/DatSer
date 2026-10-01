const RESERVED_FIELDS = new Set([
  'id', 'member_id', 'workspace_owner_id', 'user_id', 'member_code',
  'server_revision', 'created_at', 'updated_at', 'deleted_at',
  '__source_table', '__canonical_member_id',
])

const SUPPORTED_FIELDS = new Set([
  'Full Name', 'full_name', 'Name', 'name',
  'Phone Number', 'phone_number', 'phone',
  'Gender', 'gender', 'Age', 'age', 'Current Level', 'current_level',
  'date_of_birth', 'parent_name_1', 'parent_phone_1', 'parent_name_2',
  'parent_phone_2', 'notes', 'ministry', 'is_visitor', 'workspace',
  'Member', 'Regular', 'Newcomer', 'Manual Badge', 'Badge Type',
])

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)

export const validateMemberPayload = (payload, { requireName = false } = {}) => {
  if (!isObject(payload)) throw new Error('Member changes must be an object.')
  const normalized = {}
  for (const [key, value] of Object.entries(payload)) {
    if (RESERVED_FIELDS.has(key)) throw new Error(`Member field ${key} is server-controlled.`)
    if (!SUPPORTED_FIELDS.has(key)) throw new Error(`Member field ${key} is not supported by Member V2.`)
    if (value === undefined) continue
    normalized[key] = typeof value === 'string' ? value.trim() : value
  }
  if (!Object.keys(normalized).length) throw new Error('At least one supported member field is required.')
  const name = normalized['Full Name'] ?? normalized.full_name ?? normalized.Name ?? normalized.name
  if (requireName && !String(name || '').trim()) throw new Error('Member full name is required.')
  return normalized
}

export const mergeMemberPayload = (base, updates) => ({ ...base, ...updates })

export const editableMemberPayload = (payload) => Object.fromEntries(
  Object.entries(payload || {}).filter(([key]) => SUPPORTED_FIELDS.has(key))
)

const semanticAliases = [
  [['full_name', 'name', 'Name', 'Full Name'], 'Full Name'],
  [['phone_number', 'phone', 'Phone Number'], 'Phone Number'],
  [['gender', 'Gender'], 'Gender'],
  [['age', 'Age'], 'Age'],
  [['current_level', 'Current Level'], 'Current Level'],
]

// The server fingerprints its normalized month-table payload. The current
// DatSer month shape uses these display columns; a future table profile can
// override a target field without changing the durable mutation format.
export const toServerMemberPayload = (payload, fieldMap = {}) => {
  const result = { ...payload }
  for (const [aliases, defaultTarget] of semanticAliases) {
    const target = fieldMap[defaultTarget] || defaultTarget
    const present = aliases.filter((key) => Object.hasOwn(result, key))
    if (!present.length) continue
    const value = result[present[0]]
    if (present.some((key) => JSON.stringify(result[key]) !== JSON.stringify(value))) {
      throw new Error(`Conflicting aliases supplied for ${target}.`)
    }
    for (const key of present) delete result[key]
    result[target] = value
  }
  return result
}
