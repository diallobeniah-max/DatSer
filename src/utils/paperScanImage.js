// Local paper-sheet image helpers for Paper Scan Review.
// Phase 1: capture/upload, validation, and client-side enhancement presets only.
// Nothing here touches the network, Gemini, OCR, or Supabase.

export const ENHANCEMENT_PRESETS = [
  { id: 'original', label: 'Original' },
  { id: 'auto', label: 'Auto' },
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'black-white', label: 'Black & White' },
  { id: 'high-contrast', label: 'High Contrast' },
  { id: 'darken-handwriting', label: 'Darken Handwriting' },
  { id: 'sharpen', label: 'Sharpen' }
]

export const ENHANCEMENT_PRESET_IDS = ENHANCEMENT_PRESETS.map((preset) => preset.id)

// 0-100 intensity per preset. Original and Auto are pass-through/decided
// already; the rest expose an intensity slider.
export const PRESET_DEFAULT_INTENSITY = {
  original: null,
  auto: null,
  grayscale: 100,
  'black-white': 85,
  'high-contrast': 75,
  'darken-handwriting': 75,
  sharpen: 50
}

export const clampIntensity = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)))

const MAX_PREVIEW_DIMENSION = 2000

// A decoded raster above this many pixels is rejected before any canvas work.
// 60 megapixels comfortably covers 48 MP phone captures and document scans
// while stopping decompression bombs whose declared dimensions would otherwise
// make the browser allocate gigabytes on decode/draw.
export const MAX_DECODED_PIXELS = 60_000_000

// Input formats we will decode and re-encode to JPEG. Anything else is
// rejected BEFORE upload — we never silently reinterpret an arbitrary file.
export const SUPPORTED_INPUT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

// Input file byte sanity limit: a real camera capture is a few MB; anything
// far larger is either a decompression bomb or not the intended sheet.
export const MAX_INPUT_FILE_BYTES = 25 * 1024 * 1024

// Working-surface ceilings for the bounded resize path. No single canvas is
// ever allowed to exceed these, so an enormous source is downscaled before
// pixel work instead of allocating a full-resolution surface.
export const MAX_WORKING_DIMENSION = 4000
export const MAX_WORKING_PIXELS = 12_000_000

// Returns the decoded pixel count after an Image element loads, rejecting
// empty and pathological dimensions. Call before any canvas allocation so an
// oversized image is refused with a clear reason instead of exhausting memory.
export const validateImageDimensions = (image) => {
  const { width, height } = imageSize(image)
  const pixels = width * height
  if (pixels <= 0) return { ok: false, reason: 'The image has no readable dimensions.' }
  if (pixels > MAX_DECODED_PIXELS) {
    return { ok: false, reason: 'The image is too large to process. Use a photo under 60 megapixels.' }
  }
  return { ok: true, pixels }
}

// Works for Image elements (naturalWidth), ImageBitmap, and canvas sources.
export const imageSize = (source) => ({
  width: Number(source?.naturalWidth) || Number(source?.width) || 0,
  height: Number(source?.naturalHeight) || Number(source?.height) || 0
})

export const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)))

const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b

const clampPixel = (r, g, b) => [clampByte(r), clampByte(g), clampByte(b)]

// Basic upload validation: a file must exist, be one of the supported image
// MIME types (JPEG/PNG/WEBP), hold bytes, and stay under the input byte sanity
// limit. Unsupported formats are rejected clearly BEFORE any decoding, so an
// arbitrary file is never silently reinterpreted.
export const validateImageFile = (file) => {
  if (!file) return { ok: false, reason: 'No file was selected.' }
  if (!file.type) return { ok: false, reason: 'Please choose a supported image file.' }
  if (!SUPPORTED_INPUT_MIME.has(file.type)) {
    return { ok: false, reason: 'Unsupported image format. Use JPG, PNG, or WEBP.' }
  }
  if (!file.size || file.size <= 0) return { ok: false, reason: 'The file appears empty or unreadable.' }
  if (file.size > MAX_INPUT_FILE_BYTES) {
    return { ok: false, reason: 'That image file is too large to process. Use a photo under 25 MB.' }
  }
  return { ok: true }
}

