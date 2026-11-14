// YouTube page world (MAIN): reads the player response YouTube already has for the current
// video (watch page or Shorts) and passes it to yt.js. Read-only, no network requests.
(() => {
  if (window.__reelInsightYt) return;
  window.__reelInsightYt = true;

  const num = (v) => (v != null && /^\d+$/.test(String(v)) ? Number(v) : null);
  let lastKey = '';

  function currentId() {
    const u = new URL(location.href);
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
    if (u.pathname === '/watch') return u.searchParams.get('v');
    return null;
  }

  function playerResponses() {
    const out = [];
    for (const id of ['shorts-player', 'movie_player']) {
      try { const r = document.getElementById(id)?.getPlayerResponse?.(); if (r) out.push(r); } catch (_) { /* ignore */ }
    }
    if (window.ytInitialPlayerResponse) out.push(window.ytInitialPlayerResponse);
    return out;
  }

  function scan() {
    const id = currentId();
    if (!id) return;
    const pr = playerResponses().find((r) => r?.videoDetails?.videoId === id);
    if (!pr) return;
    const d = pr.videoDetails;
    const mf = pr.microformat?.playerMicroformatRenderer || {};
    const data = {
      videoId: id,
      views: num(d.viewCount),
      lengthSeconds: num(d.lengthSeconds),
      title: d.title || '',
      author: d.author || mf.ownerChannelName || '',
      channelId: d.channelId || mf.externalChannelId || null,
      description: (d.shortDescription || '').slice(0, 600),
      published: mf.publishDate || mf.uploadDate || null,
      isLive: !!d.isLiveContent,
    };
    const key = JSON.stringify(data);
    if (key === lastKey) return;
    lastKey = key;
    window.postMessage({ source: 'reel-insight-yt', type: 'video', data }, location.origin);
  }

  setInterval(scan, 1000);
  document.addEventListener('yt-navigate-finish', () => setTimeout(scan, 300));
})();
