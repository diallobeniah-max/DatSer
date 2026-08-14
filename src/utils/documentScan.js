// Pure document-detection geometry and image math for the Paper Scan camera.
// Node-safe: everything here works on flat RGBA/Uint8 arrays and plain point
// objects, so it runs identically in Vitest and the browser. The DOM/canvas
// glue lives in paperScanCamera.js.

export const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)))

// ---------------------------------------------------------------- grayscale

export const toGrayscale = (rgba, width, height) => {
  const gray = new Uint8Array(width * height)
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4
    gray[index] = Math.round(0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2])
  }
  return gray
}

// Separable box blur, integer math. Good enough for noise reduction before
// edge detection and far cheaper than a full Gaussian.
export const boxBlur = (src, width, height, radius = 2) => {
  if (radius <= 0) return src.slice()
  const size = radius * 2 + 1
  const horizontal = new Uint8Array(width * height)
  const out = new Uint8Array(width * height)
  for (let row = 0; row < height; row += 1) {
    const offset = row * width
    let sum = 0
    for (let col = -radius; col <= radius; col += 1) sum += src[offset + clampInt(col, 0, width - 1)]
    for (let col = 0; col < width; col += 1) {
      const remove = clampInt(col - radius - 1, 0, width - 1)
      const add = clampInt(col + radius, 0, width - 1)
      sum += src[offset + add] - src[offset + remove]
      horizontal[offset + col] = sum / size
    }
  }
  for (let col = 0; col < width; col += 1) {
    let sum = 0
    for (let row = -radius; row <= radius; row += 1) sum += horizontal[clampInt(row, 0, height - 1) * width + col]
    for (let row = 0; row < height; row += 1) {
      const remove = clampInt(row - radius - 1, 0, height - 1)
      const add = clampInt(row + radius, 0, height - 1)
      sum += horizontal[add * width + col] - horizontal[remove * width + col]
      out[row * width + col] = sum / size
    }
  }
  return out
}

// Sobel gradient magnitude, |gx| + |gy| for speed (skips sqrt).
export const sobelMagnitude = (src, width, height) => {
  const out = new Uint8Array(width * height)
  for (let row = 1; row < height - 1; row += 1) {
    for (let col = 1; col < width - 1; col += 1) {
      const a = row * width + col
      const up = (row - 1) * width + col
      const down = (row + 1) * width + col
      const gx = (src[up - 1] + 2 * src[a - 1] + src[down - 1])
        - (src[up + 1] + 2 * src[a + 1] + src[down + 1])
      const gy = (src[up - 1] + 2 * src[up] + src[up + 1])
        - (src[down - 1] + 2 * src[down] + src[down + 1])
      out[a] = Math.round(Math.min(255, Math.abs(gx) + Math.abs(gy)))
    }
  }
  return out
}

// Otsu's threshold for a Uint8Array of 8-bit values.
export const otsuThreshold = (values) => {
  const histogram = new Float64Array(256)
  for (let index = 0; index < values.length; index += 1) histogram[values[index]] += 1
  const total = values.length
  let sumAll = 0
  for (let level = 0; level < 256; level += 1) sumAll += level * histogram[level]
  let sumBg = 0
  let weightBg = 0
  let maxVariance = -1
  let threshold = 0
  for (let level = 0; level < 256; level += 1) {
    weightBg += histogram[level]
    if (weightBg === 0) continue
    const weightFg = total - weightBg
    if (weightFg === 0) break
    sumBg += level * histogram[level]
    const meanBg = sumBg / weightBg
    const meanFg = (sumAll - sumBg) / weightFg
    const variance = weightBg * weightFg * (meanBg - meanFg) * (meanBg - meanFg)
    if (variance > maxVariance) {
      maxVariance = variance
      threshold = level
    }
  }
  return threshold
}

// ---------------------------------------------------------------- detection

// Largest 8-connected component of a binary bitmap, returned as an array of
// [x, y] points. A BFS with an integer queue keeps this fast enough for a
// ~640px analysis frame at a few frames per second.
export const largestComponent = (binary, width, height) => {
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let best = null
  for (let start = 0; start < width * height; start += 1) {
    if (!binary[start] || visited[start]) continue
    let head = 0
    let tail = 0
    queue[tail] = start
    tail += 1
    visited[start] = 1
    while (head < tail) {
      const current = queue[head]
      head += 1
      const x = current % width
      const y = (current - x) / width
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const next = ny * width + nx
          if (!binary[next] || visited[next]) continue
          visited[next] = 1
          queue[tail] = next
          tail += 1
        }
      }
    }
    const points = new Array(tail)
    for (let index = 0; index < tail; index += 1) {
      points[index] = { x: queue[index] % width, y: Math.floor(queue[index] / width) }
    }
    if (!best || points.length > best.length) best = points
  }
  return best || []
}

