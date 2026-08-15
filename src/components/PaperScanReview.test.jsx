// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PaperScanReview from './PaperScanReview'
import { supabase } from '../lib/supabase'

const mocks = vi.hoisted(() => ({
  applyEnhancement: vi.fn(),
  canvasToDataUrl: vi.fn(),
  loadImageElement: vi.fn(),
  readFileAsDataUrl: vi.fn(),
  validateImageFile: vi.fn(),
  decodeOrientedImage: vi.fn(),
  prepareSheetForUpload: vi.fn(),
  getQrCameraConstraintCandidates: vi.fn(),
  uploadSheetImage: vi.fn(),
  mergeStagedSheet: vi.fn(),
  removeStagedSheet: vi.fn(),
  getSavedScan: vi.fn(),
  listSavedScans: vi.fn(),
  createSheetImageSignedUrl: vi.fn(),
  extractSheetWithGemini: vi.fn()
}))

vi.mock('../utils/paperScanImage', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    applyEnhancement: mocks.applyEnhancement,
    canvasToDataUrl: mocks.canvasToDataUrl,
    loadImageElement: mocks.loadImageElement,
    readFileAsDataUrl: mocks.readFileAsDataUrl,
    validateImageFile: mocks.validateImageFile,
    decodeOrientedImage: mocks.decodeOrientedImage,
    prepareSheetForUpload: mocks.prepareSheetForUpload
  }
})

vi.mock('../context/AppContext', () => ({
  useApp: () => ({
    dataOwnerId: 'owner-1',
    currentTable: 'August_2026',
    monthlyTables: [],
    updateMember: vi.fn(),
    refreshSyncedDataInBackground: vi.fn(),
    loadAllAttendanceData: vi.fn(),
    fetchMembers: vi.fn(),
    isOnline: true,
    offlineMode: false,
    memberCodeMap: {}
  })
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' }
  })
}))

vi.mock('../utils/qrCheckIn', () => ({
  getQrCameraConstraintCandidates: mocks.getQrCameraConstraintCandidates
}))

vi.mock('../services/paperScanSavedScans', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    uploadSheetImage: mocks.uploadSheetImage,
    mergeStagedSheet: mocks.mergeStagedSheet,
    removeStagedSheet: mocks.removeStagedSheet,
    getSavedScan: mocks.getSavedScan,
    listSavedScans: mocks.listSavedScans,
    createSheetImageSignedUrl: mocks.createSheetImageSignedUrl
  }
})

