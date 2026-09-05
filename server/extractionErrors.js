export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

// JSON body budget: base64 inflates the image ~33% over raw bytes, plus JSON
// overhead. Read is bounded and stops accumulating the instant the limit is
// exceeded so an oversized upload cannot buffer unbounded memory.
export const MAX_BODY_BYTES = MAX_IMAGE_BYTES * 2

export class ExtractionError extends Error {
  constructor(code, message, options = {}, retryableFlag = undefined) {
    super(message)
    this.name = 'ExtractionError'
    this.code = code
    if (typeof options === 'number') {
      this.httpStatus = options
      this.retryable = typeof retryableFlag === 'boolean' ? retryableFlag : false
    } else {
      this.retryable = options?.retryable ?? (typeof retryableFlag === 'boolean' ? retryableFlag : false)
      this.httpStatus = options?.httpStatus ?? 502
    }
  }
}
