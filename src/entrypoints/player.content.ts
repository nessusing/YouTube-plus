import { createLogger } from '@/core/log';
import { startPlayer } from '@/features/player';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    startPlayer().catch((e) => createLogger('player').error('start failed', e));
  },
});