// Monotone-chain convex hull (Andrew). Returns hull points in CCW order.
export const convexHull = (points) => {
  if (points.length < 3) return points.slice()
  const sorted = points.slice().sort((left, right) => left.x - right.x || left.y - right.y)
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

export const polygonArea = (points) => {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

// Douglas-Peucker polygon simplification. `points` must be an ordered,
// implicitly closed polygon (first point repeated at the end is fine/optional).
export const approxPolyDP = (points, epsilon = 1) => {
  if (points.length <= 3) return points.slice()
  // The input polygon is implicitly closed; simplify as an open chain so the
  // anchor segment (first -> last) is never a zero-length duplicate.
  const closed = points.slice()
  const keep = new Uint8Array(closed.length)
  keep[0] = 1
  keep[closed.length - 1] = 1
  const perpendicular = (p, a, b) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy) || 1
    return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / length
  }
  const simplify = (first, last) => {
    let maxDistance = 0
    let farthest = first
    for (let index = first + 1; index < last; index += 1) {
      const distance = perpendicular(closed[index], closed[first], closed[last])
      if (distance > maxDistance) {
        maxDistance = distance
        farthest = index
      }
    }
    if (maxDistance > epsilon) {
      keep[farthest] = 1
      if (farthest - first > 1) simplify(first, farthest)
      if (last - farthest > 1) simplify(farthest, last)
    }
  }
  simplify(0, closed.length - 1)
  const result = []
  for (let index = 0; index < closed.length; index += 1) {
    if (keep[index]) result.push(closed[index])
  }
  return result
}

// Order four (or any) points as [topLeft, topRight, bottomRight, bottomLeft]
// using centroid-quadrant classification, then verify by centroid sum/diff.
export const orderCorners = (points) => {
  if (points.length !== 4) return points.slice()
  const centroidX = points.reduce((sum, p) => sum + p.x, 0) / 4
  const centroidY = points.reduce((sum, p) => sum + p.y, 0) / 4
  const quadrant = (p) => (p.y < centroidY ? (p.x < centroidX ? 'tl' : 'tr') : (p.x < centroidX ? 'bl' : 'br'))
  const buckets = { tl: [], tr: [], br: [], bl: [] }
  points.forEach((p) => buckets[quadrant(p)].push(p))
  // Handles degenerate layouts where two corners share a quadrant: fall back to
  // geometric extremes (min/max of x+y for TL/BR, min/max of x-y for TR/BL).
  const bySum = points.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y))
  const byDiff = points.slice().sort((a, b) => (a.x - a.y) - (b.x - b.y))
  const pick = (name, fallback) => buckets[name][0] || fallback
  const topLeft = pick('tl', bySum[0])
  const bottomRight = pick('br', bySum[bySum.length - 1])
  const topRight = pick('tr', byDiff[byDiff.length - 1])
  const bottomLeft = pick('bl', byDiff[0])
  return [topLeft, topRight, bottomRight, bottomLeft]
}

// Angles (radians) at each vertex of a polygon.
export const polygonAngles = (points) => {
  const angles = []
  for (let index = 0; index < points.length; index += 1) {
    const prev = points[(index - 1 + points.length) % points.length]
    const cur = points[index]
    const next = points[(index + 1) % points.length]
    const v1 = { x: prev.x - cur.x, y: prev.y - cur.y }
    const v2 = { x: next.x - cur.x, y: next.y - cur.y }
    const dot = v1.x * v2.x + v1.y * v2.y
    const cross = Math.abs(v1.x * v2.y - v1.y * v2.x)
    angles.push(Math.atan2(cross, dot))
  }
  return angles
}

export const angleFromVertical = (radians) => Math.abs((radians % Math.PI) - Math.PI / 2)

