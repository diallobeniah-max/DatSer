// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  analysisToDisplay,
  coverScale,
  createDetectionLoop,
  defaultSheetCorners,
  displayCornersToVideo,
  drawDocumentOutline,
  scaleCornersToVideo,
  setTorch,
  torchSupported
} from './paperScanCamera'

const corners = () => [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 80 },
  { x: 0, y: 80 }
]

describe('paperScanCamera cover math', () => {
  it('coverScale fills the display box (crops overflow)', () => {
    // Landscape video, portrait display: scale matches height so vertical fills.
    expect(coverScale(1920, 1080, 400, 720)).toBeCloseTo(0.6667, 3)
    // Identical aspect => pure fit.
    expect(coverScale(1000, 500, 200, 100)).toBeCloseTo(0.2, 3)
  })

  it('displayCornersToVideo maps display-space corners back into the source frame', () => {
    const mid = corners().map((p) => ({ x: p.x + 50, y: p.y + 40 }))
    const mapped = displayCornersToVideo({
      corners: mid,
      videoWidth: 1000,
      videoHeight: 500,
      displayWidth: 200,
      displayHeight: 100
    })
    // Same aspect ratio => identity-ish mapping: display 200x100 = video 1000x500 at scale 0.2.
    expect(mapped[0].x).toBeCloseTo(250, 6)
    expect(mapped[0].y).toBeCloseTo(200, 6)
  })

  it('displayCornersToVideo accounts for cover cropping on a mismatched aspect', () => {
    const mapped = displayCornersToVideo({
      corners: corners(),
      videoWidth: 1920,
      videoHeight: 1080,
      displayWidth: 400,
      displayHeight: 720
    })
    // scale = 720/1080 = 0.6667; offsetX = (1920*0.6667 - 400)/(2*0.6667) = 660
    expect(mapped[0].x).toBeCloseTo(660, 1)
    expect(mapped[1].x).toBeCloseTo(810, 1)
  })

  it('returns null for missing inputs', () => {
    expect(displayCornersToVideo({ corners: null, videoWidth: 10, videoHeight: 10, displayWidth: 10, displayHeight: 10 })).toBeNull()
    expect(displayCornersToVideo({ corners: corners(), videoWidth: 0, videoHeight: 0, displayWidth: 10, displayHeight: 10 })).toBeNull()
  })

  it('analysisToDisplay scales corners to the display box', () => {
    const mapped = analysisToDisplay({
      corners: corners(),
      analysisWidth: 320,
      analysisHeight: 240,
      displayWidth: 480,
      displayHeight: 360
    })
    expect(mapped[2]).toMatchObject({ x: 150, y: 120 })
  })

  it('scaleCornersToVideo scales analysis corners to full video resolution', () => {
    const scaled = scaleCornersToVideo(corners(), 320, 240, 1920, 1080)
    expect(scaled[2]).toMatchObject({ x: 600, y: 360 })
  })

  it('defaultSheetCorners insets 8% around the frame', () => {
    const ledges = defaultSheetCorners(1000, 500)
    expect(ledges[0]).toMatchObject({ x: 80, y: 40 })
    expect(ledges[2]).toMatchObject({ x: 920, y: 460 })
  })
})

describe('paperScanCamera torch', () => {
  const trackWith = (capabilities) => ({ getCapabilities: () => capabilities, applyConstraints: vi.fn().mockResolvedValue() })

  it('reports true only when the track advertises torch', () => {
    expect(torchSupported(trackWith({ torch: true }))).toBe(true)
    expect(torchSupported(trackWith({}))).toBe(false)
    expect(torchSupported(null)).toBe(false)
    expect(torchSupported({ getCapabilities: () => { throw new Error('nope') } })).toBe(false)
  })

  it('toggles torch only when supported', async () => {
    const supported = trackWith({ torch: true })
    await setTorch(supported, true)
    expect(supported.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] })
    const unsupported = trackWith({})
    expect(await setTorch(unsupported, true)).toBe(false)
    expect(unsupported.applyConstraints).not.toHaveBeenCalled()
  })

  it('returns false when applyConstraints throws', async () => {
    const failing = { getCapabilities: () => ({ torch: true }), applyConstraints: vi.fn().mockRejectedValue(new Error('denied')) }
    expect(await setTorch(failing, true)).toBe(false)
  })
})

describe('paperScanCamera detection loop', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks on the configured interval and stops cleanly', () => {
    vi.useFakeTimers()
    const tick = vi.fn()
    const loop = createDetectionLoop({ intervalMs: 100, tick })
    loop.start()
    vi.advanceTimersByTime(250)
    expect(tick).toHaveBeenCalledTimes(2)
    loop.stop()
    vi.advanceTimersByTime(300)
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('is idempotent on start and stop', () => {
    vi.useFakeTimers()
    const tick = vi.fn()
    const loop = createDetectionLoop({ intervalMs: 100, tick })
    loop.start()
    loop.start()
    vi.advanceTimersByTime(100)
    expect(tick).toHaveBeenCalledTimes(1)
    loop.stop()
    loop.stop()
    vi.advanceTimersByTime(200)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('swallows tick exceptions so the camera never dies', () => {
    vi.useFakeTimers()
    const loop = createDetectionLoop({ intervalMs: 100, tick: () => { throw new Error('cv failed') } })
    loop.start()
    expect(() => vi.advanceTimersByTime(250)).not.toThrow()
    loop.stop()
  })
})

describe('paperScanCamera outline', () => {
  it('clears and redraws when a canvas context exists', () => {
    const context = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      set strokeStyle(value) {},
      set lineWidth(value) {},
      set fillStyle(value) {}
    }
    const canvas = { width: 320, height: 240, getContext: () => context }
    drawDocumentOutline({ canvas, corners: corners(), confirmed: true })
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 320, 240)
    expect(context.stroke).toHaveBeenCalled()
    expect(context.fill).toHaveBeenCalled()
  })

  it('returns silently without a context', () => {
    const canvas = { width: 10, height: 10, getContext: () => null }
    expect(() => drawDocumentOutline({ canvas, corners: corners() })).not.toThrow()
  })
})