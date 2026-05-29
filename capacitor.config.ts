import type { CapacitorConfig } from '@capacitor/cli'

const useRemoteBundle = process.env.CAPACITOR_REMOTE_BUNDLE === 'true' || Boolean(process.env.CAPACITOR_SERVER_URL)
const liveUrl = process.env.CAPACITOR_SERVER_URL || 'https://datser.vercel.app'
const serverConfig = useRemoteBundle
  ? {
      url: liveUrl,
      cleartext: liveUrl.startsWith('http://')
    }
  : undefined

const config: CapacitorConfig = {
  appId: 'com.datser.app',
  appName: 'DatSer',
  webDir: 'dist',
  ...(serverConfig ? { server: serverConfig } : {}),
  android: {
    path: 'android'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#ffffff',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    }
  }
}

export default config