// One-shot detection pipeline. Returns ordered [TL, TR, BR, BL] or null.
// Options:
//   edgeThreshold   - sobel floor (default otsu)
//   minAreaFraction - minimum hull area / frame area (default 0.05)
//   minPoints       - minimum component size (default 300)
//   blurRadius      - box blur radius (default 2)
export const detectDocumentCorners = ({ rgba, width, height, options = {} }) => {
  const {
    edgeThreshold = null,
    minAreaFraction = 0.05,
    minPoints = 300,
    blurRadius = 2
  } = options
  if (!width || !height) return null
  const gray = toGrayscale(rgba, width, height)
  const blurred = boxBlur(gray, width, height, blurRadius)
  const edges = sobelMagnitude(blurred, width, height)
  const threshold = edgeThreshold == null ? Math.max(30, otsuThreshold(edges)) : edgeThreshold
  const binary = new Uint8Array(width * height)
  for (let index = 0; index < edges.length; index += 1) {
    if (edges[index] >= threshold) binary[index] = 1
  }
  const component = largestComponent(binary, width, height)
  if (component.length < minPoints) return null
  const hull = convexHull(component)
  const perimeter = hull.reduce((sum, p, i) => sum + Math.hypot(p.x - hull[(i + 1) % hull.length].x, p.y - hull[(i + 1) % hull.length].y), 0)
  const simplified = approxPolyDP(hull, Math.max(2, perimeter * 0.02))
  if (simplified.length !== 4) return null
  const ordered = orderCorners(simplified)
  const area = polygonArea(hull)
  if (area / (width * height) < minAreaFraction) return null
  // Reject shapes too far from a document rectangle: all corners reasonably close to 90deg.
  const angles = polygonAngles(ordered)
  const rectScore = angles.reduce((min, angle) => Math.min(min, 1 - angleFromVertical(angle) / (Math.PI / 2)), 1)
  if (rectScore < 0.35) return null
  return ordered
}

// -------------------------------------------------------------smoothing

export const cornerDelta = (a, b) => {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let index = 0; index < a.length; index += 1) {
    sum += Math.hypot(a[index].x - b[index].x, a[index].y - b[index].y)
  }
  return sum / a.length
}

// Exponential moving average. Preserves null-ness so the first valid frame
// becomes the baseline immediately.
export const smoothCorners = (previous, next, alpha = 0.3) => {
  if (!previous || !next) return next ? next.map((p) => ({ x: p.x, y: p.y })) : null
  return next.map((p, index) => ({
    x: p.x * alpha + previous[index].x * (1 - alpha),
    y: p.y * alpha + previous[index].y * (1 - alpha)
  }))
}

// ------------------------------------------------------------perspective

const solveLinearSystem = (matrix, vector) => {
  const size = vector.length
  const augmented = matrix.map((row, index) => [...row, vector[index]])
  for (let col = 0; col < size; col += 1) {
    let pivot = col
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row
    }
    if (Math.abs(augmented[pivot][col]) < 1e-10) return null
    if (pivot !== col) {
      const swap = augmented[col]
      augmented[col] = augmented[pivot]
      augmented[pivot] = swap
    }
    const divisor = augmented[col][col]
    for (let entry = col; entry <= size; entry += 1) augmented[col][entry] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === col) continue
      const factor = augmented[row][col]
      for (let entry = col; entry <= size; entry += 1) augmented[row][entry] -= factor * augmented[col][entry]
    }
  }
  return augmented.map((row) => row[size])
}

// Homography from four source corners [TL, TR, BR, BL] to the unit rectangle
// [0,0]-[1,1]. Returns null when singular.
export const estimateHomography = (corners) => {
  const dst = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const matrix = []
  const vector = []
  for (let index = 0; index < 4; index += 1) {
    const x = corners[index].x
    const y = corners[index].y
    const u = dst[index][0]
    const v = dst[index][1]
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    vector.push(u)
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    vector.push(v)
  }
  const h = solveLinearSystem(matrix, vector)
  if (!h) return null
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

// Warps part of an RGBA image so the four source corners become a rectangle of
// the requested dimensions. Bilinear sampling. Pure: returns { width, height, data }.
export const warpPerspective = ({ rgba, width, height, corners, outWidth, outHeight }) => {
  const h = estimateHomography(corners)
  if (!h) return null
  const out = new Uint8ClampedArray(outWidth * outHeight * 4)
  // Solve the inverse mapping directly by using the destination -> source map.
  // h maps source to unit-square. For each output pixel we need source coords:
  //   u_out,v_out in [0,1]; source = H^-1 * (u_out,v_out,1) normalized.
  const det = h[0] * (h[4] * h[8] - h[5] * h[7]) - h[1] * (h[3] * h[8] - h[5] * h[6]) + h[2] * (h[3] * h[7] - h[4] * h[6])
  if (Math.abs(det) < 1e-10) return null
  const inv = [
    (h[4] * h[8] - h[5] * h[7]) / det,
    (h[2] * h[7] - h[1] * h[8]) / det,
    (h[1] * h[5] - h[2] * h[4]) / det,
    (h[5] * h[6] - h[3] * h[8]) / det,
    (h[0] * h[8] - h[2] * h[6]) / det,
    (h[2] * h[3] - h[0] * h[5]) / det,
    (h[3] * h[7] - h[4] * h[6]) / det,
    (h[1] * h[6] - h[0] * h[7]) / det,
    (h[0] * h[4] - h[1] * h[3]) / det
  ]
  for (let row = 0; row < outHeight; row += 1) {
    const v = outHeight > 1 ? row / (outHeight - 1) : 0
    for (let col = 0; col < outWidth; col += 1) {
      const u = outWidth > 1 ? col / (outWidth - 1) : 0
      const denom = inv[6] * u + inv[7] * v + inv[8]
      if (Math.abs(denom) < 1e-10) continue
      const srcX = (inv[0] * u + inv[1] * v + inv[2]) / denom
      const srcY = (inv[3] * u + inv[4] * v + inv[5]) / denom
      const x0 = Math.floor(srcX)
      const y0 = Math.floor(srcY)
      const fx = srcX - x0
      const fy = srcY - y0
      const target = (row * outWidth + col) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const topLeftX = clampInt(x0, 0, width - 1)
        const topLeftY = clampInt(y0, 0, height - 1)
        const topRightX = clampInt(x0 + 1, 0, width - 1)
        const bottomLeftY = clampInt(y0 + 1, 0, height - 1)
        const tl = rgba[(topLeftY * width + topLeftX) * 4 + channel]
        const tr = rgba[(topLeftY * width + topRightX) * 4 + channel]
        const bl = rgba[(bottomLeftY * width + topLeftX) * 4 + channel]
        const br = rgba[(bottomLeftY * width + topRightX) * 4 + channel]
        const top = tl + (tr - tl) * fx
        const bottom = bl + (br - bl) * fx
        out[target + channel] = Math.round(top + (bottom - top) * fy)
      }
    }
  }
  return { width: outWidth, height: outHeight, data: out }
}

