// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentCameraModal from './DocumentCameraModal'

const mocks = vi.hoisted(() => ({
  detectDocumentCorners: vi.fn(),
  drawDocumentOutline: vi.fn(),
  straightenDocument: vi.fn(),
  getQrCameraConstraintCandidates: vi.fn(),
  getSession: vi.fn(),
  canvasToDataUrl: vi.fn()
}))

vi.mock('../utils/documentScan', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    detectDocumentCorners: mocks.detectDocumentCorners,
    smoothCorners: (previous, next) => (next ? next.map((p) => ({ x: p.x, y: p.y })) : null)
  }
})

vi.mock('../utils/paperScanCamera', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    drawDocumentOutline: mocks.drawDocumentOutline,
    straightenDocument: mocks.straightenDocument
  }
})

vi.mock('../utils/paperScanImage', () => ({
  canvasToDataUrl: mocks.canvasToDataUrl
}))

vi.mock('../utils/qrCheckIn', () => ({
  getQrCameraConstraintCandidates: mocks.getQrCameraConstraintCandidates
}))

const CORNERS = () => [
  { x: 20, y: 20 },
  { x: 300, y: 25 },
  { x: 305, y: 420 },
  { x: 15, y: 415 }
]

const makeStream = () => {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({}),
    applyConstraints: vi.fn().mockResolvedValue()
  }
  return {
    stream: {
      getVideoTracks: () => [track],
      getTracks: () => [track],
      track
    },
    track
  }
}

const installFakeMediaDevices = (streamInfo) => {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: 'videoinput', deviceId: 'cam-a', label: 'Front' },
        { kind: 'videoinput', deviceId: 'cam-b', label: 'Back' }
      ]),
      getUserMedia: vi.fn().mockResolvedValue(streamInfo.stream)
    }
  })
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue()
  })
  Object.defineProperty(window.HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => 1280
  })
  Object.defineProperty(window.HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => 720
  })
  // The modal boots detection only once the video reports a layout size.
  Object.defineProperty(window.HTMLVideoElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 400, height: 720, left: 0, top: 0, right: 400, bottom: 720, x: 0, y: 0, toJSON: () => ({}) })
  })
}

// jsdom has no real 2D canvas; give analysis + capture draws a minimal stub.
const installFakeCanvas2d = () => {
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        width: 1,
        height: 1,
        data: new Uint8ClampedArray([0, 0, 0, 255])
      })),
      putImageData: vi.fn(),
      setTransform: vi.fn(),
      clearRect: vi.fn()
    }))
  })
}

// Give the crop preview a measurable box so pointer math in tests works.
const installPreviewRect = () => {
  Object.defineProperty(window.Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 400, height: 400, left: 0, top: 0, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
  })
}

const openModal = () => render(<DocumentCameraModal isOpen onClose={() => {}} onCaptured={() => {}} />)

