// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PaperScanReview from './PaperScanReview'

const mocks = vi.hoisted(() => ({
  applyEnhancement: vi.fn(),
  canvasToDataUrl: vi.fn(),
  fitSheetForUpload: vi.fn(),
  loadImageElement: vi.fn(),
  readFileAsDataUrl: vi.fn(),
  validateImageDimensions: vi.fn(),
  validateImageFile: vi.fn(),
  getQrCameraConstraintCandidates: vi.fn(),
  getSession: vi.fn(),
  extractSheetWithGemini: vi.fn(),
  fromTable: vi.fn(),
  rpc: vi.fn(),
  updateMember: vi.fn(),
  refreshSyncedDataInBackground: vi.fn(),
  loadAllAttendanceData: vi.fn(),
  storageFrom: vi.fn(),
  storageUpload: vi.fn(),
  storageList: vi.fn(),
  storageRemove: vi.fn(),
  storageCreateSignedUrl: vi.fn(),
  operation: null,
  appContext: {
    dataOwnerId: 'owner-workspace-id',
    currentTable: 'June_2026',
    monthlyTables: [],
    updateMember: null,
    refreshSyncedDataInBackground: null,
    loadAllAttendanceData: null
  }
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    from: mocks.fromTable,
    rpc: mocks.rpc,
    storage: { from: mocks.storageFrom }
  }
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-user-id', email: 'owner@test.dev' }, isAuthenticated: true })
}))

vi.mock('../context/AppContext', () => ({
  useApp: () => ({
    dataOwnerId: mocks.appContext.dataOwnerId,
    currentTable: mocks.appContext.currentTable,
    monthlyTables: mocks.appContext.monthlyTables,
    updateMember: mocks.appContext.updateMember || mocks.updateMember,
    refreshSyncedDataInBackground: mocks.appContext.refreshSyncedDataInBackground || mocks.refreshSyncedDataInBackground,
    loadAllAttendanceData: mocks.appContext.loadAllAttendanceData || mocks.loadAllAttendanceData
  })
}))

vi.mock('../services/paperScanExtraction', () => ({
  extractSheetWithGemini: mocks.extractSheetWithGemini
}))

vi.mock('../utils/paperScanImage', () => ({
  ENHANCEMENT_PRESETS: [
    { id: 'original', label: 'Original' },
    { id: 'grayscale', label: 'Grayscale' },
    { id: 'high-contrast', label: 'High Contrast' },
    { id: 'darken-handwriting', label: 'Darken Handwriting' },
    { id: 'sharpen', label: 'Sharpen' }
  ],
  PRESET_DEFAULT_INTENSITY: {
    original: null,
    grayscale: 100,
    'high-contrast': 75,
    'darken-handwriting': 75,
    sharpen: 50
  },
  applyEnhancement: mocks.applyEnhancement,
  canvasToDataUrl: mocks.canvasToDataUrl,
  fitSheetForUpload: mocks.fitSheetForUpload,
  loadImageElement: mocks.loadImageElement,
  readFileAsDataUrl: mocks.readFileAsDataUrl,
  validateImageDimensions: mocks.validateImageDimensions,
  validateImageFile: mocks.validateImageFile
}))

vi.mock('../utils/qrCheckIn', () => ({
  getQrCameraConstraintCandidates: mocks.getQrCameraConstraintCandidates
}))

const FAKE_DATA_URL = 'data:image/jpeg;base64,c2hlZXQ='
const FAKE_ENHANCED = 'data:image/jpeg;base64,ZW5oYW5jZWQ='

const selectSheetByLabel = (sheetNumber) => screen.getByRole('button', { name: new RegExp(`sheet ${sheetNumber}:`) })

const selectPreset = (label) => screen.getByRole('button', { name: new RegExp(label) })

const uploadSheet = async (name) => {
  const file = new File(['fake-image-bytes'], name, { type: 'image/jpeg' })
  const input = screen.getByLabelText('Upload an image')
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(mocks.readFileAsDataUrl).toHaveBeenCalled())
}

