// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CsvPossibleMatchResolver from './CsvPossibleMatchResolver'

const candidates = [
  { id: 'one', 'Full Name': 'Enoch Norkplim', 'Phone Number': '0240000001', member_code: 'DS-001' },
  { id: 'two', 'Full Name': 'Enoch Norkplim Two', 'Phone Number': '0240000002' },
  { id: 'three', 'Full Name': 'Enoch Norkplim Three', 'Phone Number': '0000000000' },
  { id: 'four', 'Full Name': 'Enoch Norkplim Four', 'Phone Number': '0240000004' },
]

const setup = (props = {}) => {
  const onSelect = vi.fn()
  const onCreateNew = vi.fn()
  render(<CsvPossibleMatchResolver candidates={candidates} onSelect={onSelect} onCreateNew={onCreateNew} {...props} />)
  return { onSelect, onCreateNew }
}

afterEach(cleanup)

describe('CsvPossibleMatchResolver', () => {
  it('keeps the supplied candidate order and shows the first three by default', () => {
    setup()
    expect(screen.getByRole('button', { name: /select enoch norkplim, 0240000001/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /select enoch norkplim three/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /select enoch norkplim four/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'More matches (1)' })).toBeTruthy()
  })

  it('shows every choice directly when there are one, two, or three candidates', () => {
    for (const count of [1, 2, 3]) {
      const { unmount } = render(<CsvPossibleMatchResolver candidates={candidates.slice(0, count)} onSelect={vi.fn()} onCreateNew={vi.fn()} />)
      expect(screen.getAllByRole('button', { name: /^select /i })).toHaveLength(count)
      expect(screen.queryByRole('button', { name: /more matches/i })).toBeNull()
      unmount()
    }
  })

  it('reveals remaining candidates only when requested', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'More matches (1)' }))
    expect(screen.getByRole('button', { name: /select enoch norkplim four, 0240000004/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show fewer matches' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('selects only after an explicit candidate click and supports keyboard activation', () => {
    const { onSelect } = setup()
    const candidate = screen.getByRole('button', { name: /select enoch norkplim, 0240000001/i })
    fireEvent.keyDown(candidate, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(candidate)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(candidates[0])
  })

  it('only creates a member after the explicit create-new action', () => {
    const { onCreateNew } = setup()
    expect(onCreateNew).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create as new member' }))
    expect(onCreateNew).toHaveBeenCalledTimes(1)
  })

  it('uses a compact responsive row and replaces the placeholder phone with No phone', () => {
    setup()
    const candidate = screen.getByRole('button', { name: /select enoch norkplim three/i })
    expect(candidate.className).toContain('min-h-11')
    expect(screen.getByLabelText('Possible DatSer matches').querySelector('.md\\:grid-cols-3')).toBeTruthy()
    expect(screen.getByText('No phone')).toBeTruthy()
  })

  it('makes a supplied selected candidate obvious', () => {
    setup({ selectedMemberId: 'two' })
    expect(screen.getByRole('button', { name: /select enoch norkplim two/i }).getAttribute('aria-pressed')).toBe('true')
  })
})
