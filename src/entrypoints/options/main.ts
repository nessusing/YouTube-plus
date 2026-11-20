import { getLang, initLang, LANG_NAMES, t, type Lang, type MsgKey } from '@/core/i18n';
import { formatEntry, LOG_KEY, LOG_LEVELS, type LogEntry, type LogFeature } from '@/core/log';
import type { Message, SelfCheckResponse } from '@/core/messages';
import type { CheckResult } from '@/core/selfcheck';
import { MINI_POS_KEY } from '@/features/player/consts';
import type { Snapshot } from '@/features/queue/core';
import { OUTBOX_KEY, SNAPSHOT_KEY, STATE_KEY } from '@/features/queue/keys';
import type { TldrStatus } from '@/features/tldr/service';
import { clearCategory, formatBytes, getStorageUsage, type StorageCategory } from '@/core/storage-usage';
import { FEATURES, getSettings, saveSettings, type PlayerSettings, type Settings } from '@/core/settings';

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
  try { localStorage.setItem('tab', id); } catch { /* ignore */ }
  current = id;
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
let current: TabId = 'general';
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

group(tldrTab, t('opt.tldr.output'), undefined,
  toggle(t('opt.tldr.titleCheck'), settings.tldr.titleCheck, (v) => update((s) => { s.tldr.titleCheck = v; })));

group(tldrTab, t('opt.tldr.limits'), t('opt.tldr.limitsHint'),
  el('div', { className: 'row' }, el('div', {}), el('div', { className: 'row-body' },
    toggle(t('opt.tldr.prefetch'), settings.tldr.prefetch, (v) => update((s) => { s.tldr.prefetch = v; })))),
  row(t('opt.tldr.perHour'), inline(numberInput(() => settings.tldr.perHour, (s, v) => { s.tldr.perHour = v; }, 1))),
  row(t('opt.tldr.perDay'), inline(numberInput(() => settings.tldr.perDay, (s, v) => { s.tldr.perDay = v; }, 1))),
  row(t('opt.tldr.batchSize'), inline(numberInput(() => settings.tldr.batchSize, (s, v) => { s.tldr.batchSize = v; }, 1, 10)), hint(t('opt.tldr.batchHint'))),
);

const tldrStatus = el('p', { className: 'sub' });
const resumeBtn = button(t('opt.resume'), async () => {
  await send({ type: 'YouTube+/tldr-resume' });
  void renderTldr();
});
group(tldrTab, t('opt.tldr.status'), undefined, tldrStatus, el('div', { className: 'inline mt' }, resumeBtn));

// The banner sits above every tab: signing in is what unblocks TL;DR.
const banner = document.getElementById('banner')!;
banner.append(
  el('div', { className: 'text' }, el('strong', { textContent: t('opt.tldr.banner') }), el('span', { className: 'muted', textContent: t('opt.tldr.signinHint') })),
  button(t('opt.tldr.signin'), () => send({ type: 'YouTube+/tldr-signin' }), 'btn filled'),
);

