import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AttendanceChoice from './AttendanceChoice'

afterEach(cleanup)

describe('AttendanceChoice', () => {
  it('renders the member-card variant as two actions with no trailing Clear action', () => {
    render(<AttendanceChoice value={null} onChange={() => {}} showClear={false} variant="member-card" />)

    const group = screen.getByRole('group')
    expect(group.getAttribute('data-columns')).toBe('2')
    expect(group.getAttribute('data-variant')).toBe('member-card')
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('renders editable attendance as three equal choices and reports selection immediately', () => {
    const onChange = vi.fn()
    render(<AttendanceChoice value={null} onChange={onChange} />)

    expect(screen.getByRole('group').getAttribute('data-columns')).toBe('3')
    expect(screen.getAllByRole('button')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
