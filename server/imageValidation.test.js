import { describe, expect, it } from 'vitest'
import { validateSheetImage, ALLOWED_IMAGE_MIME_TYPES } from './imageValidation.js'

const asBase64 = (buffer) => buffer.toString('base64')

const catchError = (fn) => {
  try {
    fn()
    return null
  } catch (error) {
    return error
  }
}

const expectRejected = (fn, code, httpStatus) => {
  const error = catchError(fn)
  expect(error).toBeTruthy()
  expect(error.code).toBe(code)
  expect(error.httpStatus).toBe(httpStatus)
}

const makePng = ({ width = 800, height = 600 } = {}) => {
  const buf = Buffer.alloc(100)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

const makeWebp = ({ width = 800, height = 600 } = {}) => {
  const buf = Buffer.alloc(100)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(100, 4)
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8X', 12, 'ascii')
  buf.writeUIntLE(width - 1, 24, 3)
  buf.writeUIntLE(height - 1, 27, 3)
  return buf
}

const makeJpeg = ({ width = 800, height = 600 } = {}) => {
  const buf = Buffer.alloc(100)
  buf[0] = 0xff
  buf[1] = 0xd8
  buf[2] = 0xff
  buf[3] = 0xc0
  buf.writeUInt16BE(17, 4)
  buf[6] = 8
  buf.writeUInt16BE(height, 7)
  buf.writeUInt16BE(width, 9)
  return buf
}

describe('validateSheetImage', () => {
  it('accepts a valid PNG with parsed dimensions', () => {
    const png = makePng()
    const result = validateSheetImage({ mimeType: 'image/png', data: asBase64(png) })
    expect(result.mimeType).toBe('image/png')
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
    expect(result.bytes).toEqual(png)
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts a valid WebP with parsed dimensions', () => {
    const webp = makeWebp()
    const result = validateSheetImage({ mimeType: 'image/webp', data: asBase64(webp) })
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
  })

  it('accepts a valid JPEG with parsed dimensions', () => {
    const jpeg = makeJpeg()
    const result = validateSheetImage({ mimeType: 'image/jpeg', data: asBase64(jpeg) })
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
  })

  it('rejects mime types outside the allowlist', () => {
    expectRejected(() => validateSheetImage({ mimeType: 'image/gif', data: asBase64(makePng()) }), 'INVALID_MIME', 400)
  })

  it('rejects data whose bytes do not match the declared file type', () => {
    expectRejected(() => validateSheetImage({ mimeType: 'image/png', data: asBase64(makeWebp()) }), 'INVALID_IMAGE_DATA', 400)
  })

  it('rejects non-canonical base64 payloads', () => {
    const valid = asBase64(makePng())
    expectRejected(() => validateSheetImage({ mimeType: 'image/png', data: valid.slice(0, -2) }), 'INVALID_IMAGE_DATA', 400)
  })

  it('rejects images whose dimensions cannot be verified', () => {
    const buf = Buffer.alloc(100)
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0) // valid PNG magic, no IHDR
    expectRejected(() => validateSheetImage({ mimeType: 'image/png', data: asBase64(buf) }), 'DIMENSIONS_UNREADABLE', 400)
  })

  it('rejects degenerate images that are too small', () => {
    const png = makePng({ width: 8, height: 8 })
    expectRejected(() => validateSheetImage({ mimeType: 'image/png', data: asBase64(png) }), 'IMAGE_TOO_SMALL', 400)
  })

  it('rejects images larger than the byte limit', () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1)
    big[0] = 0xff
    big[1] = 0xd8
    big[2] = 0xff
    big[3] = 0xc0
    big.writeUInt16BE(17, 4)
    big[6] = 8
    big.writeUInt16BE(600, 7)
    big.writeUInt16BE(800, 9)
    expectRejected(() => validateSheetImage({ mimeType: 'image/jpeg', data: asBase64(big) }), 'IMAGE_TOO_LARGE', 413)
  })

  it('rejects compressed images that exceed the server pixel cap', () => {
    const png = makePng({ width: 12000, height: 12000 })
    expectRejected(() => validateSheetImage({ mimeType: 'image/png', data: asBase64(png) }), 'IMAGE_PIXELS_EXCEEDED', 413)
  })

  it('defaults the allowed mime allowlist to JPEG, PNG and WebP only', () => {
    expect(ALLOWED_IMAGE_MIME_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })
})
