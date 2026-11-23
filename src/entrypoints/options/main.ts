import { getLang, initLang, t, type MsgKey } from '@/core/i18n';
import { formatEntry, LOG_KEY, LOG_LEVELS, type LogEntry, type LogFeature } from '@/core/log';
import type { Message, SelfCheckResponse } from '@/core/messages';
import type { CheckResult } from '@/core/selfcheck';
import { FLOAT_POS_KEY, MINI_POS_KEY, PIP_SIZE_KEY } from '@/features/player/consts';
import { checkShortcut, DEFAULT_PIP_SHORTCUT, formatShortcut, fromEvent, isModifierOnly } from '@/features/player/shortcut';
import { recentYouTubeTab } from '@/core/page-checks';
import { DEFAULT_PROFILE, type QueueMode, type QueueProfile } from '@/features/queue/core';
import { PROFILE_PREFIX, PROTOCOL_ERROR_KEY } from '@/features/queue/keys';
import type { QueueOp, QueueRequest, QueueResponse } from '@/features/queue/messages';
import { getProfile, updateProfile, type Identity } from '@/features/queue/profiles';
import type { PlaylistRef } from '@/features/queue/rpc';
import type { TldrStatus } from '@/features/tldr/service';
import { clearCategory, formatBytes, getStorageUsage, type StorageCategory } from '@/core/storage-usage';
import { DEFAULT_SETTINGS, FEATURES, featureOn, getSettings, saveSettings, type NotifySettings, type PlayerSettings, type Settings, DANMAKU_STYLES, type DanmakuStyle } from '@/core/settings';
import { NOTIFY_PREVIEW, NOTIFY_X_KEY } from '@/core/notify';
import { missingPlaceholders } from '@/features/danmaku/ai';
import { CardView } from '@/features/danmaku/card-view';
import { demoTimeline } from '@/features/danmaku/demo';
import { flyItems } from '@/features/danmaku/fly';
import { FlyView } from '@/features/danmaku/fly-view';
import { slotAt } from '@/features/danmaku/frame';
import { DEFAULT_PARAMS, DEFAULT_PROMPT, promptOf, type DanmakuParams } from '@/features/danmaku/params';

// Build the page in YouTube's language (F-04-AC4); rebuild (reload) when it changes.
await initLang(() => location.reload());
document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
document.title = t('opt.title');

const PLAYER_KEYS: (keyof PlayerSettings)[] = ['miniControls', 'freeDrag', 'stickyPlayer', 'backToTop', 'loopButton', 'miniMinimize'];

const send = <T>(m: Message) => browser.runtime.sendMessage(m) as Promise<T>;

// ---------- building blocks (YouTube settings look) ----------

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/** Page head: tab name, big title, subtitle, divider. */
function pageHead(section: HTMLElement, tab: string, title: string, sub: string | HTMLElement): void {
  section.append(
    el('p', { className: 'eyebrow', textContent: tab }),
    el('h2', { className: 'title', textContent: title }),
    typeof sub === 'string' ? el('p', { className: 'sub', textContent: sub }) : sub,
  );
}

/** A titled group, separated from the previous one by a divider. */
function group(section: HTMLElement, title: string, desc?: string, ...children: Child[]): HTMLElement {
  const g = el('div', { className: 'group' }, el('h3', { textContent: title, className: desc ? '' : 'solo' }));
  if (desc) g.append(el('p', { className: 'desc', textContent: desc }));
  g.append(...children);
  section.append(el('hr'), g);
  return g;
}

/** Label column + content column. */
function row(label: string, ...body: Child[]): HTMLElement {
  return el('div', { className: 'row' }, el('div', { className: 'row-label', textContent: label }), el('div', { className: 'row-body' }, ...body));
}

const inline = (...children: Child[]) => el('div', { className: 'inline' }, ...children);
const hint = (text: string) => el('p', { className: 'hint', textContent: text });

function toggle(label: string, checked: boolean, onChange: (v: boolean) => void, desc?: string): HTMLElement {
  const input = el('input', { type: 'checkbox', className: 'switch', checked });
  input.setAttribute('role', 'switch');
  input.addEventListener('change', () => onChange(input.checked));
  const text = el('span', { className: 'text' }, label);
  if (desc) text.append(el('small', { textContent: desc }));
  return el('label', { className: 'switch-row' }, input, text);
}

function button(text: string, onClick: () => unknown, cls = 'btn'): HTMLButtonElement {
  const b = el('button', { type: 'button', className: cls, textContent: text });
  b.addEventListener('click', () => void onClick());
  return b;
}

/** Show `done` on the button for a moment. */
function flash(b: HTMLButtonElement, done: string): void {
  const was = b.textContent;
  b.textContent = done;
  setTimeout(() => (b.textContent = was), 1500);
}

// ---------- tabs ----------

const tabs = [
  { id: 'general', label: t('opt.tab.general') },
  { id: 'tldr', label: t('feature.tldr') },
  { id: 'queue', label: t('feature.queue') },
  { id: 'player', label: t('feature.player') },
  { id: 'danmaku', label: t('feature.danmaku') },
  { id: 'notify', label: t('opt.tab.notify') },
  { id: 'storage', label: t('opt.tab.storage') },
  { id: 'diag', label: t('opt.tab.diag') },
] as const;
type TabId = (typeof tabs)[number]['id'];

document.getElementById('nav-title')!.textContent = t('opt.settings');
const nav = document.getElementById('tabs')!;
const panels = document.getElementById('panels')!;
const sections = new Map<TabId, HTMLElement>();
const buttons = new Map<TabId, HTMLButtonElement>();

function selectTab(id: TabId) {
  for (const [k, s] of sections) s.hidden = k !== id;
  for (const [k, b] of buttons) b.setAttribute('aria-selected', String(k === id));
  void renderTldr();
  if (id === 'storage') void renderStorage();
  if (id === 'danmaku') syncDanmakuOff();
  window.scrollTo(0, 0);
}

for (const tab of tabs) {
  const b = el('button', { type: 'button', textContent: tab.label });
  b.setAttribute('role', 'tab');
  b.addEventListener('click', () => selectTab(tab.id));
  buttons.set(tab.id, b);
  nav.append(b);
  const s = el('section');
  s.setAttribute('role', 'tabpanel');
  sections.set(tab.id, s);
  panels.append(s);
}
const isTab = (x: string | null): x is TabId => !!x && sections.has(x as TabId);

// ---------- settings ----------

let settings: Settings = await getSettings();
const update = async (mut: (s: Settings) => void) => {
  mut(settings);
  await saveSettings(settings);
};

// ---------- general ----------

const general = sections.get('general')!;
pageHead(general, t('opt.tab.general'), t('opt.general.title'), t('opt.general.sub'));

// Master switch: off turns every feature off without losing their own switches.
group(general, t('opt.enabled'), t('opt.enabledHint'), toggle(t('opt.enabledLabel'), settings.enabled,
  (v) => update((s) => { s.enabled = v; }).then(() => { syncFeatureList(); return renderTldr(); })));

