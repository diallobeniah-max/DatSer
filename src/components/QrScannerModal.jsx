import React, { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { Camera, Check, Loader2, ScanLine, ShieldCheck, X, Zap } from 'lucide-react'
import { getLocalQrCheckInTarget, getPreferredQrCameraConstraints } from '../utils/qrCheckIn'

const enableContinuousCameraFocus = async (videoElement) => {
  const track = videoElement?.srcObject?.getVideoTracks?.()[0]
  if (!track) return { track: null, torchAvailable: false }

  const capabilities = track.getCapabilities?.() || {}
  const advanced = {}
  if (capabilities.focusMode?.includes?.('continuous')) advanced.focusMode = 'continuous'
  if (capabilities.exposureMode?.includes?.('continuous')) advanced.exposureMode = 'continuous'
  if (capabilities.whiteBalanceMode?.includes?.('continuous')) advanced.whiteBalanceMode = 'continuous'

  if (Object.keys(advanced).length) {
    try {
      await track.applyConstraints({ advanced: [advanced] })
    } catch (focusError) {
      console.warn('Could not enable continuous QR camera focus:', focusError)
    }
  }

  return { track, torchAvailable: capabilities.torch === true }
}

const QrScannerModal = ({ isOpen, onClose, onScan }) => {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const trackRef = useRef(null)
  const completedRef = useRef(false)
  const invalidResetRef = useRef(null)
  const onScanRef = useRef(onScan)
  const [status, setStatus] = useState('Starting camera...')
  const [error, setError] = useState('')
  const [scanState, setScanState] = useState('starting')
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    if (!isOpen) return undefined
    let disposed = false
    completedRef.current = false
    setError('')
    setStatus('Starting camera...')
    setScanState('starting')
    setTorchAvailable(false)
    setTorchOn(false)

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera scanning is not supported in this browser.')
        return
      }
      try {
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 100 })
        const controls = await reader.decodeFromConstraints(
          getPreferredQrCameraConstraints(),
          videoRef.current,
          (result, scanError, activeControls) => {
            if (disposed || completedRef.current) return
            if (result) {
              const value = result.getText()
              const localTarget = getLocalQrCheckInTarget(value)
              if (!localTarget) {
                setScanState('invalid')
                setStatus('QR found, but it is not a DatSer member pass.')
                window.clearTimeout(invalidResetRef.current)
                invalidResetRef.current = window.setTimeout(() => {
                  if (!completedRef.current) {
                    setScanState('scanning')
                    setStatus('Hold steady and fit the whole QR code inside the frame')
                  }
                }, 1400)
                return
              }
              completedRef.current = true
              setScanState('found')
              setStatus('Member pass found — opening check-in')
              navigator.vibrate?.(80)
              activeControls?.stop()
              window.setTimeout(() => onScanRef.current?.(localTarget), 180)
              return
            }
            if (scanError && scanError.name !== 'NotFoundException') {
              console.debug('QR scan attempt:', scanError)
            }
          }
        )
        if (disposed) {
          controls.stop()
          return
        }
        controlsRef.current = controls
        const focusResult = await enableContinuousCameraFocus(videoRef.current)
        trackRef.current = focusResult.track
        setTorchAvailable(focusResult.torchAvailable)
        if (!completedRef.current) {
          setScanState('scanning')
          setStatus('Hold steady and fit the whole QR code inside the frame')
        }
      } catch (cameraError) {
        console.error('Could not start QR scanner:', cameraError)
        setError(cameraError?.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow camera permission and try again.'
          : 'Could not open the camera. Check that another app is not using it.')
        setScanState('error')
      }
    }

    start()
    return () => {
      disposed = true
      controlsRef.current?.stop()
      controlsRef.current = null
      trackRef.current = null
      window.clearTimeout(invalidResetRef.current)
      invalidResetRef.current = null
    }
  }, [isOpen])

  const toggleTorch = async () => {
    const track = trackRef.current
    if (!track || !torchAvailable) return
    const nextTorchOn = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: nextTorchOn }] })
      setTorchOn(nextTorchOn)
    } catch (torchError) {
      console.warn('Could not change QR scanner flashlight:', torchError)
      setTorchAvailable(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="app-modal-backdrop fixed inset-0 z-[160] flex items-center justify-center bg-black/85 p-3 backdrop-blur-xl" role="dialog" aria-modal="true" aria-label="Scan member pass">
      <div className="qr-scanner-shell relative flex h-[min(88vh,46rem)] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] border border-orange-400/35 bg-[#090b0d] text-white shadow-[0_30px_100px_rgba(0,0,0,0.65)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500/15 text-orange-300"><ScanLine className="h-5 w-5" /></span>
            <div><p className="font-black">Scan member pass</p><p className="text-xs text-white/50">Secure DatSer QR check-in</p></div>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-white/8 text-white/80 transition hover:bg-white/15" aria-label="Close scanner"><X className="h-5 w-5" /></button>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_35%,rgba(0,0,0,.72)_72%)]" />
          <div className={`qr-scanner-frame qr-scanner-frame-${scanState} pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[min(70vw,18rem)] -translate-x-1/2 -translate-y-1/2 rounded-[1.5rem] border`}>
            <span className="qr-scanner-corner qr-scanner-corner-tl" /><span className="qr-scanner-corner qr-scanner-corner-tr" />
            <span className="qr-scanner-corner qr-scanner-corner-bl" /><span className="qr-scanner-corner qr-scanner-corner-br" />
            {scanState === 'scanning' && <span className="qr-scanner-line" />}
            {scanState === 'found' && <span className="absolute inset-0 grid place-items-center rounded-[1.4rem] bg-emerald-500/20"><span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_0_35px_rgba(16,185,129,.75)]"><Check className="h-9 w-9" /></span></span>}
          </div>
          {scanState === 'scanning' && <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-black/55 px-4 py-2 text-xs font-bold text-white/85 backdrop-blur-md">Move closer until the QR fills the frame</div>}
          {torchAvailable && !error && (
            <button type="button" onClick={toggleTorch} className={`absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full border backdrop-blur-md transition ${torchOn ? 'border-amber-300 bg-amber-400 text-black' : 'border-white/15 bg-black/45 text-white'}`} aria-label={torchOn ? 'Turn flashlight off' : 'Turn flashlight on'} aria-pressed={torchOn}>
              <Zap className="h-5 w-5" />
            </button>
          )}
          {status === 'Starting camera...' && !error && <div className="absolute inset-0 grid place-items-center"><Loader2 className="h-8 w-8 animate-spin text-orange-400" /></div>}
          {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-red-500/15 text-red-300"><Camera className="h-8 w-8" /></span><p className="max-w-xs font-bold">{error}</p></div>}
        </div>

        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
          <p className="min-w-0 flex-1 text-sm font-semibold text-white/70" aria-live="polite">{error || status}</p>
        </div>
      </div>
    </div>
  )
}

export default QrScannerModal
