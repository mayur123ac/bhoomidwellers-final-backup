import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bhoomidwellers.crm',
  appName: 'Bhoomi Dwellers',
  webDir: 'dist-capacitor',

  server: {
    // The canonical URL after Vercel's 308 redirect (bhoomidwellers.com → www).
    // Must match the final host so Capacitor keeps navigation in the WebView.
    url: 'https://www.bhoomidwellers.com',
    // Keep both the bare and www domain in-app in case of cross-links.
    allowNavigation: ['bhoomidwellers.com', 'www.bhoomidwellers.com'],
    androidScheme: 'https',
  },

  android: {
    allowMixedContent: false,
  },
};

export default config;