const featureList = el('div', { className: 'stack' });
for (const f of FEATURES) {
  featureList.append(toggle(t(`feature.${f}` as MsgKey), settings.features[f],
    (v) => update((s) => { s.features[f] = v; }).then(() => renderTldr()),
    t(`opt.featureDesc.${f}` as MsgKey)));
}
group(general, t('opt.features'), t('opt.featuresHint'), featureList);
function syncFeatureList() {
  featureList.classList.toggle('off', !settings.enabled);
  for (const i of featureList.querySelectorAll('input')) i.disabled = !settings.enabled;
}
syncFeatureList();

// ---------- TL;DR (F-03-AC13) ----------

const tldrTab = sections.get('tldr')!;
pageHead(tldrTab, t('feature.tldr'), t('opt.tldr.title'), t('opt.tldr.sub'));

function numberInput(get: () => number, set: (s: Settings, v: number) => void, min = 0, max = Infinity): HTMLInputElement {
  const input = el('input', { type: 'number', min: String(min), step: '1', value: String(get()), className: 'field num' });
  if (max !== Infinity) input.max = String(max);
  input.addEventListener('change', () => {
    const v = Math.floor(Number(input.value));
    if (!(v >= min && v <= max)) { input.value = String(get()); return; }
    void update((s) => set(s, v));
  });
  return input;
}

// Gemini connection: the one thing a new user has to do (F-03-AC12).
const connState = el('span', { className: 'state', textContent: t('opt.tldr.connUnknown') });
const signinBtn = button(t('opt.tldr.signin'), () => send({ type: 'YouTube+/tldr-signin' }), 'btn filled');
const recheckBtn = button(t('opt.tldr.recheck'), async () => {
  recheckBtn.disabled = true;
  try { await send({ type: 'YouTube+/tldr-recheck' }); } finally { recheckBtn.disabled = false; }
  await renderTldr();
});
const signinHint = hint(t('opt.tldr.signinHint'));
group(tldrTab, t('opt.tldr.gemini'), t('opt.tldr.geminiDesc'),
  row(t('opt.tldr.conn'), inline(connState), inline(signinBtn, recheckBtn), signinHint),
  row(t('opt.tldr.accountRow'), inline(numberInput(() => settings.tldr.account, (s, v) => { s.tldr.account = v; })), hint(t('opt.tldr.accountN'))),
);

const pre = el('div', { className: 'links' });
for (const [text, href] of [
  [t('opt.tldr.pre1'), 'https://gemini.google.com/'],
  [t('opt.tldr.pre2'), 'https://myactivity.google.com/product/gemini'],
  [t('opt.tldr.pre3'), 'https://gemini.google.com/apps'],
] as const) pre.append(el('a', { href, target: '_blank', rel: 'noopener', textContent: text }));
group(tldrTab, t('opt.tldr.prereq'), t('opt.tldr.prereqHint'), pre);

// These need Gemini; dimmed while signed out (F-05).
const tldrNeedsGemini: HTMLElement[] = [];
tldrNeedsGemini.push(group(tldrTab, t('opt.tldr.output'), undefined,
  toggle(t('opt.tldr.titleCheck'), settings.tldr.titleCheck, (v) => update((s) => { s.tldr.titleCheck = v; }))));

tldrNeedsGemini.push(group(tldrTab, t('opt.tldr.limits'), t('opt.tldr.limitsHint'),
  el('div', { className: 'row' }, el('div', {}), el('div', { className: 'row-body' },
    toggle(t('opt.tldr.prefetch'), settings.tldr.prefetch, (v) => update((s) => { s.tldr.prefetch = v; })))),
  row(t('opt.tldr.perHour'), inline(numberInput(() => settings.tldr.perHour, (s, v) => { s.tldr.perHour = v; }, 1))),
  row(t('opt.tldr.perDay'), inline(numberInput(() => settings.tldr.perDay, (s, v) => { s.tldr.perDay = v; }, 1))),
  row(t('opt.tldr.batchSize'), inline(numberInput(() => settings.tldr.batchSize, (s, v) => { s.tldr.batchSize = v; }, 1, 10)), hint(t('opt.tldr.batchHint'))),
));

const tldrStatus = el('p', { className: 'sub' });
const resumeBtn = button(t('opt.resume'), async () => {
  await send({ type: 'YouTube+/tldr-resume' });
  void renderTldr();
});
group(tldrTab, t('opt.tldr.status'), undefined, tldrStatus, el('div', { className: 'inline mt' }, resumeBtn));

// ---------- sign-in status, above every tab (F-01, F-05) ----------

const YT_SIGNIN = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F';
const openYouTube = () => browser.tabs.create({ url: 'https://www.youtube.com/' });

const banner = document.getElementById('banner')!;
banner.className = 'status';
const ytState = el('span', { className: 'state' });
const ytActions = el('span', { className: 'inline' });
const gmState = el('span', { className: 'state' });
const gmActions = el('span', { className: 'inline' },
  button(t('opt.tldr.signin'), () => send({ type: 'YouTube+/tldr-signin' }), 'btn filled'));
const gmRow = el('div', { className: 'status-row' }, el('span', { className: 'status-label', textContent: 'Gemini' }), gmState, gmActions);
banner.append(el('div', { className: 'status-row' }, el('span', { className: 'status-label', textContent: 'YouTube' }), ytState, ytActions), gmRow);
banner.hidden = false;

function setState(span: HTMLElement, kind: 'ok' | 'bad' | '', text: string) {
  span.className = `state${kind ? ` ${kind}` : ''}`;
  span.textContent = text;
}

async function renderTldr() {
  if (!featureOn(settings, 'tldr')) {
    gmRow.hidden = true;
    for (const g of tldrNeedsGemini) g.classList.remove('dim');
    return;
  }
  try {
    const st = await send<TldrStatus>({ type: 'YouTube+/tldr-status' });
    const out = st.gemini === 'signedOut';
    const kind = st.gemini === 'ok' ? 'ok' : out ? 'bad' : '';
    const text = st.gemini === 'ok' ? t('opt.tldr.connOk', { n: st.account })
      : out ? t('opt.tldr.connOut', { n: st.account }) : t('opt.tldr.connUnknown');
    setState(connState, kind, text);
    setState(gmState, kind, text);
    gmRow.hidden = false;
    gmActions.hidden = signinBtn.hidden = signinHint.hidden = !out;
    for (const g of tldrNeedsGemini) {
      g.classList.toggle('dim', out);
      g.title = out ? t('opt.needGemini') : '';
    }

    const b = st.breaker;
    const breaker = b.state === 'quota' ? t('opt.tldr.brQuota')
      : b.state === 'blocked' && (b.until ?? 0) > Date.now() ? t('opt.tldr.brBlocked', { n: Math.ceil(((b.until ?? 0) - Date.now()) / 60000) })
      : t('opt.tldr.brOk');
    tldrStatus.textContent = t('opt.tldr.statusLine', {
      h: st.counters.hour.length, hMax: settings.tldr.perHour, d: st.counters.dayCount, dMax: settings.tldr.perDay,
      q: st.queued, r: st.running ? t('opt.tldr.runningN', { n: st.running }) : '', b: breaker,
    });
    resumeBtn.disabled = b.state === 'closed' || (b.state === 'blocked' && (b.until ?? 0) <= Date.now());
  } catch (e) {
    tldrStatus.textContent = t('opt.tldr.statusFail', { e: String(e) });
  }
}
// Cheap (no network): keeps the Gemini status current, e.g. after signing in elsewhere.
setInterval(() => void renderTldr(), 3000);

