import { createLogger } from '@/core/log';
import { startDanmaku } from '@/features/danmaku';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    startDanmaku().catch((e) => createLogger('danmaku').error('start failed', e));
  },
});
