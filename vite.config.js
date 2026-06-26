import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const createDatserApkDevPlugin = () => {
  const jobs = new Map()
  let activeJobId = null

  const repoRoot = process.cwd()
  const apkOutputPath = path.join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
  const preferredJavaHome = [
    process.env.JAVA_HOME_21,
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.11.10-hotspot',
    'C:\\Program Files\\Java\\jdk-21',
    '/usr/lib/jvm/java-21-openjdk'
  ].find(candidate => candidate && fs.existsSync(path.join(candidate, process.platform === 'win32' ? 'bin\\java.exe' : 'bin/java')))

  const getApkDefaults = () => {
    let versionName = '1.0.0'
    let versionCode = 1

    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
      if (packageJson?.version) versionName = String(packageJson.version)
    } catch {
      // Keep fallback.
    }

    try {
      const appVersionPath = path.join(repoRoot, 'public', 'app-version.json')
      const appVersion = JSON.parse(fs.readFileSync(appVersionPath, 'utf8'))
      const currentCode = Number(appVersion?.versionCode || appVersion?.version_code || 0)
      if (Number.isFinite(currentCode) && currentCode > 0) versionCode = currentCode + 1
      if (appVersion?.latestVersion && versionName === '1.0.0') versionName = String(appVersion.latestVersion)
    } catch {
      // Keep fallback.
    }

    return {
      versionName,
      versionCode,
      title: `DatSer ${versionName}`,
      description: 'Built from the current local development files.'
    }
  }

  const writeJson = (res, statusCode, payload) => {
    res.statusCode = statusCode
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(payload))
  }

  const parseBody = async (req) => new Promise((resolve) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        resolve({})
      }
    })
  })

  const createJob = ({ mode = 'local' } = {}) => {
    const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const job = {
      id: jobId,
      mode,
      status: 'running',
      progress: 4,
      apkPath: '',
      fileName: '',
      fileSize: 0,
      error: '',
      nextStep: '',
      logs: [
        `Starting DatSer ${mode === 'release' ? 'release' : 'local debug'} APK build...`
      ],
      defaults: getApkDefaults(),
      startedAt: new Date().toISOString(),
      finishedAt: null
    }

    const scriptName = mode === 'release' ? 'android:apk:release' : 'android:apk:local'
    const spawnCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm'
    const spawnArgs = process.platform === 'win32'
      ? ['/d', '/s', '/c', `npm run ${scriptName}`]
      : ['run', scriptName]

    let child
    try {
      child = spawn(spawnCommand, spawnArgs, {
        cwd: repoRoot,
        env: {
          ...process.env,
          ...(preferredJavaHome ? { JAVA_HOME: preferredJavaHome } : {}),
          ...(mode === 'local' ? { CAPACITOR_LOCAL_BUNDLE: 'true' } : {})
        },
        windowsHide: true
      })
    } catch (error) {
      job.status = 'failed'
      job.progress = 100
      job.error = error?.message || 'Could not start APK build.'
      job.nextStep = 'Confirm Node, npm, Capacitor, Android Studio, Java, and Gradle are installed, then retry from Admin Panel.'
      job.finishedAt = new Date().toISOString()
      jobs.set(jobId, job)
      activeJobId = null
      return job
    }

    const appendLog = (chunk) => {
      const text = String(chunk || '')
      if (!text.trim()) return
      const lines = text.replace(/\r/g, '').split('\n').filter(Boolean)
      job.logs.push(...lines.slice(-40))
      job.logs = job.logs.slice(-140)

      const joined = text.toLowerCase()
      if (joined.includes('vite') || joined.includes('building')) job.progress = Math.max(job.progress, 18)
      if (joined.includes('cap sync') || joined.includes('copying web assets') || joined.includes('sync')) job.progress = Math.max(job.progress, 42)
      if (joined.includes('gradle') || joined.includes('assemble')) job.progress = Math.max(job.progress, 66)
      if (joined.includes('build successful') || joined.includes('built in')) job.progress = Math.max(job.progress, 82)
    }

    child.stdout.on('data', appendLog)
    child.stderr.on('data', appendLog)
    child.on('error', (error) => {
      job.status = 'failed'
      job.progress = 100
      job.error = error?.message || 'Could not start APK build.'
      job.nextStep = 'Confirm Node, Capacitor, Android Studio, Java, and Gradle are installed, then retry from Admin Panel.'
      job.finishedAt = new Date().toISOString()
      activeJobId = null
    })
    child.on('close', (code) => {
      job.finishedAt = new Date().toISOString()
      job.progress = 100
      activeJobId = null

      if (code === 0 && fs.existsSync(apkOutputPath)) {
        const stat = fs.statSync(apkOutputPath)
        job.status = 'success'
        job.apkPath = apkOutputPath
        job.fileName = path.basename(apkOutputPath)
        job.fileSize = stat.size
        job.nextStep = 'Review the saved APK path, then upload it if you want users to download this build.'
        job.logs.push(`APK saved to ${apkOutputPath}`)
        return
      }

      job.status = 'failed'
      job.error = code === 0
        ? `Build finished, but the APK was not found at ${apkOutputPath}.`
        : `APK build failed with exit code ${code}.`
      job.nextStep = 'Open the build log above. If Java is missing, install JDK 21 or set JAVA_HOME_21. If signing fails, check android/keystore.properties.'
    })

    job.childPid = child.pid
    jobs.set(jobId, job)
    activeJobId = jobId
    return job
  }

  return {
    name: 'datser-apk-dev-tools',
    configureServer(server) {
      server.middlewares.use('/__datser-dev/apk-build', async (req, res, next) => {
        if (req.url && req.url !== '/') {
          next()
          return
        }

        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'Method not allowed' })
          return
        }

        if (activeJobId) {
          writeJson(res, 409, {
            error: 'An APK build is already running.',
            job: jobs.get(activeJobId)
          })
          return
        }

        const body = await parseBody(req)
        const mode = body?.mode === 'release' ? 'release' : 'local'
        writeJson(res, 202, { job: createJob({ mode }) })
      })

      server.middlewares.use('/__datser-dev/apk-build/status', (req, res) => {
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: 'Method not allowed' })
          return
        }

        const url = new URL(req.url || '', 'http://localhost')
        const jobId = url.searchParams.get('jobId') || activeJobId
        const job = jobId ? jobs.get(jobId) : null
        if (!job) {
          writeJson(res, 404, { error: 'APK build job was not found.' })
          return
        }

        writeJson(res, 200, { job })
      })

      server.middlewares.use('/__datser-dev/apk-build/file', (req, res) => {
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: 'Method not allowed' })
          return
        }

        const url = new URL(req.url || '', 'http://localhost')
        const jobId = url.searchParams.get('jobId')
        const job = jobId ? jobs.get(jobId) : null
        if (!job || job.status !== 'success' || !job.apkPath || !fs.existsSync(job.apkPath)) {
          writeJson(res, 404, { error: 'Built APK file is not available for this job.' })
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/vnd.android.package-archive')
        res.setHeader('Content-Disposition', `attachment; filename="${job.fileName || 'datser-local.apk'}"`)
        fs.createReadStream(job.apkPath).pipe(res)
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), createDatserApkDevPlugin()],
  base: '/',
  server: {
    port: 3000,
    host: true,
    watch: {
      ignored: ['**/android/**', '**/dist/**']
    }
  },
  test: {
    exclude: ['node_modules/**', 'tests/**', 'test-results/**']
  }
})