// ---------- queue (F-05) ----------
// Queue settings belong to a YouTube identity (channel); this page edits the
// one signed in on the YouTube tab used last, and works through that tab.

const queue = sections.get('queue')!;
pageHead(queue, t('feature.queue'), t('opt.queue.title'), t('opt.queue.sub'));

type Who =
  | { kind: 'noTab' }
  | { kind: 'noScript'; tab: Browser.tabs.Tab }
  | { kind: 'ok'; tab: Browser.tabs.Tab; me: Identity };
let who: Who = { kind: 'noTab' };
let profile: QueueProfile = { ...DEFAULT_PROFILE };
let lists: PlaylistRef[] | undefined;
let listsFor: string | undefined;

async function ask<T>(tab: Browser.tabs.Tab, m: QueueOp): Promise<T> {
  const r = (await browser.tabs.sendMessage(tab.id!, { type: 'YouTube+/queue', ...m } satisfies QueueRequest, { frameId: 0 })) as QueueResponse<T> | undefined;
  if (!r) throw new Error(t('opt.queue.noScript'));
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

const whoLine = el('div', { className: 'inline who' });
group(queue, t('opt.queue.who'), t('opt.queue.whoHint'), whoLine);

// Mode: two options with their explanations.
const modeInputs = new Map<QueueMode, HTMLInputElement>();
const modeBox = el('div', { className: 'radios rich', role: 'radiogroup' });
function modeOption(mode: QueueMode, title: string, desc: string, ...extra: Child[]): HTMLElement {
  const input = el('input', { type: 'radio', name: 'queue-mode', value: mode });
  input.addEventListener('change', () => input.checked && void saveProfile((p) => { p.mode = mode; }));
  modeInputs.set(mode, input);
  const label = el('label', {}, input, el('span', { className: 'text' }, el('strong', { textContent: title }), el('small', { textContent: desc })));
  return el('div', { className: 'option' }, label, ...extra);
}

const listSel = el('select', { className: 'list-select' });
listSel.setAttribute('aria-label', t('opt.queue.list'));
const NEW = '__new__';
const newName = el('input', { type: 'text', value: 'YouTube +', className: 'field text' });
newName.setAttribute('aria-label', t('opt.queue.newName'));
const createBtn = button(t('opt.queue.create'), createList, 'btn filled');
const newRow = el('div', { className: 'inline' }, newName, createBtn);
newRow.hidden = true;
newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });
const listMsg = el('p', { className: 'hint' });
const pickHint = hint(t('opt.queue.pickHint'));
const removeToggle = toggle(t('opt.queue.removeWatched'), true, (v) => void saveProfile((p) => { p.removeWatched = v; }));
const removeInput = removeToggle.querySelector('input')!;
const protoLine = el('p', { className: 'hint warn' });
const playlistBlock = el('div', { className: 'option-body' },
  el('div', { className: 'inline' }, el('span', { className: 'muted', textContent: t('opt.queue.list') }), listSel), newRow, pickHint, listMsg, removeToggle, protoLine);
const playlistNeeds = el('p', { className: 'hint' });

modeBox.append(
  modeOption('native', t('opt.queue.native'), t('opt.queue.nativeDesc')),
  modeOption('playlist', t('opt.queue.playlist'), t('opt.queue.playlistDesc'), playlistNeeds, playlistBlock),
);
const modeGroup = group(queue, t('opt.queue.mode'), undefined, modeBox);

listSel.addEventListener('change', () => {
  if (listSel.value === NEW) {
    newRow.hidden = false;
    newName.focus();
    newName.select();
    return;
  }
  newRow.hidden = true;
  const l = lists?.find((x) => x.id === listSel.value);
  if (l) void saveProfile((p) => { p.listId = l.id; p.listName = l.title; });
});

async function saveProfile(mut: (p: QueueProfile) => void) {
  if (who.kind !== 'ok' || !who.me.key) return;
  profile = await updateProfile(who.me.key, mut);
  renderQueueControls();
}

async function createList() {
  if (who.kind !== 'ok') return;
  const title = newName.value.trim() || 'YouTube +';
  createBtn.disabled = true;
  listMsg.textContent = t('opt.queue.creating');
  try {
    const id = await ask<string>(who.tab, { op: 'create', title });
    // Leave "New…", or the select keeps showing it over the new list.
    listSel.value = '';
    newRow.hidden = true;
    await saveProfile((p) => { p.listId = id; p.listName = title; });
    listMsg.textContent = t('opt.queue.created', { name: title });
    // A new list shows in the editable lists only a second or two later (findings F16).
    for (const ms of [0, 1500, 3000]) {
      await new Promise((r) => setTimeout(r, ms));
      await loadLists(true);
      if (lists?.some((l) => l.id === id)) break;
    }
  } catch (e) {
    listMsg.textContent = t('opt.queue.createFail', { e: e instanceof Error ? e.message : String(e) });
  } finally {
    createBtn.disabled = false;
  }
}

/** The lists this identity can edit, incl. Watch Later (F-05). */
async function loadLists(force = false) {
  if (who.kind !== 'ok' || !who.me.key) return;
  if (!force && lists && listsFor === who.me.key) return;
  try {
    lists = await ask<PlaylistRef[]>(who.tab, { op: 'lists' });
    listsFor = who.me.key;
  } catch (e) {
    lists = undefined;
    listMsg.textContent = t('opt.queue.listsFail', { e: e instanceof Error ? e.message : String(e) });
  }
  renderQueueControls();
}

function renderListSelect() {
  const keepNew = listSel.value === NEW;
  listSel.replaceChildren();
  const chosen = profile.listId;
  if (!chosen) listSel.append(el('option', { value: '', textContent: t('opt.queue.pick'), disabled: true }));
  for (const l of lists ?? []) {
    const name = l.id === 'WL' ? `${l.title || t('queue.watchLater')}` : l.title;
    listSel.append(el('option', { value: l.id, textContent: l.privacy ? `${name} · ${privacyLabel(l.privacy)}` : name }));
  }
  if (chosen && !lists?.some((l) => l.id === chosen)) {
    // Not in this identity's editable lists (or the lists are still loading).
    listSel.append(el('option', { value: chosen, textContent: lists ? t('opt.queue.unavailable', { name: profile.listName ?? chosen }) : profile.listName ?? chosen }));
  }
  listSel.append(el('option', { value: NEW, textContent: t('opt.queue.new') }));
  listSel.value = keepNew ? NEW : chosen ?? '';
}

function privacyLabel(p: string): string {
  return p === 'PRIVATE' ? t('opt.queue.private') : p === 'UNLISTED' ? t('opt.queue.unlisted') : p === 'PUBLIC' ? t('opt.queue.public') : p;
}

