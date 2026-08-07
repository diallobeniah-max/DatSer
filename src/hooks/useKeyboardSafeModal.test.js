// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  dismissKeyboardForNonTextControl,
  dismissMobileKeyboard,
  scrollControlIntoModalView,
} from './useKeyboardSafeModal'

describe('keyboard-safe modal helpers', () => {
  it('dismisses text focus before a non-text control continues', () => {
    const input = document.createElement('input')
    const button = document.createElement('button')
    document.body.append(input, button)
    input.focus()

    dismissKeyboardForNonTextControl({ target: button })

    expect(document.activeElement).not.toBe(input)
    input.remove()
    button.remove()
  })

  it('keeps focus when the pointer remains inside a text field', () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()

    dismissKeyboardForNonTextControl({ target: input })

    expect(document.activeElement).toBe(input)
    dismissMobileKeyboard()
    input.remove()
  })

  it('centers invalid controls by scrolling only the modal body', () => {
    const scrollTo = vi.fn()
    const scrollContainer = {
      scrollTop: 100,
      clientHeight: 400,
      getBoundingClientRect: () => ({ top: 100 }),
      scrollTo,
    }
    const target = {
      getBoundingClientRect: () => ({ top: 500, height: 40 }),
    }

    scrollControlIntoModalView(scrollContainer, target)

    expect(scrollTo).toHaveBeenCalledWith({ top: 320, behavior: 'smooth' })
  })
})
