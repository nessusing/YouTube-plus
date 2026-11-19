import { formatEntry, LOG_KEY, LOG_LEVELS, type LogEntry, type LogFeature } from '@/core/log';
import type { Message, SelfCheckResponse } from '@/core/messages';
import type { CheckResult } from '@/core/selfcheck';
import { MINI_POS_KEY } from '@/features/player/consts';
import type { Snapshot } from '@/features/queue/core';
import { OUTBOX_KEY, SNAPSHOT_KEY, STATE_KEY } from '@/features/queue/keys';
import { clearCategory, formatBytes, getStorageUsage, type StorageCategory } from '@/core/storage-usage';
import { FEATURES, getSettings, saveSettings, type FeatureId, type PlayerSettings, type Settings } from '@/core/settings';

const FEATURE_LABEL: Record<FeatureId, string> = { tldr: 'TL;DR', queue: '队列', player: '播放器' };
const PLAYER_LABEL: Record<keyof PlayerSettings, string> = {
  miniControls: '迷你播放器控件（音量、进度条）',
  freeDrag: '迷你播放器自由拖动，记住位置和大小',
  stickyPlayer: '观看页往下滚时播放器置顶',
  backToTop: '「回到顶部」按钮',
};

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
  { id: 'general', label: '通用' },
  { id: 'tldr', label: 'TL;DR' },
  { id: 'queue', label: '队列' },
  { id: 'player', label: '播放器' },
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

for (const t of tabs) {
  const b = el('button', { textContent: t.label });
  b.setAttribute('role', 'tab');
  b.addEventListener('click', () => selectTab(t.id));
  buttons.set(t.id, b);
  nav.append(b);
  const s = el('section');
  sections.set(t.id, s);
  panels.append(s);
}

// ---------- settings ----------

let settings: Settings = await getSettings();
const update = async (mut: (s: Settings) => void) => {
  mut(settings);
  await saveSettings(settings);
};

const general = sections.get('general')!;
general.append(el('h2', { textContent: '功能开关' }));
for (const f of FEATURES) {
  general.append(checkbox(FEATURE_LABEL[f], settings.features[f], (v) => update((s) => { s.features[f] = v; })));
}

// ---------- self-check ----------

general.append(el('h2', { textContent: '自检' }));
const checkBtn = el('button', { className: 'act', textContent: '自检' });
const checkList = el('ul', { className: 'checks' });
const STATUS_LABEL = { pass: '通过', fail: '失败', skip: '跳过' } as const;

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
  checkList.replaceChildren(el('li', { className: 'muted', textContent: '运行中…' }));
  try {
    const { results } = await send<SelfCheckResponse>({ type: 'yt++/selfcheck' });
    renderChecks(results);
  } catch (e) {
    checkList.replaceChildren(el('li', { className: 'fail', textContent: `自检没能运行：${String(e)}` }));
  } finally {
    checkBtn.disabled = false;
  }
}
checkBtn.addEventListener('click', runSelfCheck);
general.append(el('div', { className: 'row' }, checkBtn), checkList);

// ---------- log ----------

