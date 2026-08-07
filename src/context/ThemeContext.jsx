import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useAuth } from './AuthContext'

const ThemeContext = createContext()

const APPLE_SYSTEM_FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"'

const resolveFontFamily = (fontFamily) => {
  if (!fontFamily || fontFamily === 'system') return APPLE_SYSTEM_FONT_STACK
  return fontFamily
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

export const ThemeProvider = ({ children }) => {
  const { user, loading, updatePreference, preferences } = useAuth()
  const updatePreferenceRef = useRef(updatePreference)

  useEffect(() => {
    updatePreferenceRef.current = updatePreference
  }, [updatePreference])

  // 1. Theme Mode
  const [themeMode, setThemeModeState] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('themeMode')
      if (saved) return saved
    }
    return preferences?.theme_mode || 'system'
  })

  // 2. Command K (Device-specific)
  const [commandKEnabled, setCommandKEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('datser_command_k')
      return saved !== 'false'
    }
    return true
  })

  // 3. System Theme
  const [systemTheme, setSystemTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  })

  // 4. Font Size
  const [fontSize, setFontSizeState] = useState(() => {
    return preferences?.font_size || (typeof window !== 'undefined' ? localStorage.getItem('fontSize') : null) || '16'
  })

  // 5. Font Family - Default to system font
  const [fontFamily, setFontFamilyState] = useState(() => {
    return preferences?.font_family || (typeof window !== 'undefined' ? localStorage.getItem('fontFamily') : null) || 'system'
  })

  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  // Hydration is local-only. The explicit setters below are the only path that
  // persists a theme choice, so copied server values can never trigger a save.
  useEffect(() => {
    if (preferences && user) {
      if (preferences.theme_mode && preferences.theme_mode !== themeMode && !preferencesLoaded) {
        setThemeModeState(preferences.theme_mode)
      }
      if (preferences.font_size && preferences.font_size !== fontSize && !preferencesLoaded) {
        setFontSizeState(preferences.font_size)
      }
      if (preferences.font_family && preferences.font_family !== fontFamily && !preferencesLoaded) {
        setFontFamilyState(preferences.font_family)
      }
      setPreferencesLoaded(true)
    }
  }, [preferences, user, preferencesLoaded])

  // Keep the last resolved device theme through session refresh/resume.
  useEffect(() => {
    if (!loading && !user) {
      setPreferencesLoaded(false)
    }
  }, [user, loading])

  // System Theme Listener
  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (e) => setSystemTheme(e.matches ? 'dark' : 'light')
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])

  const resolvedTheme = themeMode === 'system' ? systemTheme : themeMode
  const isDarkMode = resolvedTheme === 'dark'

  // DOM Updates
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('themeMode', themeMode)
    if (isDarkMode) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light')
  }, [themeMode, isDarkMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('fontSize', fontSize)
    document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`)
  }, [fontSize])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('fontFamily', fontFamily)
    document.documentElement.style.setProperty('--font-family', resolveFontFamily(fontFamily))
  }, [fontFamily])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('datser_command_k', String(commandKEnabled))
  }, [commandKEnabled])

  const persistExplicitPreference = useCallback((key, value) => {
    if (!user || !preferencesLoaded || !updatePreferenceRef.current) return
    void updatePreferenceRef.current(key, value)
  }, [preferencesLoaded, user])

  const setThemeMode = useCallback((nextThemeMode) => {
    const value = typeof nextThemeMode === 'function' ? nextThemeMode(themeMode) : nextThemeMode
    if (value === themeMode) return
    setThemeModeState(value)
    persistExplicitPreference('theme_mode', value)
  }, [persistExplicitPreference, themeMode])

  const setFontSize = useCallback((nextFontSize) => {
    const value = typeof nextFontSize === 'function' ? nextFontSize(fontSize) : nextFontSize
    if (value === fontSize) return
    setFontSizeState(value)
    persistExplicitPreference('font_size', value)
  }, [fontSize, persistExplicitPreference])

  const setFontFamily = useCallback((nextFontFamily) => {
    const value = typeof nextFontFamily === 'function' ? nextFontFamily(fontFamily) : nextFontFamily
    if (value === fontFamily) return
    setFontFamilyState(value)
    persistExplicitPreference('font_family', value)
  }, [fontFamily, persistExplicitPreference])

  const toggleTheme = useCallback(() => {
    setThemeMode(() => (isDarkMode ? 'light' : 'dark'))
  }, [isDarkMode])

  // Memoize context value to prevent unnecessary re-renders of consumers
  const value = useMemo(() => ({
    isDarkMode,
    toggleTheme,
    themeMode,
    setThemeMode,
    theme: resolvedTheme,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    commandKEnabled,
    setCommandKEnabled
  }), [isDarkMode, toggleTheme, themeMode, resolvedTheme, fontSize, fontFamily, commandKEnabled])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export default ThemeContext
