import { vi } from 'vitest'
import http from 'node:http'
import https from 'node:https'

// 1. Force env vars to fake mock values
process.env.VITE_SUPABASE_URL = 'https://mock-test-project.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'mock-test-anon-key'

// 2. Network safety check function
const checkUrlSafety = (target) => {
  if (!target) return
  const str = String(target).toLowerCase()
  if (str.includes('btonpncrhbyhriavelyi') || str.includes('supabase.co')) {
    throw new Error(
      `[TEST SAFETY VIOLATION] Unmocked network attempt to live Supabase project detected: ${target}. ` +
      `All tests must use mocked Supabase clients.`
    )
  }
}

// 3. Guard fetch
const nativeFetch = globalThis.fetch
if (typeof nativeFetch === 'function') {
  globalThis.fetch = function (input, init) {
    const urlStr = typeof input === 'string' ? input : input?.url || String(input)
    checkUrlSafety(urlStr)
    return nativeFetch.apply(this, arguments)
  }
}

// 4. Guard http.request and https.request
const nativeHttpRequest = http.request
http.request = function (options, callback) {
  const host = typeof options === 'string' ? options : options?.host || options?.hostname || ''
  checkUrlSafety(host)
  return nativeHttpRequest.apply(this, arguments)
}

const nativeHttpsRequest = https.request
https.request = function (options, callback) {
  const host = typeof options === 'string' ? options : options?.host || options?.hostname || ''
  checkUrlSafety(host)
  return nativeHttpsRequest.apply(this, arguments)
}

const nativeHttpGet = http.get
http.get = function (options, callback) {
  const host = typeof options === 'string' ? options : options?.host || options?.hostname || ''
  checkUrlSafety(host)
  return nativeHttpGet.apply(this, arguments)
}

const nativeHttpsGet = https.get
https.get = function (options, callback) {
  const host = typeof options === 'string' ? options : options?.host || options?.hostname || ''
  checkUrlSafety(host)
  return nativeHttpsGet.apply(this, arguments)
}

if (typeof globalThis.XMLHttpRequest !== 'undefined') {
  const NativeXMLHttpRequest = globalThis.XMLHttpRequest
  globalThis.XMLHttpRequest = class GuardedXMLHttpRequest extends NativeXMLHttpRequest {
    open(method, url, ...rest) {
      checkUrlSafety(url)
      return super.open(method, url, ...rest)
    }
  }
}

// 5. Guard WebSocket
class MockWebSocket {
  constructor(url) {
    checkUrlSafety(url)
    this.url = url
    this.readyState = 3 // CLOSED
  }
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

globalThis.WebSocket = MockWebSocket
