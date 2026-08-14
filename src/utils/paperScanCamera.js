// Browser-side camera glue for the Paper Scan document camera. Thin wrappers
// around canvas/DOM APIs; all the math lives in documentScan.js so it stays
// testable in Node. Functions here are pure-ish and mockable in Vitest.

import { canvasToDataUrl } from './paperScanImage'
import { detectDocumentCorners, orderCorners, warpPerspective } from './documentScan'

// Note: drawImage into an off-DOM location with preserveDrawingBuffer is not
// needed; we read pixels synchronously during the same frame.

const readRgba = (canvas) => {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  const { width, height } = canvas
  const imageData = context.getImageData(0, 0, width, height)
  return { width, height, rgba: imageData.data }
}

// Renders a cover-scaled analysis frame. When video width/height and display
// dimensions are given, the resulting canvas matches the video's DISPLAYED
// aspect ratio (what the user sees through object-cover), so detected corners
// can be drawn at 1:1 on an overlay of the same display size.
export const coverScale = (videoWidth, videoHeight, displayWidth, displayHeight) => {
  if (!videoWidth || !videoHeight || !displayWidth || !displayHeight) return 1
  return Math.max(displayWidth / videoWidth, displayHeight / videoHeight) || 1
}

// Undoes object-cover for detected corners. `corners` are display-space; the
// captured frame is the FULL video surface, so display corners must be mapped
// back into the full frame before warping. Returns null on missing inputs.
export const displayCornersToVideo = ({ corners, videoWidth, videoHeight, displayWidth, displayHeight }) => {
  if (!corners || !videoWidth || !videoHeight || !displayWidth || !displayHeight) return null
  const scale = coverScale(videoWidth, videoHeight, displayWidth, displayHeight)
  const offsetX = (videoWidth * scale - displayWidth) / (2 * scale)
  const offsetY = (videoHeight * scale - displayHeight) / (2 * scale)
  return corners.map((p) => ({
    x: offsetX + p.x / scale,
    y: offsetY + p.y / scale
  }))
}

// Renders a cover-scaled analysis frame. When video width/height and display
// dimensions are given, the resulting canvas matches the video's DISPLAYED
// aspect ratio (what the user sees through object-cover), so detected corners
// can be drawn at 1:1 on an overlay of the same display size.
export const captureCoverAnalysisFrame = ({ video, videoWidth, videoHeight, displayWidth, displayHeight, maxLongEdge = 640 }) => {
  if (!video || !videoWidth || !videoHeight || !displayWidth || !displayHeight) return null
  const scale = coverScale(videoWidth, videoHeight, displayWidth, displayHeight)
  // Analysis canvas keeps the DISPLAY aspect ratio (what the user sees), capped
  // on the long edge so CV cost stays bounded.
  let width
  let height
  if (displayWidth >= displayHeight) {
    width = Math.min(displayWidth, maxLongEdge)
    height = Math.max(1, Math.round(width * displayHeight / displayWidth))
  } else {
    height = Math.min(displayHeight, maxLongEdge)
    width = Math.max(1, Math.round(height * displayWidth / displayHeight))
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  // Cover: draw the video at cover size centered on the canvas; overflow crops,
  // matching the <video> element's object-cover exactly.
  const f = width / displayWidth
  const drawWidth = videoWidth * scale * f
  const drawHeight = videoHeight * scale * f
  const ox = (width - drawWidth) / 2
  const oy = (height - drawHeight) / 2
  context.drawImage(video, ox, oy, drawWidth, drawHeight)
  return { canvas, ...readRgba(canvas) }
}

// Maps analysis-canvas coordinates back onto the display box (same aspect,
// so a straight multiply by the ratio of display size to canvas size).
export const analysisToDisplay = ({ corners, analysisWidth, analysisHeight, displayWidth, displayHeight }) => {
  if (!corners || !analysisWidth || !analysisHeight) return null
  const sx = displayWidth / analysisWidth
  const sy = displayHeight / analysisHeight
  return corners.map((p) => ({ x: p.x * sx, y: p.y * sy }))
}

export const runCornerDetection = ({ rgba, width, height, options }) => (
  detectDocumentCorners({ rgba, width, height, options })
)

export const runCornerOrdering = (points) => orderCorners(points)

// Draws the document outline + corner handles on the analysis overlay canvas.
// `corners` are in analysis-canvas coordinates. White 3px outline; the corner
// dots give the eye (and the auto-capture logic) a stable reference.
export const drawDocumentOutline = ({ canvas, corners, confirmed = false }) => {
  const context = canvas.getContext('2d')
  if (!context || !corners || corners.length !== 4) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.beginPath()
  corners.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y)
    else context.lineTo(point.x, point.y)
  })
  context.closePath()
  context.strokeStyle = confirmed ? '#4ade80' : '#ffffff'
  context.lineWidth = 3
  context.stroke()
  corners.forEach((point) => {
    context.beginPath()
    context.arc(point.x, point.y, 4, 0, Math.PI * 2)
    context.fillStyle = confirmed ? '#4ade80' : '#ffffff'
    context.fill()
    context.strokeStyle = '#000000'
    context.lineWidth = 1.5
    context.stroke()
  })
}

