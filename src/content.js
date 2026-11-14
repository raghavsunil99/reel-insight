// Isolated-world content script: keeps the stats cache, scores the reel and draws the card.
(() => {
  const RI = globalThis.ReelInsight;
  const IN = 'reel-insight';
  const OUT = 'reel-insight-cs';
  const PROFILE_TTL = 6 * 3600 * 1000;
  const FETCH_DELAY = 1200; // give Instagram's own requests a moment before we ask directly
  const MAX_TRIES = 2;

  const cache = new Map();         // code -> media stats
  const followersSeen = new Map(); // username -> followers
  const profiles = new Map();      // username -> profile | 'pending'
  const tries = new Map();         // code -> number of direct fetches sent
  const pendingFetch = new Map();  // code -> timer id (never reset by refresh)
  const errors = new Map();        // code -> last error text
  let currentCode = null;
  let ui = { collapsed: false, pos: null };
  let dismissed = null;
  let swipeCodes = new Set();
  let lastRender = '';

  const alive = () => { try { return !!chrome.runtime?.id; } catch (_) { return false; } };

  // ---------- storage ----------
  async function loadStorage() {
    if (!alive()) return;
    const { swipe = [], profiles: saved = {}, ui: savedUi = {} } = await chrome.storage.local.get(['swipe', 'profiles', 'ui']);
    swipeCodes = new Set(swipe.map((s) => s.code));
    const { settings: st = {} } = await chrome.storage.local.get('settings');
    settings = { ...settings, ...st };
    ui = { collapsed: !!savedUi.collapsed, pos: savedUi.pos || null };
    applyPos();
    const now = Date.now();
    for (const [u, p] of Object.entries(saved)) if (now - p.ts < PROFILE_TTL) profiles.set(u, p);
    const { followers: fol = {} } = await chrome.storage.local.get('followers');
    for (const [u, v] of Object.entries(fol)) if (now - v.ts < 7 * 86400000 && !followersSeen.has(u)) followersSeen.set(u, v.n);
    lastRender = '';
    refresh();
  }
  const saveUi = () => { if (alive()) chrome.storage.local.set({ ui }); };
  async function saveProfile(username, p) {
    if (!alive()) return;
    const { profiles: saved = {} } = await chrome.storage.local.get('profiles');
    const now = Date.now();
    for (const k of Object.keys(saved)) if (now - saved[k].ts > PROFILE_TTL) delete saved[k];
    saved[username] = { ...p, ts: now };
    await chrome.storage.local.set({ profiles: saved });
  }
  if (alive()) chrome.storage.onChanged?.addListener((ch) => {
    if (ch.settings) settings = { ...settings, ...(ch.settings.newValue || {}) };
    if (ch.swipe) { swipeCodes = new Set((ch.swipe.newValue || []).map((s) => s.code)); lastRender = ''; refresh(); }
  });

  // ---------- messages from inject.js ----------
  function merge(m) {
    const prev = cache.get(m.code) || {};
    const next = { ...prev };
    for (const [k, v] of Object.entries(m)) if (v != null && v !== '') next[k] = v;
    cache.set(m.code, next);
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== IN) return;
    const d = e.data;
    if (d.type === 'data') {
      for (const m of d.media || []) { merge(m); errors.delete(m.code); }
      for (const u of d.users || []) followersSeen.set(u.username, u.followers);
      refresh();
    } else if (d.type === 'profile') {
      profiles.set(d.username, d.profile);
      if (!d.profile.error) saveProfile(d.username, d.profile);
      refresh();
    } else if (d.type === 'media-fail') {
      errors.set(d.code, d.error || 'unknown error');
      refresh();
    }
  });

  // ---------- routing ----------
  const codeFromPath = (p) => (p.match(/^\/(?:[^/]+\/)?(?:reels?|p)\/([A-Za-z0-9_-]{5,})/) || [])[1] || null;
  let lastHref = '';
  function checkRoute() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    currentCode = codeFromPath(location.pathname);
    lastRender = '';
    applyTheme();
    refresh();
  }
  setInterval(checkRoute, 400);

  // Followers from the profile page itself (no API call): header link or og:description meta
  const parseCount = (t) => {
    const m = String(t || '').replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
    if (!m) return null;
    return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1));
  };
  async function scanProfilePage() {
    const u = (location.pathname.match(/^\/([A-Za-z0-9._]+)\/(?:reels\/|tagged\/)?$/) || [])[1];
    if (!u || ['explore', 'reels', 'direct', 'accounts', 'stories'].includes(u)) return;
    let n = null;
    const link = document.querySelector(`a[href="/${u}/followers/"]`);
    if (link) n = parseCount(link.querySelector('[title]')?.getAttribute('title')) ?? parseCount(link.textContent);
    if (n == null) {
      const meta = document.querySelector('meta[property="og:description"], meta[name="description"]')?.content || '';
      const mm = meta.match(/([\d.,]+\s*[KMB]?)\s+Followers/i);
      if (mm) n = parseCount(mm[1]);
    }
    if (n == null || followersSeen.get(u) === n) return;
    followersSeen.set(u, n);
    if (alive()) {
      const { followers: f = {} } = await chrome.storage.local.get('followers');
      f[u] = { n, ts: Date.now() };
      await chrome.storage.local.set({ followers: f });
    }
  }
  setInterval(scanProfilePage, 1500);
  window.addEventListener('popstate', checkRoute);

  // ---------- core ----------
  const hasViews = (m) => m && m.views != null;

  function baselineFor(m) {
    const p = m.username ? profiles.get(m.username) : null;
    const prof = p && p !== 'pending' ? p : null;
    let others = (prof?.recent || []).filter((x) => x.code !== m.code).map((x) => x.views);
    let source = prof?.source || null;
    if (others.length < 4) {
      // passive fallback: other reels of this creator that Instagram already loaded while you browsed
      const seen = [...cache.values()].filter((x) => x.username === m.username && x.code !== m.code && x.views != null).map((x) => x.views);
      if (seen.length >= 4) { others = seen; source = 'seen'; }
    }
    return {
      followers: m.followers ?? followersSeen.get(m.username) ?? prof?.followers ?? null,
      median: RI.median(others),
      sampleSize: others.length,
      source,
      error: prof?.error || null,
      pending: p === 'pending',
    };
  }

  function requestMedia(code, delay) {
    if (pendingFetch.has(code) || (tries.get(code) || 0) >= MAX_TRIES) return;
    pendingFetch.set(code, setTimeout(() => {
      pendingFetch.delete(code);
      if (hasViews(cache.get(code))) return;
      tries.set(code, (tries.get(code) || 0) + 1);
      errors.delete(code);
      window.postMessage({ source: OUT, type: 'fetch-media', code }, location.origin);
    }, delay));
  }

  function refresh() {
    if (!host) return;
    if (!currentCode || dismissed === currentCode) { host.style.display = 'none'; return; }
    const m = cache.get(currentCode);

    if (!hasViews(m)) {
      const n = tries.get(currentCode) || 0;
      if (n === 0) requestMedia(currentCode, FETCH_DELAY);
      else if (errors.has(currentCode)) requestMedia(currentCode, 2500); // one automatic retry
    }
    // No automatic profile API calls: Instagram rate-limits them (HTTP 429). Baseline comes from
    // reels Instagram already loaded, or from the "Load baseline" button.
    render(m);
  }

  // ---------- theme / position ----------
  function isDarkPage() {
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      const c = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || []).map(Number);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0)) return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 128;
    }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function applyTheme() { root?.querySelector('.ri')?.classList.toggle('dark', isDarkPage()); }
  function applyPos() {
    if (!host) return;
    if (ui.pos) {
      const x = Math.min(Math.max(ui.pos.x, 0), innerWidth - 120);
      const y = Math.min(Math.max(ui.pos.y, 0), innerHeight - 50);
      Object.assign(host.style, { left: x + 'px', top: y + 'px', right: 'auto' });
    } else {
      Object.assign(host.style, { left: 'auto', top: '72px', right: '16px' });
    }
  }

  // ---------- UI ----------
  let host, root;
  function mount() {
    host = document.createElement('div');
    host.id = 'reel-insight-host';
    host.style.cssText = 'position:fixed;z-index:2147483646;display:none;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="ri"><div class="card"></div></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('mousedown', onDragStart);
    document.documentElement.appendChild(host);
    applyPos();
    applyTheme();
  }

  function onDragStart(e) {
    if (!e.target.closest('.drag') || e.target.closest('button')) return;
    e.preventDefault();
    const r = host.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => { ui.pos = { x: ev.clientX - dx, y: ev.clientY - dy }; applyPos(); };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); saveUi(); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // ---------- auto log ----------
  let settings = { autoLog: true, threshold: 65 };
  const logged = new Map(); // code -> score last written
  function makeEntry(code, m, base, s) {
    return {
      code, url: reelUrl(code), username: m.username, views: m.views, likes: m.likes, comments: m.comments,
      shares: m.shares ?? null, followers: base.followers, creatorMedian: base.median,
      outlier: s.metrics.outlierMedian ?? s.metrics.outlierFollowers ?? null, er: s.metrics.er ?? null,
      score: s.score, verdict: s.verdict, caption: (m.caption || '').slice(0, 300), audio: m.audio || null,
      takenAt: m.takenAt || null, savedAt: Date.now(),
    };
  }
  let logQueue = Promise.resolve();
  function autoLog(m, base, s) {
    const code = currentCode;
    if (!settings.autoLog || s.score < settings.threshold || s.verdict !== 'recreate' || logged.get(code) === s.score) return;
    logged.set(code, s.score);
    const entry = makeEntry(code, m, base, s);
    logQueue = logQueue.then(async () => {
      if (!alive()) return;
      const { autolog = [] } = await chrome.storage.local.get('autolog');
      const i = autolog.findIndex((x) => x.code === code);
      if (i >= 0) autolog.splice(i, 1, { ...entry, savedAt: autolog[i].savedAt });
      else autolog.unshift(entry);
      await chrome.storage.local.set({ autolog: autolog.slice(0, 500) });
    }).catch(() => {});
  }

  const reelUrl = (code) => `https://www.instagram.com/reel/${code}/`;

  const { IC, CSS } = globalThis.ReelInsightUI;

  function header(m, s) {
    const who = m?.username ? '@' + esc(m.username) : 'Reel Insight';
    const sub = m?.username ? 'Reel Insight' : 'Instagram reel stats';
    const badge = ui.collapsed && s ? `<span class="badge ${s.verdict}"><i class="dot"></i>${s.score}</span>` : '';
    return `<div class="head drag">
      <div class="logo">RI</div>
      <div class="who"><div class="name">${who}</div><div class="sub">${sub}</div></div>
      ${badge}
      <button class="icon-btn" data-act="collapse" title="${ui.collapsed ? 'Expand' : 'Minimize'}">${ui.collapsed ? IC.expand : IC.minus}</button>
      <button class="icon-btn" data-act="close" title="Ee reel ki hide cheyi">${IC.x}</button>
    </div>`;
  }

  function render(m) {
    host.style.display = 'block';
    const card = root.querySelector('.card');
    let html;
    if (!hasViews(m)) {
      const n = tries.get(currentCode) || 0;
      const err = errors.get(currentCode);
      const failed = err && n >= MAX_TRIES;
      const notVideo = m && m.likes != null && !m.isVideo && n >= 1 && !pendingFetch.has(currentCode);
      html = header(m) + (ui.collapsed ? '' : notVideo
        ? `<div class="body"><div class="muted">Idi photo post, views undavu. Reels ki matrame verdict vastundi.</div></div>`
        : failed
        ? `<div class="body"><div class="alert">${IC.alert}<div><b>Stats load avvaledu</b><div class="muted">${esc(err)}</div></div></div>
           <button class="btn outline full" data-act="retry">${IC.refresh} Retry</button></div>`
        : `<div class="body"><div class="skeleton w60"></div><div class="skeleton w40"></div>
           <div class="grid3">${'<div class="cell"><div class="skeleton w50"></div><div class="skeleton w70"></div></div>'.repeat(3)}</div>
           <div class="muted small">Stats load avutunnayi…</div></div>`);
    } else {
      const base = baselineFor(m);
      const s = RI.scoreReel(m, base);
      autoLog(m, base, s);
      const saved = swipeCodes.has(currentCode);
      if (ui.collapsed) html = header(m, s);
      else {
        const cell = (label, val, note = '') =>
          `<div class="cell"><div class="label">${label}</div><div class="value">${val}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
        const om = s.metrics.outlierMedian, of = s.metrics.outlierFollowers;
        const outlier = om != null ? RI.times(om) : of != null ? RI.times(of) : '—';
        const outlierNote = om != null ? 'vs creator avg' : of != null ? 'vs followers' : base.pending ? 'loading…' : '';
        html = header(m, s) + `
          <div class="body">
            <div class="verdict">
              <span class="badge lg ${s.verdict}"><i class="dot"></i>${s.label}</span>
              <span class="score"><b>${s.score}</b><span class="muted">/100</span></span>
            </div>
            <div class="progress"><div class="bar ${s.verdict}" style="width:${s.score}%"></div></div>
            <div class="grid3">
              ${cell('Views', RI.fmt(m.views))}
              ${cell('Likes', m.likesHidden ? 'Hidden' : RI.fmt(m.likes))}
              ${cell('Comments', RI.fmt(m.comments))}
              ${cell('Shares', m.shares != null ? RI.fmt(m.shares) : 'N/A', m.shares != null ? '' : 'private')}
              ${cell('Saves', m.saves != null ? RI.fmt(m.saves) : 'N/A', m.saves != null ? '' : 'owner only')}
              ${cell('Followers', RI.fmt(base.followers))}
            </div>
            <div class="grid3 metrics">
              ${cell('Outlier', outlier, outlierNote)}
              ${cell('Engagement', RI.pct(s.metrics.er))}
              ${cell('Views/day', RI.fmt(s.metrics.perDay), s.metrics.ageDays != null ? Math.max(1, Math.round(s.metrics.ageDays)) + 'd old' : '')}
            </div>
            ${s.reasons.length ? `<ul class="list">${s.reasons.map((x) => `<li>${IC.check}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
            ${s.warnings.length ? `<div class="alert warn">${IC.alert}<div>${s.warnings.map(esc).join('<br>')}${base.error && (base.followers == null || base.sampleSize < 4) ? `<div class="errline">${esc(base.error)}</div>` : ''}</div></div>` : ''}
            ${(om == null || base.followers == null) && !base.pending ? `<div class="hint muted">${IC.alert}<span>${om == null ? 'Outlier' : 'Followers'} kosam <b>@${esc(m.username || '')}</b> profile lo Reels tab okasari open cheyandi, leda
              <button class="link" data-act="baseline">baseline load cheyi</button>.</span></div>` : ''}
            ${m.audio ? `<div class="audio muted">${IC.music}<span>${esc(m.audio)}</span></div>` : ''}
          </div>
          <div class="foot">
            <button class="btn outline ${saved ? 'saved' : ''}" data-act="save">${saved ? IC.bookmarkOn + ' Saved' : IC.bookmark + ' Save'}</button>
            <button class="btn primary" data-act="remake">${IC.clap} Remake</button>
          </div>`;
      }
    }
    if (html !== lastRender) { card.innerHTML = html + '<div class="toast"></div>'; lastRender = html; }
  }

  function toast(text) {
    const t = root.querySelector('.toast');
    if (!t) return;
    t.textContent = text; t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2200);
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
    if (act === 'close') { dismissed = currentCode; refresh(); return; }
    if (act === 'collapse') { ui.collapsed = !ui.collapsed; lastRender = ''; saveUi(); refresh(); return; }
    if (act === 'baseline') {
      const mm = cache.get(currentCode);
      if (mm?.username) {
        profiles.set(mm.username, 'pending'); lastRender = ''; refresh();
        window.postMessage({ source: OUT, type: 'fetch-profile', username: mm.username, userId: mm.userId || null }, location.origin);
      }
      return;
    }
    if (act === 'retry') { tries.delete(currentCode); errors.delete(currentCode); lastRender = ''; requestMedia(currentCode, 0); refresh(); return; }
    const m = cache.get(currentCode);
    if (!m) return;
    const url = reelUrl(currentCode);
    if (act === 'remake') {
      const ok = await copy(`/reel-remake ${url}`);
      toast(ok ? 'Copied! Reel Studio lo paste cheyandi.' : 'Copy fail ayyindi.');
    }
    if (act === 'save') {
      if (!alive()) { toast('Extension reload ayyindi, page refresh cheyandi.'); return; }
      const { swipe = [] } = await chrome.storage.local.get('swipe');
      const i = swipe.findIndex((x) => x.code === currentCode);
      let msg;
      if (i >= 0) { swipe.splice(i, 1); msg = 'Swipe file nunchi teesesam.'; }
      else {
        const base = baselineFor(m);
        swipe.unshift(makeEntry(currentCode, m, base, RI.scoreReel(m, base)));
        msg = 'Swipe file lo save ayyindi.';
      }
      await chrome.storage.local.set({ swipe });
      swipeCodes = new Set(swipe.map((x) => x.code));
      lastRender = '';
      refresh();
      toast(msg);
    }
  }

  mount();
  loadStorage();
  checkRoute();
})();
