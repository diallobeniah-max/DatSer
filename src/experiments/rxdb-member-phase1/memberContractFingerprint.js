const canonicalJson = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const sha256Hex = async (value) => {
  const bytes = new globalThis.TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const createMemberV2Fingerprint = ({
  operation,
  ownerId,
  tableName,
  memberId,
  baseServerRevision = null,
  payload,
}) => sha256Hex(canonicalJson({
  base_server_revision: baseServerRevision,
  member_id: memberId,
  operation,
  owner_id: ownerId,
  payload,
  table_name: tableName,
}))

export { canonicalJson }