export const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(new Error('Could not read the selected image.'))
  reader.readAsDataURL(file)
})

export const loadImageElement = (src) => new Promise((resolve, reject) => {
  const image = new Image()
  // Remote images (e.g. signed Storage URLs) must be fetched with CORS or any
  // later canvas draw taints and canvas.toBlob rejects, failing encoding for
  // reopened saved scans. Data URLs are unaffected.
  if (typeof src === 'string' && !src.startsWith('data:')) {
    image.crossOrigin = 'anonymous'
  }
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('The image could not be decoded.'))
  image.src = src
})

// Decodes a raster with EXIF orientation applied, so phone captures (e.g. a
// portrait JPEG stored in landscape sensor orientation) render upright. Most
// browsers already orient <img> and drawImage, but createImageBitmap with
// imageOrientation: 'from-image' is the reliable cross-browser path. Returns
// null (caller falls back to the plain source) when unavailable or unsupported.
export const decodeOrientedImage = async (image) => {
  const bitmapFactory = globalThis.createImageBitmap
  if (typeof bitmapFactory !== 'function' || !image) return null
  try {
    return await bitmapFactory(image, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
}

// Builds an image/jpeg blob from a JPEG data URL (fallback when toBlob is
// unavailable, e.g. some test environments). Byte size is real decoded bytes.
const blobFromJpegDataUrl = (dataUrl) => {
  const match = /^data:image\/[^;,]+;base64,(.*)$/i.exec(dataUrl || '')
  if (!match) return null
  try {
    const binary = globalThis.atob(match[1])
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new Blob([bytes], { type: 'image/jpeg' })
  } catch {
    return null
  }
}

// Encodes a canvas to an image/jpeg Blob at the given quality. Prefers
// canvas.toBlob (true encoder output); falls back to a data-URL round-trip.
const toJpegBlob = (canvas, quality) => new Promise((resolve, reject) => {
  if (!canvas) {
    reject(new Error('The image could not be encoded.'))
    return
  }
  if (typeof canvas.toBlob === 'function') {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('The image could not be encoded.'))
    }, 'image/jpeg', quality)
    return
  }
  const url = canvas.toDataURL('image/jpeg', quality)
  const blob = blobFromJpegDataUrl(url)
  if (blob) resolve(blob)
  else reject(new Error('The image could not be encoded.'))
})

const createCanvas = (width, height) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export const drawImageToCanvas = (image, maxDimension = MAX_PREVIEW_DIMENSION) => {
  if (!image) return null
  if (!validateImageDimensions(image).ok) return null
  const { width: naturalWidth, height: naturalHeight } = imageSize(image)
  const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight, 1))
  const width = Math.max(1, Math.round(naturalWidth * scale))
  const height = Math.max(1, Math.round(naturalHeight * scale))
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, width, height)
  return canvas
}

const grayscalePixels = (data) => {
  for (let index = 0; index < data.length; index += 4) {
    const gray = luminance(data[index], data[index + 1], data[index + 2])
    data[index] = gray
    data[index + 1] = gray
    data[index + 2] = gray
  }
}

const highContrastPixels = (data, amount = 1.5) => {
  const factor = amount + 1
  const offset = 128 * (1 - factor)
  for (let index = 0; index < data.length; index += 4) {
    const [r, g, b] = clampPixel(data[index] * factor + offset, data[index + 1] * factor + offset, data[index + 2] * factor + offset)
    data[index] = r
    data[index + 1] = g
    data[index + 2] = b
  }
}

