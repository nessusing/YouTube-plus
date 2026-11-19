import { getLang, initLang, LANG_NAMES, setLang, t, type Lang, type MsgKey } from '@/core/i18n';
import { formatEntry, LOG_KEY, LOG_LEVELS, type LogEntry, type LogFeature } from '@/core/log';
import type { Message, SelfCheckResponse } from '@/core/messages';
import type { CheckResult } from '@/core/selfcheck';
import { MINI_POS_KEY } from '@/features/player/consts';
import type { Snapshot } from '@/features/queue/core';
import { OUTBOX_KEY, SNAPSHOT_KEY, STATE_KEY } from '@/features/queue/keys';
import { clearCategory, formatBytes, getStorageUsage, type StorageCategory } from '@/core/storage-usage';
import { FEATURES, getSettings, saveSettings, type FeatureId, type PlayerSettings, type Settings } from '@/core/settings';

// Build the page in the chosen language; rebuild (reload) when it changes.
await initLang(() => location.reload());
document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
document.title = t('opt.title');

const PLAYER_KEYS: (keyof PlayerSettings)[] = ['miniControls', 'freeDrag', 'stickyPlayer', 'backToTop'];

const send = <T>(m: Message) => browser.runtime.sendMessage(m) as Promise<T>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const id = `cb-${Math.random().toString(36).slice(2)}`;
  const input = el('input', { type: 'checkbox', id, checked });
  input.addEventListener('change', () => onChange(input.checked));
  return el('div', { className: 'row' }, input, el('label', { htmlFor: id }, label));
}

// ---------- tabs ----------

const tabs = [
  { id: 'general', label: t('opt.tab.general') },
  { id: 'tldr', label: t('feature.tldr') },
  { id: 'queue', label: t('feature.queue') },
  { id: 'player', label: t('feature.player') },
] as const;

const nav = document.getElementById('tabs')!;
const panels = document.getElementById('panels')!;
const sections = new Map<string, HTMLElement>();
const buttons = new Map<string, HTMLButtonElement>();

function selectTab(id: string) {
  for (const [k, s] of sections) s.hidden = k !== id;
  for (const [k, b] of buttons) b.setAttribute('aria-selected', String(k === id));
  try { localStorage.setItem('tab', id); } catch { /* ignore */ }
}

for (const tab of tabs) {
  const b = el('button', { textContent: tab.label });
  b.setAttribute('role', 'tab');
  b.addEventListener('click', () => selectTab(tab.id));
  buttons.set(tab.id, b);
  nav.append(b);
  const s = el('section');
  sections.set(tab.id, s);
  panels.append(s);
}

// ---------- settings ----------

let settings: Settings = await getSettings();
const update = async (mut: (s: Settings) => void) => {
  mut(settings);
  await saveSettings(settings);
};

const general = sections.get('general')!;
const langSel = el('select');
for (const l of Object.keys(LANG_NAMES) as Lang[]) langSel.append(el('option', { value: l, textContent: LANG_NAMES[l], selected: settings.lang === l }));
langSel.addEventListener('change', async () => {
  // Don't setLang() here: initLang's listener would then see no change and skip
  // the rebuild. Reload ourselves once the new value is saved.
  await update((s) => { s.lang = langSel.value as Lang; });
  location.reload();
});
general.append(
  el('h2', { textContent: t('opt.language') }),
  el('div', { className: 'row' }, langSel),
  el('p', { className: 'muted', textContent: t('opt.languageHint') }),
);
general.append(el('h2', { textContent: t('opt.features') }));
for (const f of FEATURES) {
  general.append(checkbox(t(`feature.${f}` as MsgKey), settings.features[f], (v) => update((s) => { s.features[f] = v; })));
}

// ---------- self-check ----------

general.append(el('h2', { textContent: t('opt.selfcheck') }));
const checkBtn = el('button', { className: 'act', textContent: t('opt.selfcheck') });
const checkList = el('ul', { className: 'checks' });
const STATUS_LABEL = { pass: t('opt.status.pass'), fail: t('opt.status.fail'), skip: t('opt.status.skip') } as const;

function renderChecks(results: CheckResult[]) {
  checkList.replaceChildren(
    ...results.map((r) =>
      el(
        'li',
        {},
        el('span', { className: `badge ${r.status}`, textContent: STATUS_LABEL[r.status] }),
        ` [${r.feature}] ${r.name}`,
        r.detail ? el('span', { className: 'muted', textContent: ` — ${r.detail}` }) : '',
      ),
    ),
  );
}

