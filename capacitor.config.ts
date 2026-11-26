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
      launchShowDuration: 1500,
      backgroundColor: '#0B1020',
      showSpinner: true,
      spinnerColor: '#8065F5',
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0B1020',
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;
