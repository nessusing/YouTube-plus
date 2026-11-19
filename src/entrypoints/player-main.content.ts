import { startPlayerMain } from '@/features/player/player-main';

// Page JS world: the only way to reach the player API (setInternalSize).
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    startPlayerMain();
  },
});