function renderQueueControls() {
  const signedIn = who.kind === 'ok' && who.me.loggedIn && !!who.me.key;
  modeGroup.classList.toggle('dim', !signedIn);
  for (const [m, input] of modeInputs) {
    input.checked = profile.mode === m;
    input.disabled = !signedIn;
  }
  playlistNeeds.textContent = who.kind === 'ok' && !who.me.loggedIn ? t('opt.queue.needYouTube') : '';
  playlistNeeds.hidden = !playlistNeeds.textContent;
  const on = signedIn && profile.mode === 'playlist';
  playlistBlock.classList.toggle('dim', !on);
  listSel.disabled = !on;
  removeInput.disabled = !on;
  removeInput.checked = profile.removeWatched;
  renderListSelect();
  pickHint.hidden = !on || !!profile.listId;
}

function renderWho() {
  whoLine.replaceChildren();
  ytActions.replaceChildren();
  if (who.kind === 'noTab') {
    whoLine.append(el('span', { className: 'muted', textContent: t('opt.queue.openYt') }), button(t('opt.queue.openYtBtn'), openYouTube));
    setState(ytState, '', t('opt.yt.noTab'));
    ytActions.append(button(t('opt.queue.openYtBtn'), openYouTube));
    return;
  }
  if (who.kind === 'noScript') {
    whoLine.append(el('span', { className: 'muted', textContent: t('opt.queue.noScript') }));
    setState(ytState, '', t('opt.yt.unknown'));
    return;
  }
  const me = who.me;
  if (!me.loggedIn) {
    whoLine.append(el('span', { className: 'muted', textContent: t('opt.queue.signedOut') }));
    setState(ytState, 'bad', t('opt.yt.signedOut'));
    ytActions.append(button(t('opt.yt.signin'), () => browser.tabs.create({ url: YT_SIGNIN }), 'btn filled'));
    return;
  }
  const name = me.name ?? t('opt.queue.unnamed');
  whoLine.append(el('span', { className: 'muted', textContent: t('opt.queue.editing') }));
  if (me.avatar) whoLine.append(el('img', { src: me.avatar, alt: '', width: 24, height: 24, className: 'avatar', referrerPolicy: 'no-referrer' }));
  whoLine.append(el('strong', { textContent: name }));
  setState(ytState, 'ok', t('opt.yt.signedIn', { name }));
}

async function renderProtocolError() {
  const err = (await browser.storage.local.get(PROTOCOL_ERROR_KEY))[PROTOCOL_ERROR_KEY] as { time: number; detail: string } | undefined;
  protoLine.replaceChildren();
  protoLine.hidden = !err;
  if (err) {
    protoLine.append(t('opt.queue.protocol', { t: new Date(err.time).toLocaleString(), e: err.detail }), ' ');
    const dismiss = el('a', { href: '#', textContent: t('opt.queue.dismiss') });
    dismiss.addEventListener('click', (e) => {
      e.preventDefault();
      void browser.storage.local.remove(PROTOCOL_ERROR_KEY);
    });
    protoLine.append(dismiss);
  }
}

/** Find the identity again and redraw the tab and the YouTube status (cheap: one message). */
let queueBusy: Promise<void> | undefined;
function renderQueue(): Promise<void> {
  queueBusy ??= (async () => {
    try {
      const tab = await recentYouTubeTab();
      if (!tab?.id) who = { kind: 'noTab' };
      else {
        try {
          who = { kind: 'ok', tab, me: await ask<Identity>(tab, { op: 'whoami' }) };
        } catch {
          who = { kind: 'noScript', tab };
        }
      }
      const key = who.kind === 'ok' ? who.me.key : undefined;
      if (key !== listsFor) lists = undefined;
      profile = key ? await getProfile(key) : { ...DEFAULT_PROFILE };
      renderWho();
      renderQueueControls();
      await renderProtocolError();
      if (profile.mode === 'playlist') await loadLists();
    } finally {
      queueBusy = undefined;
    }
  })();
  return queueBusy;
}

// Follow the YouTube tab: coming back to this page, or a YouTube tab loading.
let ytTimer: ReturnType<typeof setTimeout> | undefined;
const queueSoon = () => {
  if (ytTimer) clearTimeout(ytTimer);
  ytTimer = setTimeout(() => void renderQueue(), 400);
};
window.addEventListener('focus', queueSoon);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && queueSoon());
browser.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === 'complete' && /^https:\/\/www\.youtube\.com\//.test(tab.url ?? '')) queueSoon();
});
browser.tabs.onRemoved.addListener(queueSoon);
browser.storage.onChanged.addListener((changes, area) => {
  const key = who.kind === 'ok' ? who.me.key : undefined;
  if (area === 'sync' && key && `${PROFILE_PREFIX}${key}` in changes) {
    void getProfile(key).then((p) => { profile = p; renderQueueControls(); if (p.mode === 'playlist') void loadLists(); });
  }
  if (area === 'local' && PROTOCOL_ERROR_KEY in changes) void renderProtocolError();
});

// ---------- player ----------

const player = sections.get('player')!;
pageHead(player, t('feature.player'), t('opt.player.title'), t('opt.player.subtitle'));
const playerList = el('div', { className: 'stack' });
for (const k of PLAYER_KEYS) {
  playerList.append(toggle(t(`opt.player.${k}`), settings.player[k], (v) => update((s) => { s.player[k] = v; })));
}
playerList.append(pipOption());

/** Pop-out (F-11): the switch, and under it the shortcut recorder. */
function pipOption(): HTMLElement {
  const supported = 'documentPictureInPicture' in window;
  const sw = toggle(t('opt.player.pip'), settings.player.pip, (v) => {
    void update((s) => { s.player.pip = v; });
    render();
  }, supported ? undefined : t('opt.player.pipUnsupported'));
  const swInput = sw.querySelector('input')!;
  swInput.disabled = !supported;

  const keyBtn = el('button', { type: 'button', className: 'btn key' });
  keyBtn.setAttribute('aria-label', t('opt.player.pipKey'));
  const reset = button(t('opt.player.pipKeyDefault', { x: DEFAULT_PIP_SHORTCUT }), () => save(DEFAULT_PIP_SHORTCUT));
  const clear = button(t('opt.player.pipKeyClear'), () => save(''));
  const msg = el('p', { className: 'hint fail-line' });
  let recording = false;

  const render = () => {
    const off = !supported || !settings.player.pip;
    for (const b of [keyBtn, reset, clear]) b.disabled = off;
    if (off) recording = false;
    keyBtn.classList.toggle('recording', recording);
    keyBtn.textContent = recording ? t('opt.player.pipKeyPress') : settings.shortcuts.pip || t('opt.player.pipKeyNone');
  };
  const stop = () => {
    recording = false;
    render();
  };
  const save = async (v: string) => {
    msg.textContent = '';
    recording = false;
    await update((s) => { s.shortcuts.pip = v; });
    render();
  };
  keyBtn.addEventListener('click', () => {
    msg.textContent = '';
    recording = true;
    render();
  });
  keyBtn.addEventListener('blur', stop);
  keyBtn.addEventListener('keydown', (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return stop();
    if (isModifierOnly(e)) return;
    const k = fromEvent(e);
    const err = checkShortcut(k);
    if (err === 'needModifier') msg.textContent = t('opt.player.pipKeyNeedMod');
    else if (err === 'youtube') msg.textContent = t('opt.player.pipKeyTaken', { x: formatShortcut(k) });
    else void save(formatShortcut(k));
  });
  render();

  const body = el('div', { className: 'switch-body' },
    inline(el('span', { className: 'muted', textContent: t('opt.player.pipKey') }), keyBtn, reset, clear),
    hint(t('opt.player.pipKeyRecordHint')), msg);
  const box = el('div', { className: supported ? 'option' : 'option dim' }, sw, body);
  return box;
}
const resetPos = button(t('opt.player.resetPos'), async () => {
  await browser.storage.local.remove([MINI_POS_KEY, FLOAT_POS_KEY, PIP_SIZE_KEY]);
  flash(resetPos, t('opt.player.resetDone'));
});
group(player, t('opt.player.sub'), undefined, playerList, el('div', { className: 'inline mt-lg' }, resetPos));