describe('PaperScanReview', () => {
  beforeEach(() => {
    mocks.validateImageFile.mockReturnValue({ ok: true })
    mocks.validateImageDimensions.mockReturnValue({ ok: true, pixels: 10000 })
    mocks.readFileAsDataUrl.mockResolvedValue(FAKE_DATA_URL)
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 100, naturalHeight: 100 })
    mocks.applyEnhancement.mockReturnValue({})
    mocks.canvasToDataUrl.mockReturnValue(FAKE_ENHANCED)
    mocks.fitSheetForUpload.mockReturnValue(FAKE_ENHANCED)
    mocks.getQrCameraConstraintCandidates.mockReturnValue([])
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } } })
    mocks.extractSheetWithGemini.mockResolvedValue({ sheet: { detected_headers: [], attendance_dates: [] }, rows: [], warnings: [] })
    mocks.fromTable.mockReturnValue({ select: () => ({ then: (resolve) => Promise.resolve(resolve({ data: [], error: null })) }) })
    mocks.operation = null
    mocks.rpc.mockImplementation((name, args) => {
      if (name === 'paper_scan_begin_save_operation') {
        const steps = (args?.p_plan?.rows || []).flatMap((row, index) => {
          const memberId = row.member_action === 'create-new' ? `server-member-${index}` : row.member_id
          const create = row.member_action === 'create-new' ? [{ id: `create-${index}`, step_key: `${index + 1}:member:2026-06-01`, kind: 'member-create', member_id: memberId, state: 'pending' }] : []
          const profile = Object.keys(row.profile_updates || {}).length ? [{ id: `profile-${index}`, step_key: `${index + 1}:profile`, kind: 'profile', member_id: memberId, profile_payload: row.profile_updates, state: 'pending' }] : []
          const attendance = (row.attendance || []).map((item, itemIndex) => ({ id: `attendance-${index}-${itemIndex}`, step_key: `${index + 1}:attendance:${item.date}`, kind: 'attendance', member_id: memberId, state: 'pending' }))
          return [...create, ...profile, ...attendance]
        })
        mocks.operation = { operation_id: args.p_operation_id, status: 'pending', immutable_plan: args.p_plan, steps }
        return Promise.resolve({ data: mocks.operation, error: null })
      }
      if (name === 'paper_scan_execute_save_step') {
        const step = mocks.operation?.steps.find((entry) => entry.id === args.p_step_id)
        if (step) step.state = 'succeeded'
        if (mocks.operation) mocks.operation.status = 'complete'
        return Promise.resolve({ data: { success: true, step_id: args.p_step_id, affected: 1 }, error: null })
      }
      if (name === 'paper_scan_get_save_operation') return Promise.resolve({ data: mocks.operation, error: null })
      return Promise.resolve({ data: { success: true }, error: null })
    })
    mocks.updateMember.mockResolvedValue({ id: 'm1' })
    mocks.refreshSyncedDataInBackground.mockResolvedValue()
    mocks.loadAllAttendanceData.mockResolvedValue()
    mocks.appContext.monthlyTables = []
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('describes extraction privacy accurately instead of claiming the photo never leaves the device', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /take a photo/i }))
    expect(screen.getByText(/stays on this device until you run extraction/i)).toBeTruthy()
    expect(screen.queryByText(/never leaves this device/i)).toBeNull()
  })

  it('starts with no sheets and a disabled Continue button', () => {
    render(<PaperScanReview onBack={() => {}} />)
    expect(screen.getByRole('button', { name: /continue/i }).disabled).toBe(true)
    expect(screen.queryByLabelText('Select sheet 1')).toBeNull()
  })

  it('adds multiple sheets and shows a thumbnail per sheet', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    await uploadSheet('sheet-b.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (2)')).toBeTruthy())

    expect(selectSheetByLabel(1)).toBeTruthy()
    expect(selectSheetByLabel(2)).toBeTruthy()
    expect(screen.getByRole('button', { name: /continue/i }).disabled).toBe(false)
  })

  it('keeps enhancement settings per sheet when switching active sheet', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    await uploadSheet('sheet-b.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (2)')).toBeTruthy())

    fireEvent.click(selectPreset('Grayscale'))
    await waitFor(() => expect(mocks.applyEnhancement).toHaveBeenLastCalledWith(
      expect.anything(),
      'grayscale',
      expect.objectContaining({ intensity: 100 })
    ))

    fireEvent.click(selectSheetByLabel(1))
    await waitFor(() => {
      expect(selectPreset('Original').getAttribute('aria-pressed')).toBe('true')
    })

    fireEvent.click(selectPreset('Sharpen'))
    await waitFor(() => expect(mocks.applyEnhancement).toHaveBeenLastCalledWith(
      expect.anything(),
      'sharpen',
      expect.objectContaining({ intensity: 50 })
    ))

    fireEvent.click(selectSheetByLabel(2))
    await waitFor(() => {
      expect(selectPreset('Grayscale').getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('shows an intensity slider for non-original presets and updates the preview live', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    expect(screen.queryByLabelText('Enhancement intensity')).toBeNull()

    fireEvent.click(selectPreset('High Contrast'))
    await waitFor(() => expect(screen.getByLabelText('Enhancement intensity')).toBeTruthy())

    mocks.applyEnhancement.mockClear()
    const slider = screen.getByLabelText('Enhancement intensity')
    fireEvent.change(slider, { target: { value: '30' } })
    await waitFor(() => expect(mocks.applyEnhancement).toHaveBeenCalledWith(
      expect.anything(),
      'high-contrast',
      expect.objectContaining({ intensity: 30 })
    ))
    expect(screen.getByText('30%')).toBeTruthy()
  })

  it('does not show an intensity slider for the original preset', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    fireEvent.click(selectPreset('Original'))
    expect(screen.queryByLabelText('Enhancement intensity')).toBeNull()
  })

  it('removes a sheet and the batch count updates', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    await uploadSheet('sheet-b.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (2)')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Remove sheet 2' }))
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Remove sheet 2' })).toBeNull()
  })

  it('Continue transitions into a processing view that stops at Ready for AI connection', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText(/Processing sheets/)).toBeTruthy()
    expect(screen.getByText('1 sheet in this batch')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByText('Ready for AI extraction')).toBeTruthy()
    expect(screen.getByText(/Extract will send these to the DatSer server/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to editing' })).toBeTruthy()
  })

  it('adds three sheets when three valid files are selected together', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    const input = screen.getByLabelText('Upload an image')
    expect(input.multiple).toBe(true)
    const files = [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
      new File(['c'], 'c.jpg', { type: 'image/png' })
    ]
    fireEvent.change(input, { target: { files } })
    await waitFor(() => expect(screen.getByText('Sheets (3)')).toBeTruthy())
    expect(selectSheetByLabel(1)).toBeTruthy()
    expect(selectSheetByLabel(2)).toBeTruthy()
    expect(selectSheetByLabel(3)).toBeTruthy()
    expect(mocks.readFileAsDataUrl).toHaveBeenCalledTimes(3)
  })

  it('keeps existing sheets when new files are added', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('first.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    const input = screen.getByLabelText('Upload an image')
    fireEvent.change(input, {
      target: { files: [
        new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
        new File(['c'], 'c.jpg', { type: 'image/png' })
      ] }
    })
    await waitFor(() => expect(screen.getByText('Sheets (3)')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Remove sheet 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove sheet 3' })).toBeTruthy()
  })

  it('gracefully handles a mix of valid and invalid files', async () => {
    mocks.validateImageFile.mockImplementation((file) => {
      if (file.type === 'text/plain') return { ok: false, reason: 'Please choose an image file.' }
      return { ok: true }
    })
    render(<PaperScanReview onBack={() => {}} />)
    const input = screen.getByLabelText('Upload an image')
    fireEvent.change(input, {
      target: { files: [
        new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
        new File(['x'], 'notes.txt', { type: 'text/plain' }),
        new File(['b'], 'b.jpg', { type: 'image/jpeg' })
      ] }
    })
    await waitFor(() => expect(screen.getByText('Sheets (2)')).toBeTruthy())
    expect(screen.getByText(/1 file was skipped/i)).toBeTruthy()
  })

  it('coalesces rapid slider changes to the latest requested intensity', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    fireEvent.click(selectPreset('High Contrast'))
    await waitFor(() => expect(screen.getByLabelText('Enhancement intensity')).toBeTruthy())

    vi.useFakeTimers()
    mocks.applyEnhancement.mockClear()
    const slider = screen.getByLabelText('Enhancement intensity')
    fireEvent.change(slider, { target: { value: '20' } })
    fireEvent.change(slider, { target: { value: '60' } })
    fireEvent.change(slider, { target: { value: '85' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(mocks.applyEnhancement).toHaveBeenCalledTimes(1)
    expect(mocks.applyEnhancement).toHaveBeenLastCalledWith(
      expect.anything(),
      'high-contrast',
      expect.objectContaining({ intensity: 85 })
    )
    expect(screen.getByText('85%')).toBeTruthy()
  })

  it('cancels pending preview work when switching sheets', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    await uploadSheet('sheet-b.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (2)')).toBeTruthy())
    fireEvent.click(selectPreset('Sharpen'))
    await waitFor(() => expect(screen.getByLabelText('Enhancement intensity')).toBeTruthy())

    vi.useFakeTimers()
    mocks.applyEnhancement.mockClear()
    const slider = screen.getByLabelText('Enhancement intensity')
    fireEvent.change(slider, { target: { value: '40' } })
    fireEvent.click(selectSheetByLabel(1))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(mocks.applyEnhancement).not.toHaveBeenCalled()
  })

  it('cleans up pending preview work on unmount', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    fireEvent.click(selectPreset('Grayscale'))
    await waitFor(() => expect(screen.getByLabelText('Enhancement intensity')).toBeTruthy())

    vi.useFakeTimers()
    mocks.applyEnhancement.mockClear()
    const slider = screen.getByLabelText('Enhancement intensity')
    fireEvent.change(slider, { target: { value: '50' } })
    cleanup()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(mocks.applyEnhancement).not.toHaveBeenCalled()
  })

  it('sends the session token and active workspace id when extracting', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByRole('button', { name: 'Extract with Gemini' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract with Gemini' }))
    })
    const call = mocks.extractSheetWithGemini.mock.calls[0][0]
    expect(call).toEqual(expect.objectContaining({
      workspaceId: 'owner-workspace-id',
      bearerToken: 'test-token'
    }))
    expect(call).toHaveProperty('requestId')
    expect(call.requestId).toMatch(/^extract-/)
    expect(call.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses a distinct request id per sheet within one cancellable run', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    await uploadSheet('sheet-b.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (2)')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract with Gemini' }))
    })
    expect(mocks.extractSheetWithGemini).toHaveBeenCalledTimes(2)
    const first = mocks.extractSheetWithGemini.mock.calls[0][0]
    const second = mocks.extractSheetWithGemini.mock.calls[1][0]
    expect(second.requestId).not.toBe(first.requestId)
    expect(second.requestId).toMatch(/^extract-/)
    // One run shares one AbortController, so a single Cancel aborts every sheet.
    expect(second.signal).toBe(first.signal)
  })

  it('aborts the in-flight request when extraction is cancelled', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    let resolveSecond
    const deferred = new Promise((resolve) => { resolveSecond = resolve })
    mocks.extractSheetWithGemini.mockImplementationOnce(() => deferred)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract with Gemini' }))
    })
    const { signal } = mocks.extractSheetWithGemini.mock.calls[0][0]
    expect(signal.aborted).toBe(false)
    expect(screen.getByRole('button', { name: /cancel extraction/i })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel extraction/i }))
    })
    expect(signal.aborted).toBe(true)
    // Let the (now stale) extraction promise settle; it must not reopen review.
    await act(async () => {
      resolveSecond({ sheet: { detected_headers: [], attendance_dates: [] }, rows: [{ full_name: 'Late row' }], warnings: [] })
    })
    expect(screen.queryByText('Late row')).toBeNull()
    // Cancelled run returns to editing, never to review.
    expect(screen.getByText('Sheets (1)')).toBeTruthy()
  })

  it('ignores a stale response whose request was superseded', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    let resolveFirst
    mocks.extractSheetWithGemini.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract with Gemini' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel extraction/i }))
    })
    // The cancelled request resolves late; the component must not advance to review.
    await act(async () => {
      resolveFirst({ sheet: { detected_headers: [], attendance_dates: [] }, rows: [{ full_name: 'Late row' }], warnings: [] })
    })
    expect(screen.queryByText('Late row')).toBeNull()
  })

  it('starts a fresh request with a new signal when the user retries a sheet', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    mocks.extractSheetWithGemini.mockRejectedValueOnce(new Error('boom'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract with Gemini' }))
    })
    expect(screen.getByText(/extraction failed/i)).toBeTruthy()

    mocks.extractSheetWithGemini.mockResolvedValue({ sheet: { detected_headers: [], attendance_dates: [] }, rows: [], warnings: [] })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /retry this sheet/i }))
    })
    const retryCall = mocks.extractSheetWithGemini.mock.calls[1][0]
    expect(retryCall.requestId).toMatch(/^extract-/)
    expect(retryCall.signal).toBeInstanceOf(AbortSignal)
    expect(retryCall.requestId).not.toBe(mocks.extractSheetWithGemini.mock.calls[0][0].requestId)
    expect(screen.getByText('Review extracted data')).toBeTruthy()
  })

  it('issues exactly one retry request when the retry button is double-clicked', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    mocks.extractSheetWithGemini.mockRejectedValueOnce(new Error('boom'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract with Gemini' }))
    })
    expect(screen.getByText(/extraction failed/i)).toBeTruthy()

    let resolveRetry
    const deferred = new Promise((resolve) => { resolveRetry = resolve })
    mocks.extractSheetWithGemini.mockImplementationOnce(() => deferred)
    const retryButton = screen.getByRole('button', { name: /retry this sheet/i })
    // Two back-to-back clicks in the same tick, before any re-render swaps the
    // button out. The in-flight ref guard must swallow the second click.
    await act(async () => {
      fireEvent.click(retryButton)
      fireEvent.click(retryButton)
    })
    expect(mocks.extractSheetWithGemini).toHaveBeenCalledTimes(2)
    const retryCall = mocks.extractSheetWithGemini.mock.calls[1][0]
    expect(retryCall.requestId).toMatch(/^extract-/)

    await act(async () => {
      resolveRetry({ sheet: { detected_headers: [], attendance_dates: [] }, rows: [], warnings: [] })
    })
    expect(screen.getByText('Review extracted data')).toBeTruthy()
  })

  it('surfaces a friendly message when a sheet cannot fit the upload limit and never calls Gemini', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    mocks.fitSheetForUpload.mockReturnValue(null)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract with Gemini' }))
    })
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
    expect(screen.getByText('That image is too large to upload. Try a smaller or clearer photo.')).toBeTruthy()
  })

  it('blocks extraction when no session token is available', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract with Gemini' }))
    })
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
    expect(screen.getByText(/sign-in session expired/i)).toBeTruthy()
  })
})

