// npm run e2e:cleanup — deletes every list named "YouTube+ e2e …" (the
// account fixture sweeps them before anything else) and nothing else.
import { test } from '../support/fixtures';

test('delete leftover test lists', async ({ account }) => {
  test.info().annotations.push({ type: 'account', description: account.me.name ?? '' });
});
