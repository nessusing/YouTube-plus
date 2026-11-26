import { startThumbsMain } from '@/features/thumbs/main-world';

// Page JS world: the only way to read the data YouTube keeps on its cards (F-22-AC1).
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    startThumbsMain();
  },
});
