import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MemberCard from './MemberCard'

const renderMemberCard = (props = {}) => render(
  <MemberCard
    member={{
      id: 'member-1',
      full_name: 'PreCOMPLETEDious Ewoenam Tetteh Tsikata With A Very Long Name',
      created_at: '2026-01-10T00:00:00.000Z',
      Gender: 'Female',
      'Phone Number': '0551234567',
      Age: '22',
      'Current Level': '300'
    }}
    memberIndexCode="P01"
    isExpanded={false}
    isSelected={false}
    selectionMode={false}
    onToggleExpansion={vi.fn()}
    onToggleSelection={vi.fn()}
    onLongPressStart={vi.fn()}
    onLongPressMove={vi.fn()}
    onLongPressEnd={vi.fn()}
    onMouseDown={vi.fn()}
    onMouseUp={vi.fn()}
    onAttendance={vi.fn()}
    onAttendanceForDate={vi.fn()}
    onEdit={vi.fn()}
    onDelete={vi.fn()}
    attendanceStatus={undefined}
    attendanceLoading={false}
    monthSundays={[]}
    attendanceData={{}}
    currentTable="January_2026"
    getMonthDisplayName={(tableName) => tableName.replace('_', ' ')}
    onIndexClick={vi.fn()}
    {...props}
  />
)

describe('MemberCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the member index code as its own card control', () => {
    renderMemberCard()

    expect(screen.getByRole('button', { name: /code P01/i })).toBeTruthy()
  })
})