async function runSelfCheck() {
  checkBtn.disabled = true;
  checkList.replaceChildren(el('li', { className: 'muted', textContent: t('opt.running') }));
  try {
    const { results } = await send<SelfCheckResponse>({ type: 'yt+/selfcheck' });
    renderChecks(results);
  } catch (e) {
    checkList.replaceChildren(el('li', { className: 'fail', textContent: t('opt.selfcheckFailed', { e: String(e) }) }));
  } finally {
    checkBtn.disabled = false;
  }
}
checkBtn.addEventListener('click', runSelfCheck);
general.append(el('div', { className: 'row' }, checkBtn), checkList);

// ---------- log ----------

general.append(el('h2', { textContent: t('opt.log') }));
const featureSel = el('select');
featureSel.append(el('option', { value: '', textContent: t('opt.allFeatures') }));
for (const f of ['core', ...FEATURES] as LogFeature[]) featureSel.append(el('option', { value: f, textContent: f }));
const levelSel = el('select');
levelSel.append(el('option', { value: '', textContent: t('opt.allLevels') }));
for (const l of LOG_LEVELS) levelSel.append(el('option', { value: l, textContent: `≥ ${l}` }));
const copyBtn = el('button', { className: 'act', textContent: t('opt.copyAll') });
const exportBtn = el('button', { className: 'act', textContent: t('opt.export') });
const clearBtn = el('button', { className: 'act', textContent: t('opt.clear') });
const countSpan = el('span', { className: 'muted' });
const logBox = el('div', { id: 'log' });
general.append(el('div', { className: 'row' }, featureSel, levelSel, copyBtn, exportBtn, clearBtn, countSpan), logBox);

let allEntries: LogEntry[] = [];

function filtered(): LogEntry[] {
  const f = featureSel.value;
  const minLevel = levelSel.value ? LOG_LEVELS.indexOf(levelSel.value as LogEntry['level']) : 0;
  return allEntries.filter((e) => (!f || e.feature === f) && LOG_LEVELS.indexOf(e.level) >= minLevel);
}

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

