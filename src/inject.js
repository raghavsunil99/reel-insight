// Runs in the page's own JS world (MAIN). Reads the JSON Instagram already loads
// for the reels you watch, and passes the stats to content.js via postMessage.
// Read-only: it never likes, follows or posts anything.
(() => {
  if (window.__reelInsightHooked) return;
  window.__reelInsightHooked = true;

  const OUT = 'reel-insight';      // messages to content.js
  const IN = 'reel-insight-cs';    // requests from content.js
  const APP_ID = '936619743392459'; // Instagram web app id, sent by instagram.com itself
  const origFetch = window.fetch;

  const num = (v) =>
    typeof v === 'number' && isFinite(v) ? v
      : typeof v === 'string' && /^\d+$/.test(v) ? Number(v)
      : null;

  function pickMedia(o) {
    const code = o.code || o.shortcode;
    if (!code || typeof code !== 'string' || code.length < 5) return null;
    const views = num(o.play_count) ?? num(o.ig_play_count) ?? num(o.video_play_count) ??
      num(o.view_count) ?? num(o.video_view_count);
    const likes = num(o.like_count) ?? num(o.edge_media_preview_like?.count) ?? num(o.edge_liked_by?.count);
    const comments = num(o.comment_count) ?? num(o.edge_media_to_comment?.count) ??
      num(o.edge_media_preview_comment?.count);
    if (views == null && likes == null) return null;
    const user = o.user || o.owner || {};
    const caption = typeof o.caption === 'string' ? o.caption
      : (o.caption?.text ?? o.edge_media_to_caption?.edges?.[0]?.node?.text ?? '');
    const music = o.clips_metadata?.music_info?.music_asset_info;
    const orig = o.clips_metadata?.original_sound_info;
    const audio = music ? [music.title, music.display_artist].filter(Boolean).join(' · ')
      : orig ? 'Original audio' + (orig.ig_artist?.username ? ' · @' + orig.ig_artist.username : '')
      : null;
    return {
      code,
      views,
      likes,
      comments,
      shares: num(o.reshare_count) ?? num(o.share_count) ?? num(o.media_repost_count),
      saves: num(o.save_count),
      takenAt: num(o.taken_at) ?? num(o.taken_at_timestamp),
      duration: num(o.video_duration),
      username: user.username || null,
      userId: (user.pk ?? user.pk_id ?? user.id ?? null) != null ? String(user.pk ?? user.pk_id ?? user.id) : null,
      followers: num(user.follower_count) ?? num(user.edge_followed_by?.count),
      caption: caption || '',
      audio,
      likesHidden: o.like_and_view_counts_disabled === true ? true : null,
      isVideo: (o.media_type === 2 || o.is_video === true || o.product_type === 'clips' || views != null) || null,
    };
  }

  function pickUser(o) {
    if (typeof o.username !== 'string') return null;
    const f = num(o.follower_count) ?? num(o.edge_followed_by?.count);
    return f == null ? null : { username: o.username, followers: f };
  }

  function walk(node, out, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) { for (const x of node) walk(x, out, depth + 1); return; }
    const m = pickMedia(node); if (m) out.media.push(m);
    const u = pickUser(node); if (u) out.users.push(u);
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') walk(v, out, depth + 1);
    }
  }

  function parseLoose(text) {
    const t = text.replace(/^for \(;;\);/, '').trim();
    try { return [JSON.parse(t)]; } catch (_) { /* may be newline-delimited */ }
    const parts = [];
    for (const line of t.split('\n')) {
      const s = line.trim();
      if (!s.startsWith('{')) continue;
      try { parts.push(JSON.parse(s)); } catch (_) { /* skip */ }
    }
    return parts;
  }

  function handleJson(objs) {
    const out = { media: [], users: [] };
    for (const o of objs) walk(o, out);
    if (out.media.length || out.users.length) {
      window.postMessage({ source: OUT, type: 'data', media: out.media, users: out.users }, location.origin);
    }
  }

  function handleText(text) {
    if (typeof text !== 'string' || text.length < 20) return;
    if (!/"(code|shortcode)"/.test(text) && !text.includes('follower_count')) return;
    handleJson(parseLoose(text));
  }

  const interesting = (url) => /\/(graphql|api)\//.test(url || '');

  // 1. fetch responses
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (interesting(url)) res.clone().text().then(handleText).catch(() => {});
    } catch (_) { /* never break the page */ }
    return res;
  };

  // 2. XHR responses
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__riUrl = String(url);
    return origOpen.call(this, method, url, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (interesting(this.__riUrl)) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') handleText(this.responseText);
          else if (this.responseType === 'json' && this.response) handleJson([this.response]);
        } catch (_) { /* ignore */ }
      });
    }
    return origSend.apply(this, args);
  };

  // 3. Data embedded in the first page load
  function scanEmbedded() {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (s.__riDone) continue;
      s.__riDone = true;
      const t = s.textContent || '';
      if (t.includes('like_count') || t.includes('play_count') || t.includes('follower_count')) handleText(t);
    }
  }
  document.addEventListener('DOMContentLoaded', scanEmbedded);
  setTimeout(scanEmbedded, 1500);
  setTimeout(scanEmbedded, 4000);

  // ---- On-demand lookups requested by content.js (only for the reel/creator you open) ----
  const csrf = () => (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
  const headers = () => ({ 'x-ig-app-id': APP_ID, 'x-requested-with': 'XMLHttpRequest', 'x-csrftoken': csrf() });

  function codeToId(code) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let id = 0n;
    for (const c of code.slice(0, 11)) id = id * 64n + BigInt(A.indexOf(c));
    return id.toString();
  }

  async function fetchMedia(code) {
    try {
      const r = await origFetch(`/api/v1/media/${codeToId(code)}/info/`, { headers: headers(), credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const json = await r.json();
      const out = { media: [], users: [] };
      walk(json, out);
      if (!out.media.length) throw new Error('response lo stats levu');
      // the API may return a different (canonical) code; map the first item to the code we asked for
      out.media[0] = { ...out.media[0], code };
      window.postMessage({ source: OUT, type: 'data', media: out.media, users: out.users }, location.origin);
    } catch (e) {
      console.debug('[ReelInsight] media fetch failed', code, e);
      window.postMessage({ source: OUT, type: 'media-fail', code, error: String(e) }, location.origin);
    }
  }

  async function getJson(url, init = {}) {
    const r = await origFetch(url, { credentials: 'include', ...init, headers: { ...headers(), ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`${url.split('?')[0].replace(/\/\d{5,}\//, '/{id}/')} HTTP ${r.status}`);
    const t = await r.text();
    try { return JSON.parse(t); } catch (_) { throw new Error(`${url.split('?')[0]} not JSON (login?)`); }
  }
  const viewsOf = (m) => num(m?.play_count) ?? num(m?.ig_play_count) ?? num(m?.view_count) ?? num(m?.video_view_count);

  // Each step is optional; we keep whatever works and report what failed.
  let backoffUntil = 0;
  async function fetchProfile(username, userId) {
    const profile = { followers: null, recent: [], source: null, error: null };
    if (Date.now() < backoffUntil) {
      profile.error = `Instagram rate limit (429). ${Math.ceil((backoffUntil - Date.now()) / 60000)} min tarvata try cheyandi.`;
      window.postMessage({ source: OUT, type: 'profile', username, profile }, location.origin);
      return;
    }
    const errs = [];
    let timeline = [];

    // 1. user id + followers
    if (userId) {
      try {
        const u = (await getJson(`/api/v1/users/${userId}/info/`))?.user;
        profile.followers = num(u?.follower_count);
      } catch (e) { errs.push(e.message); }
    }
    if (!userId || profile.followers == null) {
      try {
        const user = (await getJson(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`))?.data?.user;
        if (!user) throw new Error('web_profile_info empty');
        userId = userId || user.id;
        profile.followers = profile.followers ?? num(user.edge_followed_by?.count);
        timeline = (user.edge_owner_to_timeline_media?.edges || []).map((e) => e.node).filter((n) => n?.is_video)
          .map((n) => ({ code: n.shortcode, views: num(n.video_view_count) }));
      } catch (e) { errs.push(e.message); }
    }

    // 2. recent reels: reels tab -> user feed -> profile timeline
    const keep = (list, src) => {
      const ok = list.filter((x) => x.code && x.views != null);
      if (!profile.recent.length && ok.length) { profile.recent = ok; profile.source = src; }
    };
    if (userId) {
      try {
        const body = new URLSearchParams({ target_user_id: userId, page_size: '12', include_feed_video: 'true' });
        const j = await getJson('/api/v1/clips/user/', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
        keep((j?.items || []).map((it) => it.media).filter(Boolean).map((m) => ({ code: m.code, views: viewsOf(m) })), 'reels');
      } catch (e) { errs.push(e.message); }
      if (!profile.recent.length) {
        try {
          const j = await getJson(`/api/v1/feed/user/${userId}/?count=12`);
          keep((j?.items || []).filter((m) => m.media_type === 2).map((m) => ({ code: m.code, views: viewsOf(m) })), 'feed');
          if (profile.followers == null) profile.followers = num(j?.user?.follower_count);
        } catch (e) { errs.push(e.message); }
      }
    }
    keep(timeline, 'timeline');

    if (errs.some((e) => e.includes('HTTP 429'))) backoffUntil = Date.now() + 15 * 60 * 1000;
    if (profile.followers == null || !profile.recent.length) profile.error = errs.join(' · ') || 'no data';
    console.debug('[ReelInsight] profile', username, profile);
    window.postMessage({ source: OUT, type: 'profile', username, profile }, location.origin);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== IN) return;
    if (e.data.type === 'fetch-media' && e.data.code) fetchMedia(e.data.code);
    if (e.data.type === 'fetch-profile' && e.data.username) fetchProfile(e.data.username, e.data.userId);
  });
})();
