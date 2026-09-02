// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CsvImportBatchWorkspace from './CsvImportBatchWorkspace'
import { CSV_BATCH_STATUS } from '../utils/csvImportBatch'

const handlers = {
  onBatchNameChange: vi.fn(), onBatchNameCommit: vi.fn(), onReview: vi.fn(),
  onRetry: vi.fn(), onRemove: vi.fn(), onAssignImage: vi.fn(),
}

describe('CsvImportBatchWorkspace', () => {
  it('shows the canonical Reviewed count', () => {
    render(<CsvImportBatchWorkspace {...handlers} batchName="QA batch" progress={{}} entries={[{
      id: '1', displayBasename: 'Sheet 1', originalCsvFilename: 'Sheet 1.csv',
      csvFiles: [{ name: 'Sheet 1.csv', persisted: true }], imageFiles: [], rows: [],
      status: CSV_BATCH_STATUS.REVIEWED,
    }]} />)
    const countLabel = screen.getAllByText('Reviewed').find((element) => element.className.includes('block'))
    expect(countLabel).toBeTruthy()
    expect(countLabel.previousSibling.textContent).toBe('1')
  })

  it('renders a large metadata batch without decoding all source images', () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({
      id: String(index), displayBasename: `Sheet ${index + 1}`,
      originalCsvFilename: `Sheet ${index + 1}.csv`,
      csvFiles: [{ name: `Sheet ${index + 1}.csv`, persisted: true }],
      imageFiles: [{ path: `workspace/session/${index + 1}.png`, persisted: true }],
      persistedImageCount: 1, rows: [], status: CSV_BATCH_STATUS.READY,
    }))
    const { container } = render(<CsvImportBatchWorkspace {...handlers} batchName="Large batch" progress={{}} entries={entries} />)
    expect(screen.getByText('Sheet 100')).toBeTruthy()
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })
})