// ---------- comment danmaku (F-12) ----------

const dmTab = sections.get('danmaku')!;
pageHead(dmTab, t('feature.danmaku'), t('opt.dm.title'), t('opt.dm.sub'));
const dmOff = el('p', { className: 'hint warn', textContent: t('opt.dm.off') });
dmTab.append(dmOff);
function syncDanmakuOff() {
  dmOff.hidden = featureOn(settings, 'danmaku');
}

/** Radio buttons; `rich` options carry a description. */
function radios<T extends string>(name: string, options: [T, string, string?][], get: () => T, set: (v: T) => void): HTMLElement {
  const rich = options.some((o) => o[2]);
  const box = el('div', { className: rich ? 'radios rich' : 'radios', role: 'radiogroup' });
  for (const [v, title, desc] of options) {
    const input = el('input', { type: 'radio', name, value: v, checked: get() === v });
    input.addEventListener('change', () => input.checked && set(v));
    const text = desc
      ? el('span', { className: 'text' }, el('strong', { textContent: title }), el('small', { textContent: desc }))
      : el('span', { className: 'text', textContent: title });
    box.append(el('label', {}, input, text));
  }
  return box;
}

group(dmTab, t('opt.dm.style'), t('opt.dm.styleHint'),
  radios('dm-style', DANMAKU_STYLES.map((v) => [v, t(`opt.dm.style.${v}`), t(`opt.dm.style.${v}Desc`)] as [DanmakuStyle, string, string]),
    () => settings.danmaku.style, (v) => void update((s) => { s.danmaku.style = v; })));

group(dmTab, t('opt.dm.placement'), t('opt.dm.placementHint'),
  radios('dm-placement', [['local', t('opt.dm.local'), t('opt.dm.localDesc')], ['ai', t('opt.dm.ai'), t('opt.dm.aiDesc')]],
    () => settings.danmaku.placement, (v) => void update((s) => { s.danmaku.placement = v; })),
  el('div', { className: 'mt' }, row(t('opt.dm.fallback'),
    radios('dm-fallback', [['local', t('opt.dm.fallbackLocal')], ['stamps', t('opt.dm.fallbackStamps')]],
      () => settings.danmaku.params.ai.fallback, (v) => void update((s) => { s.danmaku.params.ai.fallback = v; })))),
);

group(dmTab, t('opt.dm.debug'), undefined,
  toggle(t('opt.dm.debugLabel'), settings.danmaku.debug, (v) => update((s) => { s.danmaku.debug = v; })));

// The prompt: saved as '' while it equals the default (settings are one 8 KB sync item).
const promptBox = el('textarea', { className: 'prompt', spellcheck: false, rows: 20, value: promptOf(settings.danmaku.params.ai) });
promptBox.setAttribute('aria-label', t('opt.dm.prompt'));
const promptState = el('p', { className: 'hint' });
function renderPromptState() {
  const missing = missingPlaceholders(promptBox.value);
  promptState.className = missing.length ? 'hint warn' : 'hint';
  promptState.textContent = missing.length ? t('opt.dm.promptMissing', { x: missing.join('、') })
    : promptBox.value === DEFAULT_PROMPT ? t('opt.dm.promptIsDefault') : t('opt.dm.promptEdited');
}
let promptTimer: ReturnType<typeof setTimeout> | undefined;
promptBox.addEventListener('input', () => {
  renderPromptState();
  clearTimeout(promptTimer);
  promptTimer = setTimeout(() => {
    const v = promptBox.value;
    void update((s) => { s.danmaku.params.ai.prompt = v === DEFAULT_PROMPT ? '' : v; });
  }, 600);
});
renderPromptState();
group(dmTab, t('opt.dm.prompt'), t('opt.dm.promptHint'), promptBox, promptState,
  el('div', { className: 'inline mt' }, button(t('opt.dm.defaults'), async () => {
    clearTimeout(promptTimer);
    promptBox.value = DEFAULT_PROMPT;
    renderPromptState();
    await update((s) => { s.danmaku.params.ai.prompt = ''; });
  })));

