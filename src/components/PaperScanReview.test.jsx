// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PaperScanReview from './PaperScanReview'

const mocks = vi.hoisted(() => ({
  applyEnhancement: vi.fn(),
  canvasToDataUrl: vi.fn(),
  loadImageElement: vi.fn(),
  readFileAsDataUrl: vi.fn(),
  validateImageFile: vi.fn(),
  getQrCameraConstraintCandidates: vi.fn()
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
  loadImageElement: mocks.loadImageElement,
  readFileAsDataUrl: mocks.readFileAsDataUrl,
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
    mocks.readFileAsDataUrl.mockResolvedValue(FAKE_DATA_URL)
    mocks.loadImageElement.mockResolvedValue({ naturalWidth: 100, naturalHeight: 100 })
    mocks.applyEnhancement.mockReturnValue({})
    mocks.canvasToDataUrl.mockReturnValue(FAKE_ENHANCED)
    mocks.getQrCameraConstraintCandidates.mockReturnValue([])
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
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText(/Processing sheets/)).toBeTruthy()
    expect(screen.getByText('1 sheet in this batch')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByText('Ready for AI connection')).toBeTruthy()
    expect(screen.getByText(/not connected yet/)).toBeTruthy()
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
    expect(screen.getByText(/Hold the sheet steady/)).toBeTruthy()
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
