// P13 probe: search, keep videos with Chinese captions, count single-timestamp
// comments in the first 300. usage: node find.mjs <query>...
const ctx = { client: { clientName: 'WEB', clientVersion: '2.20261120.00.00', hl: 'en', gl: 'US' } };
const post = async (ep, body) => (await fetch(`https://www.youtube.com/youtubei/v1/${ep}?prettyPrint=false`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ctx, ...body }) })).json();
const walk = (o, k, out = []) => { if (o && typeof o === 'object') { if (k in o) out.push(o[k]); for (const v of Object.values(o)) walk(v, k, out); } return out; };
async function caps(id) { const h = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`)).text(); const m = h.match(/"captionTracks":(\[.*?\])/); return m ? JSON.parse(m[1]).map((t) => `${t.languageCode}${t.kind === 'asr' ? '(a)' : ''}`).join(',') : ''; }
for (const q of process.argv.slice(2)) {
  const s = await post('search', { query: q, params: 'EgQQARgD' });
  for (const v of walk(s, 'videoRenderer').slice(0, 5)) {
    const c = await caps(v.videoId); if (!/zh/.test(c)) { console.log(`skip ${v.videoId} caps=${c || '-'}`); continue; }
    const f = await post('next', { videoId: v.videoId });
    const isr = f.contents?.twoColumnWatchNextResults?.results?.results?.contents?.find((x) => x.itemSectionRenderer?.sectionIdentifier === 'comment-item-section')?.itemSectionRenderer;
    let tok = isr?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token; let n = 0, ts = 0;
    for (let p = 0; tok && p < 15; p++) {
      const j = await post('next', { continuation: tok });
      for (const e of walk(j, 'commentEntityPayload')) { n++; if ((e.properties.content.commandRuns ?? []).filter((r) => r.onTap?.innertubeCommand?.watchEndpoint?.videoId === v.videoId).length === 1) ts++; }
      const items = (j.onResponseReceivedEndpoints ?? []).flatMap((e) => Object.values(e)).flatMap((x) => x?.continuationItems ?? []);
      const last = items.at(-1)?.continuationItemRenderer; tok = last?.continuationEndpoint?.continuationCommand?.token ?? last?.button?.buttonRenderer?.command?.continuationCommand?.token;
    }
    console.log(`${v.videoId} ${v.lengthText?.simpleText} caps=${c} n=${n} ts=${ts} ${v.title?.runs?.[0]?.text}`);
  }
}
