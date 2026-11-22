// P13 probe: list the caption tracks of videos (watch page HTML). usage: node caps.mjs <videoId>...
for (const id of process.argv.slice(2)) {
  const h = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { 'Accept-Language': 'en' } })).text();
  const m = h.match(/"captionTracks":(\[.*?\])/);
  const tracks = m ? JSON.parse(m[1]).map((t) => `${t.languageCode}${t.kind === 'asr' ? '(auto)' : ''}`) : [];
  const title = h.match(/<title>(.*?)<\/title>/)?.[1];
  console.log(id, tracks.join(',') || 'NONE', '|', title);
}