const darkenHandwritingPixels = (data) => {
  for (let index = 0; index < data.length; index += 4) {
    const gray = luminance(data[index], data[index + 1], data[index + 2])
    // Ink (dark pixels) gets pushed darker; paper (light pixels) is nudged whiter.
    const mapped = gray < 190 ? gray * 0.55 : gray + (255 - gray) * 0.45
    data[index] = mapped
    data[index + 1] = mapped
    data[index + 2] = mapped
  }
}

const sharpenPixels = (data, width, height, amount = 0.6) => {
  const source = new Uint8ClampedArray(data)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const left = x > 0 ? -4 : 0
      const right = x < width - 1 ? 4 : 0
      const up = y > 0 ? -width * 4 : 0
      const down = y < height - 1 ? width * 4 : 0
      for (let channel = 0; channel < 3; channel++) {
        const neighborSum = source[index + channel + left]
          + source[index + channel + right]
          + source[index + channel + up]
          + source[index + channel + down]
        const original = source[index + channel]
        data[index + channel] = clampByte(original + amount * (original * 4 - neighborSum))
      }
    }
  }
}

// Analyzes the luminance histogram and stretches it so faint ink gains
// contrast without blowing out the page. Phenomena (shadows, low light) get
// partially pulled toward white; dark ink stays dark.
const autoEnhancePixels = (data, width, height) => {
  const histogram = new Float64Array(256)
  const length = data.length
  for (let index = 0; index < length; index += 4) {
    histogram[Math.round(luminance(data[index], data[index + 1], data[index + 2]))] += 1
  }
  const total = width * height
  const accumulate = (fraction) => {
    const target = total * fraction
    let sum = 0
    for (let level = 0; level < 256; level += 1) {
      sum += histogram[level]
      if (sum >= target) return level
    }
    return 255
  }
  // Percentile-based stretch: ignore the extreme 2% so garbage outliers don't
  // clamp the whole page.
  const low = accumulate(0.02)
  const high = accumulate(0.98)
  const spread = Math.max(1, high - low)
  const factor = 255 / spread
  const offset = -low * factor
  const amount = 0.55 // blend factor toward the stretched result
  for (let index = 0; index < length; index += 4) {
    const gray = luminance(data[index], data[index + 1], data[index + 2])
    const stretched = clampByte(gray * factor + offset)
    const mapped = clampByte(gray + (stretched - gray) * amount)
    data[index] = mapped
    data[index + 1] = mapped
    data[index + 2] = mapped
  }
  // A light sharpen pass firms up pencil/pen strokes after the stretch.
  sharpenPixels(data, width, height, 0.35)
}

// Adaptive thresholding: a pixel is "ink" when it is darker than the mean of
// its local neighborhood by more than `bias`. This keeps faint handwriting
// while dropping the page's own lighting gradients (unlike a global
// threshold). Output is blended toward the original by the preset's intensity
// so a sliver of gray survives behind light strokes.
const blackWhitePixels = (data, width, height, amount = 85) => {
  const source = amount < 100 ? new Uint8ClampedArray(data) : null
  const gray = new Uint8ClampedArray(width * height)
  for (let index = 0; index < data.length; index += 4) {
    gray[index / 4] = Math.round(luminance(data[index], data[index + 1], data[index + 2]))
  }
  const radius = 10
  const integral = new Float64Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y += 1) {
    const rowOffset = (y + 1) * (width + 1)
    let running = 0
    for (let x = 0; x < width; x += 1) {
      running += gray[y * width + x]
      integral[rowOffset + x + 1] = integral[rowOffset - (width + 1) + x + 1] + running
    }
  }
  const windowMean = (x, y) => {
    const x0 = Math.max(0, x - radius)
    const y0 = Math.max(0, y - radius)
    const x1 = Math.min(width - 1, x + radius)
    const y1 = Math.min(height - 1, y + radius)
    const count = (x1 - x0 + 1) * (y1 - y0 + 1)
    const a = integral[y0 * (width + 1) + x0]
    const b = integral[y0 * (width + 1) + x1 + 1]
    const c = integral[(y1 + 1) * (width + 1) + x0]
    const d = integral[(y1 + 1) * (width + 1) + x1 + 1]
    return (a - b - c + d) / count
  }
  const bias = 6
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const mean = windowMean(x, y)
      const isInk = gray[y * width + x] < mean - bias
      const value = isInk ? 0 : 255
      if (source) {
        data[index] = clampByte(source[index] + (value - source[index]) * (amount / 100))
        data[index + 1] = clampByte(source[index + 1] + (value - source[index + 1]) * (amount / 100))
        data[index + 2] = clampByte(source[index + 2] + (value - source[index + 2]) * (amount / 100))
      } else {
        data[index] = value
        data[index + 1] = value
        data[index + 2] = value
      }
    }
  }
}

