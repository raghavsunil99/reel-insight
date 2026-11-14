// Service worker: YouTube Data API v3 calls (official API, uses the user's own key).
const API = 'https://www.googleapis.com/youtube/v3/';
const BASE_TTL = 6 * 3600 * 1000;

async function api(path, params, key) {
  const qs = new URLSearchParams({ ...params, key });
  const r = await fetch(API + path + '?' + qs);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`YouTube API ${path}: ${j?.error?.message || 'HTTP ' + r.status}`);
  return j;
}

// "PT1H2M3S" -> seconds
function isoDur(s) {
  const m = String(s || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
const n = (v) => (v == null ? null : Number(v));

async function videoInfo(videoId, key) {
  const j = await api('videos', { id: videoId, part: 'snippet,statistics,contentDetails' }, key);
  const v = j.items?.[0];
  if (!v) throw new Error('Video dorakaledu');
  return {
    videoId,
    views: n(v.statistics.viewCount), likes: n(v.statistics.likeCount), comments: n(v.statistics.commentCount),
    title: v.snippet.title, author: v.snippet.channelTitle, channelId: v.snippet.channelId,
    publishedAt: v.snippet.publishedAt, lengthSeconds: isoDur(v.contentDetails.duration),
    description: (v.snippet.description || '').slice(0, 600), tags: (v.snippet.tags || []).slice(0, 15),
  };
}

async function channelBaseline(channelId, key) {
  const cacheKey = 'ytbase:' + channelId;
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
  if (cached && Date.now() - cached.ts < BASE_TTL) return cached;

  const c = (await api('channels', { id: channelId, part: 'statistics,contentDetails' }, key)).items?.[0];
  if (!c) throw new Error('Channel dorakaledu');
  const subs = c.statistics.hiddenSubscriberCount ? null : n(c.statistics.subscriberCount);
  const uploads = c.contentDetails.relatedPlaylists.uploads;
  const pl = await api('playlistItems', { playlistId: uploads, part: 'contentDetails', maxResults: '50' }, key);
  const ids = (pl.items || []).map((i) => i.contentDetails.videoId);
  const recent = [];
  for (let i = 0; i < ids.length; i += 50) {
    const vs = await api('videos', { id: ids.slice(i, i + 50).join(','), part: 'statistics,contentDetails,snippet' }, key);
    for (const v of vs.items || []) {
      const secs = isoDur(v.contentDetails.duration);
      // skip videos younger than 3 days: their views are still climbing
      if (Date.now() - Date.parse(v.snippet.publishedAt) < 3 * 86400000) continue;
      recent.push({ id: v.id, views: n(v.statistics.viewCount), short: secs != null && secs <= 180 });
    }
  }
  const out = { ts: Date.now(), subs, recent };
  await chrome.storage.local.set({ [cacheKey]: out });
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'yt-lookup') return;
  (async () => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    const key = settings.youtubeKey;
    if (!key) return { error: 'nokey' };
    const res = {};
    try { res.video = await videoInfo(msg.videoId, key); } catch (e) { res.videoError = e.message; }
    const ch = res.video?.channelId || msg.channelId;
    if (ch) { try { res.base = await channelBaseline(ch, key); } catch (e) { res.baseError = e.message; } }
    return res;
  })().then(reply, (e) => reply({ error: e.message }));
  return true;
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'yt-key-test') return;
  api('videos', { id: 'dQw4w9WgXcQ', part: 'id' }, msg.key).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e.message }));
  return true;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'open-options') chrome.runtime.openOptionsPage();
});
