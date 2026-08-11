// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENHANCEMENT_PRESET_IDS,
  ENHANCEMENT_PRESETS,
  PRESET_DEFAULT_INTENSITY,
  applyEnhancement,
  canvasToDataUrl,
  clampByte,
  clampIntensity,
  drawImageToCanvas,
  validateImageFile
} from './paperScanImage'

const fakeImage = (width, height) => ({
  naturalWidth: width,
  naturalHeight: height
})

const makeContext = (pixelData) => ({
  drawImage: vi.fn(),
  getImageData: vi.fn((_x, _y, width, height) => ({
    data: pixelData || new Uint8ClampedArray(width * height * 4)
  })),
  putImageData: vi.fn(),
  filter: ''
})

const installFakeCanvas = (pixelData) => {
  const originalCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag !== 'canvas') return originalCreateElement(tag)
    const canvas = originalCreateElement('canvas')
    canvas.getContext = vi.fn(() => makeContext(pixelData))
    canvas.toDataURL = vi.fn(() => 'data:image/jpeg;base64,fake')
    return canvas
  })
}

const readBack = (canvas) => canvas.getContext().getImageData(0, 0, canvas.width, canvas.height).data

describe('paperScanImage presets', () => {
  it('exposes the five phase-1 enhancement presets', () => {
    expect(ENHANCEMENT_PRESETS.map((preset) => preset.id)).toEqual([
      'original',
      'grayscale',
      'high-contrast',
      'darken-handwriting',
      'sharpen'
    ])
    expect(ENHANCEMENT_PRESET_IDS).toHaveLength(5)
  })
})

describe('validateImageFile', () => {
  it('rejects no file', () => {
    expect(validateImageFile(null).ok).toBe(false)
  })

  it('rejects non-image files', () => {
    expect(validateImageFile({ type: 'text/plain', size: 10 }).ok).toBe(false)
  })

  it('rejects empty files', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: 0 }).ok).toBe(false)
    expect(validateImageFile({ type: 'image/jpeg', size: -1 }).ok).toBe(false)
  })

  it('accepts a non-empty image file', () => {
    expect(validateImageFile({ type: 'image/png', size: 1024 }).ok).toBe(true)
  })
})

describe('clampByte', () => {
  it('clamps into the 0..255 byte range', () => {
    expect(clampByte(-5)).toBe(0)
    expect(clampByte(300)).toBe(255)
    expect(clampByte(128.4)).toBe(128)
  })
})

describe('clampIntensity', () => {
  it('clamps into the 0..100 range and rounds', () => {
    expect(clampIntensity(-10)).toBe(0)
    expect(clampIntensity(150)).toBe(100)
    expect(clampIntensity(42.6)).toBe(43)
    expect(clampIntensity(0)).toBe(0)
    expect(clampIntensity(100)).toBe(100)
  })
})

describe('PRESET_DEFAULT_INTENSITY', () => {
  it('gives every non-original preset a default intensity in range and original none', () => {
    expect(PRESET_DEFAULT_INTENSITY.original).toBeNull()
    for (const preset of ENHANCEMENT_PRESETS) {
      if (preset.id === 'original') continue
      expect(PRESET_DEFAULT_INTENSITY[preset.id]).toBeGreaterThanOrEqual(0)
      expect(PRESET_DEFAULT_INTENSITY[preset.id]).toBeLessThanOrEqual(100)
    }
  })
})

