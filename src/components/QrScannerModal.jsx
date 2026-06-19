import React, { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { Camera, Loader2, ScanLine, ShieldCheck, X } from 'lucide-react'

const isDatSerCheckInUrl = (value) => {
  try {
    const url = new URL(value, window.location.origin)
    return url.origin === window.location.origin &&
      url.searchParams.get('member_checkin') === '1' &&
      Boolean(url.searchParams.get('qr_mark'))
  } catch {
    return false
  }
}

const QrScannerModal = ({ isOpen, onClose, onScan }) => {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const completedRef = useRef(false)
  const [status, setStatus] = useState('Starting camera...')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return undefined
    let disposed = false
    completedRef.current = false
    setError('')
    setStatus('Starting camera...')

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera scanning is not supported in this browser.')
        return
      }
      try {
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 180 })
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' } } },
          videoRef.current,
          (result, scanError, activeControls) => {
            if (disposed || completedRef.current) return
            if (result) {
              const value = result.getText()
              if (!isDatSerCheckInUrl(value)) {
                setStatus('That is not a DatSer member pass. Keep scanning.')
                return
              }
              completedRef.current = true
              setStatus('Member pass found')
              activeControls?.stop()
              onScan?.(value)
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
        setStatus('Point the camera at a DatSer member QR code')
      } catch (cameraError) {
        console.error('Could not start QR scanner:', cameraError)
        setError(cameraError?.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow camera permission and try again.'
          : 'Could not open the camera. Check that another app is not using it.')
      }
    }

    start()
    return () => {
      disposed = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [isOpen, onScan])

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
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_34%,rgba(0,0,0,.66)_70%)]" />
          <div className="qr-scanner-frame pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[min(72vw,19rem)] -translate-x-1/2 -translate-y-1/2 rounded-[1.8rem] border border-orange-300/30">
            <span className="qr-scanner-corner qr-scanner-corner-tl" /><span className="qr-scanner-corner qr-scanner-corner-tr" />
            <span className="qr-scanner-corner qr-scanner-corner-bl" /><span className="qr-scanner-corner qr-scanner-corner-br" />
            {!error && <span className="qr-scanner-line" />}
          </div>
          {status === 'Starting camera...' && !error && <div className="absolute inset-0 grid place-items-center"><Loader2 className="h-8 w-8 animate-spin text-orange-400" /></div>}
          {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-red-500/15 text-red-300"><Camera className="h-8 w-8" /></span><p className="max-w-xs font-bold">{error}</p></div>}
        </div>

        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
          <p className="min-w-0 flex-1 text-sm font-semibold text-white/70">{error || status}</p>
        </div>
      </div>
    </div>
  )
}

export default QrScannerModal