// Tunable numbers, by group; each group can go back to its defaults.
type NumKey<G extends keyof DanmakuParams> = { [K in keyof DanmakuParams[G]]: DanmakuParams[G][K] extends number ? K : never }[keyof DanmakuParams[G]] & string;
type Field = { [G in keyof DanmakuParams]: { g: G; k: NumKey<G>; min: number; max: number; step: number; unit?: MsgKey } }[keyof DanmakuParams];
const f = <G extends keyof DanmakuParams>(g: G, k: NumKey<G>, min: number, max: number, step: number, unit?: MsgKey): Field => ({ g, k, min, max, step, unit }) as Field;
const SEC = 'opt.dm.u.sec', TIMES = 'opt.dm.u.times', RATIO = 'opt.dm.u.ratio', ITEMS = 'opt.dm.u.items', CHARS = 'opt.dm.u.chars';
const DM_GROUPS: { g: keyof DanmakuParams; hint?: MsgKey; fields: Field[] }[] = [
  { g: 'display', fields: [
    f('display', 'screenSec', 1, 30, 0.5, SEC), f('display', 'latinCharSec', 0.01, 1, 0.001, SEC), f('display', 'cjkCharSec', 0.01, 2, 0.01, SEC),
    f('display', 'minSec', 0.5, 10, 0.5, SEC), f('display', 'gapSec', 0, 5, 0.5, SEC), f('display', 'fadeMs', 0, 2000, 50, 'opt.dm.u.ms'),
    f('display', 'fontScale', 0.5, 3, 0.1, TIMES), f('display', 'bgOpacity', 0, 1, 0.05, RATIO), f('display', 'refLineWidth', 10, 200, 1, CHARS),
    f('display', 'cjkWidth', 1, 3, 0.1, TIMES), f('display', 'resumeMinSec', 0, 10, 0.5, SEC),
    f('display', 'flyMinSec', 1, 30, 0.5, SEC), f('display', 'flyMaxSec', 1, 30, 0.5, SEC), f('display', 'flyMaxLines', 1, 20, 1, 'opt.dm.u.lines'),
    f('display', 'flyArea', 0.1, 1, 0.05, RATIO),
  ] },
  { g: 'comments', fields: [
    f('comments', 'firstBatch', 10, 600, 10, ITEMS), f('comments', 'minCount', 10, 600, 10, ITEMS), f('comments', 'perMinute', 1, 100, 1, ITEMS),
    f('comments', 'maxCount', 10, 2000, 10, ITEMS), f('comments', 'minLength', 0, 100, 1, CHARS), f('comments', 'cjkWeight', 1, 5, 0.5, TIMES),
  ] },
  { g: 'stamps', fields: [
    f('stamps', 'maxDelaySec', 0, 60, 0.5, SEC), f('stamps', 'clusterSec', 0, 10, 0.5, SEC), f('stamps', 'rotateMax', 1, 10, 1, ITEMS),
    f('stamps', 'tocMinStamps', 2, 20, 1), f('stamps', 'tocTitleMax', 10, 200, 1, CHARS),
  ] },
  { g: 'heat', hint: 'opt.dm.g.heatHint', fields: [
    f('heat', 'likeWeight', -5, 5, 0.1), f('heat', 'replyWeight', -5, 5, 0.1), f('heat', 'recencyWeight', -5, 5, 0.1),
  ] },
  { g: 'local', hint: 'opt.dm.g.localHint', fields: [
    f('local', 'perMinuteMin', 0.5, 20, 0.5, 'opt.dm.u.perMin'), f('local', 'perMinuteMax', 1, 30, 0.5, 'opt.dm.u.perMin'), f('local', 'windowSec', 5, 300, 5, SEC),
    f('local', 'replayWeight', 0, 10, 0.1), f('local', 'leadInSec', 0, 60, 1, SEC), f('local', 'spoilerTail', 0, 1, 0.05, RATIO),
  ] },
  { g: 'ai', hint: 'opt.dm.g.aiHint', fields: [
    f('ai', 'batchSize', 10, 300, 10, ITEMS), f('ai', 'commentMaxChars', 50, 2000, 50), f('ai', 'highConf', 0, 1, 0.05, RATIO),
    f('ai', 'relevanceWeight', 0, 10, 0.1), f('ai', 'heatWeight', 0, 10, 0.1), f('ai', 'idleSec', 5, 120, 1, SEC),
  ] },
  { g: 'cache', fields: [f('cache', 'days', 1, 60, 1, 'opt.dm.u.days'), f('cache', 'mb', 0.5, 50, 0.5, 'opt.dm.u.mb')] },
];

const paramOf = (s: Settings, g: keyof DanmakuParams) => s.danmaku.params[g] as unknown as Record<string, unknown>;

/** A number field bound to one param; out-of-range input snaps back. */
function paramInput(fd: Field): { input: HTMLInputElement; refresh: () => void } {
  const get = () => String(paramOf(settings, fd.g)[fd.k]);
  const input = el('input', { type: 'number', min: String(fd.min), max: String(fd.max), step: String(fd.step), value: get(), className: 'field num' });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (input.value === '' || !(v >= fd.min && v <= fd.max)) { input.value = get(); return; }
    void update((s) => { paramOf(s, fd.g)[fd.k] = v; });
  });
  return { input, refresh: () => { input.value = get(); } };
}

const splitWords = (v: string) => v.split(/[,，、]/).map((w) => w.trim()).filter(Boolean);

// Preview (F-12): the real card on a mock player, looping sample comments
// with the current display params (read every frame, so edits show at once).
const PV_SIZES = { small: 426, medium: 640, large: 854 } as const;
/** YouTube's control bar, about this tall. */
const PV_CONTROLS_PX = 48;
const pv = { size: 'medium' as keyof typeof PV_SIZES, controls: false, captions: false, debug: settings.danmaku.debug, playing: true, clock: 0, last: performance.now() };
const pvView = new CardView();
const pvFly = new FlyView();
const pvPanelNote = hint(t('opt.dm.pv.panel'));
const pvCaption = el('div', { className: 'dm-caption', textContent: t('opt.dm.pv.caption') });
const pvCtrl = el('div', { className: 'dm-ctrl' }, el('div', { className: 'dm-bar' }));
const pvBox = el('div', { className: 'dm-preview' }, pvCtrl, pvCaption, pvView.host, pvFly.host);
const pvStatus = el('span', { className: 'muted' });
const pvSize = el('select');
for (const k of Object.keys(PV_SIZES) as (keyof typeof PV_SIZES)[]) pvSize.append(el('option', { value: k, textContent: t(`opt.dm.pv.${k}`), selected: k === pv.size }));
pvSize.setAttribute('aria-label', t('opt.dm.pv.size'));
pvSize.addEventListener('change', () => { pv.size = pvSize.value as keyof typeof PV_SIZES; pvLayout(); });
const pvPlay = button(t('opt.dm.pv.pause'), () => {
  pv.playing = !pv.playing;
  pvPlay.textContent = pv.playing ? t('opt.dm.pv.pause') : t('opt.dm.pv.play');
});
function pvLayout() {
  pvBox.style.width = `${PV_SIZES[pv.size]}px`;
  pvCtrl.hidden = !pv.controls;
  pvCaption.hidden = !pv.captions;
}
pvLayout();
group(dmTab, t('opt.dm.preview'), t('opt.dm.previewHint'),
  el('div', { className: 'inline' }, el('span', { className: 'muted', textContent: t('opt.dm.pv.size') }), pvSize, pvPlay, button(t('opt.dm.pv.restart'), () => { pv.clock = 0; }), pvStatus),
  el('div', { className: 'inline mt' },
    toggle(t('opt.dm.pv.controls'), pv.controls, (v) => { pv.controls = v; pvLayout(); }),
    toggle(t('opt.dm.pv.captions'), pv.captions, (v) => { pv.captions = v; pvLayout(); }),
    toggle(t('opt.dm.pv.debug'), pv.debug, (v) => { pv.debug = v; })),
  pvBox, pvPanelNote);

/** flyItems of the demo, kept while the params are the same object (FlyView plans lanes per array). */
let pvFlying: { p: DanmakuParams['display']; items: ReturnType<typeof flyItems> } | undefined;
function pvFlyItems(slots: Parameters<typeof flyItems>[0], p: DanmakuParams['display']) {
  if (pvFlying?.p !== p) pvFlying = { p, items: flyItems(slots, p) };
  return pvFlying.items;
}

