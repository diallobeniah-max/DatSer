// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import HelpCenterPage from './HelpCenterPage'

afterEach(() => {
  cleanup()
  delete window.openOnboarding
})

describe('manual tutorial access', () => {
  it('keeps Replay Tutorial as an explicit Help Center action', () => {
    window.openOnboarding = vi.fn()

    render(<HelpCenterPage onBack={vi.fn()} onNavigate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Replay Tutorial/i }))

    expect(window.openOnboarding).toHaveBeenCalledOnce()
  })

  it('does not retain an automatic tutorial prompt in the application shell', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

    expect(appSource).toContain('window.openOnboarding = () => setShowOnboarding(true)')
    expect(appSource).not.toContain('TutorialPromptBar')
    expect(appSource).not.toContain('tutorialNotifications')
    expect(appSource).not.toContain('tutorialPrompt_dismissed')
  })
})
