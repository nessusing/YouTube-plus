import { startDanmakuMain } from '@/features/danmaku/main-world';

// Page JS world: InnerTube calls need ytcfg and the page's cookies (plans P13).
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    startDanmakuMain();
  },
});
