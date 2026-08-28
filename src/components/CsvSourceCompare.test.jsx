import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CsvSourceCompare from './CsvSourceCompare'

const props = { sheets: ['Sheet 1', 'Sheet 2'], sheetImages: { 'Sheet 1': [{ previewUrl: 'one.png', path: 'one' }] }, activeSheet: 'Sheet 1', onSheetChange: vi.fn(), onClose: vi.fn() }
const setup = (overrides = {}) => render(<CsvSourceCompare {...props} {...overrides}><div>CSV review ledger</div></CsvSourceCompare>)
afterEach(cleanup)

describe('CsvSourceCompare', () => {
  it('renders image and review together on desktop structure', () => { setup(); expect(screen.getByAltText('Source for Sheet 1')).toBeTruthy(); expect(screen.getByText('CSV review ledger')).toBeTruthy() })
  it('shows a sheet-specific empty state', () => { setup({ activeSheet: 'Sheet 2' }); expect(screen.getByText('No source image for this sheet')).toBeTruthy() })
  it('switches sheet through the shared sheet control', () => { const onSheetChange = vi.fn(); setup({ onSheetChange }); fireEvent.click(screen.getByRole('button', { name: 'Sheet 2' })); expect(onSheetChange).toHaveBeenCalledWith('Sheet 2') })
  it('closes from the full-screen control', () => { const onClose = vi.fn(); setup({ onClose }); fireEvent.click(screen.getByRole('button', { name: 'Close source comparison' })); expect(onClose).toHaveBeenCalled() })
  it('clamps zoom between 50 and 400 percent', () => { setup(); for (let index = 0; index < 20; index += 1) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' })); expect(screen.getByText('400%')).toBeTruthy(); for (let index = 0; index < 20; index += 1) fireEvent.click(screen.getByRole('button', { name: 'Zoom out' })); expect(screen.getByText('50%')).toBeTruthy() })
  it('fit returns to 100 percent', () => { setup(); fireEvent.click(screen.getByRole('button', { name: 'Zoom in' })); fireEvent.click(screen.getByRole('button', { name: 'Fit image' })); expect(screen.getByText('100%')).toBeTruthy() })
  it('reset returns to 100 percent', () => { setup(); fireEvent.click(screen.getByRole('button', { name: 'Zoom in' })); fireEvent.click(screen.getByRole('button', { name: 'Reset image view' })); expect(screen.getByText('100%')).toBeTruthy() })
  it('moves between multiple images', () => { setup({ sheetImages: { 'Sheet 1': [{ previewUrl: 'one.png' }, { previewUrl: 'two.png' }] } }); fireEvent.click(screen.getByRole('button', { name: 'Next source image' })); expect(screen.getByText('2 / 2')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Previous source image' })); expect(screen.getByText('1 / 2')).toBeTruthy() })
})
