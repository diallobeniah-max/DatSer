// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENHANCEMENT_PRESET_IDS,
  ENHANCEMENT_PRESETS,
  ENHANCEMENT_TYPE_LABEL,
  MAX_INPUT_FILE_BYTES,
  PRESET_DEFAULT_INTENSITY,
  applyEnhancement,
  canvasToDataUrl,
  clampByte,
  clampIntensity,
  decodeOrientedImage,
  drawImageToCanvas,
  fitSheetForUpload,
  MAX_SHEET_UPLOAD_BYTES,
  prepareSheetForUpload,
  validateImageDimensions,
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
  it('exposes the phase-1 presets plus the phase-4b document presets', () => {
    expect(ENHANCEMENT_PRESETS.map((preset) => preset.id)).toEqual([
      'original',
      'auto',
      'grayscale',
      'black-white',
      'high-contrast',
      'darken-handwriting',
      'sharpen'
    ])
    expect(ENHANCEMENT_PRESET_IDS).toHaveLength(7)
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

  it('rejects an unsupported image MIME before upload (never silently reinterpreted)', () => {
    expect(validateImageFile({ type: 'image/gif', size: 1024 }).ok).toBe(false)
    expect(validateImageFile({ type: 'image/tiff', size: 1024 }).ok).toBe(false)
    expect(validateImageFile({ type: 'image/heic', size: 1024 }).ok).toBe(false)
    const result = validateImageFile({ type: 'image/gif', size: 1024 })
    expect(result.reason).toMatch(/unsupported/i)
  })

  it('rejects a file with no declared MIME type', () => {
    expect(validateImageFile({ size: 1024 }).ok).toBe(false)
  })

  it('accepts the three supported formats only', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateImageFile({ type, size: 1024 }).ok).toBe(true)
    }
  })

  it('rejects an input file above the byte sanity limit', () => {
    const result = validateImageFile({ type: 'image/jpeg', size: MAX_INPUT_FILE_BYTES + 1 })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/too large/i)
  })
})

