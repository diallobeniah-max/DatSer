import { createHash } from 'node:crypto'
import { ExtractionError, MAX_IMAGE_BYTES } from './extractionErrors.js'

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const MIN_IMAGE_BYTES = 64
const MIN_DIMENSION = 64
const MAX_DIMENSION = 12000
// A highly-compressible image can stay below the byte limit while still forcing
// Gemini (or an image decoder) to process an enormous pixel buffer. Keep this
// server-side as clients can bypass the browser's preflight check.
export const MAX_IMAGE_PIXELS = 60_000_000

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const hasJpegMagic = (bytes) => {
  return (
    bytes.length > 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
}

const hasPngMagic = (bytes) => {
  if (bytes.length < 8) return false
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
}

const hasWebpMagic = (bytes) => {
  return (
    bytes.length > 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
}

// Scans JPEG marker segments for the first Start-Of-Frame marker, which
// carries the image height and width directly after the marker length.
const jpegDimensions = (bytes) => {
  let offset = 2
  const length = bytes.length
  while (offset + 9 < length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xff || marker === 0xd9 || marker === 0xda) return null
    const segmentLength = bytes.readUInt16BE(offset + 2)
    if (segmentLength < 2) return null
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7)
      }
    }
    offset += 2 + segmentLength
  }
  return null
}

const pngDimensions = (bytes) => {
  if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  }
}

const webpDimensions = (bytes) => {
  const fourcc = bytes.toString('ascii', 12, 16)
  if (fourcc === 'VP8 ') {
    if (bytes.length < 30) return null
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff
    }
  }
  if (fourcc === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    const packed = bytes.readUInt32LE(21)
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >> 14) & 0x3fff) + 1
    }
  }
  if (fourcc === 'VP8X') {
    if (bytes.length < 30) return null
    return {
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1
    }
  }
  return null
}

const magicMatches = (bytes, mimeType) => {
  if (mimeType === 'image/jpeg') return hasJpegMagic(bytes)
  if (mimeType === 'image/png') return hasPngMagic(bytes)
  if (mimeType === 'image/webp') return hasWebpMagic(bytes)
  return false
}

const readDimensions = (bytes, mimeType) => {
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes)
  if (mimeType === 'image/png') return pngDimensions(bytes)
  if (mimeType === 'image/webp') return webpDimensions(bytes)
  return null
}

const asCanonicalBase64 = (data) => String(data || '').replace(/\s/g, '')

export const validateSheetImage = ({ mimeType, data }) => {
  if (!mimeType || !ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new ExtractionError('INVALID_MIME', 'Only JPEG, PNG, and WebP images are accepted.', { httpStatus: 400 })
  }
  if (!data || typeof data !== 'string') {
    throw new ExtractionError('MISSING_IMAGE', 'An image payload is required.', { httpStatus: 400 })
  }

  let bytes
  try {
    bytes = Buffer.from(data, 'base64')
  } catch {
    throw new ExtractionError('INVALID_IMAGE_DATA', 'The image data is not valid base64.', { httpStatus: 400 })
  }

  if (bytes.length === 0) {
    throw new ExtractionError('INVALID_IMAGE_DATA', 'The image data is empty.', { httpStatus: 400 })
  }
  if (Buffer.from(bytes.toString('base64'), 'base64').toString('base64') !== asCanonicalBase64(data)) {
    throw new ExtractionError('INVALID_IMAGE_DATA', 'The image data is not valid base64.', { httpStatus: 400 })
  }
  if (bytes.length < MIN_IMAGE_BYTES) {
    throw new ExtractionError('IMAGE_TOO_SMALL', 'The image file is too small to be a real photo.', { httpStatus: 400 })
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ExtractionError('IMAGE_TOO_LARGE', 'The image is too large to process.', { httpStatus: 413 })
  }

  if (!magicMatches(bytes, mimeType)) {
    throw new ExtractionError('INVALID_IMAGE_DATA', 'The image data does not match its declared file type.', { httpStatus: 400 })
  }

  const dimensions = readDimensions(bytes, mimeType)
  if (!dimensions || !dimensions.width || !dimensions.height) {
    throw new ExtractionError('DIMENSIONS_UNREADABLE', 'The image dimensions could not be verified.', { httpStatus: 400 })
  }
  if (dimensions.width < MIN_DIMENSION || dimensions.height < MIN_DIMENSION) {
    throw new ExtractionError('IMAGE_TOO_SMALL', 'The image is too small to scan a sheet.', { httpStatus: 400 })
  }
  if (dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
    throw new ExtractionError('IMAGE_DIMENSIONS_INVALID', 'The image dimensions exceed the supported limit.', { httpStatus: 400 })
  }

  if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw new ExtractionError('IMAGE_PIXELS_EXCEEDED', 'The image has too many pixels to process safely.', { httpStatus: 413 })
  }

  return {
    bytes,
    mimeType,
    width: dimensions.width,
    height: dimensions.height,
    sha256: sha256(bytes)
  }
}
