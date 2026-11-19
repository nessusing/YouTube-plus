import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'yt++',
    description: 'YouTube toolkit: TL;DR, a queue that persists, and player tweaks.',
    permissions: ['storage', 'unlimitedStorage', 'tabs'],
    host_permissions: ['https://www.youtube.com/*'],
  },
});
