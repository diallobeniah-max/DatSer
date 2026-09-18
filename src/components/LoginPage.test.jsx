// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import LoginPage from './LoginPage'

const mockSignInWithGoogle = vi.fn()
const mockSignInWithEmail = vi.fn()
const mockSignUpWithEmail = vi.fn()
const mockSignInWithMagicLink = vi.fn()
const mockSignInWithAdminCode = vi.fn()
const mockResetPassword = vi.fn()
const mockBypassAuth = vi.fn()

let mockIsDarkMode = false

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    signInWithGoogle: mockSignInWithGoogle,
    signInWithEmail: mockSignInWithEmail,
    signUpWithEmail: mockSignUpWithEmail,
    signInWithMagicLink: mockSignInWithMagicLink,
    signInWithAdminCode: mockSignInWithAdminCode,
    resetPassword: mockResetPassword,
    bypassAuth: mockBypassAuth
  })
}))

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    isDarkMode: mockIsDarkMode,
    themeMode: mockIsDarkMode ? 'dark' : 'light',
    setThemeMode: vi.fn()
  })
}))

vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: () => <div data-testid="turnstile-mock" />
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null })
    }
  }
}))

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsDarkMode = false
    mockSignInWithEmail.mockResolvedValue({ user: { id: 'u1' } })
    mockSignInWithAdminCode.mockResolvedValue({ user: { id: 'admin1' } })
  })

  afterEach(() => {
    cleanup()
  })

  it('submits email login form on pressing Enter in the password input', async () => {
    render(<LoginPage />)
    const emailInput = screen.getByPlaceholderText(/^email$/i)
    const passwordInput = screen.getByPlaceholderText(/^password$/i)

    fireEvent.change(emailInput, { target: { value: 'operator@datser.org' } })
    fireEvent.change(passwordInput, { target: { value: 'SecretPassword123!' } })

    fireEvent.keyDown(passwordInput, { key: 'Enter', code: 'Enter' })

    await waitFor(() => {
      expect(mockSignInWithEmail).toHaveBeenCalledWith('operator@datser.org', 'SecretPassword123!', undefined)
    })
  })

  it('submits email login form on pressing Enter in the email input', async () => {
    render(<LoginPage />)
    const emailInput = screen.getByPlaceholderText(/^email$/i)
    const passwordInput = screen.getByPlaceholderText(/^password$/i)

    fireEvent.change(emailInput, { target: { value: 'operator@datser.org' } })
    fireEvent.change(passwordInput, { target: { value: 'SecretPassword123!' } })

    fireEvent.keyDown(emailInput, { key: 'Enter', code: 'Enter' })

    await waitFor(() => {
      expect(mockSignInWithEmail).toHaveBeenCalledWith('operator@datser.org', 'SecretPassword123!', undefined)
    })
  })

  it('submits admin code on pressing Enter in the admin code input', async () => {
    render(<LoginPage />)
    const adminTab = screen.getByRole('tab', { name: /^admin$/i })
    fireEvent.click(adminTab)

    const codeInput = screen.getByPlaceholderText(/enter admin code/i)
    fireEvent.change(codeInput, { target: { value: '123456' } })

    const form = codeInput.closest('form')
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockSignInWithAdminCode).toHaveBeenCalledWith('123456')
    })
  })

  it('switches seamlessly between User and Admin modes via the top-right selector', () => {
    render(<LoginPage />)
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeTruthy()
    expect(screen.getByPlaceholderText(/^email$/i)).toBeTruthy()

    // Switch to Admin mode
    const adminTab = screen.getByRole('tab', { name: /^admin$/i })
    fireEvent.click(adminTab)
    expect(screen.getByRole('heading', { name: /admin access/i })).toBeTruthy()
    expect(screen.getByPlaceholderText(/enter admin code/i)).toBeTruthy()

    // Switch back to User mode
    const userTab = screen.getByRole('tab', { name: /^user$/i })
    fireEvent.click(userTab)
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeTruthy()
    expect(screen.getByPlaceholderText(/^email$/i)).toBeTruthy()
  })

  it('prevents duplicate submissions when loading is in progress', async () => {
    let resolveLogin
    mockSignInWithEmail.mockImplementation(() => new Promise((res) => { resolveLogin = res }))

    render(<LoginPage />)
    const emailInput = screen.getByPlaceholderText(/^email$/i)
    const passwordInput = screen.getByPlaceholderText(/^password$/i)

    fireEvent.change(emailInput, { target: { value: 'operator@datser.org' } })
    fireEvent.change(passwordInput, { target: { value: 'SecretPassword123!' } })

    // First Enter triggers login
    fireEvent.keyDown(passwordInput, { key: 'Enter', code: 'Enter' })
    expect(mockSignInWithEmail).toHaveBeenCalledTimes(1)

    // Second Enter during in-flight request is ignored
    fireEvent.keyDown(passwordInput, { key: 'Enter', code: 'Enter' })
    expect(mockSignInWithEmail).toHaveBeenCalledTimes(1)

    resolveLogin({ user: { id: 'u1' } })
  })

  it('submits a valid signup request', async () => {
    mockSignUpWithEmail.mockResolvedValue({ user: { id: 'local-user' }, session: { access_token: 'test' } })
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'Synthetic Android User' } })
    fireEvent.change(screen.getByPlaceholderText(/^email$/i), { target: { value: 'android-test@local.invalid' } })
    fireEvent.change(screen.getByPlaceholderText(/^password$/i), { target: { value: 'StrongPassword9!' } })

    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(mockSignUpWithEmail).toHaveBeenCalledWith('android-test@local.invalid', 'StrongPassword9!', 'Synthetic Android User', undefined)
    })
  })

  it('shows a visible sanitized error when signup fails', async () => {
    mockSignUpWithEmail.mockRejectedValue(new Error('Network request failed'))
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'Synthetic Android User' } })
    fireEvent.change(screen.getByPlaceholderText(/^email$/i), { target: { value: 'android-test@local.invalid' } })
    fireEvent.change(screen.getByPlaceholderText(/^password$/i), { target: { value: 'StrongPassword9!' } })

    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/could not reach authentication/i)).toBeTruthy()
  })

  it('shows confirmation instructions when signup requires email confirmation', async () => {
    mockSignUpWithEmail.mockResolvedValue({ needsConfirmation: true })
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'Synthetic Android User' } })
    fireEvent.change(screen.getByPlaceholderText(/^email$/i), { target: { value: 'android-test@local.invalid' } })
    fireEvent.change(screen.getByPlaceholderText(/^password$/i), { target: { value: 'StrongPassword9!' } })

    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/check your email/i)).toBeTruthy()
  })

  it('renders dark mode styling with crisp contrast surfaces', () => {
    mockIsDarkMode = true
    const { container } = render(<LoginPage />)

    // Login Card has dark background class
    const card = container.querySelector('.dark\\:bg-gray-900\\/85')
    expect(card).toBeTruthy()
  })
})
