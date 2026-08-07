// Automatic historical-search fallback: decide, given a settled current-month
// search, whether the historical search should run automatically (once). This is
// a pure decision so the guard is unit-testable without rendering the dashboard.

// A (table, term) pair is the unit of dedup: the same pair must never fire a
// second automatic historical request while the search state is unchanged.
export const getAutoHistoricalSearchKey = (tableName, term) =>
  `${tableName || ''}:${String(term || '').trim()}`

// Returns true only when ALL of these hold:
//   - a non-empty search term of at least 2 characters,
//   - the current-month search has settled (not loading),
//   - no historical search is already running,
//   - the mobile short-search tray is not the active display,
//   - there are ZERO visible active current-month matches,
//   - this (table, term) has not already triggered a request.
export const shouldAutoSearchHistorical = ({
  query,
  loading = false,
  isSearchingOtherMonths = false,
  isShortSearchDisplayActive = false,
  visibleCount = 0,
  alreadyFired = false
}) => {
  const term = String(query || '').trim()
  if (!term || term.length < 2) return false
  if (loading || isSearchingOtherMonths || isShortSearchDisplayActive) return false
  if ((Number(visibleCount) || 0) > 0) return false
  if (alreadyFired) return false
  return true
}
