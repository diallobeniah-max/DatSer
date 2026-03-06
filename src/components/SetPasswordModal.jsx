import React, { useState, useRef, useEffect } from 'react'
import { X, Lock, Eye, EyeOff, CheckCircle, AlertCircle, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'

const SetPasswordModal = ({ isOpen, onClose, onSuccess }) => {
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState(null)
    const inputRef = useRef(null)

    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 100)
        }
    }, [isOpen])

    // Password strength calculation
    const getPasswordStrength = (pwd) => {
        if (!pwd) return { score: 0, label: '', color: '' }
        let score = 0
        if (pwd.length >= 6) score++
        if (pwd.length >= 8) score++
        if (/[A-Z]/.test(pwd)) score++
        if (/[0-9]/.test(pwd)) score++
        if (/[^A-Za-z0-9]/.test(pwd)) score++

        if (score <= 1) return { score: 1, label: 'Weak', color: 'red' }
        if (score <= 2) return { score: 2, label: 'Fair', color: 'orange' }
        if (score <= 3) return { score: 3, label: 'Good', color: 'yellow' }
        if (score <= 4) return { score: 4, label: 'Strong', color: 'green' }
        return { score: 5, label: 'Very Strong', color: 'emerald' }
    }

    const strength = getPasswordStrength(password)
    const passwordsMatch = password && confirmPassword && password === confirmPassword
    const canSubmit = password.length >= 6 && passwordsMatch && !isLoading

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!canSubmit) return

        setIsLoading(true)
        setError(null)

        try {
            const { error: updateError } = await supabase.auth.updateUser({
                password: password
            })

            if (updateError) throw updateError

            // Mark password as set in localStorage
            localStorage.setItem('passwordSetup_complete', 'true')
            // Clear the dismissed flag so tutorial prompt can show
            sessionStorage.removeItem('passwordSetup_dismissed')

            toast.success('Password created successfully! You can now log in with your email and password.')
            onSuccess?.()
            onClose()
        } catch (err) {
            console.error('Error setting password:', err)
            setError(err.message || 'Failed to set password')
        } finally {
            setIsLoading(false)
        }
    }

    const handleSkip = () => {
        // Mark as dismissed so it doesn't show again this session
        sessionStorage.setItem('passwordSetup_dismissed', 'true')
        onClose()
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                {/* Header */}
                <div className="relative bg-gradient-to-r from-orange-600 to-purple-600 p-6 text-white">
                    <button
                        onClick={handleSkip}
                        className="absolute top-4 right-4 p-1 rounded-full hover:bg-white/20 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-white/20 rounded-lg">
                            <Shield className="w-6 h-6" />
                        </div>
                        <h2 className="text-xl font-bold">Create a Password</h2>
                    </div>
                    <p className="text-white/80 text-sm">
                        Set up a password so you can log in anytime without needing a magic link.
                    </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* Password Field */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            New Password
                        </label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                ref={inputRef}
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter a password (min 6 characters)"
                                className="w-full pl-10 pr-10 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                                minLength={6}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>

                        {/* Strength Indicator */}
                        {password && (
                            <div className="mt-2">
                                <div className="flex gap-1 mb-1">
                                    {[1, 2, 3, 4, 5].map((i) => (
                                        <div
                                            key={i}
                                            className={`h-1 flex-1 rounded-full transition-colors ${
                                                i <= strength.score
                                                    ? strength.color === 'red' ? 'bg-red-500'
                                                    : strength.color === 'orange' ? 'bg-orange-500'
                                                    : strength.color === 'yellow' ? 'bg-yellow-500'
                                                    : strength.color === 'green' ? 'bg-green-500'
                                                    : 'bg-emerald-500'
                                                    : 'bg-gray-200 dark:bg-gray-600'
                                            }`}
                                        />
                                    ))}
                                </div>
                                <p className={`text-xs ${
                                    strength.color === 'red' ? 'text-red-500'
                                    : strength.color === 'orange' ? 'text-orange-500'
                                    : strength.color === 'yellow' ? 'text-yellow-500'
                                    : strength.color === 'green' ? 'text-green-500'
                                    : 'text-emerald-500'
                                }`}>
                                    {strength.label}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Confirm Password Field */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Confirm Password
                        </label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type={showConfirm ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Confirm your password"
                                className={`w-full pl-10 pr-10 py-2.5 bg-gray-50 dark:bg-gray-700 border rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all ${
                                    confirmPassword && !passwordsMatch
                                        ? 'border-red-300 dark:border-red-500'
                                        : passwordsMatch
                                        ? 'border-green-300 dark:border-green-500'
                                        : 'border-gray-200 dark:border-gray-600'
                                }`}
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirm(!showConfirm)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                        {confirmPassword && !passwordsMatch && (
                            <p className="text-xs text-red-500 mt-1">Passwords don't match</p>
                        )}
                        {passwordsMatch && (
                            <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" /> Passwords match
                            </p>
                        )}
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleSkip}
                            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >
                            Skip for now
                        </button>
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <>
                                    <Lock className="w-4 h-4" />
                                    Create Password
                                </>
                            )}
                        </button>
                    </div>

                    <p className="text-xs text-center text-gray-400 dark:text-gray-500">
                        You can always set this up later in Settings
                    </p>
                </form>
            </div>
        </div>
    )
}

export default SetPasswordModal