vi.mock('../services/paperScanExtraction', () => ({
  extractSheetWithGemini: mocks.extractSheetWithGemini
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
  let stagedEntries = []

  beforeEach(() => {
    stagedEntries = []
    mocks.validateImageFile.mockReturnValue({ ok: true })
    mocks.readFileAsDataUrl.mockResolvedValue(FAKE_DATA_URL)
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 100, naturalHeight: 100 })
    mocks.decodeOrientedImage.mockResolvedValue(null)
    mocks.applyEnhancement.mockReturnValue({})
    mocks.canvasToDataUrl.mockReturnValue(FAKE_ENHANCED)
    mocks.prepareSheetForUpload.mockImplementation(async () => ({
      dataUrl: FAKE_DATA_URL,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      extension: '.jpg',
      width: 100,
      height: 100,
      encodedBytes: 1
    }))
    mocks.getQrCameraConstraintCandidates.mockReturnValue([])
    mocks.uploadSheetImage.mockImplementation(async ({ userId, scanId, sheetId }) => {
      const path = `${userId}/${scanId}/${sheetId}.jpg`
      stagedEntries = [...stagedEntries.filter((entry) => entry.sheetId !== sheetId), { sheetId, source: 'Camera capture', path }]
      return path
    })
    mocks.mergeStagedSheet.mockImplementation(async ({ sheet }) => {
      stagedEntries = [...stagedEntries.filter((entry) => entry.sheetId !== sheet.sheetId), sheet]
      return { id: 'scan-1', name: 'Staged scan', sheet_images: stagedEntries, review_state: { _staging: true } }
    })
    mocks.removeStagedSheet.mockImplementation(async ({ sheetId }) => {
      stagedEntries = stagedEntries.filter((entry) => entry.sheetId !== sheetId)
      return { id: 'scan-1', sheet_images: stagedEntries, review_state: { _staging: true } }
    })
    mocks.getSavedScan.mockImplementation(async () => ({
      id: 'scan-1',
      name: 'Staged scan',
      sheet_images: stagedEntries,
      review_state: { _staging: true }
    }))
    mocks.listSavedScans.mockResolvedValue([])
    mocks.createSheetImageSignedUrl.mockImplementation(async ({ path }) => `signed:${path}`)
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'test-token' } } })
    mocks.extractSheetWithGemini.mockResolvedValue({
      sheet: { detected_headers: [], attendance_dates: [] },
      rows: [],
      warnings: [],
      usageMetadata: null
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }))
      await Promise.resolve()
    })
    expect(screen.getByText(/Processing sheets/)).toBeTruthy()
    expect(screen.getByText('1 sheet in this batch')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByRole('button', { name: /extract with gemini/i })).toBeTruthy()
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

  it('limits background sheet saves to three concurrent uploads', async () => {
    const pending = []
    mocks.uploadSheetImage.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    render(<PaperScanReview onBack={() => {}} />)
    const input = screen.getByLabelText('Upload an image')
    fireEvent.change(input, {
      target: { files: [
        new File(['a'], 'one.jpg', { type: 'image/jpeg' }),
        new File(['b'], 'two.jpg', { type: 'image/jpeg' }),
        new File(['c'], 'three.jpg', { type: 'image/jpeg' }),
        new File(['d'], 'four.jpg', { type: 'image/jpeg' })
      ] }
    })
    await waitFor(() => expect(mocks.uploadSheetImage).toHaveBeenCalledTimes(3))
    pending.shift()('user-1/scan-1/sheet-1.jpg')
    await waitFor(() => expect(mocks.uploadSheetImage).toHaveBeenCalledTimes(4))
    pending.splice(0).forEach((resolve, index) => resolve(`user-1/scan-1/sheet-${index + 2}.jpg`))
  })

  it('blocks processing until a failed staging save is retried', async () => {
    mocks.uploadSheetImage.mockRejectedValue(new Error('Saved Scan storage upload failed (400): The object exceeded the maximum allowed size.'))
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('sheet-a.jpg')
    await waitFor(() => expect(screen.getByText('Save failed')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }))
      await Promise.resolve()
    })
    expect(screen.getByText(/needs to finish saving before processing/i)).toBeTruthy()
    expect(screen.queryByText(/Processing sheets/)).toBeNull()
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
    expect(screen.getByText('SEARCHING FOR DOCUMENT')).toBeTruthy()
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

