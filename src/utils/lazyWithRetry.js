import { lazy } from 'react'

const transientImportErrorText = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'Loading chunk',
  'ChunkLoadError'
]

const isTransientImportError = (error) => {
  const message = String(error?.message || error || '')
  return transientImportErrorText.some((text) => message.includes(text))
}

const delay = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms)
})

const lazyWithRetry = (importer, retries = 1) => lazy(async () => {
  let lastError

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await importer()
    } catch (error) {
      lastError = error
      if (!isTransientImportError(error) || attempt === retries) break
      await delay(250)
    }
  }

  throw lastError
})

export default lazyWithRetry
