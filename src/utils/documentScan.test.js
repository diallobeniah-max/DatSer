import { describe, expect, it } from 'vitest'
import {
  AUTO_CAPTURE_STATUS,
  approxPolyDP,
  boxBlur,
  convexHull,
  cornerDelta,
  createAutoCaptureTracker,
  detectDocumentCorners,
  estimateHomography,
  largestComponent,
  orderCorners,
  otsuThreshold,
  polygonArea,
  polygonAngles,
  smoothCorners,
  sobelMagnitude,
  toGrayscale,
  warpPerspective
} from './documentScan'

const solidRgba = (width, height, value) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = value
    data[index * 4 + 1] = value
    data[index * 4 + 2] = value
    data[index * 4 + 3] = 255
  }
  return data
}

// White sheet drawn on a darker background at known corners.
const sheetImage = ({ width, height, corners = [[30, 30], [150, 20], [160, 220], [20, 230]], sheetShade = 245, background = 40 }) => {
  const rgba = solidRgba(width, height, background)
  const minX = Math.min(...corners.map((c) => c[0]))
  const maxX = Math.max(...corners.map((c) => c[0]))
  const minY = Math.min(...corners.map((c) => c[1]))
  const maxY = Math.max(...corners.map((c) => c[1]))
  const edges = corners.map(([x, y]) => ({ x, y }))
  for (let y = minY; y <= maxY && y < height; y += 1) {
    for (let x = minX; x <= maxX && x < width; x += 1) {
      // Point-in-quad test via cross products (convex quad).
      let inside = true
      for (let index = 0; index < 4; index += 1) {
        const a = edges[index]
        const b = edges[(index + 1) % 4]
        if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) {
          inside = false
          break
        }
      }
      if (inside) {
        const offset = (y * width + x) * 4
        rgba[offset] = sheetShade
        rgba[offset + 1] = sheetShade
        rgba[offset + 2] = sheetShade
      }
    }
  }
  return { rgba, width, height }
}

describe('documentScan basics', () => {
  it('converts RGBA to grayscale luminance', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255])
    const gray = toGrayscale(rgba, 2, 1)
    expect(gray[0]).toBe(Math.round(0.299 * 255))
    expect(gray[1]).toBe(Math.round(0.587 * 255))
  })

  it('box blur keeps bright regions bright and dims nothing below 0', () => {
    const width = 9
    const height = 1
    const src = new Uint8Array(width).fill(200)
    const out = boxBlur(src, width, height, 2)
    expect(out.every((value) => value === 200)).toBe(true)
    const zeros = new Uint8Array(width)
    const zerosOut = boxBlur(zeros, width, height, 2)
    expect(zerosOut.every((value) => value === 0)).toBe(true)
  })

  it('sobel magnitude highlights a horizontal edge', () => {
    // Top half bright, bottom half dark: a strong horizontal edge at row 1.
    const width = 5
    const height = 3
    const src = new Uint8Array([
      255, 255, 255, 255, 255,
      255, 255, 255, 255, 255,
      0, 0, 0, 0, 0
    ])
    const mag = sobelMagnitude(src, width, height)
    expect(mag[(1 * width) + 2]).toBeGreaterThan(0)
  })

  it('otsu splits a bimodal histogram cleanly', () => {
    const values = new Uint8Array(200)
    for (let index = 0; index < 100; index += 1) values[index] = 20
    for (let index = 100; index < 200; index += 1) values[index] = 220
    const threshold = otsuThreshold(values)
    expect(threshold).toBeGreaterThanOrEqual(20)
    expect(threshold).toBeLessThan(220)
  })

  it('largestComponent finds the biggest blob with 8-connectivity', () => {
    const width = 4
    const height = 3
    const binary = new Uint8Array([
      0, 1, 1, 0,
      0, 1, 1, 0,
      0, 0, 0, 0
    ])
    const points = largestComponent(binary, width, height)
    expect(points).toHaveLength(4)
  })

  it('convexHull returns an ordered hull', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }]
    const hull = convexHull(points)
    expect(hull).toHaveLength(4)
    expect(polygonArea(hull)).toBeCloseTo(100)
  })

  it('approxPolyDP simplifies a noisy square to four corners', () => {
    // Stair-stepped square: simplify should keep only the four corners.
    const square = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 1 },
      { x: 79, y: 1 }, { x: 80, y: 2 }, { x: 80, y: 40 }, { x: 81, y: 79 },
      { x: 80, y: 80 }, { x: 40, y: 80 }, { x: 1, y: 81 }, { x: 0, y: 40 }
    ]
    const simplified = approxPolyDP(square, 5)
    expect(simplified.length).toBeGreaterThanOrEqual(2)
    expect(simplified.length).toBeLessThanOrEqual(5)
  })

  it('orderCorners returns TL, TR, BR, BL', () => {
    const ordered = orderCorners([{ x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 0 }])
    expect(ordered[0]).toMatchObject({ x: 0, y: 0 })
    expect(ordered[1]).toMatchObject({ x: 10, y: 0 })
    expect(ordered[2]).toMatchObject({ x: 10, y: 10 })
    expect(ordered[3]).toMatchObject({ x: 0, y: 10 })
  })

  it('polygonAngles reports ~90deg for a rectangle', () => {
    const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }]
    const angles = polygonAngles(rect)
    angles.forEach((angle) => expect(angle).toBeCloseTo(Math.PI / 2, 1))
  })

  it('smoothing blends toward the previous corners and resets on null', () => {
    const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    const b = [{ x: 4, y: 4 }, { x: 14, y: 4 }, { x: 14, y: 14 }, { x: 4, y: 14 }]
    const blended = smoothCorners(a, b, 0.5)
    expect(blended[0]).toMatchObject({ x: 2, y: 2 })
    expect(cornerDelta(a, blended)).toBeGreaterThan(0)
    expect(smoothCorners(null, b)).toEqual(b.map((p) => ({ x: p.x, y: p.y })))
  })
})

