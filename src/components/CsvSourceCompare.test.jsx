import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CsvSourceCompare from './CsvSourceCompare'

const props = { sheets: ['Sheet 1', 'Sheet 2'], sheetImages: { 'Sheet 1': [{ previewUrl: 'one.png', path: 'one' }] }, activeSheet: 'Sheet 1', onSheetChange: vi.fn(), onClose: vi.fn() }
const setup = (overrides = {}, children = <div>CSV review ledger</div>) => render(<CsvSourceCompare {...props} {...overrides}>{children}</CsvSourceCompare>)
const pointerEvent = (type, { pointerId, clientX, clientY }) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  })
  return event
}
const wheelEvent = ({ deltaY = -100, clientX = 200, clientY = 200, deltaMode = 0, ctrlKey = false } = {}) => {
  const event = new Event('wheel', { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    deltaY: { value: deltaY },
    clientX: { value: clientX },
    clientY: { value: clientY },
    deltaMode: { value: deltaMode },
    ctrlKey: { value: ctrlKey },
  })
  return event
}
afterEach(cleanup)

describe('CsvSourceCompare', () => {
  it('renders image and review together on desktop structure', () => { setup(); expect(screen.getByAltText('Source for Sheet 1')).toBeTruthy(); expect(screen.getByText('CSV review ledger')).toBeTruthy() })
  it('shows a sheet-specific empty state', () => { setup({ activeSheet: 'Sheet 2' }); expect(screen.getByText('No source image for this sheet')).toBeTruthy() })
  it('switches sheet through the shared sheet control', () => { const onSheetChange = vi.fn(); setup({ onSheetChange }); fireEvent.click(screen.getByRole('button', { name: 'Sheet 2' })); expect(onSheetChange).toHaveBeenCalledWith('Sheet 2') })
  it('switches sheets when the user hovers the source header and scrolls normally', () => {
    const onSheetChange = vi.fn()
    setup({ onSheetChange })
    const event = wheelEvent({ deltaY: 72 })
    fireEvent(screen.getByText('Compare source').closest('header'), event)
    expect(event.defaultPrevented).toBe(true)
    expect(onSheetChange).toHaveBeenCalledWith('Sheet 2')
  })
  it('closes from the full-screen control', () => { const onClose = vi.fn(); setup({ onClose }); fireEvent.click(screen.getByRole('button', { name: 'Close source comparison' })); expect(onClose).toHaveBeenCalled() })
  it('clamps zoom between 50 and 400 percent', () => { setup(); for (let index = 0; index < 20; index += 1) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' })); expect(screen.getByText('400%')).toBeTruthy(); for (let index = 0; index < 20; index += 1) fireEvent.click(screen.getByRole('button', { name: 'Zoom out' })); expect(screen.getByText('50%')).toBeTruthy() })
  it('fit returns to 100 percent', () => { setup(); fireEvent.click(screen.getByRole('button', { name: 'Zoom in' })); fireEvent.click(screen.getByRole('button', { name: 'Fit image' })); expect(screen.getByText('100%')).toBeTruthy() })
  it('reset returns to 100 percent', () => { setup(); fireEvent.click(screen.getByRole('button', { name: 'Zoom in' })); fireEvent.click(screen.getByRole('button', { name: 'Reset image view' })); expect(screen.getByText('100%')).toBeTruthy() })
  it('moves between multiple images', () => { setup({ sheetImages: { 'Sheet 1': [{ previewUrl: 'one.png' }, { previewUrl: 'two.png' }] } }); fireEvent.click(screen.getByRole('button', { name: 'Next source image' })); expect(screen.getByText('2 / 2')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Previous source image' })); expect(screen.getByText('1 / 2')).toBeTruthy() })
  it('zooms around wheel gestures without replacing button controls', () => {
    const originalFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (callback) => { callback(); return 1 }
    try {
      setup()
      const viewport = screen.getByAltText('Source for Sheet 1').parentElement
      viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 })
      fireEvent.wheel(viewport, { deltaY: -100, clientX: 200, clientY: 200 })
      expect(screen.getByText('116%')).toBeTruthy()
    } finally {
      globalThis.requestAnimationFrame = originalFrame
    }
  })

  it('prevents default only for wheel events handled by the image viewport', () => {
    setup()
    const viewport = screen.getByAltText('Source for Sheet 1').parentElement
    const event = wheelEvent()
    fireEvent(viewport, event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves review and surrounding page wheel events alone after image zoom', () => {
    setup()
    const viewport = screen.getByAltText('Source for Sheet 1').parentElement
    const imageEvent = wheelEvent()
    fireEvent(viewport, imageEvent)
    expect(imageEvent.defaultPrevented).toBe(true)

    const reviewEvent = wheelEvent({ deltaY: 24 })
    fireEvent(screen.getByText('CSV review ledger'), reviewEvent)
    expect(reviewEvent.defaultPrevented).toBe(false)

    const pageEvent = wheelEvent({ deltaY: 24 })
    fireEvent(document.body, pageEvent)
    expect(pageEvent.defaultPrevented).toBe(false)
  })

  it('does not block wheel gestures over review heading, search, status, rows, or horizontal table chrome', () => {
    setup({}, <section><h2>Review Import Data</h2><input aria-label="Search rows"/><button type="button">Exact status</button><div>CSV review row</div><div data-review-horizontal-scroll>Horizontal table scroll</div></section>)
    for (const element of [
      screen.getByRole('heading', { name: 'Review Import Data' }),
      screen.getByLabelText('Search rows'),
      screen.getByRole('button', { name: 'Exact status' }),
      screen.getByText('CSV review row'),
      screen.getByText('Horizontal table scroll'),
    ]) {
      const event = wheelEvent({ deltaY: 36 })
      fireEvent(element, event)
      expect(event.defaultPrevented).toBe(false)
    }
  })

  it('returns to image-only wheel interception when the cursor moves back into the viewport', () => {
    setup()
    const viewport = screen.getByAltText('Source for Sheet 1').parentElement
    const outside = wheelEvent({ deltaY: 24 })
    fireEvent(screen.getByText('CSV review ledger'), outside)
    expect(outside.defaultPrevented).toBe(false)

    const insideAgain = wheelEvent()
    fireEvent(viewport, insideAgain)
    expect(insideAgain.defaultPrevented).toBe(true)
  })

  it('keeps outside wheel events scrollable even after a zoomed and panned image', () => {
    const originalFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (callback) => { callback(); return 1 }
    try {
      setup()
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      const viewport = screen.getByAltText('Source for Sheet 1').parentElement
      viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 })
      fireEvent(viewport, pointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }))
      fireEvent(viewport, pointerEvent('pointermove', { pointerId: 1, clientX: 140, clientY: 120 }))
      const outside = wheelEvent({ deltaY: 1 })
      fireEvent(screen.getByText('CSV review ledger'), outside)
      expect(outside.defaultPrevented).toBe(false)
    } finally {
      globalThis.requestAnimationFrame = originalFrame
    }
  })

  it('cleans up the viewport wheel listener when comparison closes', () => {
    const view = setup()
    const viewport = screen.getByAltText('Source for Sheet 1').parentElement
    view.unmount()
    const event = wheelEvent()
    fireEvent(viewport, event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('restores scoped image zoom after the comparison is reopened', () => {
    const first = setup()
    first.unmount()
    setup()
    const viewport = screen.getByAltText('Source for Sheet 1').parentElement
    const reviewEvent = wheelEvent({ deltaY: 28 })
    fireEvent(screen.getByText('CSV review ledger'), reviewEvent)
    expect(reviewEvent.defaultPrevented).toBe(false)
    const imageEvent = wheelEvent({ ctrlKey: true })
    fireEvent(viewport, imageEvent)
    expect(imageEvent.defaultPrevented).toBe(true)
  })

  it('supports a two-finger pinch inside the source viewer', () => {
    const originalFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (callback) => { callback(); return 1 }
    try {
      setup()
      const viewport = screen.getByAltText('Source for Sheet 1').parentElement
      viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 })
      fireEvent(viewport, pointerEvent('pointerdown', { pointerId: 1, clientX: 150, clientY: 200 }))
      fireEvent(viewport, pointerEvent('pointerdown', { pointerId: 2, clientX: 250, clientY: 200 }))
      fireEvent(viewport, pointerEvent('pointermove', { pointerId: 2, clientX: 350, clientY: 200 }))
      expect(Number(screen.getByText(/%$/).textContent.replace('%', ''))).toBeGreaterThan(190)
    } finally {
      globalThis.requestAnimationFrame = originalFrame
    }
  })

  it('uses a single pointer drag to pan the zoomed image', () => {
    const originalFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (callback) => { callback(); return 1 }
    try {
      setup()
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      const image = screen.getByAltText('Source for Sheet 1')
      const viewport = image.parentElement
      viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 })
      fireEvent(viewport, pointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }))
      fireEvent(viewport, pointerEvent('pointermove', { pointerId: 1, clientX: 140, clientY: 120 }))
      expect(image.style.transform).toContain('translate3d(40px, 20px, 0)')
    } finally {
      globalThis.requestAnimationFrame = originalFrame
    }
  })
})
