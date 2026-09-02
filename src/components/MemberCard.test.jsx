// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('marks only a supplied recent CSV-import member with the green provenance badge', () => {
    renderMemberCard({ csvImportProvenance: { sourceSheet: 'Sheet 4', sourceRow: 7 } })
    expect(screen.getByText('New from import')).toBeTruthy()
    expect(screen.getByText('Sheet 4 · Row 7')).toBeTruthy()
  })

  it('preserves same-name safety: existing same-name member has no badge while new member displays provenance', () => {
    const existing = renderMemberCard({
      member: { id: 'existing-1', full_name: 'Enoch Norkplim', 'Phone Number': '0240000001' },
      csvImportProvenance: null,
    })
    expect(screen.getByText('Enoch Norkplim')).toBeTruthy()
    expect(screen.queryByText('New from import')).toBeNull()
    existing.unmount()

    renderMemberCard({
      member: { id: 'new-created-1', full_name: 'Enoch Norkplim', 'Phone Number': '0240000002' },
      csvImportProvenance: { sourceSheet: 'Sheet 2', sourceRow: 14 },
    })
    expect(screen.getByText('Enoch Norkplim')).toBeTruthy()
    expect(screen.getByText('New from import')).toBeTruthy()
    expect(screen.getByText('Sheet 2 · Row 14')).toBeTruthy()
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

  it('sends top and per-Sunday attendance choices to their matching handlers', () => {
    const onAttendance = vi.fn()
    const onAttendanceForDate = vi.fn()
    const sunday = '2026-08-16'

    renderMemberCard({
      isExpanded: true,
      onAttendance,
      onAttendanceForDate,
      monthSundays: [sunday],
      attendanceData: { [sunday]: { 'member-1': true } },
      attendanceStatus: true,
      attendanceLoading: true,
      attendanceLoadingByDate: { [`member-1_${sunday}`]: true },
    })

    // The currently-saving Present control is intentionally protected, but
    // the operator can immediately correct it to Absent or Clear.
    expect(screen.getByTestId('member-card-attendance-member-1-present')).toHaveProperty('disabled', true)
    const topAbsent = screen.getByTestId('member-card-attendance-member-1-absent')
    expect(topAbsent).toHaveProperty('disabled', false)
    fireEvent.click(topAbsent)
    expect(onAttendance).toHaveBeenCalledWith('member-1', false)

    const perSundayClear = screen.getByTestId(`member-card-attendance-member-1-${sunday}-clear`)
    expect(perSundayClear).toHaveProperty('disabled', false)
    fireEvent.click(perSundayClear)
    expect(onAttendanceForDate).toHaveBeenCalledWith('member-1', null, sunday)
  })
})
