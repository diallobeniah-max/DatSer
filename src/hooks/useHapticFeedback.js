import { useCallback, useRef } from 'react'
import { useWebHaptics } from 'web-haptics/react'

const getStoredBoolean = (key, fallback = true) => {
  if (typeof window === 'undefined') return fallback
  try {
    const value = window.localStorage.getItem(key)
    if (value === null) return fallback
    return value !== 'false'
  } catch {
    return fallback
  }
}

const getStoredNumber = (key, fallback = 1) => {
  if (typeof window === 'undefined') return fallback
  try {
    const value = Number(window.localStorage.getItem(key))
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

let lastGlobalTapAt = 0

const useHapticFeedback = () => {
  const { trigger } = useWebHaptics()
  const audioContextRef = useRef(null)

  const isMotionAndSoundEnabled = useCallback(() => {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('animations-disabled')) {
      return false
    }
    if (typeof window !== 'undefined') {
      try {
        return window.localStorage.getItem('datser_motion_and_sounds_enabled') !== 'false'
      } catch {
        return true
      }
    }
    return true
  }, [])

  const isHapticEnabled = useCallback(() => (
    getStoredBoolean('datser_haptic_feedback_enabled', true)
  ), [])

  const getHapticStrength = useCallback(() => {
    const value = getStoredNumber('datser_haptic_feedback_strength', 1)
    return Math.min(2, Math.max(0.35, value))
  }, [])

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
      const playTone = () => {
        const now = context.currentTime
        const oscillator = context.createOscillator()
        const gainNode = context.createGain()
        const strength = getHapticStrength()
        oscillator.type = tone === 'error' ? 'triangle' : 'sine'
        if (tone === 'success') {
          oscillator.frequency.setValueAtTime(760, now)
          oscillator.frequency.exponentialRampToValueAtTime(980, now + 0.06)
        } else if (tone === 'error') {
          oscillator.frequency.setValueAtTime(420, now)
          oscillator.frequency.exponentialRampToValueAtTime(300, now + 0.08)
        } else {
          oscillator.frequency.setValueAtTime(640, now)
        }
        gainNode.gain.setValueAtTime(0.0001, now)
        gainNode.gain.exponentialRampToValueAtTime((tone === 'error' ? 0.03 : 0.024) * Math.min(strength, 1.35), now + 0.01)
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + (tone === 'success' ? 0.1 : tone === 'error' ? 0.11 : 0.06))
        oscillator.connect(gainNode)
        gainNode.connect(context.destination)
        oscillator.start(now)
        oscillator.stop(now + (tone === 'success' ? 0.11 : tone === 'error' ? 0.12 : 0.07))
      }
      if (context.state === 'suspended') {
        context.resume().then(playTone).catch(() => { })
        return
      }
      playTone()
    } catch { }
  }, [createAudioContext, getHapticStrength])

  const tap = useCallback((pattern = 'nudge', tone = 'tap') => {
    if (!isMotionAndSoundEnabled()) return
    const now = Date.now()
    if (now - lastGlobalTapAt < 80) return
    lastGlobalTapAt = now
    const strength = getHapticStrength()
    const hapticEnabled = isHapticEnabled()
    const vibrationDuration = Math.round((tone === 'error' ? 38 : tone === 'success' ? 32 : 18) * strength)
    try {
      if (hapticEnabled) {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(vibrationDuration)
        }
        if (pattern === null) {
          trigger()
        } else if (pattern) {
          trigger(pattern)
        } else {
          trigger()
        }
      }
    } catch {
    } finally {
      playClick(tone)
    }
  }, [getHapticStrength, isHapticEnabled, isMotionAndSoundEnabled, playClick, trigger])

  const selection = useCallback(() => {
    tap('nudge', 'tap')
  }, [tap])

  const success = useCallback(() => {
    tap('success', 'success')
  }, [tap])

  const error = useCallback(() => {
    tap('error', 'error')
  }, [tap])

  return {
    tap,
    selection,
    success,
    error
  }
}

export default useHapticFeedback