describe('DocumentCameraModal camera lifecycle', () => {
  beforeEach(() => {
    mocks.getQrCameraConstraintCandidates.mockReturnValue([
      { audio: false, video: { facingMode: { exact: 'environment' } } },
      { audio: false, video: true }
    ])
    mocks.canvasToDataUrl.mockReturnValue('data:image/jpeg;base64,ZmFrZQ==')
    mocks.detectDocumentCorners.mockReturnValue(null)
    mocks.drawDocumentOutline.mockImplementation(() => {})
    mocks.straightenDocument.mockResolvedValue('data:image/jpeg;base64,ZmFrZQ==')
    installFakeCanvas2d()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
    delete window.navigator.mediaDevices
  })

  it('opens the camera, shows detection status, and stops tracks on close', async () => {
    const streamInfo = makeStream()
    installFakeMediaDevices(streamInfo)
    const { rerender } = render(<DocumentCameraModal isOpen onClose={() => {}} onCaptured={() => {}} />)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Capture paper sheet' })).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    expect(screen.getByText('SEARCHING FOR DOCUMENT')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Capture sheet' })).toBeTruthy()

    rerender(<DocumentCameraModal isOpen={false} onClose={() => {}} onCaptured={() => {}} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(streamInfo.track.stop).toHaveBeenCalled()
  })

  it('hides the torch control when the track does not support it', async () => {
    const streamInfo = makeStream()
    streamInfo.track.getCapabilities = () => ({})
    installFakeMediaDevices(streamInfo)
    openModal()
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /flashlight/i })).toBeNull()
  })

  it('shows the torch control when the track advertises it', async () => {
    const streamInfo = makeStream()
    streamInfo.track.getCapabilities = () => ({ torch: true })
    installFakeMediaDevices(streamInfo)
    openModal()
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /turn flashlight on/i })).toBeTruthy()
  })

  it('switches the auto capture toggle', async () => {
    const streamInfo = makeStream()
    installFakeMediaDevices(streamInfo)
    openModal()
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    const toggle = screen.getByRole('button', { name: /Auto capture/i })
    expect(toggle.textContent).toContain('On')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: /Auto capture/i }).textContent).toContain('Off')
    expect(screen.getByText('SEARCHING FOR DOCUMENT')).toBeTruthy()
  })

  it('shows a friendly error when the camera permission is denied', async () => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
      }
    })
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue()
    })
    openModal()
    await waitFor(() => expect(screen.getByText(/Camera access was blocked/)).toBeTruthy())
  })

  it('runs the detection loop and stops it on unmount', async () => {
    vi.useFakeTimers()
    const streamInfo = makeStream()
    installFakeMediaDevices(streamInfo)
    const { unmount } = openModal()
    await act(async () => {
      await Promise.resolve()
    })
    vi.advanceTimersByTime(3000)
    // Detection runs once the boot poll sees the video layout; even a null
    // result keeps the loop alive (no throw).
    expect(mocks.detectDocumentCorners).toHaveBeenCalled()
    const callsAt3s = mocks.detectDocumentCorners.mock.calls.length
    unmount()
    const after = mocks.detectDocumentCorners.mock.calls.length
    vi.advanceTimersByTime(1000)
    expect(mocks.detectDocumentCorners.mock.calls.length).toBe(after)
    expect(after).toBeGreaterThanOrEqual(callsAt3s)
    expect(streamInfo.track.stop).toHaveBeenCalled()
  })
})

