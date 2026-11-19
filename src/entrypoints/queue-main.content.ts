import { startMainWorld } from '@/features/queue/main-world';

// Runs in the page's JS world at document_start so the fetch tap is in place
// before YouTube's own scripts make requests (design §23).
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    startMainWorld();
  },
});