// Applies a preset to an image and returns a new canvas (original untouched).
// `intensity` (0-100) blends the full-strength preset back toward the original.
export const applyEnhancement = (image, presetId, { intensity, maxDimension = MAX_PREVIEW_DIMENSION } = {}) => {
  const canvas = drawImageToCanvas(image, maxDimension)
  if (!canvas) return null
  if (presetId === 'original' || !presetId) return canvas

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return canvas

  try {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    let amount = clampIntensity(intensity === undefined ? PRESET_DEFAULT_INTENSITY[presetId] : intensity)
    // Auto is a fixed, fully-applied "best guess" preset with no user slider;
    // forcing full strength keeps it from being blended back toward the original.
    if (presetId === 'auto') amount = 100
    const source = amount < 100 ? new Uint8ClampedArray(data) : null

    switch (presetId) {
      case 'auto':
        autoEnhancePixels(data, canvas.width, canvas.height)
        break
      case 'grayscale':
        grayscalePixels(data)
        break
      case 'black-white':
        blackWhitePixels(data, canvas.width, canvas.height, amount)
        break
      case 'high-contrast':
        highContrastPixels(data)
        break
      case 'darken-handwriting':
        darkenHandwritingPixels(data)
        break
      case 'sharpen':
        sharpenPixels(data, canvas.width, canvas.height)
        break
      default:
        return canvas
    }

    if (source) {
      const blend = amount / 100
      for (let index = 0; index < data.length; index += 4) {
        data[index] = clampByte(source[index] + (data[index] - source[index]) * blend)
        data[index + 1] = clampByte(source[index + 1] + (data[index + 1] - source[index + 1]) * blend)
        data[index + 2] = clampByte(source[index + 2] + (data[index + 2] - source[index + 2]) * blend)
      }
    }
    context.putImageData(imageData, 0, 0)
  } catch {
    // Fall back to the un-enhanced canvas if pixel access is unavailable.
  }
  return canvas
}

export const canvasToDataUrl = (canvas, type = 'image/jpeg', quality = 0.9) => {
  if (!canvas) return null
  try {
    return canvas.toDataURL(type, quality)
  } catch {
    return null
  }
}

// Vercel rejects serverless function payloads above roughly 4.5 MB before our
// handler runs, so the 10 MiB / 20 MiB server-side caps are never actually
// reachable from the browser. We budget the encoded sheet for the WHOLE JSON
// body and stay far under Vercel's ceiling (base64 already inflates the image
// ~33%, plus the JSON wrapper).
export const MAX_SHEET_UPLOAD_BYTES = 3.5 * 1024 * 1024
// Normal scan target. The hard ceiling remains higher so legible handwriting
// is never discarded merely to hit an arbitrary byte count.
export const TARGET_SHEET_IMAGE_BYTES = 1.25 * 1024 * 1024

// Root local sheet processing stays at 2000px; the ladder only kicks in below
// that when a noisy capture would otherwise blow the Vercel-safe budget.
const UPLOAD_DIMENSION_LADDER = [MAX_PREVIEW_DIMENSION, 1600, 1280]
const UPLOAD_QUALITY_LADDER = [0.9, 0.82, 0.72]

