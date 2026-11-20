// The suite can drive the extension: it is loaded, signed in, and follows
// settings written to its storage.
import { expect, test } from '../support/fixtures';
import { VIDEOS } from '../support/env';
import { playButton, rpc } from '../support/yt';

test('extension loaded, signed in, playlist mode shows the button', async ({ open, lists, setProfile }) => {
  const id = await lists.create([VIDEOS.a, VIDEOS.b], 'smoke');
  const page = await open('/');
  expect((await rpc<{ loggedIn: boolean }>(page, 'identity')).loggedIn).toBe(true);
  await setProfile({ mode: 'playlist', listId: id, listName: 'Smoke', removeWatched: true });
  await expect.poll(() => playButton(page).count()).toBe(2);
});