// Scales ordered corners from analysis coordinates to full video dimensions.
// Returns null if either set is missing to make the mirroring explicit.
export const scaleCornersToVideo = (corners, analysisWidth, analysisHeight, videoWidth, videoHeight) => {
  if (!corners || !analysisWidth || !analysisHeight) return null
  const scaleX = (value) => value * (videoWidth / analysisWidth)
  const scaleY = (value) => value * (videoHeight / analysisHeight)
  return corners.map((p) => ({ x: scaleX(p.x), y: scaleY(p.y) }))
}

// Warps a full-resolution captured frame using document corners. The corners
// are in full-res pixel coordinates. Returns a JPEG data URL at the sheet's
// native aspect ratio (long edge ~2000px to match existing processing).
export const straightenDocument = ({ dataUrl, corners, sourceWidth, sourceHeight }) => {
  const image = new Image()
  return new Promise((resolve, reject) => {
    image.onload = () => {
      const width = sourceWidth || image.naturalWidth
      const height = sourceHeight || image.naturalHeight
      const canvas = document.createElement('canvas')
      const longEdge = 2000
      const scale = Math.min(1, longEdge / Math.max(width, height, 1))
      const outWidth = Math.max(1, Math.round(width * scale))
      const outHeight = Math.max(1, Math.round(height * scale))
      canvas.width = outWidth
      canvas.height = outHeight
      const context = canvas.getContext('2d')
      if (!context) return reject(new Error('Could not prepare the scan canvas.'))
      context.drawImage(image, 0, 0, width, height)
      const frame = readRgba(canvas)
      if (!frame) return reject(new Error('Could not read the captured frame.'))
      const effectiveCorners = corners && corners.length === 4
        ? corners
        : defaultSheetCorners(width, height)
      const scaledCorners = effectiveCorners.map((p) => ({ x: p.x * scale, y: p.y * scale }))
      const warped = warpPerspective({
        rgba: frame.rgba,
        width: frame.width,
        height: frame.height,
        corners: scaledCorners,
        outWidth,
        outHeight
      })
      if (!warped) return reject(new Error('Could not straighten the document.'))
      const output = document.createElement('canvas')
      output.width = outWidth
      output.height = outHeight
      const outputContext = output.getContext('2d')
      if (!outputContext) return reject(new Error('Could not write the straightened document.'))
      const imageData = outputContext.createImageData(outWidth, outHeight)
      imageData.data.set(warped.data)
      outputContext.putImageData(imageData, 0, 0)
      const dataUrl = canvasToDataUrl(output)
      if (!dataUrl) return reject(new Error('Could not encode the straightened document.'))
      resolve(dataUrl)
    }
    image.onerror = () => reject(new Error('The captured frame could not be decoded.'))
    image.src = dataUrl
  })
}

// Inset corners (e.g., manual fallback or missing detection) keep a sensible
// "most of the frame" crop.
export const defaultSheetCorners = (width, height) => [
  { x: width * 0.08, y: height * 0.08 },
  { x: width * 0.92, y: height * 0.08 },
  { x: width * 0.92, y: height * 0.92 },
  { x: width * 0.08, y: height * 0.92 }
]

// Torch support check + toggle. Some browsers only expose it as an advanced
// capability; probing avoids showing a dead control.
export const torchSupported = (track) => {
  if (!track) return false
  try {
    const capabilities = track.getCapabilities ? track.getCapabilities() : {}
    return capabilities && capabilities.torch === true
  } catch {
    return false
  }
}

export const setTorch = async (track, on) => {
  if (!track || !torchSupported(track)) return false
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] })
    return true
  } catch {
    return false
  }
}

// Maps detected analysis-canvas corners onto the display overlay canvas so the
// white outline lines up with the live video. Drawn fresh each detection tick.
export const outlineToDisplayCanvas = ({ corners, analysisCanvas, displayCanvas }) => {
  const context = displayCanvas.getContext('2d')
  if (!context || !corners) return
  const sx = displayCanvas.width / analysisCanvas.width
  const sy = displayCanvas.height / analysisCanvas.height
  const scaled = corners.map((p) => ({ x: p.x * sx, y: p.y * sy }))
  drawDocumentOutline({ canvas: displayCanvas, corners: scaled })
}

// Coalesced detection loop. Runs `detect` on a throttled interval and stops
// cleanly. Returns { start, stop }. The component owns the tracker state, so
// this stays generic.
export const createDetectionLoop = ({
  intervalMs = 120,
  tick = () => {}
}) => {
  let timer = null
  const start = () => {
    if (timer != null) return
    timer = window.setInterval(() => {
      try {
        tick()
      } catch {
        // Detection failures must never kill the camera. The component shows a
        // fallback; auto-capture simply won't fire.
      }
    }, intervalMs)
  }
  const stop = () => {
    if (timer == null) return
    window.clearInterval(timer)
    timer = null
  }
  return { start, stop }
}