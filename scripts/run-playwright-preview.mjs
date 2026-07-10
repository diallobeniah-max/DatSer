import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

const previewPort = await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 4173
    server.close(error => error ? reject(error) : resolve(port))
  })
})

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['playwright', 'test', 'tests/smoke.spec.js'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      PLAYWRIGHT_USE_PREVIEW: '1',
      PLAYWRIGHT_PREVIEW_PORT: String(previewPort)
    }
  }
)

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