describe('applyEnhancement', () => {
  afterEach(() => vi.restoreAllMocks())

  it('draws an image onto a downscaled canvas', () => {
    installFakeCanvas()
    const canvas = drawImageToCanvas(fakeImage(4000, 2000))
    expect(canvas).not.toBeNull()
    expect(canvas.width).toBe(2000)
    expect(canvas.height).toBe(1000)
  })

  it('returns original canvas untouched when preset is original', () => {
    installFakeCanvas()
    const canvas = applyEnhancement(fakeImage(100, 100), 'original')
    expect(canvas).not.toBeNull()
    expect(canvas.toDataURL()).toBe('data:image/jpeg;base64,fake')
  })

  it('grayscale writes luminance to every channel', () => {
    const data = new Uint8ClampedArray([10, 200, 40, 255])
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(1, 1), 'grayscale')
    const out = readBack(canvas)
    const gray = Math.round(0.299 * 10 + 0.587 * 200 + 0.114 * 40)
    expect(out[0]).toBe(gray)
    expect(out[1]).toBe(gray)
    expect(out[2]).toBe(gray)
  })

  it('high contrast pushes dark values darker and light values lighter', () => {
    installFakeCanvas(new Uint8ClampedArray([120, 120, 120, 255]))
    const darkCanvas = applyEnhancement(fakeImage(1, 1), 'high-contrast')
    expect(readBack(darkCanvas)[0]).toBeLessThan(120)

    installFakeCanvas(new Uint8ClampedArray([136, 136, 136, 255]))
    const lightCanvas = applyEnhancement(fakeImage(1, 1), 'high-contrast')
    expect(readBack(lightCanvas)[0]).toBeGreaterThan(136)
  })

  it('darken handwriting pushes dark ink darker', () => {
    const data = new Uint8ClampedArray([20, 20, 20, 255])
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(1, 1), 'darken-handwriting')
    expect(readBack(canvas)[0]).toBeLessThan(20)
  })

  it('grayscale at 0 intensity leaves pixels unchanged', () => {
    const data = new Uint8ClampedArray([10, 200, 40, 255])
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(1, 1), 'grayscale', { intensity: 0 })
    const out = readBack(canvas)
    expect(out[0]).toBe(10)
    expect(out[1]).toBe(200)
    expect(out[2]).toBe(40)
  })

  it('grayscale at full intensity matches the pure preset', () => {
    const data = new Uint8ClampedArray([10, 200, 40, 255])
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(1, 1), 'grayscale', { intensity: 100 })
    const out = readBack(canvas)
    const gray = Math.round(0.299 * 10 + 0.587 * 200 + 0.114 * 40)
    expect(out[0]).toBe(gray)
    expect(out[1]).toBe(gray)
    expect(out[2]).toBe(gray)
  })

  it('grayscale intensity blends between original and full gray', () => {
    const original = [10, 200, 40]
    installFakeCanvas(new Uint8ClampedArray([...original, 255]))
    const canvas = applyEnhancement(fakeImage(1, 1), 'grayscale', { intensity: 50 })
    const out = readBack(canvas)
    const gray = Math.round(0.299 * 10 + 0.587 * 200 + 0.114 * 40)
    out.slice(0, 3).forEach((value, channel) => {
      expect(value).toBe(Math.round(original[channel] + (gray - original[channel]) * 0.5))
    })
  })

  it('high contrast weakens as intensity drops toward 0', () => {
    installFakeCanvas(new Uint8ClampedArray([120, 120, 120, 255]))
    const full = readBack(applyEnhancement(fakeImage(1, 1), 'high-contrast', { intensity: 100 }))[0]
    installFakeCanvas(new Uint8ClampedArray([120, 120, 120, 255]))
    const half = readBack(applyEnhancement(fakeImage(1, 1), 'high-contrast', { intensity: 50 }))[0]
    expect(half).toBeGreaterThan(full)
    expect(half).toBeLessThan(120)
  })

  it('sharpen keeps the buffer length and finite values', () => {
    const width = 2
    const height = 1
    const data = new Uint8ClampedArray([10, 20, 30, 255, 200, 210, 220, 255])
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(width, height), 'sharpen')
    const out = readBack(canvas)
    expect(out.length).toBe(data.length)
    out.forEach((value) => expect(Number.isFinite(value)).toBe(true))
  })

  it('sharpen handles a 1px-wide image without throwing', () => {
    const width = 1
    const height = 3
    const data = new Uint8ClampedArray([50, 60, 70, 255, 80, 90, 100, 255, 110, 120, 130, 255])
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(width, height), 'sharpen')
    const out = readBack(canvas)
    expect(out.length).toBe(data.length)
    out.forEach((value) => expect(Number.isFinite(value)).toBe(true))
  })

  it('sharpen handles a 1px-tall image without throwing', () => {
    const width = 3
    const height = 1
    const data = new Uint8ClampedArray([50, 60, 70, 255, 80, 90, 100, 255, 110, 120, 130, 255])
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(width, height), 'sharpen')
    const out = readBack(canvas)
    expect(out.length).toBe(data.length)
    out.forEach((value) => expect(Number.isFinite(value)).toBe(true))
  })

  it('falls back to the un-enhanced canvas when pixel access is unavailable', () => {
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return originalCreateElement(tag)
      const canvas = originalCreateElement('canvas')
      canvas.getContext = vi.fn(() => ({
        drawImage: vi.fn(),
        getImageData: vi.fn(() => { throw new Error('unavailable') }),
        putImageData: vi.fn(),
        filter: ''
      }))
      canvas.toDataURL = vi.fn(() => 'data:image/jpeg;base64,fake')
      return canvas
    })
    const canvas = applyEnhancement(fakeImage(10, 10), 'grayscale')
    expect(canvas).not.toBeNull()
    expect(canvas.toDataURL()).toBe('data:image/jpeg;base64,fake')
  })

  it('serializes a canvas to a data url and handles null', () => {
    installFakeCanvas()
    const canvas = drawImageToCanvas(fakeImage(50, 50))
    expect(canvasToDataUrl(canvas)).toBe('data:image/jpeg;base64,fake')
    expect(canvasToDataUrl(null)).toBeNull()
  })
})
