import { describe, expect, it } from 'vitest'
import { formatMemberName, MEMBER_NAME_STYLES } from './memberNameStyle'

describe('formatMemberName', () => {
  it('formats lower, title and upper without changing the canonical value', () => {
    const canonical = 'JOHN EDEM ADAE'
    expect(formatMemberName(canonical, MEMBER_NAME_STYLES.LOWER)).toBe('john edem adae')
    expect(formatMemberName(canonical, MEMBER_NAME_STYLES.TITLE)).toBe('John Edem Adae')
    expect(formatMemberName('John Edem Adae', MEMBER_NAME_STYLES.UPPER)).toBe('JOHN EDEM ADAE')
    expect(canonical).toBe('JOHN EDEM ADAE')
  })
  it('keeps hyphens and apostrophes readable in title style', () => {
    expect(formatMemberName('nana-ama mensah')).toBe('Nana-Ama Mensah')
    expect(formatMemberName("o'brien kwame")).toBe("O'Brien Kwame")
  })
  it('is safe for blank values and defaults invalid styles to title', () => {
    expect(formatMemberName(null)).toBe('')
    expect(formatMemberName('   ')).toBe('')
    expect(formatMemberName('john edem adae', 'unknown')).toBe('John Edem Adae')
  })
})