// -------------------------------------------------------- auto-capture

// Tiny configurable state machine for auto-capture. Feed it a smoothed corner
// set plus movement/area metrics each detection tick; it reports when a stable
// capture should fire. Pure and unit-testable without any browser APIs.
export const AUTO_CAPTURE_STATUS = {
  SEARCHING: 'searching',
  HOLDING: 'holding',
  STABLE: 'stable',
  READY: 'ready'
}

export const createAutoCaptureTracker = ({
  requiredHoldFrames = 4,
  movementThreshold = 3,
  minAreaFraction = 0.05,
  resetFrames = 3
} = {}) => {
  let holdCount = 0
  let jitterCount = 0
  let previous = null
  let confirmedArea = 0

  const tick = ({ corners, areaFraction }) => {
    if (!corners) {
      holdCount = 0
      jitterCount = 0
      previous = null
      return { status: AUTO_CAPTURE_STATUS.SEARCHING, shouldCapture: false, corners: null, areaFraction: 0 }
    }
    if (!previous) {
      // First sighting: establish the baseline and start holding immediately.
      previous = corners
      holdCount = Math.max(holdCount, 1)
      confirmedArea = areaFraction
      jitterCount = 0
      if (holdCount >= requiredHoldFrames) return { status: AUTO_CAPTURE_STATUS.READY, shouldCapture: true, corners, areaFraction: confirmedArea }
      return { status: AUTO_CAPTURE_STATUS.HOLDING, shouldCapture: false, corners, areaFraction: confirmedArea }
    }
    const movement = cornerDelta(previous, corners)
    previous = corners
    if (movement > movementThreshold) {
      holdCount = 0
      jitterCount += 1
      if (jitterCount >= resetFrames) return { status: AUTO_CAPTURE_STATUS.SEARCHING, shouldCapture: false, corners, areaFraction }
      return { status: AUTO_CAPTURE_STATUS.SEARCHING, shouldCapture: false, corners, areaFraction }
    }
    jitterCount = 0
    holdCount += 1
    confirmedArea = areaFraction
    if (holdCount >= requiredHoldFrames) {
      return { status: AUTO_CAPTURE_STATUS.READY, shouldCapture: true, corners, areaFraction: confirmedArea }
    }
    if (holdCount >= Math.max(1, requiredHoldFrames - 1)) {
      return { status: AUTO_CAPTURE_STATUS.STABLE, shouldCapture: false, corners, areaFraction: confirmedArea }
    }
    return { status: AUTO_CAPTURE_STATUS.HOLDING, shouldCapture: false, corners, areaFraction: confirmedArea }
  }

  const reset = () => {
    holdCount = 0
    jitterCount = 0
    previous = null
    confirmedArea = 0
  }

  const peek = () => ({ status: holdCount >= requiredHoldFrames ? AUTO_CAPTURE_STATUS.READY : holdCount > 0 ? AUTO_CAPTURE_STATUS.HOLDING : AUTO_CAPTURE_STATUS.SEARCHING })

  return { tick, reset, peek }
}