describe('PaperScanReview camera handling', () => {
  const openCamera = () => {
    render(<PaperScanReview onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /take a photo/i }))
  }

  afterEach(() => {
    cleanup()
    delete window.navigator.mediaDevices
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('tries every camera candidate and reaches the generic video fallback', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('candidate 1 failed'), { name: 'OverconstrainedError' }))
      .mockRejectedValueOnce(Object.assign(new Error('candidate 2 failed'), { name: 'OverconstrainedError' }))
      .mockRejectedValueOnce(Object.assign(new Error('candidate 3 failed'), { name: 'OverconstrainedError' }))
      .mockResolvedValueOnce({ getVideoTracks: () => [{ stop: vi.fn() }], getTracks: () => [{ stop: vi.fn() }] })
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: 'cam-a', label: 'Front' },
          { kind: 'videoinput', deviceId: 'cam-b', label: 'Back' }
        ]),
        getUserMedia
      }
    })
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue()
    })
    mocks.getQrCameraConstraintCandidates.mockImplementation((devices) => [
      { audio: false, video: { deviceId: { exact: devices[0]?.deviceId || 'cam-a' } } },
      { audio: false, video: { deviceId: { exact: devices[1]?.deviceId || 'cam-b' } } },
      { audio: false, video: { facingMode: { exact: 'environment' } } },
      { audio: false, video: true }
    ])

    openCamera()
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(4))
    const constraints = getUserMedia.mock.calls[3][0]
    expect(constraints).toEqual({ audio: false, video: true })
    expect(screen.getByText(/Point at the sheet/)).toBeTruthy()
  })

  it('surfaces a recoverable message when play() fails', async () => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: vi.fn().mockResolvedValue({ getVideoTracks: () => [{ stop: vi.fn() }], getTracks: () => [{ stop: vi.fn() }] })
      }
    })
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockRejectedValue(Object.assign(new Error('play blocked'), { name: 'NotSupportedError' }))
    })
    mocks.getQrCameraConstraintCandidates.mockReturnValue([{ audio: false, video: true }])

    openCamera()
    await waitFor(() => expect(screen.getAllByText(/playback failed/i).length).toBeGreaterThan(0))
  })

  it('stops retrying and shows an error after all candidates are exhausted', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('failed'), { name: 'OverconstrainedError' }))
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia
      }
    })
    mocks.getQrCameraConstraintCandidates.mockReturnValue([
      { audio: false, video: { facingMode: { exact: 'environment' } } },
      { audio: false, video: true }
    ])

    openCamera()
    await waitFor(() => expect(screen.getAllByText(/Could not open a usable camera/).length).toBeGreaterThan(0))
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })
})