general.append(el('h2', { textContent: '日志' }));
const featureSel = el('select');
featureSel.append(el('option', { value: '', textContent: '全部功能' }));
for (const f of ['core', ...FEATURES] as LogFeature[]) featureSel.append(el('option', { value: f, textContent: f }));
const levelSel = el('select');
levelSel.append(el('option', { value: '', textContent: '全部级别' }));
for (const l of LOG_LEVELS) levelSel.append(el('option', { value: l, textContent: `≥ ${l}` }));
const copyBtn = el('button', { className: 'act', textContent: '复制全部' });
const exportBtn = el('button', { className: 'act', textContent: '导出 .txt' });
const clearBtn = el('button', { className: 'act', textContent: '清空' });
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
  countSpan.textContent = `${shown.length} / ${allEntries.length} 行`;
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
  copyBtn.textContent = '已复制';
  setTimeout(() => (copyBtn.textContent = '复制全部'), 1500);
});
exportBtn.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }));
  const a = el('a', { href: url, download: `yt++-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
clearBtn.addEventListener('click', async () => {
  await send({ type: 'yt++/log-clear' });
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

general.append(el('h2', { textContent: '存储' }));
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
    cat: 'log', label: '日志', unit: '行',
    limit: () => limitInput(() => settings.storage.logMB, (s, v) => { s.storage.logMB = v; }),
    clear: () => send({ type: 'yt++/log-clear' }),
  },
  {
    cat: 'tldrCache', label: 'TL;DR 缓存', unit: '条',
    limit: () => limitInput(() => settings.storage.tldrCacheMB, (s, v) => { s.storage.tldrCacheMB = v; }),
    clear: () => clearCategory('tldrCache'),
  },
  { cat: 'queueSnapshot', label: '队列清空快照', clear: () => clearCategory('queueSnapshot') },
  { cat: 'other', label: '其他' },
];

storageTable.append(el('tr', {}, ...['类别', '占用', '上限', ''].map((t) => el('th', { textContent: t }))));
const usageCells = new Map<StorageCategory, HTMLTableCellElement>();
for (const r of STORAGE_ROWS) {
  const usage = el('td');
  usageCells.set(r.cat, usage);
  const clearCell = el('td');
  if (r.clear) {
    const b = el('button', { className: 'act', textContent: '清空' });
    b.addEventListener('click', async () => {
      if (!confirm(`清空${r.label}？`)) return;
      await r.clear!();
      setTimeout(renderStorage, 300);
    });
    clearCell.append(b);
  }
  storageTable.append(el('tr', {}, el('td', { textContent: r.label }), usage, el('td', {}, r.limit?.() ?? '—'), clearCell));
}

async function renderStorage() {
  const u = await getStorageUsage();
  totalLine.textContent = `总用量 ${formatBytes(u.total)}（已申请 unlimitedStorage，用量由下面的上限控制）`;
  for (const r of STORAGE_ROWS) {
    const c = u.byCategory[r.cat];
    usageCells.get(r.cat)!.textContent = formatBytes(c.bytes) + (r.unit && c.count !== undefined ? `，${c.count} ${r.unit}` : '');
  }
}

// ---------- feature tabs ----------

const notYet = (s: HTMLElement) => s.append(el('p', { className: 'muted', textContent: '这个功能还没实现。' }));
notYet(sections.get('tldr')!);

// ---------- queue tab (design §27) ----------

const queue = sections.get('queue')!;
queue.append(el('h2', { textContent: '队列用的列表' }));
const nameInput = el('input', { type: 'text', value: settings.queue.listName, className: 'text' });
const nameSave = el('button', { className: 'act', textContent: '保存' });
nameSave.addEventListener('click', async () => {
  const v = nameInput.value.trim();
  if (!v || v === settings.queue.listName) return;
  await update((s) => { s.queue.listName = v; });
  nameSave.textContent = '已保存';
  setTimeout(() => (nameSave.textContent = '保存'), 1500);
});
queue.append(
  el('div', { className: 'row' }, el('label', { textContent: '列表名字' }), nameInput, nameSave),
  el('p', { className: 'muted', textContent: '同名列表已存在就直接用；没有就建一个私密列表。改名字等于换一个列表，原来的列表不动。' }),
);
const listLine = el('p');
const outboxLine = el('p');
queue.append(listLine, outboxLine);
queue.append(el('h2', { textContent: '最近一次清空' }));
const snapLine = el('p', { className: 'muted' });
const restoreBtn = el('button', { className: 'act', textContent: '恢复' });
const restoreMsg = el('span', { className: 'muted' });
queue.append(snapLine, el('div', { className: 'row' }, restoreBtn, restoreMsg));

async function renderQueue() {
  const local = await browser.storage.local.get([STATE_KEY, OUTBOX_KEY, SNAPSHOT_KEY]);
  const state = local[STATE_KEY] as { listId?: string; listName?: string; count?: number; updatedAt?: number } | undefined;
  listLine.replaceChildren();
  if (state?.listId) {
    const a = el('a', { href: `https://www.youtube.com/playlist?list=${encodeURIComponent(state.listId)}`, target: '_blank', rel: 'noopener', textContent: state.listName ?? state.listId });
    listLine.append('当前列表：', a, `，${state.count ?? 0} 个视频（${new Date(state.updatedAt ?? 0).toLocaleString()} 读取）`);
  } else {
    listLine.append(el('span', { className: 'muted', textContent: '还没有连上列表：打开一个 YouTube 标签页后会自动查找或创建。' }));
  }
  const outbox = (local[OUTBOX_KEY] as unknown[] | undefined) ?? [];
  outboxLine.textContent = `待发送的操作：${outbox.length}`;
  const snap = local[SNAPSHOT_KEY] as Snapshot | undefined;
  restoreBtn.disabled = !snap;
  snapLine.textContent = snap
    ? `${new Date(snap.time).toLocaleString()} 从「${snap.listName}」${snap.mode === 'all' ? '清空全部' : '移除已看完'}，共 ${snap.removed.length} 个视频。`
    : '还没有清空过。';
}

restoreBtn.addEventListener('click', async () => {
  const snap = (await browser.storage.local.get(SNAPSHOT_KEY))[SNAPSHOT_KEY] as Snapshot | undefined;
  if (!snap) return;
  const tabs = await browser.tabs.query({ url: 'https://www.youtube.com/*' });
  const tab = tabs.find((t) => t.active) ?? tabs[0];
  if (!tab?.id) {
    restoreMsg.textContent = '需要先打开一个 YouTube 标签页';
    return;
  }
  restoreBtn.disabled = true;
  restoreMsg.textContent = '恢复中…';
  try {
    const r = (await browser.tabs.sendMessage(tab.id, { type: 'yt++/queue-restore-snapshot', snapshot: snap }, { frameId: 0 })) as { ok: boolean; restored?: number; error?: string };
    restoreMsg.textContent = r.ok ? `已恢复 ${r.restored} 个视频` : `失败：${r.error}`;
  } catch {
    restoreMsg.textContent = '那个 YouTube 标签页里没有 yt++ 的脚本，刷新它再试';
  } finally {
    restoreBtn.disabled = false;
  }
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (STATE_KEY in changes || OUTBOX_KEY in changes || SNAPSHOT_KEY in changes)) void renderQueue();
});

const player = sections.get('player')!;
player.append(el('h2', { textContent: '子功能' }));
for (const k of Object.keys(PLAYER_LABEL) as (keyof PlayerSettings)[]) {
  player.append(checkbox(PLAYER_LABEL[k], settings.player[k], (v) => update((s) => { s.player[k] = v; })));
}
const resetPos = el('button', { className: 'act', textContent: '重置迷你播放器位置' });
resetPos.addEventListener('click', async () => {
  await browser.storage.local.remove(MINI_POS_KEY);
  resetPos.textContent = '已重置（下次出现时用官方默认位置）';
  setTimeout(() => (resetPos.textContent = '重置迷你播放器位置'), 2000);
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
if (logFilter) logBox.scrollIntoView();
if (initialFromHash === 'install') {
  history.replaceState(null, '', location.pathname);
  void runSelfCheck();
}
