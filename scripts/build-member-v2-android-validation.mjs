import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
const javaExecutable = isWindows ? 'bin\\java.exe' : 'bin/java'
const javaCandidates = [
  process.env.JAVA_HOME_21,
  'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.11.10-hotspot',
  'C:\\Program Files\\Android\\Android Studio\\jbr',
  process.env.JAVA_HOME,
].filter(Boolean)
const javaHome = javaCandidates.find((candidate) => fs.existsSync(path.join(candidate, javaExecutable)))
const androidSdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
].filter(Boolean)
const androidSdkHome = androidSdkCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'platform-tools')))

const run = (command, args, cwd = repoRoot) => new Promise((resolve, reject) => {
  const child = spawn(isWindows ? 'cmd.exe' : command, isWindows ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args, {
    cwd,
    shell: false,
    windowsHide: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DATSER_MEMBER_V2_ANDROID_TEST_BUILD: 'true',
      ...(javaHome ? { JAVA_HOME: javaHome } : {}),
      ...(androidSdkHome ? { ANDROID_HOME: androidSdkHome, ANDROID_SDK_ROOT: androidSdkHome } : {}),
      // A validation APK always uses bundled assets, never a remote server.
      CAPACITOR_REMOTE_BUNDLE: 'false',
      CAPACITOR_SERVER_URL: '',
    },
  })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)))
})

const npm = isWindows ? 'npm.cmd' : 'npm'
const npx = isWindows ? 'npx.cmd' : 'npx'
const gradle = isWindows ? 'gradlew.bat' : './gradlew'

await run(npm, ['run', 'build:member-v2:android-test'])
await run(npx, ['cap', 'sync', 'android'])
await run(gradle, [':app:assembleMemberV2Validation'], path.join(repoRoot, 'android'))
