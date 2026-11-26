import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sawti.ai',
  appName: 'صوتي AI',
  webDir: 'www',
  server: {
    // The app loads its UI from the local bundle (https://localhost in the WebView).
    // The backend API is called with absolute URLs (see src/config.js).
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0b1020',
      showSpinner: true,
      spinnerColor: '#8b7cff',
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0b1020',
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;
