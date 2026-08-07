// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QrScannerModal from './QrScannerModal'

const scannerMocks = vi.hoisted(() => ({
  decodeFromConstraints: vi.fn(),
  stop: vi.fn(),
  scanCallback: null
}))

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class BrowserQRCodeReader {
    decodeFromConstraints(...args) {
      return scannerMocks.decodeFromConstraints(...args)
    }
  }
}))

describe('QrScannerModal', () => {
  beforeEach(() => {
    scannerMocks.stop.mockReset()
    scannerMocks.decodeFromConstraints.mockReset()
    scannerMocks.scanCallback = null
    scannerMocks.decodeFromConstraints.mockImplementation(async (_constraints, _video, callback) => {
      scannerMocks.scanCallback = callback
      return { stop: scannerMocks.stop }
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps one camera session when the onScan callback identity changes', async () => {
    const { rerender } = render(<QrScannerModal isOpen onClose={() => {}} onScan={() => {}} />)

    await waitFor(() => expect(scannerMocks.decodeFromConstraints).toHaveBeenCalledTimes(1))
    rerender(<QrScannerModal isOpen onClose={() => {}} onScan={() => {}} />)

    await waitFor(() => expect(scannerMocks.decodeFromConstraints).toHaveBeenCalledTimes(1))
  })

  it('accepts a public-site pass and hands it to the current app origin', async () => {
    const onScan = vi.fn()
    render(<QrScannerModal isOpen onClose={() => {}} onScan={onScan} />)
    await waitFor(() => expect(scannerMocks.scanCallback).toBeTypeOf('function'))

    await act(async () => {
      scannerMocks.scanCallback({
        getText: () => 'https://datser.example/?member_checkin=1&qr_mark=42&code=J02'
      }, null, { stop: scannerMocks.stop })
      await new Promise((resolve) => window.setTimeout(resolve, 220))
    })

    const expected = new URL(window.location.href)
    expected.search = '?member_checkin=1&qr_mark=42&code=J02'
    expect(onScan).toHaveBeenCalledWith(expected.toString())
    expect(scannerMocks.stop).toHaveBeenCalled()
  })
})
