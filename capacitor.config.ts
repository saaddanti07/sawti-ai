import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sawti.ai',
  appName: 'NABRA AI',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#080D1B',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#080D1B',
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;
