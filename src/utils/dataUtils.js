/**
 * Normalizes ministry data which might be in various legacy formats.
 * Handles:
 * - JSON string arrays: "[\"Choir\"]"
 * - Arrays with JSON strings: ["\"Choir\"", "Ushers"]
 * - Comma separated strings: "Choir, Ushers"
 * - Double encoded strings: "\"Choir\""
 * - Mixed content
 */
export const normalizeMinistry = (input) => {
  if (!input) return []

  const cleanString = (str) => {
    if (typeof str !== 'string') return [String(str)]
    
    let current = str.trim()
    
    // Try to parse as JSON first if it looks like it
    if ((current.startsWith('[') && current.endsWith(']')) || 
        (current.startsWith('"') && current.endsWith('"'))) {
      try {
        const parsed = JSON.parse(current)
        if (Array.isArray(parsed)) {
          return parsed.flatMap(item => cleanString(item))
        }
        // If parsed to a string, recurse on that string
        return cleanString(parsed)
      } catch (e) {
        // Fall through to manual cleanup if parse fails
      }
    }

    // Handle comma-separated lists (only if not bracketed, which would have been caught above or failed)
    if (current.includes(',') && !current.startsWith('[')) {
      return current.split(',').flatMap(item => cleanString(item))
    }

    // Manual cleanup: remove residual brackets, quotes, backslashes
    // Keep stripping until clean
    let prev = ''
    while (prev !== current) {
      prev = current
      // Remove starting/ending quotes, brackets, escapes
      current = current.replace(/^["'\[\\]+|["'\]\\]+$/g, '').trim()
    }

    return [current]
  }

  let items = Array.isArray(input) ? input : [input]
  let result = []

  items.forEach(item => {
    const cleaned = cleanString(item)
    result.push(...cleaned)
  })

  // Deduplicate and filter empty/invalid
  return [...new Set(result.filter(x => 
    x && 
    typeof x === 'string' && 
    x.trim().length > 0 && 
    x !== 'null' && 
    x !== 'undefined' &&
    !x.includes('[') && // Filter out anything that still looks like an array
    !x.includes(']') &&
    !x.includes('"')    // Filter out anything that still has quotes inside (e.g. broken JSON)
  ))]
}