function pvFrame(now: number) {
  requestAnimationFrame(pvFrame);
  const dt = (now - pv.last) / 1000;
  pv.last = now;
  if (dmTab.hidden) return;
  const { slots, length: cardLength } = demoTimeline(settings.danmaku.params);
  // Flying comments take longer than their cards: let the last one get across.
  const fp = settings.danmaku.params.display;
  const length = settings.danmaku.style === 'fly' ? Math.max(cardLength, (slots.at(-1)?.start ?? 0) + 2 * Math.max(fp.flyMinSec, fp.flyMaxSec)) : cardLength;
  if (pv.playing) pv.clock = (pv.clock + dt) % length;
  const width = pvBox.clientWidth;
  const height = pvBox.clientHeight;
  // Captions sit at the bottom, above the controls when they show; the card is at the top (F-12-AC12).
  pvCaption.style.fontSize = `${Math.round(height * 0.034)}px`;
  pvCaption.style.bottom = `${pv.controls ? PV_CONTROLS_PX + 8 : Math.max(12, height * 0.04)}px`;
  const top = Math.max(12, height * 0.04);
  const style = settings.danmaku.style;
  pvPanelNote.hidden = style !== 'panel';
  const p = settings.danmaku.params.display;
  if (style === 'fly') {
    pvView.draw(undefined, 0, { p, width, height, top });
    pvFly.draw(pvFlyItems(slots, p), pv.clock, { p, width, height, top, debug: pv.debug });
    pvStatus.textContent = t('opt.dm.pv.flyStatus', { t: pv.clock.toFixed(1) });
    return;
  }
  pvFly.clear();
  const s = slotAt(slots, pv.clock);
  pvView.draw(s, s ? pv.clock - s.start : 0, { p, width, height, top, debug: pv.debug });
  pvStatus.textContent = t('opt.dm.pv.status', { i: s ? slots.indexOf(s) + 1 : '–', n: slots.length, t: pv.clock.toFixed(1) });
}
requestAnimationFrame(pvFrame);

group(dmTab, t('opt.dm.params'), t('opt.dm.paramsHint'));
for (const dg of DM_GROUPS) {
  const refreshers: (() => void)[] = [];
  const g = group(dmTab, t(`opt.dm.g.${dg.g}` as MsgKey), dg.hint ? t(dg.hint) : undefined);
  for (const fd of dg.fields) {
    const { input, refresh } = paramInput(fd);
    refreshers.push(refresh);
    g.append(row(t(`opt.dm.${fd.g}.${fd.k}` as MsgKey), inline(input, fd.unit ? el('span', { className: 'muted', textContent: t(fd.unit) }) : '')));
  }
  if (dg.g === 'local') {
    const words = el('input', { type: 'text', className: 'field text wide', value: settings.danmaku.params.local.spoilerWords.join(', ') });
    words.addEventListener('change', () => void update((s) => { s.danmaku.params.local.spoilerWords = splitWords(words.value); }));
    refreshers.push(() => { words.value = settings.danmaku.params.local.spoilerWords.join(', '); });
    g.append(row(t('opt.dm.local.spoilerWords'), words));
  }
  if (dg.g === 'ai') {
    const amb = toggle(t('opt.dm.ai.ambient'), settings.danmaku.params.ai.ambient, (v) => update((s) => { s.danmaku.params.ai.ambient = v; }));
    refreshers.push(() => { amb.querySelector('input')!.checked = settings.danmaku.params.ai.ambient; });
    g.append(row('', amb));
  }
  g.append(el('div', { className: 'inline mt' }, button(t('opt.dm.defaults'), async () => {
    await update((s) => {
      const keep = dg.g === 'ai' ? { prompt: s.danmaku.params.ai.prompt, fallback: s.danmaku.params.ai.fallback } : {};
      Object.assign(s.danmaku.params[dg.g], structuredClone(DEFAULT_PARAMS[dg.g]), keep);
    });
    for (const r of refreshers) r();
  })));
}

// ---------- notifications (F-02) ----------

const notifyTab = sections.get('notify')!;
pageHead(notifyTab, t('opt.tab.notify'), t('opt.notify.title'), t('opt.notify.sub'));

const posBox = el('div', { className: 'radios', role: 'radiogroup' });
for (const [v, label] of [['bottom', t('opt.notify.bottom')], ['top', t('opt.notify.top')]] as const) {
  const input = el('input', { type: 'radio', name: 'notify-pos', value: v, checked: settings.notify.position === v });
  input.addEventListener('change', () => input.checked && void update((s) => { s.notify.position = v; }));
  posBox.append(el('label', {}, input, el('span', { className: 'text', textContent: label })));
}
const centerBtn = button(t('opt.notify.center'), async () => {
  await browser.storage.local.remove(NOTIFY_X_KEY);
  flash(centerBtn, t('opt.notify.centered'));
});
group(notifyTab, t('opt.notify.where'), undefined,
  row(t('opt.notify.position'), posBox),
  row(t('opt.notify.across'), inline(centerBtn), hint(t('opt.notify.acrossHint'))),
  row(t('opt.notify.max'), inline(numberInput(() => settings.notify.maxVisible, (s, v) => { s.notify.maxVisible = v; }, 1, 5), el('span', { className: 'muted', textContent: t('opt.notify.maxUnit') }))),
);

type SecKey = keyof Pick<NotifySettings, 'plainSec' | 'actionSec' | 'errorSec'>;
const SEC_ROWS: [SecKey, string][] = [['plainSec', t('opt.notify.plain')], ['actionSec', t('opt.notify.action')], ['errorSec', t('opt.notify.error')]];
const secInputs = new Map<SecKey, HTMLInputElement>();
const durationGroup = group(notifyTab, t('opt.notify.duration'), t('opt.notify.durationHint'));
for (const [k, label] of SEC_ROWS) {
  const input = numberInput(() => settings.notify[k], (s, v) => { s.notify[k] = v; }, 2, 30);
  secInputs.set(k, input);
  durationGroup.append(row(label, inline(input, el('span', { className: 'muted', textContent: t('opt.notify.sec') }))));
}
durationGroup.append(el('div', { className: 'inline mt' }, button(t('opt.notify.defaults'), async () => {
  await update((s) => { for (const [k] of SEC_ROWS) s.notify[k] = DEFAULT_SETTINGS.notify[k]; });
  for (const [k, input] of secInputs) input.value = String(settings.notify[k]);
})));

const previewMsg = el('span', { className: 'muted' });
const previewBtn = button(t('opt.notify.preview'), async () => {
  previewMsg.textContent = '';
  const tab = await recentYouTubeTab();
  if (!tab?.id) {
    previewMsg.textContent = t('opt.yt.noTab');
    return;
  }
  try {
    await browser.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
    const ok = await browser.tabs.sendMessage(tab.id, { type: NOTIFY_PREVIEW }, { frameId: 0 });
    if (!ok) previewMsg.textContent = t('opt.queue.noScript');
  } catch {
    previewMsg.textContent = t('opt.queue.noScript');
  }
});
group(notifyTab, t('opt.notify.preview'), t('opt.notify.previewHint'), el('div', { className: 'inline' }, previewBtn, previewMsg));

// ---------- storage (F-01-AC5) ----------

const storage = sections.get('storage')!;
const totalLine = el('p', { className: 'sub' });
pageHead(storage, t('opt.tab.storage'), t('opt.storage.title'), totalLine);

function limitInput(get: () => number, set: (s: Settings, v: number) => void): HTMLElement {
  const input = el('input', { type: 'number', min: '0.1', step: '0.5', value: String(get()), className: 'field num' });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (!(v > 0)) { input.value = String(get()); return; }
    void update((s) => set(s, v)).then(() => setTimeout(renderStorage, 1500));
  });
  return el('span', { className: 'inline' }, el('span', { className: 'muted', textContent: t('opt.storage.limit') }), input, 'MB');
}