const text = () => filtered().map(formatEntry).join('\n');
copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(text());
  copyBtn.textContent = t('opt.copied');
  setTimeout(() => (copyBtn.textContent = t('opt.copyAll')), 1500);
});
exportBtn.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }));
  const a = el('a', { href: url, download: `yt+-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
clearBtn.addEventListener('click', async () => {
  await send({ type: 'yt+/log-clear' });
});
featureSel.addEventListener('change', renderLog);
levelSel.addEventListener('change', renderLog);
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (LOG_KEY in changes) void loadLog();
  scheduleStorageRender();
});

let storageTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleStorageRender() {
  storageTimer ??= setTimeout(() => { storageTimer = undefined; void renderStorage(); }, 500);
}

// ---------- storage (design §4.1) ----------

general.append(el('h2', { textContent: t('opt.storage') }));
const totalLine = el('p', { className: 'muted' });
const storageTable = el('table', { className: 'storage' });
general.append(totalLine, storageTable);

function limitInput(get: () => number, set: (s: Settings, v: number) => void): HTMLElement {
  const input = el('input', { type: 'number', min: '0.1', step: '0.5', value: String(get()) });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (!(v > 0)) { input.value = String(get()); return; }
    void update((s) => set(s, v)).then(() => setTimeout(renderStorage, 1500));
  });
  return el('span', {}, input, ' MB');
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
    clear: () => send({ type: 'yt+/log-clear' }),
  },
  {
    cat: 'tldrCache', label: t('opt.storage.tldr'), unit: t('opt.unit.entries'),
    limit: () => limitInput(() => settings.storage.tldrCacheMB, (s, v) => { s.storage.tldrCacheMB = v; }),
    clear: () => clearCategory('tldrCache'),
  },
  { cat: 'queueSnapshot', label: t('opt.storage.snapshot'), clear: () => clearCategory('queueSnapshot') },
  { cat: 'other', label: t('opt.storage.other') },
];

storageTable.append(el('tr', {}, ...[t('opt.storage.cat'), t('opt.storage.used'), t('opt.storage.limit'), ''].map((x) => el('th', { textContent: x }))));
const usageCells = new Map<StorageCategory, HTMLTableCellElement>();
for (const r of STORAGE_ROWS) {
  const usage = el('td');
  usageCells.set(r.cat, usage);
  const clearCell = el('td');
  if (r.clear) {
    const b = el('button', { className: 'act', textContent: t('opt.clear') });
    b.addEventListener('click', async () => {
      if (!confirm(t('opt.storage.confirmClear', { x: r.label }))) return;
      await r.clear!();
      setTimeout(renderStorage, 300);
    });
    clearCell.append(b);
  }
  storageTable.append(el('tr', {}, el('td', { textContent: r.label }), usage, el('td', {}, r.limit?.() ?? '—'), clearCell));
}

async function renderStorage() {
  const u = await getStorageUsage();
  totalLine.textContent = t('opt.storage.total', { x: formatBytes(u.total) });
  for (const r of STORAGE_ROWS) {
    const c = u.byCategory[r.cat];
    usageCells.get(r.cat)!.textContent = formatBytes(c.bytes) + (r.unit && c.count !== undefined ? `${t('opt.storage.sep')}${c.count} ${r.unit}` : '');
  }
}

// ---------- feature tabs ----------

// ---------- TL;DR tab (design §15) ----------

const tldrTab = sections.get('tldr')!;

function numberInput(get: () => number, set: (s: Settings, v: number) => void, min = 0, max = Infinity): HTMLInputElement {
  const input = el('input', { type: 'number', min: String(min), step: '1', value: String(get()), className: 'num' });
  if (max !== Infinity) input.max = String(max);
  input.addEventListener('change', () => {
    const v = Math.floor(Number(input.value));
    if (!(v >= min && v <= max)) { input.value = String(get()); return; }
    void update((s) => set(s, v));
  });
  return input;
}

tldrTab.append(
  el('h2', { textContent: t('opt.tldr.output') }),
  el('p', { className: 'muted', textContent: t('opt.languageHint') }),
  checkbox(t('opt.tldr.titleCheck'), settings.tldr.titleCheck, (v) => update((s) => { s.tldr.titleCheck = v; })),
  el('h2', { textContent: t('opt.tldr.account') }),
  el('div', { className: 'row' }, el('label', { textContent: t('opt.tldr.accountN') }),
    numberInput(() => settings.tldr.account, (s, v) => { s.tldr.account = v; })),
  el('h2', { textContent: t('opt.tldr.limits') }),
  checkbox(t('opt.tldr.prefetch'), settings.tldr.prefetch, (v) => update((s) => { s.tldr.prefetch = v; })),
  el('div', { className: 'row' }, el('label', { textContent: t('opt.tldr.perHour') }), numberInput(() => settings.tldr.perHour, (s, v) => { s.tldr.perHour = v; }, 1),
    el('label', { textContent: t('opt.tldr.perDay') }), numberInput(() => settings.tldr.perDay, (s, v) => { s.tldr.perDay = v; }, 1)),
  el('p', { className: 'muted', textContent: t('opt.tldr.limitsHint') }),
  el('div', { className: 'row' }, el('label', { textContent: t('opt.tldr.batchSize') }), numberInput(() => settings.tldr.batchSize, (s, v) => { s.tldr.batchSize = v; }, 1, 10)),
  el('p', { className: 'muted', textContent: t('opt.tldr.batchHint') }),
);
const tldrStatus = el('p');
const resumeBtn = el('button', { className: 'act', textContent: t('opt.resume') });
resumeBtn.addEventListener('click', async () => {
  await send({ type: 'yt+/tldr-resume' });
  void renderTldr();
});
tldrTab.append(el('h2', { textContent: t('opt.tldr.status') }), tldrStatus, el('div', { className: 'row' }, resumeBtn));
const pre = el('ul');
for (const [text, href] of [
  [t('opt.tldr.pre1'), 'https://gemini.google.com/'],
  [t('opt.tldr.pre2'), 'https://myactivity.google.com/product/gemini'],
  [t('opt.tldr.pre3'), 'https://gemini.google.com/apps'],
] as const) pre.append(el('li', {}, el('a', { href, target: '_blank', rel: 'noopener', textContent: text })));
tldrTab.append(el('h2', { textContent: t('opt.tldr.prereq') }), pre,
  el('p', { className: 'muted', textContent: t('opt.tldr.prereqHint') }));

async function renderTldr() {
  try {
    const st = (await send({ type: 'yt+/tldr-status' })) as { counters: { hour: number[]; dayCount: number }; breaker: { state: string; until?: number }; queued: number; running: number };
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
setInterval(() => { if (!sections.get('tldr')!.hidden) void renderTldr(); }, 5000);

// ---------- queue tab (design §27) ----------

const queue = sections.get('queue')!;
queue.append(el('h2', { textContent: t('opt.queue.list') }));
const nameInput = el('input', { type: 'text', value: settings.queue.listName, className: 'text' });
const nameSave = el('button', { className: 'act', textContent: t('opt.save') });
nameSave.addEventListener('click', async () => {
  const v = nameInput.value.trim();
  if (!v || v === settings.queue.listName) return;
  await update((s) => { s.queue.listName = v; });
  nameSave.textContent = t('opt.saved');
  setTimeout(() => (nameSave.textContent = t('opt.save')), 1500);
});
queue.append(
  el('div', { className: 'row' }, el('label', { textContent: t('opt.queue.name') }), nameInput, nameSave),
  el('p', { className: 'muted', textContent: t('opt.queue.nameHint') }),
);
const listLine = el('p');
const outboxLine = el('p');
queue.append(listLine, outboxLine);
queue.append(el('h2', { textContent: t('opt.queue.lastClear') }));
const snapLine = el('p', { className: 'muted' });
const restoreBtn = el('button', { className: 'act', textContent: t('opt.resume') });
const restoreMsg = el('span', { className: 'muted' });
queue.append(snapLine, el('div', { className: 'row' }, restoreBtn, restoreMsg));

async function renderQueue() {
  const local = await browser.storage.local.get([STATE_KEY, OUTBOX_KEY, SNAPSHOT_KEY]);
  const state = local[STATE_KEY] as { listId?: string; listName?: string; count?: number; updatedAt?: number } | undefined;
  listLine.replaceChildren();
  if (state?.listId) {
    const a = el('a', { href: `https://www.youtube.com/playlist?list=${encodeURIComponent(state.listId)}`, target: '_blank', rel: 'noopener', textContent: state.listName ?? state.listId });
    listLine.append(t('opt.queue.current'), a, t('opt.queue.currentTail', { n: state.count ?? 0, t: new Date(state.updatedAt ?? 0).toLocaleString() }));
  } else {
    listLine.append(el('span', { className: 'muted', textContent: t('opt.queue.notConnected') }));
  }
  const outbox = (local[OUTBOX_KEY] as unknown[] | undefined) ?? [];
  outboxLine.textContent = t('opt.queue.outbox', { n: outbox.length });
  const snap = local[SNAPSHOT_KEY] as Snapshot | undefined;
  restoreBtn.disabled = !snap;
  snapLine.textContent = snap
    ? t('opt.queue.snap', { t: new Date(snap.time).toLocaleString(), name: snap.listName, mode: t(snap.mode === 'all' ? 'queue.clearAll' : 'queue.removeWatched'), n: snap.removed.length })
    : t('opt.queue.never');
}

