import { createLogger } from '@/core/log';
import { startThumbs } from '@/features/thumbs/content';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    startThumbs().catch((e) => createLogger('thumbs').error('start failed', e));
  },
});
