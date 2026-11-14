const RI = globalThis.ReelInsight;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABEL = { recreate: 'Recreate', maybe: 'Maybe', skip: 'Skip' };
const PLAT = { ig: 'Instagram', 'yt-short': 'YT Short', 'yt-long': 'YT Video' };
const plat = (x) => x.platform || 'ig';
const DEFAULT_MODEL = 'gemini-2.5-flash';

let data = { swipe: [], autolog: [] };
let tab = 'swipe';

async function load() {
  const st = await chrome.storage.local.get(['swipe', 'autolog', 'popupTab', 'lastSuggest']);
  data = { swipe: st.swipe || [], autolog: st.autolog || [] };
  tab = st.popupTab || 'swipe';
  if (st.lastSuggest) renderSuggest(st.lastSuggest);
  else $('#suggest').innerHTML = `<div class="empty">Saved + Auto log reels nunchi Gemini ye reels remake cheyalo suggest chestundi.<br><br>Mundu ⚙ Settings lo Gemini API key pettandi.</div>`;
  render();
}

function setTab(t) {
  tab = t;
  chrome.storage.local.set({ popupTab: t });
  render();
}

function render() {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#c-swipe').textContent = data.swipe.length || '';
  $('#c-autolog').textContent = data.autolog.length || '';
  $('#listView').hidden = tab === 'suggest';
  $('#suggestView').hidden = tab !== 'suggest';
  $('#sub').textContent = tab === 'swipe' ? 'Meeru save chesina reels'
    : tab === 'autolog' ? 'Scroll chesetappudu auto ga log ayina Recreate reels' : 'Gemini tho remake ideas';
  if (tab !== 'suggest') renderList();
}

function renderList() {
  const items = data[tab];
  const f = $('#filter').value, key = $('#sort').value;
  const pf = $('#pfilter').value;
  const list = items.filter((x) => (f === 'all' || x.verdict === f) && (pf === 'all' || plat(x) === pf)).sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
  $('#count').textContent = `${items.length} reels`;
  $('#list').innerHTML = list.length ? list.map((x) => `
    <div class="item" data-code="${esc(x.code)}">
      <div class="row">
        <span class="user">${plat(x) === 'ig' ? '@' : ''}${esc(x.username || 'unknown')}<span class="pchip ${plat(x)}">${PLAT[plat(x)]}</span></span>
        <span class="badge ${esc(x.verdict)}"><i class="dot"></i>${LABEL[x.verdict] || ''} · ${x.score}</span>
      </div>
      <div class="stats">
        <div><b>${RI.fmt(x.views)}</b><span>Views</span></div>
        <div><b>${RI.times(x.outlier)}</b><span>Outlier</span></div>
        <div><b>${RI.pct(x.er)}</b><span>Engagement</span></div>
        <div><b>${new Date(x.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</b><span>${tab === 'swipe' ? 'Saved' : 'Logged'}</span></div>
      </div>
      ${x.caption ? `<div class="cap">${esc(x.caption)}</div>` : ''}
      <div class="acts">
        <button class="btn" data-act="open">Open</button>
        <button class="btn primary" data-act="remake">Remake</button>
        ${tab === 'autolog' ? '<button class="btn" data-act="keep">Save</button>' : ''}
        <button class="btn danger" data-act="del">Delete</button>
      </div>
    </div>`).join('')
    : `<div class="empty">${tab === 'swipe'
      ? 'Inka emi save cheyaledu.<br>Reel open chesi card lo <b>Save</b> click cheyandi.'
      : 'Inka emi log avvaledu.<br>Instagram lo reels scroll cheyandi, Recreate reels ikkada automatic ga vastayi.'}</div>`;
}

const remakeCmd = (x) => plat(x) === 'yt-long'
  ? `/yt-script Ee YouTube video ni Telugu audience kosam remake cheyali (same topic, mana angle): ${x.url}`
  : `/reel-remake ${x.url}`;