restoreBtn.addEventListener('click', async () => {
  const snap = (await browser.storage.local.get(SNAPSHOT_KEY))[SNAPSHOT_KEY] as Snapshot | undefined;
  if (!snap) return;
  const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
  const tab = tabs.find((t) => t.active) ?? tabs[0];
  if (!tab?.id) {
    restoreMsg.textContent = t('opt.queue.needTab');
    return;
  }
  restoreBtn.disabled = true;
  restoreMsg.textContent = t('opt.queue.restoring');
  try {
    const r = (await browser.tabs.sendMessage(tab.id, { type: 'yt+/queue-restore-snapshot', snapshot: snap }, { frameId: 0 })) as { ok: boolean; restored?: number; error?: string };
    restoreMsg.textContent = r.ok ? t('opt.queue.restored', { n: r.restored ?? 0 }) : t('opt.queue.restoreFail', { e: r.error ?? '' });
  } catch {
    restoreMsg.textContent = t('opt.queue.noScript');
  } finally {
    restoreBtn.disabled = false;
  }
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (STATE_KEY in changes || OUTBOX_KEY in changes || SNAPSHOT_KEY in changes)) void renderQueue();
});

const player = sections.get('player')!;
player.append(el('h2', { textContent: t('opt.player.sub') }));
for (const k of PLAYER_KEYS) {
  player.append(checkbox(t(`opt.player.${k}`), settings.player[k], (v) => update((s) => { s.player[k] = v; })));
}
const resetPos = el('button', { className: 'act', textContent: t('opt.player.resetPos') });
resetPos.addEventListener('click', async () => {
  await browser.storage.local.remove(MINI_POS_KEY);
  resetPos.textContent = t('opt.player.resetDone');
  setTimeout(() => (resetPos.textContent = t('opt.player.resetPos')), 2000);
});
player.append(el('div', { className: 'row' }, resetPos));

// ---------- start ----------

const hashParams = new URLSearchParams(location.hash.slice(1));
const logFilter = hashParams.get('log');
if (logFilter) featureSel.value = logFilter;
const initialFromHash = logFilter ? 'general' : location.hash.slice(1);
let initial: string = 'general';
try { initial = localStorage.getItem('tab') ?? 'general'; } catch { /* ignore */ }
if (initialFromHash === 'install') initial = 'general';
else if (sections.has(initialFromHash)) initial = initialFromHash;
selectTab(sections.has(initial) ? initial : 'general');
await loadLog();
await renderStorage();
await renderQueue();
await renderTldr();
if (logFilter) logBox.scrollIntoView();
if (initialFromHash === 'install') {
  history.replaceState(null, '', location.pathname);
  void runSelfCheck();
}
