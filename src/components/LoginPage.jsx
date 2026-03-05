import React, { useState, useMemo, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { Mail, Lock, User, Eye, EyeOff, ArrowLeft, Check, X, Sparkles } from 'lucide-react'
import { Turnstile } from '@marsidev/react-turnstile'
import { supabase } from '../lib/supabase'

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

const getPasswordStrength = (password) => {
  if (!password) return { score: 0, label: '', color: '' }

  let score = 0
  const checks = {
    length: password.length >= 10,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
  }

  if (password.length >= 6) score += 1
  if (password.length >= 8) score += 1
  if (checks.lowercase && checks.uppercase) score += 1
  if (checks.number) score += 1
  if (checks.special) score += 1

  if (score <= 2) return { score, label: 'Weak', color: 'bg-red-500', textColor: 'text-red-500', checks }
  if (score <= 3) return { score, label: 'Fair', color: 'bg-orange-500', textColor: 'text-orange-500', checks }
  if (score <= 4) return { score, label: 'Good', color: 'bg-yellow-500', textColor: 'text-yellow-500', checks }
  return { score, label: 'Strong', color: 'bg-green-500', textColor: 'text-green-500', checks }
}

const LoginPage = () => {
  const { signInWithGoogle, signUpWithEmail, signInWithEmail, signInWithMagicLink, resetPassword, bypassAuth } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  // Form state
  const [mode, setMode] = useState('login') // 'login', 'signup', 'forgot', 'magiclink'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)

  // Detect if user arrived via invite link (token_hash in URL, PKCE code, or hash fragment)
  const [isInviteFlow] = useState(() => {
    const hash = window.location.hash
    const params = new URLSearchParams(window.location.search)
    const tokenType = params.get('type')
    const hasTokenHash = !!params.get('token_hash') && (tokenType === 'invite' || tokenType === 'magiclink')
    const hasCode = !!params.get('code')
    const hasInviteHash = hash && (hash.includes('type=invite') || hash.includes('type=magiclink') || hash.includes('access_token'))
    return hasTokenHash || hasCode || hasInviteHash
  })

  // Detect if user arrived via password reset link
  const [isPasswordResetFlow] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const tokenType = params.get('type')
    return tokenType === 'recovery'
  })

  // Password reset form state
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)

  const [loginAttempts, setLoginAttempts] = useState(0)
  const [captchaToken, setCaptchaToken] = useState(null)
  const turnstileRef = useRef(null)
  const hasTurnstile = Boolean(TURNSTILE_SITE_KEY)



  // Calculate password strength for signup mode
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password])

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      console.error('Sign in error:', err)
      setError('Failed to sign in. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEmailSignIn = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Please fill in all fields')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      // Allow login even without captcha token (captcha may not be configured)
      await signInWithEmail(email, password, captchaToken || undefined)
      setCaptchaToken(null)
      turnstileRef.current?.reset()
      setLoginAttempts(0) // Reset on success
    } catch (err) {
      console.error('Login error details:', err)
      const newAttempts = loginAttempts + 1
      setLoginAttempts(newAttempts)

      // Show increasingly helpful messages based on attempts
      if (err.message?.includes('Invalid login credentials')) {
        if (newAttempts === 1) {
          setError('Invalid email or password. Please try again.')
        } else if (newAttempts === 2) {
          setError('Still incorrect. Double-check your email and password.')
        } else {
          setError("We couldn't find an account with these credentials. Need to create one?")
        }
      } else if (err.message?.includes('Email not confirmed')) {
        setError('Please check your email and click the confirmation link first.')
      } else {
        // Show the actual error message for debugging
        setError(err.message || 'Something went wrong. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleEmailSignUp = async (e) => {
    e.preventDefault()
    if (!email || !password || !fullName) {
      setError('Please fill in all fields')
      return
    }
    if (password.length < 10) {
      setError('Password must be at least 10 characters')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      // Allow signup even without captcha token (captcha may not be configured)
      const result = await signUpWithEmail(email, password, fullName, captchaToken || undefined)
      setCaptchaToken(null)
      turnstileRef.current?.reset()
      if (result?.needsConfirmation) {
        setConfirmationSent(true)
      } else if (result?.needsSignIn) {
        setMode('login')
      }
    } catch (err) {
      // Error is handled in AuthContext
    } finally {
      setIsLoading(false)
    }
  }

  const handleMagicLinkSignIn = async (e) => {
    e.preventDefault()
    if (!email) {
      setError('Please enter your email address')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      await signInWithMagicLink(email, captchaToken || undefined)
      setCaptchaToken(null)
      turnstileRef.current?.reset()
      setConfirmationSent(true)
    } catch (err) {
      // Error is handled in AuthContext
    } finally {
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async (e) => {
    e.preventDefault()
    if (!email) {
      setError('Please enter your email address')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      // Allow password reset even without captcha token (captcha may not be configured)
      await resetPassword(email, captchaToken || undefined)
      setCaptchaToken(null)
      turnstileRef.current?.reset()
      setConfirmationSent(true)
    } catch (err) {
      // Error is handled in AuthContext
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordResetSubmit = async (e) => {
    e.preventDefault()
    if (!newPassword || !confirmNewPassword) {
      setError('Please fill in all fields')
      return
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })
      if (error) throw error
      setResetSuccess(true)
      // Auto-redirect to login after 3 seconds
      setTimeout(() => {
        setResetSuccess(false)
        setNewPassword('')
        setConfirmNewPassword('')
        setMode('login')
      }, 3000)
    } catch (err) {
      console.error('Password reset error:', err)
      setError(err.message || 'Failed to reset password. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const resetForm = () => {
    setError(null)
    setConfirmationSent(false)
    setLoginAttempts(0)
    setCaptchaToken(null)
    turnstileRef.current?.reset()
  }

  const switchMode = (newMode) => {
    setMode(newMode)
    resetForm()
  }

  // Password reset flow - shown when user clicks reset link from email
  if (isPasswordResetFlow) {
    if (resetSuccess) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Password Reset Successfully!
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Your password has been updated. Redirecting to login...
              </p>
              <div className="flex justify-center">
                <div className="w-8 h-8 border-3 border-green-600 border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo/Brand Section */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 shadow-lg mb-3">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              Datser
            </h1>
            <p className="text-sm text-gray-600">
              Attendance Tracking & Management
            </p>
          </div>

          {/* Reset Password Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6">
            <div className="text-center mb-5">
              <h2 className="text-lg font-semibold text-gray-900">
                Set New Password
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Create a new password for your account
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm text-center">
                {error}
              </div>
            )}

            <form onSubmit={handlePasswordResetSubmit} className="space-y-4">
              {/* New Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full pl-11 pr-12 py-3 rounded-xl border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type={showConfirmNewPassword ? 'text' : 'password'}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className={`w-full pl-11 pr-12 py-3 rounded-xl border bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all ${
                      confirmNewPassword && newPassword !== confirmNewPassword
                        ? 'border-red-300 dark:border-red-500'
                        : confirmNewPassword && newPassword === confirmNewPassword
                        ? 'border-green-300 dark:border-green-500'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showConfirmNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {confirmNewPassword && newPassword === confirmNewPassword && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Passwords match
                  </p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading || !newPassword || !confirmNewPassword || newPassword !== confirmNewPassword}
                className="w-full py-3 rounded-xl font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all mt-6"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Resetting...
                  </span>
                ) : (
                  'Reset Password'
                )}
              </button>
            </form>

            <div className="mt-5 text-center text-sm">
              <p className="text-gray-600 dark:text-gray-400">
                Remember your password?{' '}
                <button
                  onClick={() => {
                    setNewPassword('')
                    setConfirmNewPassword('')
                    setError(null)
                    setMode('login')
                  }}
                  className="text-primary-600 dark:text-primary-400 font-medium hover:underline"
                >
                  Sign in
                </button>
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-5 text-xs text-gray-500">
            <p>A simple platform for tracking and organizing records.</p>
          </div>
        </div>
      </div>
    )
  }

  // Invite flow loading screen - shown while Supabase processes the invite token
  if (isInviteFlow) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
              <Mail className="w-8 h-8 text-blue-600 animate-pulse" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Accepting your invite...
            </h2>
            <p className="text-gray-600 mb-6">
              Setting up your access. This will only take a moment.
            </p>
            <div className="flex justify-center">
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Confirmation sent screen
  if (confirmationSent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <Mail className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Check your email
            </h2>
            <p className="text-gray-600 mb-6">
              {mode === 'forgot'
                ? `We've sent a password reset link to ${email}`
                : mode === 'magiclink'
                ? `We've sent a magic login link to ${email}. Click it to sign in instantly!`
                : `We've sent a confirmation link to ${email}. Click it to activate your account.`
              }
            </p>
            <button
              onClick={() => {
                setConfirmationSent(false)
                setMode('login')
              }}
              className="text-primary-600 dark:text-primary-400 font-medium hover:underline"
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand Section */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 shadow-lg mb-3">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Datser
          </h1>
          <p className="text-sm text-gray-600">
            Attendance Tracking & Management
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6">
          {/* Mode Header */}
          <div className="text-center mb-5">
            {(mode === 'forgot' || mode === 'magiclink') && (
              <button
                onClick={() => switchMode('login')}
                className="absolute left-4 top-4 p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-gray-900">
              {mode === 'login' && 'Welcome Back'}
              {mode === 'signup' && 'Create Account'}
              {mode === 'forgot' && 'Reset Password'}
              {mode === 'magiclink' && 'Magic Link Login'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {mode === 'login' && 'Sign in to continue'}
              {mode === 'signup' && 'Sign up to get started'}
              {mode === 'forgot' && 'Enter your email to reset'}
              {mode === 'magiclink' && 'We\'ll email you a login link'}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm text-center">
              {error}
            </div>
          )}

          {/* Email/Password Form */}
          <form onSubmit={mode === 'login' ? handleEmailSignIn : mode === 'signup' ? handleEmailSignUp : mode === 'magiclink' ? handleMagicLinkSignIn : handleForgotPassword}>
            {/* Full Name - Signup only */}
            {mode === 'signup' && (
              <div className="mb-3">
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full Name"
                    className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <div className="mb-3">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            {/* Password - Not for forgot or magiclink mode */}
            {mode !== 'forgot' && mode !== 'magiclink' && (
              <div className="mb-4">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="w-full pl-11 pr-12 py-3 rounded-xl border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>

                {/* Password Strength Indicator - Signup only */}
                {mode === 'signup' && password && (
                  <div className="mt-2 space-y-2">
                    {/* Strength Bar */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${passwordStrength.color} transition-all duration-300`}
                          style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                        />
                      </div>
                      <span className={`text-xs font-medium ${passwordStrength.textColor}`}>
                        {passwordStrength.label}
                      </span>
                    </div>

                    {/* Requirements Checklist */}
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <div className={`flex items-center gap-1 ${passwordStrength.checks?.length ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordStrength.checks?.length ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        10+ characters
                      </div>
                      <div className={`flex items-center gap-1 ${passwordStrength.checks?.uppercase ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordStrength.checks?.uppercase ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Uppercase
                      </div>
                      <div className={`flex items-center gap-1 ${passwordStrength.checks?.lowercase ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordStrength.checks?.lowercase ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Lowercase
                      </div>
                      <div className={`flex items-center gap-1 ${passwordStrength.checks?.number ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordStrength.checks?.number ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Number
                      </div>
                      <div className={`flex items-center gap-1 ${passwordStrength.checks?.special ? 'text-green-600' : 'text-gray-400'}`}>
                        {passwordStrength.checks?.special ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Special char
                      </div>
                    </div>
                  </div>
                )}

                {mode === 'signup' && !password && (
                  <p className="mt-1 text-xs text-gray-500">Create a strong password</p>
                )}
              </div>
            )}

            {hasTurnstile && (
              <div className="mb-4 flex justify-center">
                <Turnstile
                  ref={turnstileRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  onSuccess={(token) => setCaptchaToken(token)}
                  onError={() => setCaptchaToken(null)}
                  onExpire={() => setCaptchaToken(null)}
                />
              </div>
            )}

            {/* Forgot Password & Magic Link - Login only */}
            {mode === 'login' && (
              <div className="flex items-center justify-between mb-4">
                <button
                  type="button"
                  onClick={() => switchMode('magiclink')}
                  className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Magic link
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-xl font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {mode === 'login' ? 'Signing in...' : mode === 'signup' ? 'Creating account...' : mode === 'magiclink' ? 'Sending link...' : 'Sending...'}
                </span>
              ) : (
                <>
                  {mode === 'login' && 'Sign In'}
                  {mode === 'signup' && 'Create Account'}
                  {mode === 'magiclink' && 'Send Magic Link'}
                  {mode === 'forgot' && 'Send Reset Link'}
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-3 bg-white text-gray-500">
                or
              </span>
            </div>
          </div>

          {/* Google Sign In Button */}
          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all duration-200 bg-white border-2 border-gray-300 hover:border-gray-400 hover:shadow-md text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            <span>Continue with Google</span>
          </button>

          {/* Switch Mode */}
          <div className="mt-5 text-center text-sm">
            {mode === 'login' ? (
              <>
                <p className="text-gray-600 dark:text-gray-400">
                  Don't have an account?{' '}
                  <button
                    onClick={() => switchMode('signup')}
                    className="text-primary-600 dark:text-primary-400 font-medium hover:underline"
                  >
                    Sign up
                  </button>
                </p>

              </>
            ) : mode === 'signup' ? (
              <p className="text-gray-600 dark:text-gray-400">
                Already have an account?{' '}
                <button
                  onClick={() => switchMode('login')}
                  className="text-primary-600 dark:text-primary-400 font-medium hover:underline"
                >
                  Sign in
                </button>
              </p>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-5 text-xs text-gray-500">
          <p>A simple platform for tracking and organizing records.</p>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
