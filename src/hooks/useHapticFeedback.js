import { useCallback, useRef } from 'react'
import { useWebHaptics } from 'web-haptics/react'

const useHapticFeedback = () => {
  const { trigger } = useWebHaptics()
  const audioContextRef = useRef(null)

  const createAudioContext = useCallback(() => {
    if (typeof window === 'undefined') return null
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return null
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass()
    }
    return audioContextRef.current
  }, [])

  const playClick = useCallback((tone = 'tap') => {
    try {
      const context = createAudioContext()
      if (!context) return
      if (context.state === 'suspended') {
        context.resume().catch(() => { })
      }
      const now = context.currentTime
      const oscillator = context.createOscillator()
      const gainNode = context.createGain()
      oscillator.type = 'sine'
      if (tone === 'success') {
        oscillator.frequency.setValueAtTime(760, now)
        oscillator.frequency.exponentialRampToValueAtTime(980, now + 0.06)
      } else {
        oscillator.frequency.setValueAtTime(640, now)
      }
      gainNode.gain.setValueAtTime(0.0001, now)
      gainNode.gain.exponentialRampToValueAtTime(0.018, now + 0.01)
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + (tone === 'success' ? 0.1 : 0.06))
      oscillator.connect(gainNode)
      gainNode.connect(context.destination)
      oscillator.start(now)
      oscillator.stop(now + (tone === 'success' ? 0.11 : 0.07))
    } catch { }
  }, [createAudioContext])

  const shouldUseSoundFallback = useCallback(() => {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return true
    }
    try {
      return navigator.vibrate(0) === false
    } catch {
      return true
    }
  }, [])

  const tap = useCallback((pattern = null, tone = 'tap') => {
    const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
    try {
      if (pattern) {
        trigger(pattern)
      } else {
        trigger()
      }
      if (!canVibrate) {
        playClick(tone)
      }
    } catch {
      playClick(tone)
    }
  }, [playClick, shouldUseSoundFallback, trigger])

  const selection = useCallback(() => {
    tap(null, 'tap')
  }, [tap])

  const success = useCallback(() => {
    tap([
      { duration: 30 },
      { delay: 60, duration: 40, intensity: 1 }
    ], 'success')
  }, [tap])

  return {
    tap,
    selection,
    success
  }
}

export default useHapticFeedback
