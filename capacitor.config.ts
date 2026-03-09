import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.orange.memories',
  appName: '橙心回忆',
  webDir: 'mobile-web',
  bundledWebRuntime: false,
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_orange',
      iconColor: '#FF8FA3'
    },
    BackgroundRunner: {
      label: 'com.orange.memories.notifications',
      src: 'runners/background-notifications.js',
      event: 'orangeNotificationCheck',
      repeat: true,
      interval: 15,
      autoStart: true
    }
  },
  ios: {
    contentInset: 'automatic'
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