async function copyBtn(btn, text) {
  await navigator.clipboard.writeText(text);
  const old = btn.textContent;
  btn.textContent = 'Copied ✓';
  setTimeout(() => { btn.textContent = old; }, 1500);
}

$('#list').addEventListener('click', async (e) => {
  const act = e.target.dataset.act;
  const code = e.target.closest('.item')?.dataset.code;
  const x = data[tab].find((i) => i.code === code);
  if (!act || !x) return;
  if (act === 'open') chrome.tabs.create({ url: x.url });
  if (act === 'remake') copyBtn(e.target, remakeCmd(x));
  if (act === 'keep' && !data.swipe.some((i) => i.code === code)) {
    data.swipe.unshift({ ...x, savedAt: Date.now() });
    await chrome.storage.local.set({ swipe: data.swipe });
    e.target.textContent = 'Saved ✓';
    render();
  }
  if (act === 'del') {
    data[tab] = data[tab].filter((i) => i.code !== code);
    await chrome.storage.local.set({ [tab]: data[tab] });
    render();
  }
});

$('#export').addEventListener('click', () => {
  const cols = ['url', 'username', 'verdict', 'score', 'views', 'likes', 'comments', 'shares', 'followers',
    'creatorMedian', 'outlier', 'er', 'audio', 'caption', 'postedAt', 'savedAt'];
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = data[tab].map((x) => cols.map((c) => cell(
    c === 'postedAt' ? (x.takenAt ? new Date(x.takenAt * 1000).toISOString().slice(0, 10) : '')
      : c === 'savedAt' ? new Date(x.savedAt).toISOString().slice(0, 10)
      : c === 'outlier' || c === 'er' ? (x[c] != null ? x[c].toFixed(3) : '')
      : x[c])).join(','));
  const blob = new Blob(['﻿' + [cols.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reel-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
});

$('#clear').addEventListener('click', async () => {
  const items = data[tab];
  if (!items.length || !confirm(`${items.length} reels delete cheyala?`)) return;
  data[tab] = [];
  await chrome.storage.local.set({ [tab]: [] });
  render();
});

// ---------- Suggest (Gemini) ----------
function buildPrompt(reels, channels) {
  const lines = reels.map((r, i) =>
    `${i + 1}. id=${r.code} [${PLAT[plat(r)]}${r.duration ? ' ' + Math.round(r.duration / 60) + ' min' : ''}] ${r.username || '?'} | views ${RI.fmt(r.views)} | outlier ${RI.times(r.outlier)} | ER ${RI.pct(r.er)} | score ${r.score}` +
    `${r.audio ? ` | audio: ${r.audio}` : ''}\n   ${plat(r) === 'ig' ? 'caption' : 'title'}: ${(r.caption || '').replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
  return `You help a Telugu Instagram creator decide which reels to remake.

Creator's channels and niche:
${channels || '(not given)'}

Reels and YouTube videos they found (outlier = views vs that creator's normal reels; higher is better):
${lines}

Task:
1. Group the reels into 3-5 topic clusters. For each: topic name, how many reels, and one line on why it is working.
2. Pick the best 3 to remake. A long YouTube video can be remade as a Telugu long video or cut into a reel idea; say which for a TELUGU audience on the creator's channels. Prefer high outlier, topics relevant in Andhra Pradesh/Telangana (students, jobs, salaries, tech, money), and ideas that work in Tenglish. Skip giveaway / "comment for link" bait unless the topic itself is strong.
3. For each pick give: id (exactly as given), a short title, why it will work in Telugu, the Telugu angle (what to change for this audience), which channel it fits, and one opening hook line in natural Tenglish (Telugu words in English letters, mixed with English).

Write all explanations in simple Tenglish. Return JSON only:
{"topics":[{"topic":"","count":0,"why":""}],"picks":[{"id":"","title":"","format":"reel | short | long video","why":"","telugu_angle":"","channel":"","hook":""}]}`;
}

async function runSuggest() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (!settings.geminiKey) {
    $('#suggest').innerHTML = `<div class="err">Gemini API key ledu. ⚙ Settings lo pettandi.</div>`;
    return;
  }
  const days = Number($('#range').value);
  const since = days ? Date.now() - days * 86400000 : 0;
  const byCode = new Map();
  for (const r of [...data.autolog, ...data.swipe]) if (r.savedAt >= since) byCode.set(r.code, r);
  const reels = [...byCode.values()].sort((a, b) => b.score - a.score).slice(0, 40);
  if (reels.length < 3) {
    $('#suggest').innerHTML = `<div class="empty">Ee range lo ${reels.length} reels matrame unnayi. Kanisam 3 kavali, inka konni reels scroll/save cheyandi.</div>`;
    return;
  }
  $('#run').disabled = true;
  $('#suggest').innerHTML = `<div class="loading">${reels.length} reels Gemini ki pampistunna…</div>`;
  try {
    const model = settings.model || DEFAULT_MODEL;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.geminiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(reels, settings.channels) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.6 },
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
    const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    const result = { at: Date.now(), count: reels.length, topics: out.topics || [], picks: out.picks || [], reels: Object.fromEntries(reels.map((x) => [x.code, x])) };
    await chrome.storage.local.set({ lastSuggest: result });
    renderSuggest(result);
  } catch (e) {
    $('#suggest').innerHTML = `<div class="err">Gemini error: ${esc(e.message)}</div>`;
  } finally {
    $('#run').disabled = false;
  }
}

let lastRes = null;
const res0 = () => lastRes;
function renderSuggest(res) {
  lastRes = res;
  const pick = (p) => {
    const r = res.reels?.[p.id];
    return `<div class="item pick">
      <h3>${esc(p.title)}</h3>
      ${r ? `<div class="meta muted" style="font-size:12px">@${esc(r.username)} · ${RI.fmt(r.views)} views · ${RI.times(r.outlier)} outlier</div>` : ''}
      <div class="kv"><span>Enduku:</span> ${esc(p.why)}</div>
      <div class="kv"><span>Telugu angle:</span> ${esc(p.telugu_angle)}</div>
      <div class="kv"><span>Channel:</span> ${esc(p.channel)}${p.format ? ` · <span>Format:</span> ${esc(p.format)}` : ''}</div>
      ${p.hook ? `<div class="hook">"${esc(p.hook)}"</div>` : ''}
      ${r ? `<div class="acts"><button class="btn" data-url="${esc(r.url)}" data-act="open">Open</button>
        <button class="btn primary" data-code="${esc(r.code)}" data-url="${esc(r.url)}" data-act="remake">Copy remake</button></div>` : ''}
    </div>`;
  };
  $('#suggest').innerHTML = `
    <div class="sec">Top 3 remake picks</div>${res.picks.map(pick).join('')}
    <div class="sec">Trending topics</div>
    ${res.topics.map((t) => `<div class="item"><div class="topic"><b>${esc(t.topic)}</b><span class="muted">${t.count} reels</span></div>
      <div class="cap" style="-webkit-line-clamp:3">${esc(t.why)}</div></div>`).join('')}
    <div class="muted" style="font-size:11px;padding:4px 0 12px">${res.count} reels nunchi · ${new Date(res.at).toLocaleString()}</div>`;
}

$('#suggest').addEventListener('click', (e) => {
  const { act, url } = e.target.dataset;
  if (act === 'open' && url) chrome.tabs.create({ url });
  if (act === 'remake' && url) { const r = res0()?.reels?.[e.target.dataset.code]; copyBtn(e.target, r ? remakeCmd(r) : `/reel-remake ${url}`); }
});

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#run').addEventListener('click', runSuggest);
$('#filter').addEventListener('change', renderList);
$('#sort').addEventListener('change', renderList);
$('#pfilter').addEventListener('change', renderList);
load();
