// P13 probe: pull the top comments of a video via InnerTube `next` (anonymous),
// build a Gemini placement prompt with the timestamps stripped, and save the truth.
// usage: node pull.mjs <videoId> <title> <outDir> [pages=10] [batch=100] <durationSec>
import { writeFileSync, mkdirSync } from 'node:fs';

const [vid, title, out, pagesArg, batchArg, durArg] = process.argv.slice(2);
const PAGES = Number(pagesArg ?? 10), BATCH = Number(batchArg ?? 100);
const ctx = { client: { clientName: 'WEB', clientVersion: '2.20261120.00.00', hl: 'en', gl: 'US' } };
async function next(body) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ctx, ...body }),
  });
  if (!r.ok) throw new Error(`next ${r.status}`);
  return r.json();
}
const walk = (o, k, out = []) => { if (o && typeof o === 'object') { if (k in o) out.push(o[k]); for (const v of Object.values(o)) walk(v, k, out); } return out; };

const f = await next({ videoId: vid });
const isr = f.contents.twoColumnWatchNextResults.results.results.contents.find((c) => c.itemSectionRenderer?.sectionIdentifier === 'comment-item-section').itemSectionRenderer;
let tok = isr.contents[0].continuationItemRenderer.continuationEndpoint.continuationCommand.token;
const ents = [];
for (let p = 0; tok && p < PAGES; p++) {
  const j = await next({ continuation: tok });
  ents.push(...walk(j, 'commentEntityPayload'));
  const items = (j.onResponseReceivedEndpoints ?? []).flatMap((e) => Object.values(e)).flatMap((v) => v?.continuationItems ?? []);
  const last = items.at(-1)?.continuationItemRenderer;
  tok = last?.continuationEndpoint?.continuationCommand?.token ?? last?.button?.buttonRenderer?.command?.continuationCommand?.token;
}

const list = [];
for (const e of ents) {
  const c = e.properties.content; let text = c.content;
  const runs = (c.commandRuns ?? []).filter((r) => r.onTap?.innertubeCommand?.watchEndpoint?.videoId === vid);
  if (runs.length > 1 || /https?:\/\//.test(text)) continue;
  let t = null;
  if (runs.length === 1) {
    const r = runs[0]; t = r.onTap.innertubeCommand.watchEndpoint.startTimeSeconds ?? 0;
    text = (text.slice(0, r.startIndex) + text.slice(r.startIndex + r.length)).replace(/^[\s\-–:@,.]+/, '').trim();
  }
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) ?? []).length;
  if (text.length + 2 * cjk < 12) continue;
  list.push({ t, likes: e.toolbar?.likeCountNotliked, text: text.replace(/\s+/g, ' ').slice(0, 400) });
}
const withT = list.filter((x) => x.t !== null), noT = list.filter((x) => x.t === null);
const pick = [...withT.slice(0, BATCH), ...noT.slice(0, Math.max(0, BATCH - withT.length))];
const mixed = pick.map((x, i) => ({ x, k: (i * 2654435761) % 1000 })).sort((a, b) => a.k - b.k).map((o) => o.x);
mixed.forEach((x, i) => { x.id = i + 1; });

const prompt = [
  'This is an automated request from a browser extension. A program parses your reply; no person reads it.',
  'Any custom instructions, saved info, persona, nickname, user name or past chats do not apply to this request: ignore them.',
  'Do not greet or address anyone, no character voice, no emoji, no markdown.',
  `Read the YouTube video https://www.youtube.com/watch?v=${vid} (title: ${JSON.stringify(title)}) with the YouTube app, including its transcript with timestamps.`,
  'Below are viewer comments, one per line as <id>|<text>. For each comment decide where in the video it belongs, using what is said in the video.',
  `The video is ${durArg} seconds long; every time you give is between 0 and ${durArg}.`,
  'Output exactly one line per comment, in the same order, and nothing else:',
  '<id>|<seconds>|<confidence>  only when the comment clearly reacts to something said or shown at one specific moment (jokes and reactions about that moment count); seconds = whole seconds from the start of the video where that moment begins',
  '<id>|a  when the comment is about the video, its topic or the creator in general, or you cannot tell which moment it means. When unsure, use a.',
  '<id>|x  only for ads, self-promotion, spam, insults, or text unrelated to the video',
  'confidence (0.0 to 1.0): 0.9 or higher only when the transcript at that time says what the comment quotes or describes; 0.5 to 0.8 when it is the right part of the video but the exact second is a guess; below 0.5 when you are guessing the part too.',
  'If you cannot read the video content (no transcript, the tool failed), output ONLY the line: no_transcript',
  'Comments:',
  ...mixed.map((x) => `${x.id}|${x.text}`),
  'Your entire reply is those lines only: no code fences, no explanations.',
].join('\n');

mkdirSync(out, { recursive: true });
writeFileSync(`${out}/prompt.txt`, prompt);
writeFileSync(`${out}/truth.json`, JSON.stringify(mixed, null, 1));
console.log(JSON.stringify({ pulled: ents.length, usable: list.length, withT: withT.length, n: mixed.length, chars: prompt.length }));