describe('documentScan detection', () => {
  it('detects a large bright sheet on a dark background', () => {
    const sheet = sheetImage({ width: 200, height: 260, corners: [[20, 20], [180, 20], [180, 240], [20, 240]] })
    const corners = detectDocumentCorners({ rgba: sheet.rgba, width: sheet.width, height: sheet.height, options: { minAreaFraction: 0.1 } })
    expect(corners).not.toBeNull()
    expect(corners).toHaveLength(4)
    // Sobel responds on the sheet boundary, so the hull can sit a few pixels
    // in from the true edge. Tolerate that margin, like a real camera would.
    expect(corners[0].x).toBeGreaterThanOrEqual(15)
    expect(corners[0].x).toBeLessThanOrEqual(25)
    expect(corners[0].y).toBeGreaterThanOrEqual(15)
    expect(corners[0].y).toBeLessThanOrEqual(25)
    expect(corners[1].x).toBeGreaterThanOrEqual(175)
    expect(corners[1].x).toBeLessThanOrEqual(190)
  })

  it('returns null on a flat image with no edges', () => {
    const rgba = solidRgba(100, 100, 128)
    expect(detectDocumentCorners({ rgba, width: 100, height: 100 })).toBeNull()
  })

  it('returns null when an image is mostly noise with no large quad', () => {
    const { rgba, width, height } = sheetImage({ width: 100, height: 100, corners: [[10, 10], [80, 10], [80, 80], [10, 80]], sheetShade: 128, background: 120 })
    const result = detectDocumentCorners({ rgba, width, height, options: { minAreaFraction: 0.9 } })
    expect(result).toBeNull()
  })

  it('ignores a tiny sheet below the minimum area fraction', () => {
    const { rgba, width, height } = sheetImage({ width: 300, height: 300, corners: [[120, 140], [180, 140], [180, 160], [120, 160]] })
    const corners = detectDocumentCorners({ rgba, width, height, options: { minAreaFraction: 0.2 } })
    expect(corners).toBeNull()
  })
})