describe('PaperScanReview compare and correct', () => {
  const MEMBER_ROW = { id: 'm1', 'Full Name': 'Ama Serwaa', 'Phone Number': '0241111111', Gender: 'Female', 'Current Level': 'SHS1' }

  const stubMemberRows = (result) => {
    mocks.fromTable.mockReturnValue({ select: () => ({ then: (resolve) => Promise.resolve(resolve(result)) }) })
  }

  const reachReview = async (rows, members = [], memberResult = null) => {
    stubMemberRows(memberResult === null ? { data: members, error: null } : memberResult)
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    mocks.extractSheetWithGemini.mockResolvedValue({ sheet: { detected_headers: [], attendance_dates: [] }, rows, warnings: [] })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract with Gemini' }))
    })
    vi.useRealTimers()
    await waitFor(() => expect(screen.getByText('Review extracted data')).toBeTruthy())
  }

  const baseRow = (overrides = {}) => ({
    full_name: 'Ama Serwaa',
    phone_number: '0241111111',
    gender: 'Female',
    current_level: 'SHS1',
    confidence: 0.95,
    attendance: {},
    warnings: [],
    ...overrides
  })

  beforeEach(() => {
    mocks.validateImageFile.mockReturnValue({ ok: true })
    mocks.validateImageDimensions.mockReturnValue({ ok: true, pixels: 10000 })
    mocks.readFileAsDataUrl.mockResolvedValue(FAKE_DATA_URL)
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 100, naturalHeight: 100 })
    mocks.applyEnhancement.mockReturnValue({})
    mocks.canvasToDataUrl.mockReturnValue(FAKE_ENHANCED)
    mocks.fitSheetForUpload.mockReturnValue(FAKE_ENHANCED)
    mocks.getQrCameraConstraintCandidates.mockReturnValue([])
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } } })
    mocks.extractSheetWithGemini.mockResolvedValue({ sheet: { detected_headers: [], attendance_dates: [] }, rows: [], warnings: [] })
    mocks.fromTable.mockReturnValue({ select: () => ({ then: (resolve) => Promise.resolve(resolve({ data: [], error: null })) }) })
    mocks.operation = null
    mocks.rpc.mockImplementation((name, args) => {
      if (name === 'paper_scan_begin_save_operation') {
        const steps = (args?.p_plan?.rows || []).flatMap((row, index) => {
          const memberId = row.member_action === 'create-new' ? `server-member-${index}` : row.member_id
          const create = row.member_action === 'create-new'
            ? (row.target_months || []).map((month, targetIndex) => ({ id: `create-${index}-${targetIndex}`, step_key: `${index + 1}:member:${month}`, kind: 'member-create', member_id: memberId, state: 'pending' }))
            : []
          const profile = Object.keys(row.profile_updates || {}).length
            ? [{ id: `profile-${index}`, step_key: `${index + 1}:profile`, kind: 'profile', member_id: memberId, profile_payload: row.profile_updates, state: 'pending' }]
            : []
          const attendance = (row.attendance || []).map((item, itemIndex) => ({ id: `attendance-${index}-${itemIndex}`, step_key: `${index + 1}:attendance:${item.date}`, kind: 'attendance', member_id: memberId, state: 'pending' }))
          return [...create, ...profile, ...attendance]
        })
        mocks.operation = { operation_id: args.p_operation_id, status: 'pending', immutable_plan: args.p_plan, steps }
        return Promise.resolve({ data: mocks.operation, error: null })
      }
      if (name === 'paper_scan_execute_save_step') {
        const step = mocks.operation?.steps.find((entry) => entry.id === args.p_step_id)
        if (step) step.state = 'succeeded'
        if (mocks.operation) mocks.operation.status = 'complete'
        return Promise.resolve({ data: { success: true, step_id: args.p_step_id, affected: 1 }, error: null })
      }
      if (name === 'paper_scan_get_save_operation') return Promise.resolve({ data: mocks.operation, error: null })
      return Promise.resolve({ data: { success: true }, error: null })
    })
    mocks.updateMember.mockResolvedValue({ id: 'm1' })
    mocks.refreshSyncedDataInBackground.mockResolvedValue()
    mocks.loadAllAttendanceData.mockResolvedValue()
    mocks.appContext.monthlyTables = []
    mocks.storageFrom.mockImplementation(() => ({
      upload: vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null }),
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/sheet.jpg' }, error: null })
    }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('shows Member X of Y with Previous/Next navigation', async () => {
    await reachReview([baseRow(), baseRow({ full_name: 'Kwame Mensah' })])
    expect(screen.getByRole('status').textContent).toContain('Member 1 of 2')
    expect(screen.getByRole('button', { name: 'Previous member' }).disabled).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next member' }))
    })
    expect(screen.getByRole('status').textContent).toContain('Member 2 of 2')
    expect(screen.getByRole('button', { name: 'Previous member' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Next member' }).disabled).toBe(true)
  })

  it('disables Previous on the first member and Next on the last member', async () => {
    await reachReview([baseRow()])
    expect(screen.getByRole('button', { name: 'Previous member' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Next member' }).disabled).toBe(true)
  })

  it('labels a phone-exact row as Matched to the existing member', async () => {
    await reachReview([baseRow()], [MEMBER_ROW])
    expect(screen.getByText('Matched')).toBeTruthy()
    expect(screen.getByText(/Matched to Ama Serwaa/)).toBeTruthy()
  })

  it('labels a partially matching row as Possible match', async () => {
    await reachReview([baseRow({ phone_number: '0249999999', full_name: 'Ama Serw' })], [MEMBER_ROW])
    expect(screen.getByText('Possible match')).toBeTruthy()
  })

  it('labels a row with no matching member as No match', async () => {
    await reachReview([baseRow({ phone_number: '0249999999', full_name: 'Stranger' })])
    expect(screen.getByText('No match')).toBeTruthy()
    expect(screen.getByText(/No existing DatSer member matches this row/)).toBeTruthy()
  })

  it('marks matching fields Same and conflicting fields Different', async () => {
    await reachReview([baseRow({ phone_number: '0249999999' })], [MEMBER_ROW])
    expect(screen.getAllByText('Same').length).toBeGreaterThan(0)
    expect(screen.getByText('Different')).toBeTruthy()
    expect(screen.getAllByText('0241111111').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0249999999').length).toBeGreaterThan(0)
  })

  it('marks a field the scan could not read as Missing without requiring a choice', async () => {
    await reachReview([baseRow({ gender: '' })], [MEMBER_ROW])
    expect(screen.getByText('Missing')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /use scan for gender/i })).toBeNull()
  })

  it('records Use Scan as the explicit choice for a field', async () => {
    await reachReview([baseRow({ phone_number: '0249999999' })], [MEMBER_ROW])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /use scan for phone/i }))
    })
    expect(screen.getAllByText('AI read').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0249999999').length).toBeGreaterThan(0)
  })

  it('records Keep DatSer as the explicit choice for a field', async () => {
    await reachReview([baseRow({ phone_number: '0249999999' })], [MEMBER_ROW])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /keep datser phone/i }))
    })
    expect(screen.getByText('Kept from DatSer')).toBeTruthy()
    expect(screen.getAllByText('0241111111').length).toBeGreaterThan(0)
  })

  it('edits a field inline and records the edited value', async () => {
    await reachReview([baseRow({ phone_number: '0249999999' })], [MEMBER_ROW])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /edit phone/i }))
    })
    const input = screen.getByLabelText('Edit Phone')
    fireEvent.change(input, { target: { value: '0205555555' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm phone edit/i }))
    })
    expect(screen.getByText('Edited')).toBeTruthy()
    expect(screen.getByText('0205555555')).toBeTruthy()
  })

  it('clears a decision and returns the field to unresolved', async () => {
    await reachReview([baseRow({ phone_number: '0249999999' })], [MEMBER_ROW])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /use scan for phone/i }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear phone decision/i }))
    })
    expect(screen.getByRole('button', { name: /use scan for phone/i })).toBeTruthy()
  })

  it('flags unknown attendance marks as needing review', async () => {
    await reachReview([baseRow({
      attendance_column_count: 2,
      attendance: { 1: { mark: 'tick', status: 'Present' }, 2: { mark: 'blank', status: 'Unknown' } }
    })])
    expect(screen.getAllByText('Needs Review').length).toBeGreaterThan(0)
    expect(screen.getByText(/This mark needs your review\./)).toBeTruthy()
    expect(screen.getAllByText(/Sun, Jun \d+/).length).toBeGreaterThan(0)
  })

  it('counts unresolved fields in the footer and the Review Changes button', async () => {
    await reachReview([baseRow({ phone_number: '0249999999' })], [MEMBER_ROW])
    expect(screen.getByText(/1 differing fields/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Review Changes \(1 unresolved\)/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save scan/ }).disabled).toBe(false)
  })

  it('lists unresolved and resolved choices in the Review Changes panel', async () => {
    await reachReview([
      baseRow({ phone_number: '0249999999' }),
      baseRow({ full_name: 'Kwame Mensah', phone_number: '0248888888' })
    ], [MEMBER_ROW])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /review changes/i }))
    })
    expect(screen.getByText(/needs a choice — scan: 0249999999 · DatSer: 0241111111/)).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /use scan for phone/i }))
    })
    expect(screen.getByText(/→ 0249999999 \(From scan\)/)).toBeTruthy()
  })

  it('shows the original Gemini value separately from the chosen value', async () => {
    await reachReview([baseRow({ phone_number: '0249999999' })], [MEMBER_ROW])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /keep datser phone/i }))
    })
    expect(screen.getByText('0241111111')).toBeTruthy()
    expect(screen.getByText('Kept from DatSer')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear phone decision/i }))
    })
    expect(screen.getByText('0249999999')).toBeTruthy()
  })

  it('opens the photo viewer, zooms, resets, and closes', async () => {
    await reachReview([baseRow()])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'View photo' }))
    })
    const dialog = screen.getByRole('dialog', { name: 'Sheet photo viewer' })
    expect(dialog).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Zoom in' }).disabled).toBe(false)
    expect(within(dialog).getByRole('button', { name: 'Zoom out' }).disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Reset zoom' }).disabled).toBe(true)

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Zoom in' }))
    })
    expect(within(dialog).getByText('115%')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Zoom out' }).disabled).toBe(false)

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reset zoom' }))
    })
    expect(within(dialog).getByText('100%')).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close photo viewer' }))
    })
    expect(screen.queryByRole('dialog', { name: 'Sheet photo viewer' })).toBeNull()
  })

  it('toggles between the original and enhanced photo', async () => {
    await reachReview([baseRow()])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'View photo' }))
    })
    const dialog = screen.getByRole('dialog', { name: 'Sheet photo viewer' })
    expect(within(dialog).getByRole('button', { name: 'Original' }).getAttribute('aria-pressed')).toBe('true')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Enhanced' }))
    })
    expect(within(dialog).getByRole('button', { name: 'Enhanced' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('updates the rows-will-be-saved count when a row is excluded', async () => {
    await reachReview([baseRow(), baseRow({ full_name: 'Kwame Mensah' })])
    expect(screen.getByText(/2 of 2 rows will be saved/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /exclude ama serwaa/i }))
    })
    expect(screen.getByText(/1 of 2 rows will be saved/)).toBeTruthy()
  })

  it('shows a persistent split sheet photo beside the member review', async () => {
    await reachReview([baseRow()])
    expect(screen.getByText(/Sheet photo/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fit page' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open full screen photo' })).toBeTruthy()
    expect(screen.getAllByText(/member 1 of 1/i).length).toBeGreaterThan(0)
  })

  it('zooms and fits the inline sheet photo without opening a dialog', async () => {
    await reachReview([baseRow()])
    expect(screen.getByText('100%')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    })
    expect(screen.getByText('115%')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Fit page' }))
    })
    expect(screen.getByText('100%')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Sheet photo viewer' })).toBeNull()
  })

  it('reviews a field against AI read, In DatSer, and a Final column', async () => {
    await reachReview([baseRow({ phone_number: '0249999999' })])
    expect(screen.getAllByText('AI read').length).toBeGreaterThan(0)
    expect(screen.getAllByText('In DatSer').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Final').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /use scan for phone/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /keep datser phone/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /edit phone/i })).toBeTruthy()
  })

  it('opens the full-screen photo viewer from the inline pane', async () => {
    await reachReview([baseRow()])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open full screen photo' }))
    })
    expect(screen.getByRole('dialog', { name: 'Sheet photo viewer' })).toBeTruthy()
  })

  it('maps attendance columns to that month\'s Sundays and preserves marks', async () => {
    await reachReview([baseRow({
      attendance: {
        1: { mark: 'tick', status: 'Present' },
        2: { mark: 'x', status: 'Absent' },
        3: { mark: 'blank', status: 'Unknown' }
      }
    })])
    expect(screen.getAllByText(/Sun, Jun 7/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Sun, Jun 14/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Sun, Jun 21/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('✓').length).toBeGreaterThan(0)
    expect(screen.getAllByText('✗').length).toBeGreaterThan(0)
    expect(screen.getAllByText('·').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Needs Review').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Mark Sun, Jun 7 as Present' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark Sun, Jun 7 as Absent' })).toBeTruthy()
  })

  it('shows columns beyond the month\'s Sundays as unmapped/unused', async () => {
    await reachReview([baseRow({
      attendance_column_count: 6,
      attendance: { 1: { mark: 'tick', status: 'Present' } }
    })])
    const unused = screen.getAllByText((_, element) => element?.textContent?.includes('Unused (no Sunday in June 2026)'))
    expect(unused.length).toBeGreaterThan(0)
  })

  it('records and clears an attendance decision keyed by Sunday date', async () => {
    await reachReview([baseRow({
      attendance: { 1: { mark: 'tick', status: 'Present' } }
    })])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark Sun, Jun 7 as Absent' }))
    })
    expect(screen.getAllByText('Absent').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Clear Sun, Jun 7 attendance decision/ })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Clear Sun, Jun 7 attendance decision/ }))
    })
    expect(screen.queryByRole('button', { name: /Clear Sun, Jun 7 attendance decision/ })).toBeNull()
  })

  it('uses the selected convention to interpret marks', async () => {
    await reachReview([baseRow({
      attendance: { 1: { mark: 'blank', status: 'Unknown' } }
    })])
    expect(screen.getAllByText('Needs Review').length).toBeGreaterThan(0)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Attendance convention'), { target: { value: 'tick_blank' } })
    })
    expect(screen.getByRole('button', { name: 'Mark Sun, Jun 7 as Absent' })).toBeTruthy()
    expect(screen.queryByText(/This mark needs your review\./)).toBeNull()
  })

  it('shows the sheet-level attendance month and the month prompt', async () => {
    await reachReview([baseRow({ attendance: { 1: { mark: 'tick', status: 'Present' } } })])
    const month = screen.getByLabelText('Attendance month')
    expect(month.value).toBe('2026-06')
    expect(screen.getByLabelText('Attendance convention')).toBeTruthy()
    expect(screen.getByText(/Choose the month this attendance sheet belongs to\./)).toBeTruthy()
    expect(screen.getAllByText(/Sun, Jun 7/).length).toBeGreaterThan(0)
  })

  it('shows a friendly no-marks state once the month is chosen but no marks exist', async () => {
    await reachReview([baseRow({})])
    expect(screen.getByText(/No attendance marks were detected for this member\. Review the Sundays below\./)).toBeTruthy()
  })

  it('previews the add-as-new-member profile and its month target', async () => {
    await reachReview([baseRow({ phone_number: '0249999999' })])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add as New Member/ }))
    })
    expect(screen.getByText(/This row will be added as a new member/)).toBeTruthy()
    expect(screen.getByText(/New member profile — prefilled from your reviewed scan values/)).toBeTruthy()
    expect(screen.getByLabelText('New member target month').value).toBe('2026-06')
    expect(screen.getByText(/No table for June 2026/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use Match' })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Match' }))
    })
    expect(screen.queryByText(/This row will be added as a new member/)).toBeNull()
  })

  it('isolates attendance decisions between months', async () => {
    await reachReview([baseRow({ attendance: { 1: { mark: 'tick', status: 'Present' } } })])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark Sun, Jun 7 as Absent' }))
    })
    expect(screen.getByRole('button', { name: /Clear Sun, Jun 7 attendance decision/ })).toBeTruthy()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Attendance month'), { target: { value: '2026-07' } })
    })
    expect(screen.queryByRole('button', { name: /Clear Sun, Jun 7 attendance decision/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Mark Sun, Jul 5 as Present' })).toBeTruthy()
    expect(screen.queryAllByText(/Sun, Jun 7/).length).toBe(0)
  })

  it('disables matching with a note when current member data cannot be loaded', async () => {
    await reachReview([baseRow()], [], { data: null, error: new Error('boom') })
    await waitFor(() => expect(screen.getByText(/matching is disabled for this batch/)).toBeTruthy())
  })

  describe('final save to DatSer', () => {
    const saveChain = () => ({
      select: () => ({ single: () => Promise.resolve({ data: [{ id: 'saved' }], error: null }) }),
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) })
    })

    it('writes only explicitly approved changes and shows the result summary', async () => {
      mocks.appContext.monthlyTables = ['June_2026']
      await reachReview(
        [baseRow({
          phone_number: '0249999999',
          reviewedValues: { phone_number: { value: '0242222222', source: 'datser' } }
        })],
        [MEMBER_ROW]
      )
      mocks.fromTable.mockReturnValue({
        select: () => ({ then: (resolve) => Promise.resolve(resolve({ data: [], error: null })) }),
        upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: [{ id: 'scan-1' }], error: null }) }) })
      })
      await act(async () => {
        fireEvent.click(screen.getByTestId('confirm-save-to-datser'))
      })

      const profileStep = mocks.rpc.mock.calls.find(([name, args]) => name === 'paper_scan_execute_save_step' && args.p_step_id.includes('profile-'))
      expect(profileStep).toBeTruthy()

      const summary = screen.getByTestId('final-save-result')
      expect(within(summary).getByTestId('final-stat-saved').textContent).toBe('1')
      expect(within(summary).getByTestId('final-stat-profile').textContent).toBe('1')
      expect(within(summary).getByTestId('final-stat-failed').textContent).toBe('0')
      expect(within(summary).getByText('Saved successfully')).toBeTruthy()
      expect(within(summary).getByText('Profile changes')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
      expect(mocks.loadAllAttendanceData).toHaveBeenCalledWith({ forceOnline: true })
      expect(mocks.refreshSyncedDataInBackground).toHaveBeenCalledWith('paper-scan-final-save', { force: true })
    })

    it('stops a likely-duplicate creation before any write and requires confirmation', async () => {
      mocks.appContext.monthlyTables = ['June_2026']
      await reachReview(
        [baseRow({
          memberAction: 'create-new',
          reviewedValues: {
            full_name: { value: 'Ama Serwaa', source: 'scan' },
            phone_number: { value: '0241111111', source: 'scan' },
            gender: { value: 'Female', source: 'scan' },
            current_level: { value: 'SHS1', source: 'scan' }
          },
          newMemberTarget: { mode: 'this-month', monthKey: '2026-06' }
        })],
        [MEMBER_ROW]
      )
      mocks.fromTable.mockReturnValue({ select: () => ({ then: (resolve) => Promise.resolve(resolve({ data: [], error: null })) }) })

      await act(async () => {
        fireEvent.click(screen.getByTestId('confirm-save-to-datser'))
      })

      expect(screen.getByText(/Possible duplicate found/)).toBeTruthy()
      expect(screen.getByTestId('confirm-duplicate-continue')).toBeTruthy()
      expect(mocks.updateMember).not.toHaveBeenCalled()

      mocks.fromTable.mockImplementation((table) => ({
        select: (columns) => (columns === 'id'
          ? { eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }
          : { then: (resolve) => Promise.resolve(resolve({ data: [], error: null })) }),
        upsert: () => (table === 'June_2026'
          ? { select: () => Promise.resolve({ data: [{ id: 'new-member' }], error: null }) }
          : saveChain())
      }))

      await act(async () => {
        fireEvent.click(screen.getByTestId('confirm-duplicate-continue'))
      })

      const createCall = mocks.rpc.mock.calls.find(([name]) => name === 'paper_scan_begin_save_operation')
      expect(createCall).toBeTruthy()
      expect(createCall[1]).toMatchObject({ p_owner_id: 'owner-workspace-id' })
      const summary = screen.getByTestId('final-save-result')
      expect(within(summary).getByTestId('final-stat-created').textContent).toBe('1')
      expect(within(summary).getByText('New members created')).toBeTruthy()
    })

    it('lets Retry Failed re-run only the rows that failed', async () => {
      mocks.appContext.monthlyTables = ['June_2026']
      await reachReview(
        [baseRow({
          phone_number: '0249999999',
          reviewedValues: { phone_number: { value: '0242222222', source: 'datser' } }
        })],
        [MEMBER_ROW]
      )
      mocks.fromTable.mockReturnValue({
        select: () => ({ then: (resolve) => Promise.resolve(resolve({ data: [], error: null })) }),
        upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: [{ id: 'scan-1' }], error: null }) }) })
      })
      const originalRpc = mocks.rpc.getMockImplementation()
      let failProfile = true
      mocks.rpc.mockImplementation((name, args) => {
        if (name === 'paper_scan_execute_save_step' && args.p_step_id.includes('profile-') && failProfile) {
          const step = mocks.operation?.steps.find((entry) => entry.id === args.p_step_id)
          if (step) { step.state = 'failed'; step.result = { error: 'database is unavailable' } }
          return Promise.resolve({ data: { success: false, error_message: 'database is unavailable' }, error: null })
        }
        return originalRpc(name, args)
      })

      await act(async () => {
        fireEvent.click(screen.getByTestId('confirm-save-to-datser'))
      })

      let summary = screen.getByTestId('final-save-result')
      expect(within(summary).getByTestId('final-stat-failed').textContent).toBe('1')
      expect(screen.getByText('database is unavailable')).toBeTruthy()
      const retry = screen.getByTestId('retry-failed-items')
      expect(retry.textContent).toContain('Retry Failed (1)')

      failProfile = false
      await act(async () => {
        fireEvent.click(retry)
      })

      expect(mocks.rpc.mock.calls.filter(([name]) => name === 'paper_scan_execute_save_step').length).toBe(2)
      summary = screen.getByTestId('final-save-result')
      expect(within(summary).getByTestId('final-stat-saved').textContent).toBe('1')
      expect(within(summary).getByTestId('final-stat-failed').textContent).toBe('0')
      expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
    })

    it('runs a single save pass when Confirm is clicked rapidly', async () => {
      mocks.appContext.monthlyTables = ['June_2026']
      await reachReview(
        [baseRow({
          memberAction: 'create-new',
          reviewedValues: {
            full_name: { value: 'Yaa Asantewaa', source: 'scan' },
            phone_number: { value: '0243333333', source: 'scan' },
            gender: { value: 'Female', source: 'scan' },
            current_level: { value: 'SHS1', source: 'scan' }
          },
          newMemberTarget: { mode: 'this-month', monthKey: '2026-06' }
        })],
        [MEMBER_ROW]
      )
      mocks.fromTable.mockReturnValue({
        select: () => ({ then: (resolve) => Promise.resolve(resolve({ data: [], error: null })) }),
        upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: [{ id: 'scan-1' }], error: null }) }) })
      })
      const originalRpc = mocks.rpc.getMockImplementation()
      let resolveBegin
      mocks.rpc.mockImplementation((name, args) => {
        if (name === 'paper_scan_begin_save_operation') {
          return new Promise((resolve) => { resolveBegin = resolve })
        }
        return originalRpc(name, args)
      })

      await act(async () => {
        fireEvent.click(screen.getByTestId('confirm-save-to-datser'))
        fireEvent.click(screen.getByTestId('confirm-save-to-datser'))
      })

      const createCalls = mocks.rpc.mock.calls.filter(([name]) => name === 'paper_scan_begin_save_operation')
      expect(createCalls).toHaveLength(1)

      await act(async () => {
        resolveBegin({
          data: {
            operation_id: 'op-1',
            immutable_plan: { rows: [] },
            steps: [{ id: 'create-0', step_key: '1:member:2026-06-01', kind: 'member-create', member_id: 'server-member-0', state: 'pending' }]
          },
          error: null
        })
      })
      await waitFor(() => expect(screen.getByTestId('final-save-result')).toBeTruthy())
      const summary = screen.getByTestId('final-save-result')
      expect(within(summary).getByTestId('final-stat-created').textContent).toBe('1')
    })
  })
})