const STORAGE_ROWS: {
  cat: StorageCategory;
  label: string;
  unit?: string;
  limit?: () => HTMLElement;
  clear?: () => Promise<unknown>;
}[] = [
  {
    cat: 'log', label: t('opt.storage.log'), unit: t('opt.unit.lines'),
    limit: () => limitInput(() => settings.storage.logMB, (s, v) => { s.storage.logMB = v; }),
    clear: () => send({ type: 'YouTube+/log-clear' }),
  },
  {
    cat: 'tldrCache', label: t('opt.storage.tldr'), unit: t('opt.unit.entries'),
    limit: () => limitInput(() => settings.storage.tldrCacheMB, (s, v) => { s.storage.tldrCacheMB = v; }),
    clear: () => clearCategory('tldrCache'),
  },
  {
    // Its limit is with the other danmaku params (F-12).
    cat: 'danmakuCache', label: t('opt.storage.danmaku'), unit: t('opt.unit.entries'),
    clear: () => clearCategory('danmakuCache'),
  },
  { cat: 'other', label: t('opt.storage.other') },
];

const usageCells = new Map<StorageCategory, HTMLElement>();
const storageGroup = group(storage, t('opt.storage.used'));
for (const r of STORAGE_ROWS) {
  const usage = el('span', { className: 'state' });
  usageCells.set(r.cat, usage);
  const line = inline(usage);
  if (r.limit) line.append(r.limit());
  if (r.clear) {
    line.append(button(t('opt.clear'), async () => {
      if (!confirm(t('opt.storage.confirmClear', { x: r.label }))) return;
      await r.clear!();
      setTimeout(renderStorage, 300);
    }));
  }
  storageGroup.append(row(r.label, line));
}

async function renderStorage() {
  const u = await getStorageUsage();
  totalLine.textContent = t('opt.storage.total', { x: formatBytes(u.total) });
  for (const r of STORAGE_ROWS) {
    const c = u.byCategory[r.cat];
    usageCells.get(r.cat)!.textContent = formatBytes(c.bytes) + (r.unit && c.count !== undefined ? `${t('opt.storage.sep')}${c.count} ${r.unit}` : '');
  }
}

let storageTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleStorageRender() {
  storageTimer ??= setTimeout(() => { storageTimer = undefined; void renderStorage(); }, 500);
}

// ---------- diagnostics: self-check and log ----------

const diag = sections.get('diag')!;
pageHead(diag, t('opt.tab.diag'), t('opt.diag.title'), t('opt.diag.sub'));

const checkBtn = button(t('opt.selfcheck'), () => runSelfCheck());
const checkList = el('ul', { className: 'checks' });
const STATUS_LABEL = { pass: t('opt.status.pass'), fail: t('opt.status.fail'), skip: t('opt.status.skip'), warn: t('opt.status.warn') } as const;
group(diag, t('opt.selfcheck'), t('opt.selfcheckHint'), el('div', { className: 'inline mb' }, checkBtn), checkList);

function renderChecks(results: CheckResult[]) {
  checkList.replaceChildren(
    ...results.map((r) =>
      el('li', {},
        el('span', { className: `chip ${r.status}`, textContent: STATUS_LABEL[r.status] }),
        el('span', {}, `[${r.feature}] ${r.name}`, r.detail ? el('span', { className: 'detail', textContent: r.detail }) : ''),
      ),
    ),
  );
}

async function runSelfCheck() {
  checkBtn.disabled = true;
  checkList.replaceChildren(el('li', { className: 'muted', textContent: t('opt.running') }));
  try {
    const { results } = await send<SelfCheckResponse>({ type: 'YouTube+/selfcheck' });
    renderChecks(results);
  } catch (e) {
    checkList.replaceChildren(el('li', { className: 'fail-line', textContent: t('opt.selfcheckFailed', { e: String(e) }) }));
  } finally {
    checkBtn.disabled = false;
    void renderTldr();
  }
}

const featureSel = el('select');
featureSel.append(el('option', { value: '', textContent: t('opt.allFeatures') }));
for (const f of ['core', ...FEATURES] as LogFeature[]) featureSel.append(el('option', { value: f, textContent: f }));
const levelSel = el('select');
levelSel.append(el('option', { value: '', textContent: t('opt.allLevels') }));
for (const l of LOG_LEVELS) levelSel.append(el('option', { value: l, textContent: `≥ ${l}` }));
const countSpan = el('span', { className: 'muted' });
const logBox = el('div', { id: 'log' });

let allEntries: LogEntry[] = [];

function filtered(): LogEntry[] {
  const f = featureSel.value;
  const minLevel = levelSel.value ? LOG_LEVELS.indexOf(levelSel.value as LogEntry['level']) : 0;
  return allEntries.filter((e) => (!f || e.feature === f) && LOG_LEVELS.indexOf(e.level) >= minLevel);
}
const logText = () => filtered().map(formatEntry).join('\n');

const copyBtn = button(t('opt.copyAll'), async () => {
  await navigator.clipboard.writeText(logText());
  flash(copyBtn, t('opt.copied'));
});
const exportBtn = button(t('opt.export'), () => {
  const url = URL.createObjectURL(new Blob([logText()], { type: 'text/plain' }));
  const a = el('a', { href: url, download: `YouTube+-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const clearBtn = button(t('opt.clear'), () => send({ type: 'YouTube+/log-clear' }));
group(diag, t('opt.log'), undefined,
  el('div', { className: 'inline mb' }, featureSel, levelSel, copyBtn, exportBtn, clearBtn, countSpan),
  logBox);

function renderLog() {
  const atBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 20;
  const shown = filtered();
  const frag = document.createDocumentFragment();
  for (const e of shown) frag.append(el('div', { className: e.level, textContent: formatEntry(e) }));
  logBox.replaceChildren(frag);
  countSpan.textContent = t('opt.lines', { a: shown.length, b: allEntries.length });
  if (atBottom) logBox.scrollTop = logBox.scrollHeight;
}

async function loadLog() {
  const got = await browser.storage.local.get(LOG_KEY);
  allEntries = (got[LOG_KEY] as LogEntry[] | undefined) ?? [];
  renderLog();
}

featureSel.addEventListener('change', renderLog);
levelSel.addEventListener('change', renderLog);
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (LOG_KEY in changes) void loadLog();
  scheduleStorageRender();
});

// ---------- start ----------

// #install (first run), #log=<feature>, or #<tab>; otherwise always General (F-01-AC3).
const hash = location.hash.slice(1);
const logFilter = new URLSearchParams(hash).get('log');
if (logFilter) featureSel.value = logFilter;
let initial: TabId = 'general';
if (hash === 'install' || logFilter) initial = 'diag';
else if (isTab(hash)) initial = hash;
selectTab(initial);
await loadLog();
await renderStorage();
await renderQueue();
// Find out now whether Gemini is signed in, so the banner shows right away.
if (featureOn(settings, 'tldr')) await send({ type: 'YouTube+/tldr-recheck' }).catch(() => {});
await renderTldr();
if (logFilter) logBox.scrollIntoView();
if (hash === 'install') {
  history.replaceState(null, '', location.pathname);
  void runSelfCheck();
}
