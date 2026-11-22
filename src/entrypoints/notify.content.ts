import { initLang, t } from '@/core/i18n';
import { notify, NOTIFY_PREVIEW } from '@/core/notify';

// The options page's "Preview" button (design §46): show a sample notice here.
// Separate from the features so it works whichever of them are on.
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    const lang = initLang();
    browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
      if ((msg as { type?: unknown } | null)?.type !== NOTIFY_PREVIEW) return;
      void lang.then(() => notify(t('notify.preview')));
      sendResponse(true);
    });
  },
});
