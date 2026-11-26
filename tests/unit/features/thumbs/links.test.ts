// @vitest-environment happy-dom
// F-22-AC1: finding YouTube's own animation for a card. The link is only in the
// page's data, so the page-world script reads it and hands it over on the card.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askMoving } from '@/features/thumbs/ask';
import { startThumbsMain } from '@/features/thumbs/main-world';
import { lockup, lockupData, movingUrl, renderer, searchData } from './helpers';

type WithData = Element & { data?: unknown };
const A = 'aaaaaaaaaaa';
const B = 'bbbbbbbbbbb';
let stop: () => void;

beforeEach(() => {
  document.body.innerHTML = '';
  stop = startThumbsMain();
});
afterEach(() => stop());

const card = (id: string) => document.querySelector<WithData>(`[data-id="${id}"]`)!;

describe('the animation link of a card', () => {
  it('F-22-AC1 from the card\'s own data (search results)', () => {
    document.body.innerHTML = renderer('ytd-video-renderer', A);
    card(A).data = searchData(A);
    expect(askMoving(card(A), A)).toBe(movingUrl(A));
  });

  it('F-22-AC1 from data further up that holds many cards, each getting its own link', () => {
    document.body.innerHTML = `<yt-horizontal-list-renderer><div><div>${lockup(A)}${lockup(B)}</div></div></yt-horizontal-list-renderer>`;
    (document.querySelector('yt-horizontal-list-renderer') as WithData).data = { items: [lockupData(A, movingUrl(A)), lockupData(B, movingUrl(B))] };
    expect(askMoving(card(A), A)).toBe(movingUrl(A));
    expect(askMoving(card(B), B)).toBe(movingUrl(B));
  });

  it('F-22-AC1 none when the card\'s data has none, even if a list further up has other data', () => {
    document.body.innerHTML = `<ytd-rich-grid-renderer><ytd-rich-item-renderer>${lockup(A)}</ytd-rich-item-renderer></ytd-rich-grid-renderer>`;
    (document.querySelector('ytd-rich-item-renderer') as WithData).data = { content: lockupData(A) };
    expect(askMoving(card(A), A)).toBeUndefined();
  });

  it('F-22-AC1 sees entries added to the data later', () => {
    document.body.innerHTML = `<ytd-item-section-renderer>${lockup(A)}${lockup(B)}</ytd-item-section-renderer>`;
    const data = { contents: [lockupData(A, movingUrl(A))] };
    (document.querySelector('ytd-item-section-renderer') as WithData).data = data;
    expect(askMoving(card(A), A)).toBe(movingUrl(A));
    data.contents.push(lockupData(B, movingUrl(B)));
    expect(askMoving(card(B), B)).toBe(movingUrl(B));
  });

  it('F-22-AC1 only takes an i.ytimg.com animation of this video', () => {
    document.body.innerHTML = renderer('ytd-video-renderer', A);
    for (const url of [`https://evil.example/an_webp/${A}/x.webp`, movingUrl(B)]) {
      card(A).data = searchData(A, url);
      expect(askMoving(card(A), A)).toBeUndefined();
    }
  });

  it('F-22-AC6 leaves no attributes behind on the card', () => {
    document.body.innerHTML = renderer('ytd-video-renderer', A);
    card(A).data = searchData(A);
    const before = card(A).getAttributeNames();
    askMoving(card(A), A);
    expect(card(A).getAttributeNames()).toEqual(before);
  });
});
