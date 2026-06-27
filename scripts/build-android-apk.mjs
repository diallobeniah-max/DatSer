import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
const mode = process.argv[2] === 'release' ? 'release' : 'debug'
const useLocalBundle = process.argv.includes('--local')

const javaExecutable = isWindows ? 'bin\\java.exe' : 'bin/java'
const javaCandidates = [
  process.env.JAVA_HOME_21,
  'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.11.10-hotspot',
  'C:\\Program Files\\Java\\jdk-21',
  '/usr/lib/jvm/java-21-openjdk',
  process.env.JAVA_HOME
].filter(Boolean)

const preferredJavaHome = javaCandidates.find((candidate) => {
  try {
    return fs.existsSync(path.join(candidate, javaExecutable))
  } catch {
    return false
  }
})

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const spawnCommand = isWindows ? 'cmd.exe' : command
  const spawnArgs = isWindows ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args
  const child = spawn(spawnCommand, spawnArgs, {
    cwd: options.cwd || repoRoot,
    env: {
      ...process.env,
      ...(preferredJavaHome ? { JAVA_HOME: preferredJavaHome } : {}),
      ...(useLocalBundle ? { CAPACITOR_LOCAL_BUNDLE: 'true' } : {})
    },
    stdio: 'inherit',
    shell: false,
    windowsHide: true
  })

  child.on('error', reject)
  child.on('exit', (code) => {
    if (code === 0) {
      resolve()
      return
    }
    reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
  })
})

const npmCommand = isWindows ? 'npm.cmd' : 'npm'
const capCommand = isWindows ? 'npx.cmd' : 'npx'
const gradleCommand = isWindows ? 'gradlew.bat' : './gradlew'
const gradleTask = mode === 'release' ? 'assembleRelease' : 'assembleDebug'

if (preferredJavaHome) {
  console.log(`[DatSer APK] Using Java home: ${preferredJavaHome}`)
} else {
  console.warn('[DatSer APK] No JDK 21 path detected. If Gradle fails, install JDK 21 or set JAVA_HOME_21.')
}

await run(npmCommand, ['run', 'build'])
await run(capCommand, ['cap', 'sync', 'android'])
await run(gradleCommand, [gradleTask], { cwd: path.join(repoRoot, 'android') })
