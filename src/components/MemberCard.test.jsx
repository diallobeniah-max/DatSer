// @vitest-environment jsdom
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

  it('shows an ellipsis placeholder only while a code is still loading', () => {
    renderMemberCard({ memberIndexCode: '', isMemberCodeLoading: true })

    expect(screen.getByLabelText('Member code loading')).toBeTruthy()
  })

  it('replaces the loading placeholder with the confirmed code once loaded', () => {
    renderMemberCard({ memberIndexCode: 'A17', isMemberCodeLoading: false })

    expect(screen.queryByLabelText('Member code loading')).toBeNull()
    expect(screen.getByRole('button', { name: /code A17/i })).toBeTruthy()
  })

  it('renders its own code for each member shown', () => {
    const { rerender } = renderMemberCard({ memberIndexCode: 'A01', isMemberCodeLoading: false })
    expect(screen.getByRole('button', { name: /code A01/i })).toBeTruthy()

    rerender(
      <MemberCard
        member={{
          id: 'member-2',
          full_name: 'Second Member',
          created_at: '2026-01-10T00:00:00.000Z'
        }}
        memberIndexCode="B04"
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
        isMemberCodeLoading={false}
      />
    )
    expect(screen.queryByRole('button', { name: /code A01/i })).toBeNull()
    expect(screen.getByRole('button', { name: /code B04/i })).toBeTruthy()
  })
})
