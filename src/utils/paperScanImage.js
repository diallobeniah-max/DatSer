// Local paper-sheet image helpers for Paper Scan Review.
// Phase 1: capture/upload, validation, and client-side enhancement presets only.
// Nothing here touches the network, Gemini, OCR, or Supabase.

export const ENHANCEMENT_PRESETS = [
  { id: 'original', label: 'Original' },
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'high-contrast', label: 'High Contrast' },
  { id: 'darken-handwriting', label: 'Darken Handwriting' },
  { id: 'sharpen', label: 'Sharpen' }
]

export const ENHANCEMENT_PRESET_IDS = ENHANCEMENT_PRESETS.map((preset) => preset.id)

// 0-100 intensity per preset. Original is a passthrough and needs no intensity.
export const PRESET_DEFAULT_INTENSITY = {
  original: null,
  grayscale: 100,
  'high-contrast': 75,
  'darken-handwriting': 75,
  sharpen: 50
}

export const clampIntensity = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)))

const MAX_PREVIEW_DIMENSION = 2000

export const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)))

const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b

const clampPixel = (r, g, b) => [clampByte(r), clampByte(g), clampByte(b)]

// Basic upload validation: a file must exist, be an image MIME type, and hold bytes.
export const validateImageFile = (file) => {
  if (!file) return { ok: false, reason: 'No file was selected.' }
  if (file.type && !file.type.startsWith('image/')) return { ok: false, reason: 'Please choose an image file.' }
  if (!file.size || file.size <= 0) return { ok: false, reason: 'The file appears empty or unreadable.' }
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
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('The image could not be decoded.'))
  image.src = src
})

const createCanvas = (width, height) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export const drawImageToCanvas = (image, maxDimension = MAX_PREVIEW_DIMENSION) => {
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight, 1))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
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
  const apply = (index) => {
    const left = (index % width) > 0 ? -4 : 0
    const right = (index % width) < width - 1 ? 4 : 0
    const up = index - width >= 0 ? -width * 4 : 0
    const down = index + width < data.length ? width * 4 : 0
    for (let channel = 0; channel < 3; channel++) {
      const neighborSum = source[index + channel + left]
        + source[index + channel + right]
        + source[index + channel + up]
        + source[index + channel + down]
      const original = source[index + channel]
      data[index + channel] = clampByte(original + amount * (original * 4 - neighborSum))
    }
  }
  for (let index = 0; index < data.length; index += 4) apply(index)
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
    const amount = clampIntensity(intensity === undefined ? PRESET_DEFAULT_INTENSITY[presetId] : intensity)
    const source = amount < 100 ? new Uint8ClampedArray(data) : null

    switch (presetId) {
      case 'grayscale':
        grayscalePixels(data)
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

export const ENHANCEMENT_TYPE_LABEL = Object.fromEntries(
  ENHANCEMENT_PRESETS.map((preset) => [preset.id, preset.label])
)
