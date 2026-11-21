import { getLang, initLang, LANG_NAMES, t, type Lang, type MsgKey } from '@/core/i18n';
import { formatEntry, LOG_KEY, LOG_LEVELS, type LogEntry, type LogFeature } from '@/core/log';
import type { Message, SelfCheckResponse } from '@/core/messages';
import type { CheckResult } from '@/core/selfcheck';
import { MINI_POS_KEY } from '@/features/player/consts';
import { recentYouTubeTab } from '@/core/page-checks';
import { DEFAULT_PROFILE, type QueueMode, type QueueProfile } from '@/features/queue/core';
import { PROFILE_PREFIX, PROTOCOL_ERROR_KEY, SNAPSHOT_PREFIX } from '@/features/queue/keys';
import type { QueueOp, QueueRequest, QueueResponse } from '@/features/queue/messages';
import { getProfile, getSnapshot, updateProfile, type Identity } from '@/features/queue/profiles';
import type { PlaylistRef } from '@/features/queue/rpc';
import type { TldrStatus } from '@/features/tldr/service';
import { clearCategory, formatBytes, getStorageUsage, type StorageCategory } from '@/core/storage-usage';
import { FEATURES, featureOn, getSettings, saveSettings, type PlayerSettings, type Settings } from '@/core/settings';

// Build the page in the chosen language; rebuild (reload) when it changes.
await initLang(() => location.reload());
document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
document.title = t('opt.title');

const PLAYER_KEYS: (keyof PlayerSettings)[] = ['miniControls', 'freeDrag', 'stickyPlayer', 'backToTop'];

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

const radios = el('div', { className: 'radios', role: 'radiogroup' });
for (const l of Object.keys(LANG_NAMES) as Lang[]) {
  const input = el('input', { type: 'radio', name: 'lang', value: l, checked: settings.lang === l });
  input.addEventListener('change', async () => {
    // Don't setLang() here: initLang's listener would then see no change and skip
    // the rebuild. Reload ourselves once the new value is saved.
    await update((s) => { s.lang = l; });
    location.reload();
  });
  radios.append(el('label', {}, input, LANG_NAMES[l]));
}
group(general, t('opt.language'), t('opt.languageHint'), radios);

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

// ---------- TL;DR (design §15) ----------

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

// Gemini connection: the one thing a new user has to do (design §15.1).
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

// These need Gemini; dimmed while signed out (design §27).
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

// ---------- sign-in status, above every tab (design §3, §27) ----------

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

// ---------- queue (design §27) ----------
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
const newName = el('input', { type: 'text', value: 'YouTube+', className: 'field text' });
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
  const title = newName.value.trim() || 'YouTube+';
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

/** The lists this identity can edit, incl. Watch Later (§24.5). */
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

const snapLine = el('p', { className: 'sub' });
const restoreMsg = el('span', { className: 'muted' });
const restoreBtn = button(t('opt.resume'), restoreSnapshot);
group(queue, t('opt.queue.lastClear'), t('opt.queue.lastClearHint'), snapLine, el('div', { className: 'inline mt' }, restoreBtn, restoreMsg));

async function renderSnapshot() {
  const key = who.kind === 'ok' ? who.me.key : undefined;
  const snap = key ? await getSnapshot(key) : undefined;
  restoreBtn.disabled = !snap;
  snapLine.textContent = snap
    ? t('opt.queue.snap', { t: new Date(snap.time).toLocaleString(), name: snap.listName, mode: t(snap.mode === 'all' ? 'queue.clearAll' : 'queue.removeWatched'), n: snap.removed.length })
    : t('opt.queue.never');
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
      await Promise.all([renderSnapshot(), renderProtocolError()]);
      if (profile.mode === 'playlist') await loadLists();
    } finally {
      queueBusy = undefined;
    }
  })();
  return queueBusy;
}

async function restoreSnapshot() {
  if (who.kind !== 'ok' || !who.me.key) {
    restoreMsg.textContent = t('opt.queue.needTab');
    return;
  }
  const snap = await getSnapshot(who.me.key);
  if (!snap) return;
  restoreBtn.disabled = true;
  restoreMsg.textContent = t('opt.queue.restoring');
  try {
    const n = await ask<number>(who.tab, { op: 'restore', key: who.me.key, snapshot: snap });
    restoreMsg.textContent = t('opt.queue.restored', { n });
  } catch (e) {
    restoreMsg.textContent = t('opt.queue.restoreFail', { e: e instanceof Error ? e.message : String(e) });
  } finally {
    restoreBtn.disabled = false;
  }
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
  if (area === 'local' && key && `${SNAPSHOT_PREFIX}${key}` in changes) void renderSnapshot();
  if (area === 'local' && PROTOCOL_ERROR_KEY in changes) void renderProtocolError();
});

// ---------- player ----------

const player = sections.get('player')!;
pageHead(player, t('feature.player'), t('opt.player.title'), t('opt.player.subtitle'));
const playerList = el('div', { className: 'stack' });
for (const k of PLAYER_KEYS) {
  playerList.append(toggle(t(`opt.player.${k}`), settings.player[k], (v) => update((s) => { s.player[k] = v; })));
}
const resetPos = button(t('opt.player.resetPos'), async () => {
  await browser.storage.local.remove(MINI_POS_KEY);
  flash(resetPos, t('opt.player.resetDone'));
});
group(player, t('opt.player.sub'), undefined, playerList, el('div', { className: 'inline mt-lg' }, resetPos));

// ---------- storage (design §4.1) ----------

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
  { cat: 'queueSnapshot', label: t('opt.storage.snapshot'), clear: () => clearCategory('queueSnapshot') },
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
const STATUS_LABEL = { pass: t('opt.status.pass'), fail: t('opt.status.fail'), skip: t('opt.status.skip') } as const;
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

// #install (first run), #log=<feature>, or #<tab>; otherwise always General (design §3).
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