// Data URLs and their base64 payloads are single-byte ASCII, so string length
// equals UTF-8 byte length.
const byteLengthOf = (dataUrl) => (dataUrl ? dataUrl.length : 0)

// Returns an upload-ready data URL that fits the Vercel-safe budget. Uses the
// existing 2000px/0.9 preview when it already fits (the normal path); only
// oversized captures are re-rendered at a smaller dimension and lower JPEG
// quality, never below a readability floor. Returns null when even the floor
// is too large, so the caller can show a friendly message instead of charging
// a Vercel rejection.
export const fitSheetForUpload = ({ image, presetId = 'original', intensity, existingPreview }) => {
  if (byteLengthOf(existingPreview) <= MAX_SHEET_UPLOAD_BYTES) return existingPreview || null
  for (const maxDimension of UPLOAD_DIMENSION_LADDER) {
    const canvas = applyEnhancement(image, presetId, { intensity, maxDimension })
    if (!canvas) continue
    for (const quality of UPLOAD_QUALITY_LADDER) {
      const dataUrl = canvasToDataUrl(canvas, 'image/jpeg', quality)
      if (dataUrl && byteLengthOf(dataUrl) <= MAX_SHEET_UPLOAD_BYTES) return dataUrl
    }
  }
  return null
}

// Normalizes any supported sheet image (JPEG/PNG/WEBP) to an image/jpeg object
// for Storage: the returned upload exposes a real JPEG Blob (actual encoded
// bytes via Blob.size), mimeType image/jpeg, extension .jpg, dimensions, and
// the encoded byte count — so the storage object's contentType and path always
// match (.jpg / image/jpeg), never PNG/WEBP bytes under a .jpg name.
//
// Uses a bounded resize/quality ladder: it starts at the highest quality that
// fits safely under the 3.5 MiB object ceiling and only descends when needed,
// preserving handwriting, phone numbers, and table lines. Orientation is
// applied via createImageBitmap before encoding. Returns { error } when even
// the smallest encoding cannot fit, or null when the source cannot be used.
export const prepareSheetForUpload = async ({ image, presetId = 'original', intensity }) => {
  if (!image) return null
  const { width, height } = imageSize(image)
  if (width <= 0 || height <= 0) return null
  if (width * height > MAX_DECODED_PIXELS) {
    return { error: 'That image is too large to process. Use a photo under 60 megapixels.' }
  }
  const oriented = await decodeOrientedImage(image)
  const source = oriented || image
  try {
    let readableFallback = null
    for (const maxDimension of UPLOAD_DIMENSION_LADDER) {
      const canvas = applyEnhancement(source, presetId, { intensity, maxDimension })
      if (!canvas) continue
      if (canvas.width * canvas.height > MAX_WORKING_PIXELS) continue
      for (const quality of UPLOAD_QUALITY_LADDER) {
        try {
          const blob = await toJpegBlob(canvas, quality)
          if (blob && blob.size > 0 && blob.size <= MAX_SHEET_UPLOAD_BYTES) {
            const prepared = {
              dataUrl: canvasToDataUrl(canvas, 'image/jpeg', quality) || '',
              blob,
              mimeType: 'image/jpeg',
              extension: '.jpg',
              width: canvas.width,
              height: canvas.height,
              encodedBytes: blob.size
            }
            if (blob.size <= TARGET_SHEET_IMAGE_BYTES) return prepared
            readableFallback = prepared
          }
        } catch {
          // Try the next quality / dimension rung.
        }
      }
    }
    if (readableFallback) return readableFallback
    return { error: 'That image is too large to save. Try a smaller or clearer photo.' }
  } finally {
    if (oriented && typeof oriented.close === 'function') oriented.close()
  }
}

export const ENHANCEMENT_TYPE_LABEL = Object.fromEntries(
  ENHANCEMENT_PRESETS.map((preset) => [preset.id, preset.label])
)