describe('PaperScanReview staging durability', () => {
  let stagedEntries = []

  beforeEach(() => {
    stagedEntries = []
    mocks.validateImageFile.mockReturnValue({ ok: true })
    mocks.readFileAsDataUrl.mockResolvedValue(FAKE_DATA_URL)
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 100, naturalHeight: 100 })
    mocks.decodeOrientedImage.mockResolvedValue(null)
    mocks.prepareSheetForUpload.mockImplementation(async () => ({
      dataUrl: FAKE_DATA_URL,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      extension: '.jpg',
      width: 100,
      height: 100,
      encodedBytes: 1
    }))
    mocks.uploadSheetImage.mockImplementation(async ({ userId, scanId, sheetId }) => {
      const path = `${userId}/${scanId}/${sheetId}.jpg`
      stagedEntries = [...stagedEntries.filter((entry) => entry.sheetId !== sheetId), { sheetId, source: 'Camera capture', path }]
      return path
    })
    mocks.mergeStagedSheet.mockImplementation(async ({ sheet }) => {
      stagedEntries = [...stagedEntries.filter((entry) => entry.sheetId !== sheet.sheetId), sheet]
      return { id: 'scan-1', name: 'Staged scan', sheet_images: stagedEntries, review_state: { _staging: true } }
    })
    mocks.removeStagedSheet.mockImplementation(async ({ sheetId }) => {
      stagedEntries = stagedEntries.filter((entry) => entry.sheetId !== sheetId)
      return { id: 'scan-1', sheet_images: stagedEntries, review_state: { _staging: true } }
    })
    mocks.getSavedScan.mockImplementation(async () => ({
      id: 'scan-1',
      name: 'Staged scan',
      sheet_images: stagedEntries,
      review_state: { _staging: true }
    }))
    mocks.listSavedScans.mockResolvedValue([])
    mocks.createSheetImageSignedUrl.mockImplementation(async ({ path }) => `signed:${path}`)
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'test-token' } } })
    mocks.extractSheetWithGemini.mockResolvedValue({
      sheet: { detected_headers: [], attendance_dates: [] },
      rows: [],
      warnings: [],
      usageMetadata: null
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps every sheet in durable metadata even when merges resolve out of order', async () => {
    const resolvers = new Map()
    mocks.mergeStagedSheet.mockImplementation(({ sheet }) => new Promise((resolve) => {
      resolvers.set(sheet.sheetId, () => {
        stagedEntries = [...stagedEntries.filter((entry) => entry.sheetId !== sheet.sheetId), sheet]
        resolve({ id: 'scan-1', name: 'Staged scan', sheet_images: stagedEntries, review_state: { _staging: true } })
      })
    }))
    render(<PaperScanReview onBack={() => {}} />)
    const input = screen.getByLabelText('Upload an image')
    fireEvent.change(input, {
      target: { files: [
        new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
        new File(['b'], 'b.jpg', { type: 'image/jpeg' })
      ] }
    })
    await waitFor(() => expect(resolvers.size).toBe(2))
    const ids = [...resolvers.keys()]
    // B's metadata resolves first, then A's — the durable merge must keep BOTH.
    resolvers.get(ids[1])()
    resolvers.get(ids[0])()
    await waitFor(() => expect(screen.getAllByText('Saved').length).toBeGreaterThanOrEqual(2))
    const durable = await mocks.getSavedScan()
    expect(durable.sheet_images.map((entry) => entry.sheetId).sort()).toEqual([...ids].sort())
  })

  it('never marks a sheet Saved when the durable metadata lacks its reference', async () => {
    mocks.mergeStagedSheet.mockResolvedValue({ id: 'scan-1', name: 'Staged scan', sheet_images: [], review_state: { _staging: true } })
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('a.jpg')
    await waitFor(() => expect(screen.getByText('Save failed')).toBeTruthy())
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('blocks Process when local state says Saved but durable metadata does not contain the sheet', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('a.jpg')
    await waitFor(() => expect(screen.getAllByText('Saved').length).toBeGreaterThan(0))
    // Simulate a stale overwrite: the latest durable record lost the sheet.
    mocks.getSavedScan.mockResolvedValue({ id: 'scan-1', name: 'Staged scan', sheet_images: [], review_state: { _staging: true } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }))
      await Promise.resolve()
    })
    expect(screen.getByText(/needs to finish saving before processing/i)).toBeTruthy()
    expect(screen.queryByText(/Processing sheets/)).toBeNull()
  })

  it('blocks "Process this sheet" when that sheet is missing from durable metadata', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    await uploadSheet('b.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (2)')).toBeTruthy())
    // Sheet A's reference was lost from durable metadata; only B remains.
    mocks.getSavedScan.mockResolvedValue({
      id: 'scan-1',
      name: 'Staged scan',
      sheet_images: stagedEntries.filter((_, index) => index === 1),
      review_state: { _staging: true }
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /process this sheet/i }))
      await Promise.resolve()
    })
    expect(screen.getByText(/needs to finish saving before processing/i)).toBeTruthy()
    expect(screen.queryByText(/Processing sheets/)).toBeNull()
  })

  it('processes exactly the selected durable sheet', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    await uploadSheet('b.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (2)')).toBeTruthy())

    fireEvent.click(selectSheetByLabel(1))
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /process this sheet/i }))
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByText('1 sheet in this batch')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /extract with gemini/i }))
    })
    await waitFor(() => expect(mocks.extractSheetWithGemini).toHaveBeenCalledTimes(1))
  })

  it('retry after a failed upload reuses the same object path and merges once', async () => {
    const uploadPaths = []
    let failFirst = true
    mocks.uploadSheetImage.mockImplementation(async ({ userId, scanId, sheetId }) => {
      const path = `${userId}/${scanId}/${sheetId}.jpg`
      uploadPaths.push(path)
      if (failFirst) {
        failFirst = false
        throw new Error('Saved Scan storage upload failed (400): boom')
      }
      return path
    })
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('a.jpg')
    await waitFor(() => expect(screen.getByText('Save failed')).toBeTruthy())
    // The failed upload reached neither Storage nor the metadata merge.
    expect(mocks.mergeStagedSheet).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getAllByText('Saved').length).toBeGreaterThan(0))
    // Repeated attempts use ONE stable object path and produce ONE durable entry.
    expect(new Set(uploadPaths).size).toBe(1)
    expect(mocks.mergeStagedSheet).toHaveBeenCalledTimes(1)
  })

  it('removing a sheet updates durable metadata and never deletes the remote object', async () => {
    render(<PaperScanReview onBack={() => {}} />)
    await uploadSheet('a.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    await uploadSheet('b.jpg')
    await waitFor(() => expect(screen.getByText('Sheets (2)')).toBeTruthy())
    const keptPath = stagedEntries.find((entry) => entry.sheetId !== stagedEntries[0].sheetId)?.path

    fireEvent.click(screen.getByRole('button', { name: 'Remove sheet 1' }))
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    await waitFor(() => expect(mocks.removeStagedSheet).toHaveBeenCalled())
    const removedSheetId = mocks.removeStagedSheet.mock.calls[0][0].sheetId
    expect(removedSheetId).toBeTruthy()
    const durable = await mocks.getSavedScan()
    expect(durable.sheet_images).toHaveLength(1)
    expect(durable.sheet_images.some((entry) => entry.sheetId === removedSheetId)).toBe(false)
    expect(durable.sheet_images[0].path).toBe(keptPath)
    // The remote object is NOT deleted by remove-from-batch.
    expect(mocks.uploadSheetImage).toHaveBeenCalled()
  })

  it('reopens a _staging batch back to preparation without fabricating extraction results', async () => {
    mocks.listSavedScans.mockResolvedValue([
      { id: 'scan-staging', name: 'Staged batch', sheet_images: [{ sheetId: 'sheet-1', source: 'Camera capture', path: 'u1/scan-staging/sheet-1.jpg' }], usage_metadata: {}, updated_at: '2026-08-14T00:00:00Z' }
    ])
    mocks.getSavedScan.mockResolvedValue({
      id: 'scan-staging',
      name: 'Staged batch',
      user_id: 'user-1',
      owner_id: 'owner-1',
      sheet_images: [{ sheetId: 'sheet-1', source: 'Camera capture', path: 'u1/scan-staging/sheet-1.jpg' }],
      review_state: { _staging: true },
      extraction: {},
      created_at: '2026-08-14T00:00:00Z',
      updated_at: '2026-08-14T00:00:00Z'
    })
    render(<PaperScanReview onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /saved scans/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Staged batch' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Open Staged batch' }))

    // Returns to batch preparation with the sheet restored, NOT to Review.
    await waitFor(() => expect(screen.getByText('Sheets (1)')).toBeTruthy())
    expect(screen.getByRole('button', { name: /camera capture/i })).toBeTruthy()
    expect(screen.queryByText(/Review extracted data/i)).toBeNull()
    expect(screen.queryByText(/people found/i)).toBeNull()
    expect(screen.getAllByText('Saved').length).toBeGreaterThan(0)
    // The unprocessed sheet stays ready for processing.
    expect(screen.getByRole('button', { name: /continue/i })).toBeTruthy()
  })

  it('rejects an unsupported image format with a clear message', async () => {
    mocks.validateImageFile.mockImplementation((file) => {
      if (file.type === 'image/gif') return { ok: false, reason: 'Unsupported image format. Use JPG, PNG, or WEBP.' }
      return { ok: true }
    })
    render(<PaperScanReview onBack={() => {}} />)
    const input = screen.getByLabelText('Upload an image')
    fireEvent.change(input, {
      target: { files: [new File(['gif'], 'x.gif', { type: 'image/gif' })] }
    })
    await waitFor(() => expect(screen.getByText(/unsupported image format/i)).toBeTruthy())
    expect(screen.queryByText('Sheets (1)')).toBeNull()
  })
})