describe('DocumentCameraModal capture and crop', () => {
  beforeEach(() => {
    mocks.getQrCameraConstraintCandidates.mockReturnValue([{ audio: false, video: true }])
    mocks.canvasToDataUrl.mockReturnValue('data:image/jpeg;base64,ZmFrZQ==')
    mocks.detectDocumentCorners.mockReturnValue(null)
    mocks.drawDocumentOutline.mockImplementation(() => {})
    mocks.straightenDocument.mockResolvedValue('data:image/jpeg;base64,ZmFrZQ==')
    installFakeCanvas2d()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
    delete window.navigator.mediaDevices
  })

  it('manual capture works even without a detected document and opens the crop stage', async () => {
    const streamInfo = makeStream()
    installFakeMediaDevices(streamInfo)
    openModal()
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Capture sheet' }))
    })
    await waitFor(() => expect(screen.getByText('Adjust the scan')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Retake' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Apply Crop' })).toBeTruthy()
    // No detection => 4 default handles still rendered.
    expect(screen.getByRole('button', { name: 'Corner 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Corner 4' })).toBeTruthy()
    expect(screen.getByText(/No document detected/)).toBeTruthy()
  })

  it('uses detected corners as the default crop handles when present', async () => {
    vi.useFakeTimers()
    mocks.detectDocumentCorners.mockReturnValue(CORNERS())
    const streamInfo = makeStream()
    installFakeMediaDevices(streamInfo)
    openModal()
    // Disable auto capture so manual shutter controls when we capture.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    fireEvent.click(screen.getByRole('button', { name: /Auto capture/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    vi.useRealTimers()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Capture sheet' }))
    })
    await waitFor(() => expect(screen.getByText('Adjust the scan')).toBeTruthy())
    expect(screen.queryByText(/No document detected/)).toBeNull()
  })

  it('renders default handles and Reset restores them (drag math covered by documentScan)', async () => {
    installPreviewRect()
    const streamInfo = makeStream()
    installFakeMediaDevices(streamInfo)
    openModal()
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Capture sheet' }))
    })
    await waitFor(() => expect(screen.getByText('Adjust the scan')).toBeTruthy())

    // Defaults sit at 8% / 92% corners.
    expect(parseFloat(screen.getByRole('button', { name: 'Corner 1' }).style.left)).toBeCloseTo(8, 0)
    expect(parseFloat(screen.getByRole('button', { name: 'Corner 3' }).style.left)).toBeCloseTo(92, 0)
    expect(parseFloat(screen.getByRole('button', { name: 'Corner 3' }).style.top)).toBeCloseTo(92, 0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    })
    expect(parseFloat(screen.getByRole('button', { name: 'Corner 1' }).style.left)).toBeCloseTo(8, 0)
  })

  it('moves a corner when it is dragged (via dispatched pointer events)', async () => {
    installPreviewRect()
    const streamInfo = makeStream()
    installFakeMediaDevices(streamInfo)
    openModal()
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Capture sheet' }))
    })
    await waitFor(() => expect(screen.getByText('Adjust the scan')).toBeTruthy())

    const handle = screen.getByRole('button', { name: 'Corner 1' })
    const withCoords = (type) => {
      const event = document.createEvent('Event')
      event.initEvent(type, true, true)
      Object.defineProperty(event, 'clientX', { value: 200 })
      Object.defineProperty(event, 'clientY', { value: 240 })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      return event
    }
    await act(async () => {
      handle.dispatchEvent(withCoords('pointerdown'))
    })
    await act(async () => {
      document.querySelector(`[aria-label="Corner 1"]`)?.dispatchEvent(withCoords('pointermove'))
    })
    // 400x400 box => 200/400 = 50%.
    const moved = screen.getByRole('button', { name: 'Corner 1' })
    expect(parseFloat(moved.style.left)).toBeCloseTo(50, 0)
    expect(parseFloat(moved.style.top)).toBeCloseTo(60, 0)
  })

  it('retake returns to the live camera view', async () => {
    const streamInfo = makeStream()
    installFakeMediaDevices(streamInfo)
    openModal()
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Capture sheet' }))
    })
    await waitFor(() => expect(screen.getByText('Adjust the scan')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retake' }))
    })
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Capture sheet' })).toBeTruthy()
  })

  it('apply crop straightens and emits the result then closes', async () => {
    const onCaptured = vi.fn()
    const onClose = vi.fn()
    const streamInfo = makeStream()
    installFakeMediaDevices(streamInfo)
    render(<DocumentCameraModal isOpen onClose={onClose} onCaptured={onCaptured} />)
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Capture sheet' }))
    })
    await waitFor(() => expect(screen.getByText('Adjust the scan')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply Crop' }))
    })
    await waitFor(() => expect(onCaptured).toHaveBeenCalled())
    expect(onCaptured).toHaveBeenCalledWith('data:image/jpeg;base64,ZmFrZQ==')
    expect(onClose).toHaveBeenCalled()
  })

  it('falls back to the raw frame if straightening fails', async () => {
    mocks.straightenDocument.mockRejectedValue(new Error('warp failed'))
    const onCaptured = vi.fn()
    const onClose = vi.fn()
    const streamInfo = makeStream()
    installFakeMediaDevices(streamInfo)
    render(<DocumentCameraModal isOpen onClose={onClose} onCaptured={onCaptured} />)
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Capture sheet' }))
    })
    await waitFor(() => expect(screen.getByText('Adjust the scan')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply Crop' }))
    })
    await waitFor(() => expect(onCaptured).toHaveBeenCalledWith('data:image/jpeg;base64,ZmFrZQ=='))
  })

  it('upload-photo alternative bypasses the camera and emits the chosen file', async () => {
    const onCaptured = vi.fn()
    const onClose = vi.fn()
    const streamInfo = makeStream()
    installFakeMediaDevices(streamInfo)
    render(<DocumentCameraModal isOpen onClose={onClose} onCaptured={onCaptured} />)
    await waitFor(() => expect(screen.getByText(/Point at the sheet/)).toBeTruthy())
    const file = new File(['fake-image'], 'photo.png', { type: 'image/png' })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Upload photo instead'), { target: { files: [file] } })
    })
    await waitFor(() => expect(onCaptured).toHaveBeenCalled())
    expect(onCaptured.mock.calls[0][0]).toMatch(/^data:image\/png;base64,/)
    expect(onClose).toHaveBeenCalled()
    expect(streamInfo.track.stop).toHaveBeenCalled()
  })
})