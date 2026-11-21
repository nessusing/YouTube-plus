import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'YouTube+',
    description: 'YouTube toolkit: TL;DR, a queue that persists, and player tweaks.',
    // cookies: read SAPISID to sign processSession requests (design §10.5).
    permissions: ['storage', 'unlimitedStorage', 'tabs', 'declarativeNetRequestWithHostAccess', 'cookies'],
    host_permissions: ['https://www.youtube.com/*', 'https://gemini.google.com/*', 'https://geminiweb-pa.clients6.google.com/*'],
    // Declared so the toolbar icon is ours on every site; without it Chrome grays
    // the icon on sites we don't run on (design §2).
    action: {
      default_title: 'YouTube+',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    },
  },
});
