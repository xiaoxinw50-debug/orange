import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.orange.memories',
  appName: '橙心回忆',
  webDir: 'mobile-web',
  bundledWebRuntime: false,
  ios: {
    contentInset: 'automatic'
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