describe('validateImageDimensions / decoded pixel limit', () => {
  it('rejects an image with no readable dimensions', () => {
    expect(validateImageDimensions({ naturalWidth: 0, naturalHeight: 100 }).ok).toBe(false)
    expect(validateImageDimensions(null).ok).toBe(false)
  })

  it('accepts an ordinary photo well under the decoded pixel budget', () => {
    const result = validateImageDimensions(fakeImage(6000, 4000))
    expect(result.ok).toBe(true)
    expect(result.pixels).toBe(24_000_000)
  })

  it('rejects a pathological oversized image before any canvas work', () => {
    const result = validateImageDimensions(fakeImage(100_000, 100_000))
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/too large/)
  })

  it('rejects an image at exactly the pathological boundary', () => {
    // 20000 x 3001 = 60_020_000 > 60_000_000
    expect(validateImageDimensions(fakeImage(20000, 3001)).ok).toBe(false)
  })

  it('drawImageToCanvas refuses to allocate for an oversized image', () => {
    installFakeCanvas()
    expect(drawImageToCanvas(fakeImage(100_000, 100_000))).toBeNull()
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
  it('gives every intensity-based preset a default intensity in range and pass-through presets none', () => {
    expect(PRESET_DEFAULT_INTENSITY.original).toBeNull()
    expect(PRESET_DEFAULT_INTENSITY.auto).toBeNull()
    for (const preset of ENHANCEMENT_PRESETS) {
      if (preset.id === 'original' || preset.id === 'auto') continue
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

  it('auto stretches a dim exposure to deepen shadows and lift highlights', () => {
    // 3x1: a dark pixel, a mid pixel, a bright pixel.
    const width = 3
    const height = 1
    const data = new Uint8ClampedArray([20, 20, 20, 255, 128, 128, 128, 255, 230, 230, 230, 255])
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(width, height), 'auto')
    const out = readBack(canvas)
    expect(Number.isFinite(out[0])).toBe(true)
    // 20% percentile stretch: the darkest pixel darkens, the brightest lifts.
    expect(out[0]).toBeLessThan(20)
    expect(out[8]).toBeGreaterThan(230)
  })

  it('auto never emits NaN or out-of-range bytes', () => {
    const width = 5
    const height = 5
    const data = new Uint8ClampedArray(width * height * 4).map((_, index) => (index % 4 === 3 ? 255 : index * 7 % 256))
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(width, height), 'auto')
    const out = readBack(canvas)
    expect(out.length).toBe(data.length)
    out.forEach((value) => {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(255)
    })
  })

  it('auto writes luminance to all three channels (no color cast left)', () => {
    const width = 2
    const height = 1
    const data = new Uint8ClampedArray([60, 180, 90, 255, 200, 20, 140, 255])
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(width, height), 'auto')
    const out = readBack(canvas)
    for (let pixel = 0; pixel < 2; pixel += 1) {
      const r = out[pixel * 4]
      const g = out[pixel * 4 + 1]
      const b = out[pixel * 4 + 2]
      expect(Math.abs(r - g) < 32 && Math.abs(g - b) < 32).toBe(true)
    }
  })

  it('black-white pushes a dark stroke to near-black and paper to near-white', () => {
    // 3x3 with a single dark stroke pixel in the center of a bright page.
    const width = 3
    const height = 3
    const data = new Uint8ClampedArray(width * height * 4).fill(255)
    const center = (1 * width + 1) * 4
    data[center] = 30
    data[center + 1] = 30
    data[center + 2] = 30
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(width, height), 'black-white', { intensity: 100 })
    const out = readBack(canvas)
    expect(out[center]).toBeLessThan(60)
    expect(out[0]).toBeGreaterThan(200)
  })

  it('black-white adapts through lighting gradients (works on a vignetted page)', () => {
    const width = 5
    const height = 1
    // Page brightness falls off from left (230) to right (150); a dark stroke
    // sits in the middle. A global threshold would blow this away; adaptive
    // thresholding still sees the stroke.
    const data = new Uint8ClampedArray([
      230, 230, 230, 255,
      230, 230, 230, 255,
      60, 60, 60, 255,
      200, 200, 200, 255,
      150, 150, 150, 255
    ])
    installFakeCanvas(data)
    const canvas = applyEnhancement(fakeImage(width, height), 'black-white')
    const out = readBack(canvas)
    // Stroke pixel (index 2) is darker than both its brighter neighbors.
    expect(out[2 * 4]).toBeLessThan(out[0 * 4])
    expect(out[2 * 4]).toBeLessThan(out[4 * 4])
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

  it('labels every preset including the document presets', () => {
    expect(Object.keys(ENHANCEMENT_TYPE_LABEL).sort()).toEqual(ENHANCEMENT_PRESET_IDS.slice().sort())
    expect(ENHANCEMENT_TYPE_LABEL.auto).toBe('Auto')
    expect(ENHANCEMENT_TYPE_LABEL['black-white']).toBe('Black & White')
  })
})

describe('fitSheetForUpload', () => {
  afterEach(() => vi.restoreAllMocks())

  // Spies on document.createElement with a fake canvas whose toDataURL yields a
  // data URL whose length depends on the canvas width, recording every encode
  // attempt (width + quality) so the downscale ladder is observable.
  const stubEncodedCanvas = (sizeFor) => {
    const calls = []
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return originalCreateElement(tag)
      const canvas = originalCreateElement('canvas')
      canvas.getContext = vi.fn(() => makeContext())
      canvas.toDataURL = vi.fn((_type, quality) => {
        const dataUrl = `data:image/jpeg;base64,${'a'.repeat(sizeFor(canvas.width, quality))}`
        calls.push({ width: canvas.width, quality })
        return dataUrl
      })
      return canvas
    })
    return calls
  }

  const makeImage = () => fakeImage(4000, 3000)
  const makePreview = (size) => `data:image/jpeg;base64,${'a'.repeat(size)}`

  it('keeps the existing 2000px preview when it already fits the Vercel-safe budget', () => {
    const calls = stubEncodedCanvas(() => 1024)
    const preview = makePreview(1024)
    expect(fitSheetForUpload({ image: makeImage(), existingPreview: preview })).toBe(preview)
    expect(calls).toHaveLength(0)
  })

  it('downscales and re-encodes only until the image fits the budget', () => {
    const calls = stubEncodedCanvas((width) => (width > 1600 ? MAX_SHEET_UPLOAD_BYTES + 1024 : 1024))
    const result = fitSheetForUpload({ image: makeImage(), existingPreview: makePreview(MAX_SHEET_UPLOAD_BYTES + 1024) })
    expect(result.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(MAX_SHEET_UPLOAD_BYTES)
    expect(calls.map((call) => call.width)).toContain(2000)
    expect(calls[calls.length - 1].width).toBe(1600)
    expect(calls[calls.length - 1].quality).toBe(0.9)
  })

  it('returns null when even the smallest acceptable encoding exceeds the budget', () => {
    stubEncodedCanvas(() => MAX_SHEET_UPLOAD_BYTES + 1024)
    expect(fitSheetForUpload({ image: makeImage(), existingPreview: makePreview(MAX_SHEET_UPLOAD_BYTES + 1024) })).toBeNull()
  })
})

describe('prepareSheetForUpload (JPEG normalization)', () => {
  afterEach(() => vi.restoreAllMocks())

  // Fake canvas with toBlob yielding a blob whose byte size depends on the
  // canvas width (and quality), so the resize/quality ladder is observable.
  const installUploadCanvas = (blobSizeFor) => {
    const calls = []
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return originalCreateElement(tag)
      const canvas = originalCreateElement('canvas')
      canvas.getContext = vi.fn(() => makeContext())
      canvas.toBlob = vi.fn((cb, type, quality) => {
        calls.push({ width: canvas.width, height: canvas.height, type, quality })
        cb(new Blob([new Uint8Array(blobSizeFor(canvas.width, quality))], { type: 'image/jpeg' }))
      })
      canvas.toDataURL = vi.fn(() => 'data:image/jpeg;base64,fake')
      return canvas
    })
    return calls
  }

  const smallBlob = () => 4096

  it('normalizes any input to image/jpeg with matching mime, extension, and actual blob bytes', async () => {
    installUploadCanvas(smallBlob)
    const prepared = await prepareSheetForUpload({ image: fakeImage(4000, 3000) })
    expect(prepared.error).toBeUndefined()
    expect(prepared.mimeType).toBe('image/jpeg')
    expect(prepared.extension).toBe('.jpg')
    expect(prepared.blob.type).toBe('image/jpeg')
    expect(prepared.dataUrl.startsWith('data:image/jpeg')).toBe(true)
    expect(prepared.encodedBytes).toBe(prepared.blob.size)
    // 4000x3000 downscaled to the 2000px preview ceiling, aspect preserved.
    expect(prepared.width).toBe(2000)
    expect(prepared.height).toBe(1500)
  })

  it('measures the ACTUAL encoded bytes (Blob.size), not a data-URL length', async () => {
    let blobSize = 1024
    installUploadCanvas(() => blobSize)
    const prepared = await prepareSheetForUpload({ image: fakeImage(1200, 800) })
    expect(prepared.encodedBytes).toBe(blobSize)
    expect(prepared.encodedBytes).toBeLessThanOrEqual(MAX_SHEET_UPLOAD_BYTES)
  })

  it('descends the dimension ladder until the encoded JPEG fits the byte budget', async () => {
    const calls = installUploadCanvas((width) => (width > 1600 ? MAX_SHEET_UPLOAD_BYTES + 1 : 4096))
    const prepared = await prepareSheetForUpload({ image: fakeImage(4000, 3000) })
    expect(prepared.width).toBe(1600)
    expect(prepared.encodedBytes).toBeLessThanOrEqual(MAX_SHEET_UPLOAD_BYTES)
    expect(calls.map((call) => call.width)).toContain(2000)
    expect(calls[calls.length - 1].width).toBe(1600)
  })

  it('returns a friendly error when even the smallest encoding exceeds the budget', async () => {
    installUploadCanvas(() => MAX_SHEET_UPLOAD_BYTES + 1)
    const prepared = await prepareSheetForUpload({ image: fakeImage(4000, 3000) })
    expect(prepared.error).toBeTruthy()
    expect(prepared.error).toMatch(/too large/i)
  })

  it('refuses a pathological source before any canvas allocation', async () => {
    installUploadCanvas(smallBlob)
    const prepared = await prepareSheetForUpload({ image: fakeImage(100_000, 100_000) })
    expect(prepared.error).toBeTruthy()
  })

  it('returns null when no usable image source is provided', async () => {
    expect(await prepareSheetForUpload({ image: null })).toBeNull()
  })

  it('applies EXIF orientation via createImageBitmap when available', async () => {
    const originalBitmap = globalThis.createImageBitmap
    const bitmapClose = vi.fn()
    const bitmap = { width: 1000, height: 2000, close: bitmapClose }
    const createImageBitmap = vi.fn().mockResolvedValue(bitmap)
    Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: createImageBitmap })
    try {
      installUploadCanvas(smallBlob)
      // Source is landscape-oriented (2000x1000); the oriented bitmap is
      // portrait (1000x2000). The prepared surface must use the ORIENTED size.
      const prepared = await prepareSheetForUpload({ image: fakeImage(2000, 1000) })
      expect(createImageBitmap).toHaveBeenCalledWith(expect.anything(), { imageOrientation: 'from-image' })
      expect(prepared.width).toBe(1000)
      expect(prepared.height).toBe(2000)
      expect(bitmapClose).toHaveBeenCalled()
    } finally {
      Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: originalBitmap })
    }
  })

  it('decodeOrientedImage falls back to null without createImageBitmap', async () => {
    const originalBitmap = globalThis.createImageBitmap
    Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: undefined })
    try {
      expect(await decodeOrientedImage({ width: 10, height: 10 })).toBeNull()
    } finally {
      Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: originalBitmap })
    }
  })
})

