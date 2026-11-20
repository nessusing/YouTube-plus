import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'YouTube+',
    description: 'YouTube toolkit: TL;DR, a queue that persists, and player tweaks.',
    permissions: ['storage', 'unlimitedStorage', 'tabs', 'declarativeNetRequestWithHostAccess'],
    host_permissions: ['https://www.youtube.com/*', 'https://gemini.google.com/*'],
  },
});
