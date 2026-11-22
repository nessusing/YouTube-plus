import { createLogger } from '@/core/log';
import { syncLangFromYouTube } from '@/core/youtube-lang';

// The extension's language follows YouTube's (plans P23). Separate from the
// features so it works whichever of them are on. YouTube reloads the page when
// its language changes, so reading once per page load is enough.
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    syncLangFromYouTube().catch((e) => createLogger('core').warn('language sync failed', e));
  },
});
