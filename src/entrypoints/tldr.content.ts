import { createLogger } from '@/core/log';
import { startTldr } from '@/features/tldr/content';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    startTldr().catch((e) => createLogger('tldr').error('start failed', e));
  },
});