async function renderTldr() {
  if (!settings.features.tldr) {
    banner.hidden = true;
    return;
  }
  try {
    const st = await send<TldrStatus>({ type: 'YouTube+/tldr-status' });
    const out = st.gemini === 'signedOut';
    // The TL;DR tab has its own connection row; the banner is for every other tab.
    banner.hidden = !out || current === 'tldr';
    connState.className = `state${st.gemini === 'ok' ? ' ok' : out ? ' bad' : ''}`;
    connState.textContent = st.gemini === 'ok' ? t('opt.tldr.connOk', { n: st.account })
      : out ? t('opt.tldr.connOut', { n: st.account }) : t('opt.tldr.connUnknown');
    signinBtn.hidden = signinHint.hidden = !out;

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
// Cheap (no network): keeps the banner and status current, e.g. after signing in elsewhere.
setInterval(() => void renderTldr(), 3000);

// ---------- queue (design §27) ----------

const queue = sections.get('queue')!;
pageHead(queue, t('feature.queue'), t('opt.queue.title'), t('opt.queue.sub'));
const nameInput = el('input', { type: 'text', value: settings.queue.listName, className: 'field text' });
const nameSave = button(t('opt.save'), async () => {
  const v = nameInput.value.trim();
  if (!v || v === settings.queue.listName) return;
  await update((s) => { s.queue.listName = v; });
  flash(nameSave, t('opt.saved'));
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameSave.click(); });
const listLine = el('p', { className: 'sub' });
const outboxLine = el('p', { className: 'hint' });
group(queue, t('opt.queue.list'), undefined,
  row(t('opt.queue.name'), inline(nameInput, nameSave), hint(t('opt.queue.nameHint'))),
  el('div', { className: 'row' }, el('div', {}), el('div', { className: 'row-body' }, listLine, outboxLine)),
);
const snapLine = el('p', { className: 'sub' });
const restoreMsg = el('span', { className: 'muted' });
const restoreBtn = button(t('opt.resume'), restoreSnapshot);
group(queue, t('opt.queue.lastClear'), undefined, snapLine, el('div', { className: 'inline mt' }, restoreBtn, restoreMsg));

async function renderQueue() {
  const local = await browser.storage.local.get([STATE_KEY, OUTBOX_KEY, SNAPSHOT_KEY]);
  const state = local[STATE_KEY] as { listId?: string; listName?: string; count?: number; updatedAt?: number } | undefined;
  listLine.replaceChildren();
  if (state?.listId) {
    const a = el('a', { href: `https://www.youtube.com/playlist?list=${encodeURIComponent(state.listId)}`, target: '_blank', rel: 'noopener', textContent: state.listName ?? state.listId });
    listLine.append(t('opt.queue.current'), a, t('opt.queue.currentTail', { n: state.count ?? 0, t: new Date(state.updatedAt ?? 0).toLocaleString() }));
  } else {
    listLine.append(t('opt.queue.notConnected'));
  }
  const outbox = (local[OUTBOX_KEY] as unknown[] | undefined) ?? [];
  outboxLine.textContent = t('opt.queue.outbox', { n: outbox.length });
  const snap = local[SNAPSHOT_KEY] as Snapshot | undefined;
  restoreBtn.disabled = !snap;
  snapLine.textContent = snap
    ? t('opt.queue.snap', { t: new Date(snap.time).toLocaleString(), name: snap.listName, mode: t(snap.mode === 'all' ? 'queue.clearAll' : 'queue.removeWatched'), n: snap.removed.length })
    : t('opt.queue.never');
}

async function restoreSnapshot() {
  const snap = (await browser.storage.local.get(SNAPSHOT_KEY))[SNAPSHOT_KEY] as Snapshot | undefined;
  if (!snap) return;
  const ytTabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
  const tab = ytTabs.find((x) => x.active) ?? ytTabs[0];
  if (!tab?.id) {
    restoreMsg.textContent = t('opt.queue.needTab');
    return;
  }
  restoreBtn.disabled = true;
  restoreMsg.textContent = t('opt.queue.restoring');
  try {
    const r = (await browser.tabs.sendMessage(tab.id, { type: 'YouTube+/queue-restore-snapshot', snapshot: snap }, { frameId: 0 })) as { ok: boolean; restored?: number; error?: string };
    restoreMsg.textContent = r.ok ? t('opt.queue.restored', { n: r.restored ?? 0 }) : t('opt.queue.restoreFail', { e: r.error ?? '' });
  } catch {
    restoreMsg.textContent = t('opt.queue.noScript');
  } finally {
    restoreBtn.disabled = false;
  }
}

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
  if (STATE_KEY in changes || OUTBOX_KEY in changes || SNAPSHOT_KEY in changes) void renderQueue();
  scheduleStorageRender();
});

// ---------- start ----------

// #install (first run), #log=<feature>, or #<tab>.
const hash = location.hash.slice(1);
const logFilter = new URLSearchParams(hash).get('log');
if (logFilter) featureSel.value = logFilter;
let initial: TabId = 'general';
try {
  const saved = localStorage.getItem('tab');
  if (isTab(saved)) initial = saved;
} catch { /* ignore */ }
if (hash === 'install' || logFilter) initial = 'diag';
else if (isTab(hash)) initial = hash;
selectTab(initial);
await loadLog();
await renderStorage();
await renderQueue();
// Find out now whether Gemini is signed in, so the banner shows right away.
if (settings.features.tldr) await send({ type: 'YouTube+/tldr-recheck' }).catch(() => {});
await renderTldr();
if (logFilter) logBox.scrollIntoView();
if (hash === 'install') {
  history.replaceState(null, '', location.pathname);
  void runSelfCheck();
}