describe('PaperScanReview saved scans (private, idempotent)', () => {
  const MEMBER_ROW = { id: 'm1', 'Full Name': 'Ama Serwaa', 'Phone Number': '0241111111', Gender: 'Female', 'Current Level': 'SHS1' }

  let capture

  const baseRow = (overrides = {}) => ({
    full_name: 'Ama Serwaa',
    phone_number: '0241111111',
    gender: 'Female',
    current_level: 'SHS1',
    confidence: 0.95,
    attendance: {},
    warnings: [],
    ...overrides
  })

  const makeSavedRecord = (overrides = {}) => ({
    id: 'scan-1',
    user_id: 'owner-user-id',
    owner_id: 'owner-workspace-id',
    name: 'My saved scan',
    sheet_images: [{ sheetId: 'sheet-reopened', source: 'Camera capture', path: 'owner-user-id/scan-1/sheet-reopened.jpg' }],
    extraction: {
      'sheet-reopened': {
        source: 'Camera capture',
        excludedIndices: [],
        sheet: { detected_headers: [], attendance_dates: ['2026-07-05'] },
        rows: [{
          full_name: 'Ama Serwaa',
          phone_number: '0249999999',
          gender: 'Female',
          current_level: 'SHS1',
          confidence: 0.95,
          attendance: { '2026-07-05': 'Present' },
          originalGeminiValue: { full_name: 'Ama Serwaa', phone_number: '0249999999', gender: 'Female', current_level: 'SHS1' },
          reviewedValues: { phone_number: { value: '0241111111', source: 'datser' } }
        }],
        warnings: []
      }
    },
    review_state: { 'sheet-reopened': { excludedIndices: [], rowCount: 1, decisionCount: 1 } },
    attendance: {
      'sheet-reopened': {
        attendance_dates: ['2026-07-05'],
        marks: [{ index: 0, full_name: 'Ama Serwaa', attendance: { '2026-07-05': 'Present' }, confidence: 0.95, excluded: false }]
      }
    },
    usage_metadata: {
      'sheet-reopened': { promptTokenCount: 100, candidatesTokenCount: 40 },
      _total: { promptTokenCount: 100, candidatesTokenCount: 40 }
    },
    created_at: '2026-08-12T00:00:00Z',
    updated_at: '2026-08-12T10:00:00Z',
    ...overrides
  })

  // Routable table/storage mock so tests can assert exactly which rows and
  // storage objects a flow touches without ever writing member or attendance
  // data.
  const stubLayers = ({ records = [], singleRecord = null, members = [] } = {}) => {
    mocks.fromTable.mockImplementation((table) => {
      if (table !== 'paper_scan_saved') {
        return { select: () => ({ then: (resolve) => Promise.resolve(resolve({ data: members, error: null })) }) }
      }
      const thenable = (value) => ({
        eq: (col, val) => { capture.ops.push({ table, op: 'filter', col, val }); return thenable(value) },
        order: () => thenable(value),
        select: () => thenable(value),
        single: () => Promise.resolve({ data: value, error: null }),
        maybeSingle: () => Promise.resolve({ data: value, error: null }),
        then: (resolve) => Promise.resolve(resolve(value))
      })
      return {
        select: (columns) => {
          capture.ops.push({ table, op: 'select', columns })
          return columns === '*' ? thenable(singleRecord) : thenable({ data: records, error: null })
        },
        upsert: (record, options) => {
          capture.upserts.push({ record, options })
          capture.ops.push({ table, op: 'write', kind: 'upsert' })
          return { select: () => ({ single: () => Promise.resolve({ data: record, error: null }) }) }
        },
        update: (changes) => {
          capture.updates.push(changes)
          capture.ops.push({ table, op: 'write', kind: 'update' })
          return { eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: singleRecord?.id || 'scan-1', ...changes }, error: null }) }) }) }
        },
        delete: () => {
          capture.deletes.push(true)
          capture.ops.push({ table, op: 'write', kind: 'delete' })
          return { eq: () => Promise.resolve({ data: null, error: null }) }
        }
      }
    })
  }

  const reachReview = async (rows, members = [], mockOptions = {}) => {
    stubLayers({ members })
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    mocks.extractSheetWithGemini.mockResolvedValue({
      sheet: { detected_headers: [], attendance_dates: [] },
      rows,
      warnings: [],
      usageMetadata: mockOptions.usageMetadata
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Extract with Gemini' }))
    })
    vi.useRealTimers()
    await waitFor(() => expect(screen.getByText('Review extracted data')).toBeTruthy())
  }

  const openSavedScans = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Saved scans' }))
    })
    await waitFor(() => expect(screen.getByText(/· opening never re-bills Gemini/i)).toBeTruthy())
  }

  beforeEach(() => {
    capture = { upserts: [], updates: [], deletes: [], uploads: [], ops: [] }
    mocks.validateImageFile.mockReturnValue({ ok: true })
    mocks.validateImageDimensions.mockReturnValue({ ok: true, pixels: 10000 })
    mocks.readFileAsDataUrl.mockResolvedValue(FAKE_DATA_URL)
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 100, naturalHeight: 100 })
    mocks.applyEnhancement.mockReturnValue({})
    mocks.canvasToDataUrl.mockReturnValue(FAKE_ENHANCED)
    mocks.fitSheetForUpload.mockReturnValue(FAKE_ENHANCED)
    mocks.getQrCameraConstraintCandidates.mockReturnValue([])
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } } })
    mocks.extractSheetWithGemini.mockResolvedValue({ sheet: { detected_headers: [], attendance_dates: [] }, rows: [], warnings: [] })
    mocks.storageUpload.mockResolvedValue({ data: { path: 'x' }, error: null })
    mocks.storageList.mockResolvedValue({ data: [], error: null })
    mocks.storageRemove.mockResolvedValue({ data: [], error: null })
    mocks.storageCreateSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/sheet.jpg' }, error: null })
    mocks.storageFrom.mockImplementation(() => ({
      upload: async (path, blob, options) => {
        capture.uploads.push({ path, blob, options })
        return mocks.storageUpload(path, blob, options)
      },
      list: mocks.storageList,
      remove: mocks.storageRemove,
      createSignedUrl: mocks.storageCreateSignedUrl
    }))
    mocks.rpc.mockImplementation((name, args) => Promise.resolve({
      data: name === 'paper_scan_create_member'
        ? { success: true, member_id: args?.p_member?.id || 'new-member-id', inserted: args?.p_target_tables || [], skipped: [] }
        : name === 'paper_scan_write_attendance'
          ? { success: true, member_id: args?.p_member_id, affected: 1 }
          : { success: true },
      error: null
    }))
    mocks.updateMember.mockResolvedValue({ id: 'm1' })
    mocks.refreshSyncedDataInBackground.mockResolvedValue()
    mocks.loadAllAttendanceData.mockResolvedValue()
    mocks.appContext.monthlyTables = []
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  const writesOutside = () => capture.ops.filter((op) => op.op === 'write' && op.table !== 'paper_scan_saved')

  it('saves a review idempotently to the private scan row and storage only', async () => {
    await reachReview(
      [baseRow({ phone_number: '0249999999' })],
      [MEMBER_ROW],
      { usageMetadata: { promptTokenCount: 73, candidatesTokenCount: 41 } }
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /use scan for phone/i }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save scan/i }))
    })

    expect(capture.upserts).toHaveLength(1)
    const { record, options } = capture.upserts[0]
    expect(options).toEqual({ onConflict: 'id' })
    expect(record.owner_id).toBe('owner-workspace-id')
    expect(record.user_id).toBe('owner-user-id')
    expect(record.name).toMatch(/^Attendance sheet/)

    const sheetIds = Object.keys(record.extraction)
    expect(sheetIds).toHaveLength(1)
    const snapshot = record.extraction[sheetIds[0]]
    expect(snapshot.source).toBe('sheet-a.jpg')
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.rows[0]).toMatchObject({
      originalGeminiValue: { full_name: 'Ama Serwaa', phone_number: '0249999999' },
      reviewedValues: { phone_number: { value: '0249999999', source: 'scan' } }
    })
    expect(record.review_state[sheetIds[0]]).toEqual({ excludedIndices: [], rowCount: 1, decisionCount: 1 })
    expect(record.usage_metadata[sheetIds[0]]).toEqual({ promptTokenCount: 73, candidatesTokenCount: 41 })
    expect(record.usage_metadata._total).toEqual({ promptTokenCount: 73, candidatesTokenCount: 41 })
    expect(record.attendance[sheetIds[0]].attendance_dates).toEqual([])
    expect(record.sheet_images).toHaveLength(1)
    expect(record.sheet_images[0].path).toContain(sheetIds[0])

    expect(capture.uploads).toHaveLength(1)
    expect(capture.uploads[0].path).toContain(sheetIds[0])
    expect(capture.uploads[0].options).toMatchObject({ upsert: true })
    expect(writesOutside()).toHaveLength(0)
    expect(screen.getByText(/reopening it will not use Gemini again/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save scan again/ })).toBeTruthy()
  })

  it('re-saving the same session reuses the same id and overwrites the same object path', async () => {
    await reachReview([baseRow()])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save scan/i }))
    })
    const firstId = capture.upserts[0].record.id
    const firstPath = capture.uploads[0].path
    expect(capture.uploads).toHaveLength(1)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save scan again/i }))
    })
    expect(capture.upserts).toHaveLength(2)
    expect(capture.upserts[1].record.id).toBe(firstId)
    // Idempotency contract: the sheet image is overwritten at the SAME path,
    // never stacked as a new object.
    expect(capture.uploads).toHaveLength(2)
    expect(capture.uploads[1].path).toBe(firstPath)
    expect(capture.uploads[1].options).toMatchObject({ upsert: true })
  })

  it('lists only the current workspace owner scans with an owner filter', async () => {
    stubLayers({ records: [makeSavedRecord()], singleRecord: null, members: [] })
    render(<PaperScanReview onBack={() => {}} />)
    await openSavedScans()

    await waitFor(() => expect(screen.getByText('My saved scan')).toBeTruthy())
    const ownerFilter = capture.ops.find((op) => op.op === 'filter' && op.col === 'owner_id')
    expect(ownerFilter?.val).toBe('owner-workspace-id')
  })

  it('reopens a saved scan without calling Gemini and restores decisions', async () => {
    stubLayers({ records: [makeSavedRecord()], singleRecord: makeSavedRecord(), members: [MEMBER_ROW] })
    render(<PaperScanReview onBack={() => {}} />)
    await openSavedScans()

    await waitFor(() => expect(screen.getByText('My saved scan')).toBeTruthy())
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
    expect(mocks.storageCreateSignedUrl).toHaveBeenCalledWith('owner-user-id/scan-1/sheet-reopened.jpg', 3600)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Open My saved scan/ }))
    })
    await waitFor(() => expect(screen.getByText('Review extracted data')).toBeTruthy())
    expect(mocks.extractSheetWithGemini).not.toHaveBeenCalled()
    expect(screen.getByText(/1 differing fields/)).toBeTruthy()
    expect(screen.getByText('0241111111')).toBeTruthy()
    expect(screen.getByText(/Kept from DatSer/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save scan again/ })).toBeTruthy()
  })

  it('reopens a completed save without auto-resuming any write and restores the durable result', async () => {
    const saveResult = {
      operationId: 'op-1',
      savedAt: '2026-08-13T00:00:00Z',
      summary: { saved: 1, newMembersCreated: 0, profileChanges: 1, attendanceUpdated: 0, skippedUnresolved: 0, failed: 0 },
      members: [{ sheetId: 'sheet-reopened', rowIndex: 0, memberId: 'm1', status: 'saved' }]
    }
    stubLayers({
      records: [makeSavedRecord({ save_result: saveResult })],
      singleRecord: makeSavedRecord({ save_result: saveResult }),
      members: [MEMBER_ROW]
    })
    mocks.rpc.mockImplementation((name) => {
      if (name === 'paper_scan_get_save_operation') {
        return Promise.resolve({
          data: {
            operation_id: 'op-1',
            status: 'complete',
            immutable_plan: {
              rows: [{ sheet_id: 'sheet-reopened', row_index: 0, display_name: 'Ama Serwaa', member_action: 'update', member_id: 'm1' }]
            },
            steps: [{ id: 'profile-0', step_key: '1:profile', kind: 'profile', member_id: 'm1', profile_payload: { phone_number: '0241111111' }, state: 'succeeded' }]
          },
          error: null
        })
      }
      return Promise.resolve({ data: { success: true }, error: null })
    })
    render(<PaperScanReview onBack={() => {}} />)
    await openSavedScans()

    await waitFor(() => expect(screen.getByText('My saved scan')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Open My saved scan/ }))
    })

    await waitFor(() => expect(screen.getByTestId('final-save-result')).toBeTruthy())
    const summary = screen.getByTestId('final-save-result')
    expect(within(summary).getByTestId('final-stat-saved').textContent).toBe('1')
    expect(within(summary).getByTestId('final-stat-profile').textContent).toBe('1')
    expect(within(summary).getByTestId('final-stat-failed').textContent).toBe('0')
    const writeRpcCalls = mocks.rpc.mock.calls.filter(([name]) => name === 'paper_scan_create_member' || name === 'paper_scan_write_attendance' || name === 'paper_scan_execute_save_step')
    expect(writeRpcCalls).toHaveLength(0)
    expect(writesOutside()).toHaveLength(0)
  })

  it('renames a saved scan through the private table only', async () => {
    stubLayers({ records: [makeSavedRecord()], singleRecord: null, members: [] })
    render(<PaperScanReview onBack={() => {}} />)
    await openSavedScans()

    await waitFor(() => expect(screen.getByText('My saved scan')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Rename My saved scan/ }))
    })
    const input = screen.getByRole('textbox', { name: /Rename My saved scan/ })
    fireEvent.change(input, { target: { value: 'After rename' } })
    await waitFor(() => {
      expect(input.value).toBe('After rename')
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirm rename of My saved scan/ }))
    })

    await waitFor(() => expect(screen.getByText('After rename')).toBeTruthy())
    expect(capture.updates).toEqual([{ name: 'After rename' }])
    expect(writesOutside()).toHaveLength(0)
  })

  it('deletes only the scan row and its owned storage objects', async () => {
    stubLayers({ records: [makeSavedRecord()], singleRecord: null, members: [] })
    mocks.storageList.mockResolvedValue({ data: [{ name: 'sheet-reopened.jpg' }], error: null })
    render(<PaperScanReview onBack={() => {}} />)
    await openSavedScans()

    await waitFor(() => expect(screen.getByText('My saved scan')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Delete My saved scan/ }))
    })
    expect(screen.getByRole('button', { name: /Confirm delete My saved scan/ })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirm delete My saved scan/ }))
    })

    await waitFor(() => expect(screen.getByText('No saved scans yet')).toBeTruthy())
    expect(mocks.storageList).toHaveBeenCalledWith('owner-user-id/scan-1', { limit: 100, offset: 0 })
    expect(mocks.storageRemove).toHaveBeenCalledWith(['owner-user-id/scan-1/sheet-reopened.jpg'])
    expect(capture.deletes).toHaveLength(1)
    expect(writesOutside()).toHaveLength(0)
  })
})
