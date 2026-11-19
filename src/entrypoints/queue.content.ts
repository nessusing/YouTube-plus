import { createLogger } from '@/core/log';
import { startQueue } from '@/features/queue';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    startQueue().catch((e) => createLogger('queue').error('start failed', e));
  },
});
