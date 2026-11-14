// YouTube card: Shorts and long videos. Stats come from the YouTube Data API (user's key, via
// background.js) when available, otherwise from what the page already shows.
(() => {
  const RI = globalThis.ReelInsight;
  const { IC, CSS, esc } = globalThis.ReelInsightUI;

  const videos = new Map();   // videoId -> merged stats
  const lookups = new Map();  // videoId -> 'pending' | result
  let currentId = null, isShort = false;
  let ui = { collapsed: false, pos: null };
  let settings = { autoLog: true, threshold: 65, youtubeKey: '' };
  let swipeCodes = new Set();
  let dismissed = null, lastRender = '';
  const logged = new Map();

  const alive = () => { try { return !!chrome.runtime?.id; } catch (_) { return false; } };
  const codeOf = (id) => 'yt:' + id;
  const urlOf = (id, short) => (short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`);
  const parseCount = (t) => {
    const m = String(t || '').replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
    if (!m) return null;
    return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1));
  };
  const dur = (s) => (s == null ? '' : s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

  // ---------- storage ----------
  async function loadStorage() {
    if (!alive()) return;
    const st = await chrome.storage.local.get(['swipe', 'settings', 'ytui']);
    swipeCodes = new Set((st.swipe || []).map((s) => s.code));
    settings = { ...settings, ...(st.settings || {}) };
    ui = { collapsed: !!st.ytui?.collapsed, pos: st.ytui?.pos || null };
    applyPos(); lastRender = ''; refresh();
  }
  const saveUi = () => { if (alive()) chrome.storage.local.set({ ytui: ui }); };
  if (alive()) chrome.storage.onChanged.addListener((ch) => {
    if (ch.settings) {
      const had = settings.youtubeKey;
      settings = { ...settings, ...(ch.settings.newValue || {}) };
      if (!had && settings.youtubeKey) { lookups.clear(); }
      lastRender = ''; refresh();
    }
    if (ch.swipe) { swipeCodes = new Set((ch.swipe.newValue || []).map((s) => s.code)); lastRender = ''; refresh(); }
  });

  // ---------- data ----------
  function merge(id, data) {
    const prev = videos.get(id) || {};
    const next = { ...prev };
    for (const [k, v] of Object.entries(data)) if (v != null && v !== '') next[k] = v;
    videos.set(id, next);
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'reel-insight-yt' || e.data.type !== 'video') return;
    const d = e.data.data;
    merge(d.videoId, { ...d, takenAt: d.published ? Date.parse(d.published) / 1000 : null });
    refresh();
  });

  // What the page shows (fallback when there is no API key)
  function scanDom() {
    if (!currentId) return;
    const out = {};
    const num = (el) => {
      if (!el) return null;
      const label = el.getAttribute('aria-label') || '';
      const big = (label.replace(/,/g, '').match(/\d+/g) || []).map(Number).sort((a, b) => b - a)[0];
      return big ?? parseCount(el.textContent);
    };
    if (isShort) {
      const active = document.querySelector('ytd-reel-video-renderer[is-active], .reel-video-in-sequence-new[is-active]') || document;
      out.likes = num(active.querySelector('#like-button button, like-button-view-model button'));
      out.comments = parseCount(active.querySelector('#comments-button .yt-spec-button-shape-with-label__label, #comments-button')?.textContent);
    } else {
      out.likes = num(document.querySelector('ytd-watch-metadata like-button-view-model button, ytd-watch-metadata #segmented-like-button button'));
      out.subs = parseCount(document.querySelector('ytd-watch-metadata #owner-sub-count, #owner-sub-count')?.textContent);
      out.comments = parseCount(document.querySelector('ytd-comments-header-renderer #count')?.textContent);
    }
    const before = JSON.stringify(videos.get(currentId) || {});
    merge(currentId, out);
    if (JSON.stringify(videos.get(currentId)) !== before) refresh();
  }
  setInterval(scanDom, 1500);

  function lookup(id) {
    if (!settings.youtubeKey || lookups.has(id) || !alive()) return;
    lookups.set(id, 'pending');
    chrome.runtime.sendMessage({ type: 'yt-lookup', videoId: id, channelId: videos.get(id)?.channelId }, (res) => {
      if (chrome.runtime.lastError) res = { error: chrome.runtime.lastError.message };
      lookups.set(id, res || { error: 'no response' });
      if (res?.video) merge(id, { ...res.video, takenAt: Date.parse(res.video.publishedAt) / 1000, subs: res.base?.subs });
      lastRender = ''; refresh();
    });
  }

  function baselineFor(id, m) {
    const l = lookups.get(id);
    const res = l && l !== 'pending' ? l : null;
    const short = isShort || (m.lengthSeconds != null && m.lengthSeconds <= 60);
    const others = (res?.base?.recent || []).filter((v) => v.id !== id && v.short === short && v.views != null).map((v) => v.views);
    return {
      followers: res?.base?.subs ?? m.subs ?? null,
      median: RI.median(others),
      sampleSize: others.length,
      pending: l === 'pending',
      error: res?.baseError || res?.videoError || (res?.error && res.error !== 'nokey' ? res.error : null),
    };
  }

  // ---------- routing ----------
  let lastHref = '';
  function checkRoute() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    const u = new URL(location.href);
    isShort = u.pathname.startsWith('/shorts/');
    currentId = isShort ? u.pathname.split('/')[2] || null : u.pathname === '/watch' ? u.searchParams.get('v') : null;
    lastRender = '';
    applyTheme();
    refresh();
  }
  setInterval(checkRoute, 400);
  document.addEventListener('yt-navigate-finish', checkRoute);

  function refresh() {
    if (!host) return;
    if (!currentId || dismissed === currentId) { host.style.display = 'none'; return; }
    lookup(currentId);
    render(videos.get(currentId));
  }

  // ---------- auto log / save ----------
  function makeEntry(id, m, base, s) {
    return {
      code: codeOf(id), platform: isShort ? 'yt-short' : 'yt-long', url: urlOf(id, isShort), username: m.author,
      views: m.views, likes: m.likes, comments: m.comments, shares: null, followers: base.followers,
      creatorMedian: base.median, outlier: s.metrics.outlierMedian ?? s.metrics.outlierFollowers ?? null,
      er: s.metrics.er ?? null, score: s.score, verdict: s.verdict, caption: m.title || '',
      duration: m.lengthSeconds ?? null, takenAt: m.takenAt || null, savedAt: Date.now(),
    };
  }
  let logQueue = Promise.resolve();
  function autoLog(id, m, base, s) {
    if (!settings.autoLog || s.score < settings.threshold || s.verdict !== 'recreate' || logged.get(id) === s.score) return;
    logged.set(id, s.score);
    const entry = makeEntry(id, m, base, s);
    logQueue = logQueue.then(async () => {
      if (!alive()) return;
      const { autolog = [] } = await chrome.storage.local.get('autolog');
      const i = autolog.findIndex((x) => x.code === entry.code);
      if (i >= 0) autolog.splice(i, 1, { ...entry, savedAt: autolog[i].savedAt }); else autolog.unshift(entry);
      await chrome.storage.local.set({ autolog: autolog.slice(0, 500) });
    }).catch(() => {});
  }

  // ---------- UI ----------
  let host, root;
  function mount() {
    host = document.createElement('div');
    host.id = 'reel-insight-yt-host';
    host.style.cssText = 'position:fixed;z-index:2147483646;display:none;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="ri"><div class="card"></div></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('mousedown', onDragStart);
    document.documentElement.appendChild(host);
    applyPos(); applyTheme();
  }
  function applyTheme() {
    const dark = document.documentElement.hasAttribute('dark') || matchMedia('(prefers-color-scheme: dark)').matches && !document.documentElement.hasAttribute('light');
    root?.querySelector('.ri')?.classList.toggle('dark', dark);
  }
  function applyPos() {
    if (!host) return;
    if (ui.pos) {
      Object.assign(host.style, { left: Math.min(Math.max(ui.pos.x, 0), innerWidth - 120) + 'px',
        top: Math.min(Math.max(ui.pos.y, 0), innerHeight - 50) + 'px', right: 'auto' });
    } else Object.assign(host.style, { left: 'auto', top: '72px', right: '16px' });
  }
  function onDragStart(e) {
    if (!e.target.closest('.drag') || e.target.closest('button')) return;
    e.preventDefault();
    const r = host.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => { ui.pos = { x: ev.clientX - dx, y: ev.clientY - dy }; applyPos(); };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); saveUi(); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  }

  function header(m, s) {
    const kind = isShort ? 'YouTube Short' : `YouTube video${m?.lengthSeconds ? ' · ' + dur(m.lengthSeconds) : ''}`;
    const badge = ui.collapsed && s ? `<span class="badge ${s.verdict}"><i class="dot"></i>${s.score}</span>` : '';
    return `<div class="head drag">
      <div class="logo yt">YT</div>
      <div class="who"><div class="name">${esc(m?.author || 'Reel Insight')}</div><div class="sub">${kind}</div></div>
      ${badge}
      <button class="icon-btn" data-act="collapse" title="${ui.collapsed ? 'Expand' : 'Minimize'}">${ui.collapsed ? IC.expand : IC.minus}</button>
      <button class="icon-btn" data-act="close" title="Ee video ki hide cheyi">${IC.x}</button>
    </div>`;
  }

  function render(m) {
    host.style.display = 'block';
    const card = root.querySelector('.card');
    let html;
    if (!m || m.views == null) {
      html = header(m) + (ui.collapsed ? '' : `<div class="body"><div class="skeleton w60"></div><div class="skeleton w40"></div>
        <div class="muted small">Video stats load avutunnayi…</div></div>`);
    } else {
      const base = baselineFor(currentId, m);
      const s = RI.scoreReel(m, base);
      autoLog(currentId, m, base, s);
      const saved = swipeCodes.has(codeOf(currentId));
      if (ui.collapsed) html = header(m, s);
      else {
        const cell = (label, val, note = '') =>
          `<div class="cell"><div class="label">${label}</div><div class="value">${val}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
        const om = s.metrics.outlierMedian, of = s.metrics.outlierFollowers;
        const outlier = om != null ? RI.times(om) : of != null ? RI.times(of) : '—';
        const outlierNote = om != null ? `vs channel ${isShort ? 'Shorts' : 'videos'} avg` : of != null ? 'vs subscribers' : base.pending ? 'loading…' : '';
        const likeRate = m.likes != null ? m.likes / m.views : null;
        const commentRate = m.comments != null ? m.comments / m.views : null;
        // YouTube has no public shares; the Instagram-style comment-bait check does not apply here
        const warnings = s.warnings.filter((w) => !w.startsWith('Comments likes kanna'));
        html = header(m, s) + `
          <div class="body">
            ${m.title ? `<div class="vtitle">${esc(m.title)}</div>` : ''}
            <div class="verdict">
              <span class="badge lg ${s.verdict}"><i class="dot"></i>${s.label}</span>
              <span class="score"><b>${s.score}</b><span class="muted">/100</span></span>
            </div>
            <div class="progress"><div class="bar ${s.verdict}" style="width:${s.score}%"></div></div>
            <div class="grid3">
              ${cell('Views', RI.fmt(m.views))}
              ${cell('Likes', RI.fmt(m.likes))}
              ${cell('Comments', RI.fmt(m.comments))}
              ${cell('Subscribers', RI.fmt(base.followers))}
              ${cell('Like rate', RI.pct(likeRate))}
              ${cell('Comment rate', commentRate != null ? (commentRate * 100).toFixed(2) + '%' : '—')}
            </div>
            <div class="grid3 metrics">
              ${cell('Outlier', outlier, outlierNote)}
              ${cell('Engagement', RI.pct(s.metrics.er))}
              ${cell('Views/day', RI.fmt(s.metrics.perDay), s.metrics.ageDays != null ? Math.max(1, Math.round(s.metrics.ageDays)) + 'd old' : '')}
            </div>
            ${s.reasons.length ? `<ul class="list">${s.reasons.map((x) => x
              .replace('normal reels', isShort ? 'normal Shorts' : 'normal videos')
              .replace('Fresh reel', isShort ? 'Fresh Short' : 'Fresh video')
              .replace('Views = followers ki', 'Views = subscribers ki').replace(' followers)', ' subscribers)')).map((x) => `<li>${IC.check}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
            ${warnings.length ? `<div class="alert warn">${IC.alert}<div>${warnings.map(esc).join('<br>')}${base.error ? `<div class="errline">${esc(base.error)}</div>` : ''}</div></div>` : ''}
            ${!settings.youtubeKey ? `<div class="hint muted">${IC.alert}<span>Channel avg tho outlier, exact likes/comments kosam
              <button class="link" data-act="settings">YouTube API key pettandi</button> (free).</span></div>` : ''}
          </div>
          <div class="foot">
            <button class="btn outline ${saved ? 'saved' : ''}" data-act="save">${saved ? IC.bookmarkOn + ' Saved' : IC.bookmark + ' Save'}</button>
            <button class="btn primary" data-act="remake">${IC.clap} ${isShort ? 'Remake' : 'Remake script'}</button>
          </div>`;
      }
    }
    if (html !== lastRender) { card.innerHTML = html + '<div class="toast"></div>'; lastRender = html; }
  }

  function toast(text) {
    const t = root.querySelector('.toast');
    if (!t) return;
    t.textContent = text; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    }
  }

  async function onClick(e) {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    if (act === 'close') { dismissed = currentId; refresh(); return; }
    if (act === 'collapse') { ui.collapsed = !ui.collapsed; lastRender = ''; saveUi(); refresh(); return; }
    if (act === 'settings') { if (alive()) chrome.runtime.sendMessage({ type: 'open-options' }); return; }
    const m = videos.get(currentId);
    if (!m) return;
    const url = urlOf(currentId, isShort);
    if (act === 'remake') {
      const cmd = isShort ? `/reel-remake ${url}` : `/yt-script Ee YouTube video ni Telugu audience kosam remake cheyali (same topic, mana angle): ${url}`;
      const ok = await copy(cmd);
      toast(ok ? 'Copied! Reel Studio lo paste cheyandi.' : 'Copy fail ayyindi.');
    }
    if (act === 'save') {
      if (!alive()) { toast('Extension reload ayyindi, page refresh cheyandi.'); return; }
      const { swipe = [] } = await chrome.storage.local.get('swipe');
      const code = codeOf(currentId);
      const i = swipe.findIndex((x) => x.code === code);
      let msg;
      if (i >= 0) { swipe.splice(i, 1); msg = 'Swipe file nunchi teesesam.'; }
      else {
        const base = baselineFor(currentId, m);
        swipe.unshift(makeEntry(currentId, m, base, RI.scoreReel(m, base)));
        msg = 'Swipe file lo save ayyindi.';
      }
      await chrome.storage.local.set({ swipe });
      swipeCodes = new Set(swipe.map((x) => x.code));
      lastRender = ''; refresh(); toast(msg);
    }
  }

  mount();
  loadStorage();
  checkRoute();
})();
