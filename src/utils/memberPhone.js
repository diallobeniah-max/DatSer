export const NO_PHONE_SENTINEL = '0000000000'

// Legacy month tables store phone values as BIGINT, so PostgreSQL returns the
// all-zero sentinel as numeric 0. Restore the existing form sentinel when a
// server-backed Member V2 record is projected into the UI.
export const normalizeMemberPhoneForUi = (value) => (
  typeof value === 'number' && value === 0 ? NO_PHONE_SENTINEL : value
)

export const normalizeEditablePhoneNumber = (value) => {
  const normalizedValue = normalizeMemberPhoneForUi(value)
  const digits = String(normalizedValue ?? '').replace(/\D/g, '')
  return digits.length === 9 ? `0${digits}` : digits
}
