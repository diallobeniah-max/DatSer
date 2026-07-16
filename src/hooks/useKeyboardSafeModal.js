import { useEffect } from 'react'

const TEXT_ENTRY_SELECTOR = 'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]), textarea, [contenteditable="true"]'

export const dismissMobileKeyboard = () => {
  if (typeof document === 'undefined') return
  const activeElement = document.activeElement
  if (activeElement?.matches?.(TEXT_ENTRY_SELECTOR)) {
    activeElement.blur()
  }
}

export const dismissKeyboardForNonTextControl = (event) => {
  const target = event?.target
  if (!(target instanceof Element)) return
  if (target.closest(TEXT_ENTRY_SELECTOR)) return
  if (target.closest('button, [role="button"], label, select, summary, [data-dismiss-keyboard]')) {
    dismissMobileKeyboard()
  }
}

export const scrollControlIntoModalView = (scrollContainer, target) => {
  if (!scrollContainer || !target) return
  const containerRect = scrollContainer.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetCenter = targetRect.top - containerRect.top + scrollContainer.scrollTop + (targetRect.height / 2)
  const nextScrollTop = Math.max(0, targetCenter - (scrollContainer.clientHeight / 2))
  scrollContainer.scrollTo({ top: nextScrollTop, behavior: 'smooth' })
}

const keepFocusedControlVisible = (scrollContainer) => {
  if (!scrollContainer || typeof document === 'undefined') return
  const activeElement = document.activeElement
  if (!activeElement?.matches?.(TEXT_ENTRY_SELECTOR) || !scrollContainer.contains(activeElement)) return

  const containerRect = scrollContainer.getBoundingClientRect()
  const targetRect = activeElement.getBoundingClientRect()
  const topPadding = 20
  const bottomPadding = 28
  let delta = 0

  if (targetRect.top < containerRect.top + topPadding) {
    delta = targetRect.top - containerRect.top - topPadding
  } else if (targetRect.bottom > containerRect.bottom - bottomPadding) {
    delta = targetRect.bottom - containerRect.bottom + bottomPadding
  }

  if (Math.abs(delta) > 1) {
    scrollContainer.scrollTop += delta
  }
}

const useKeyboardSafeModal = ({ scrollContainerRef, active = true }) => {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return undefined

    let frameId = 0
    const scheduleVisibilityCheck = () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        frameId = 0
        keepFocusedControlVisible(scrollContainer)
      })
    }

    scrollContainer.addEventListener('focusin', scheduleVisibilityCheck)
    window.visualViewport?.addEventListener('resize', scheduleVisibilityCheck)
    window.visualViewport?.addEventListener('scroll', scheduleVisibilityCheck)

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      scrollContainer.removeEventListener('focusin', scheduleVisibilityCheck)
      window.visualViewport?.removeEventListener('resize', scheduleVisibilityCheck)
      window.visualViewport?.removeEventListener('scroll', scheduleVisibilityCheck)
    }
  }, [active, scrollContainerRef])
}

export default useKeyboardSafeModal