describe('loadImageElement', () => {
  it('loads remote URLs with crossOrigin anonymous so canvas export is not tainted', async () => {
    const { loadImageElement } = await import('./paperScanImage')
    const instances = []
    const FakeImage = class {
      constructor() {
        this.crossOrigin = ''
        this._onload = null
        this._onerror = null
        instances.push(this)
      }
      set onload(fn) { this._onload = fn }
      get onload() { return this._onload }
      set onerror(fn) { this._onerror = fn }
      get onerror() { return this._onerror }
      set src(value) {
        this._src = value
        queueMicrotask(() => this._onload?.())
      }
      get src() { return this._src }
    }
    const originalImage = globalThis.Image
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage })
    try {
      await loadImageElement('https://example.test/sheet.jpg')
      expect(instances[0].crossOrigin).toBe('anonymous')
    } finally {
      Object.defineProperty(globalThis, 'Image', { configurable: true, value: originalImage })
    }
  })

  it('leaves data URLs without crossOrigin so local images keep loading anywhere', async () => {
    const { loadImageElement } = await import('./paperScanImage')
    const instances = []
    const FakeImage = class {
      constructor() {
        this.crossOrigin = ''
        this._onload = null
        this._onerror = null
        instances.push(this)
      }
      set onload(fn) { this._onload = fn }
      get onload() { return this._onload }
      set onerror(fn) { this._onerror = fn }
      get onerror() { return this._onerror }
      set src(value) {
        this._src = value
        queueMicrotask(() => this._onload?.())
      }
      get src() { return this._src }
    }
    const originalImage = globalThis.Image
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage })
    try {
      await loadImageElement('data:image/jpeg;base64,AAAA')
      expect(instances[0].crossOrigin).toBe('')
    } finally {
      Object.defineProperty(globalThis, 'Image', { configurable: true, value: originalImage })
    }
  })
})