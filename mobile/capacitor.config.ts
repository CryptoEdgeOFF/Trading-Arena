import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.btfarena.app',
  appName: 'BTF Arena',
  webDir: 'dist',
  backgroundColor: '#050507',
  ios: {
    contentInset: 'never',
  },
  android: {
    backgroundColor: '#050507',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: '#050507',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#050507',
    },
    Keyboard: {
      resize: 'none',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