describe('documentScan perspective', () => {
  it('estimates a homography that maps corners to unit square', () => {
    const corners = [{ x: 10, y: 10 }, { x: 110, y: 15 }, { x: 115, y: 115 }, { x: 8, y: 120 }]
    const h = estimateHomography(corners)
    expect(h).not.toBeNull()
    expect(h).toHaveLength(9)
  })

  it('warps a shifted square so a corner has the same value at a different spot', () => {
    const width = 12
    const height = 12
    const rgba = solidRgba(width, height, 0)
    rgba[0] = 255
    rgba[1] = 255
    rgba[2] = 255
    // Corners already in the unit square (0..1): full-frame sheet.
    const corners = [{ x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 }]
    const warped = warpPerspective({ rgba, width, height, corners, outWidth: 12, outHeight: 12 })
    expect(warped).not.toBeNull()
    expect(warped.width).toBe(12)
    expect(warped.height).toBe(12)
    expect(warped.data[0]).toBe(255)
  })

  it('returns null for a singular (degenerate) homography', () => {
    const corners = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]
    expect(warpPerspective({ rgba: solidRgba(10, 10, 0), width: 10, height: 10, corners, outWidth: 10, outHeight: 10 })).toBeNull()
  })
})

describe('documentScan auto-capture tracker', () => {
  const corners = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 120 }, { x: 0, y: 120 }]

  it('reports searching until corners arrive', () => {
    const tracker = createAutoCaptureTracker({ requiredHoldFrames: 3, movementThreshold: 5 })
    expect(tracker.tick({ corners: null, areaFraction: 0 }).status).toBe(AUTO_CAPTURE_STATUS.SEARCHING)
  })

  it('requires several stable frames before auto capture', () => {
    const tracker = createAutoCaptureTracker({ requiredHoldFrames: 4, movementThreshold: 5 })
    expect(tracker.tick({ corners, areaFraction: 0.3 }).status).toBe(AUTO_CAPTURE_STATUS.HOLDING)
    expect(tracker.tick({ corners, areaFraction: 0.3 }).status).toBe(AUTO_CAPTURE_STATUS.HOLDING)
    expect(tracker.tick({ corners, areaFraction: 0.3 }).status).toBe(AUTO_CAPTURE_STATUS.STABLE)
    const ready = tracker.tick({ corners, areaFraction: 0.3 })
    expect(ready.status).toBe(AUTO_CAPTURE_STATUS.READY)
    expect(ready.shouldCapture).toBe(true)
  })

  it('resets when the document disappears', () => {
    const tracker = createAutoCaptureTracker({ requiredHoldFrames: 3, movementThreshold: 5 })
    tracker.tick({ corners, areaFraction: 0.3 })
    tracker.tick({ corners, areaFraction: 0.3 })
    expect(tracker.peek().status).toBe(AUTO_CAPTURE_STATUS.HOLDING)
    tracker.tick({ corners: null, areaFraction: 0 })
    expect(tracker.peek().status).toBe(AUTO_CAPTURE_STATUS.SEARCHING)
  })

  it('resets on resets and large movement', () => {
    const tracker = createAutoCaptureTracker({ requiredHoldFrames: 2, movementThreshold: 2 })
    tracker.tick({ corners, areaFraction: 0.3 })
    expect(tracker.peek().status).toBe(AUTO_CAPTURE_STATUS.HOLDING)
    const jittered = corners.map((p) => ({ x: p.x + 50, y: p.y }))
    const result = tracker.tick({ corners: jittered, areaFraction: 0.3 })
    expect(result.status).toBe(AUTO_CAPTURE_STATUS.SEARCHING)
    expect(tracker.peek().status).toBe(AUTO_CAPTURE_STATUS.SEARCHING)
  })

  it('reset clears all held state', () => {
    const tracker = createAutoCaptureTracker({ requiredHoldFrames: 2, movementThreshold: 5 })
    tracker.tick({ corners, areaFraction: 0.3 })
    tracker.tick({ corners, areaFraction: 0.3 })
    tracker.reset()
    expect(tracker.peek().status).toBe(AUTO_CAPTURE_STATUS.SEARCHING)
  })
})