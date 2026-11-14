// Shared card styles, icons and helpers for the Instagram and YouTube cards.
(function (root) {
  // Lucide icons (ISC licence), inlined
  const svg = (d, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    expand: svg('<path d="m15 3 6 6"/><path d="M21 3v6h-6"/><path d="m9 21-6-6"/><path d="M3 21v-6h6"/>'),
    grip: svg('<circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    alert: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    bookmark: svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>'),
    bookmarkOn: svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>', 'fill'),
    clap: svg('<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
    refresh: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  };

  // shadcn/ui (zinc) design tokens, plain CSS so no React/Tailwind build is needed
  const CSS = `
    :host { all: initial; }
    .ri {
      --bg: #ffffff; --fg: #09090b; --muted: #f4f4f5; --muted-fg: #71717a; --border: #e4e4e7;
      --primary: #18181b; --primary-fg: #fafafa; --ring: #a1a1aa;
      --green: #16a34a; --green-bg: #f0fdf4; --amber: #d97706; --amber-bg: #fffbeb; --red: #dc2626; --red-bg: #fef2f2;
    }
    .ri.dark {
      --bg: #09090b; --fg: #fafafa; --muted: #18181b; --muted-fg: #a1a1aa; --border: #27272a;
      --primary: #fafafa; --primary-fg: #18181b; --ring: #52525b;
      --green: #4ade80; --green-bg: rgba(34,197,94,.12); --amber: #fbbf24; --amber-bg: rgba(245,158,11,.12);
      --red: #f87171; --red-bg: rgba(239,68,68,.12);
    }
    * { box-sizing: border-box; margin: 0; }
    .ri { font: 13px/1.4 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif; color: var(--fg);
      -webkit-font-smoothing: antialiased; }
    .card { width: 320px; max-width: calc(100vw - 32px); background: var(--bg); border: 1px solid var(--border); border-radius: 12px; position: relative;
      box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 12px 32px -8px rgba(0,0,0,.25); overflow: hidden; }
    .ic { width: 15px; height: 15px; flex: none; } .ic.fill { fill: currentColor; }
    .head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 14px; border-bottom: 1px solid var(--border); cursor: grab; user-select: none; }
    .head:active { cursor: grabbing; }
    .logo { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff;
      background: linear-gradient(135deg, #f58529, #dd2a7b 55%, #8134af); flex: none; }
    .who { flex: 1; min-width: 0; }
    .name { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -.01em; }
    .sub { font-size: 12px; color: var(--muted-fg); }
    .icon-btn { all: unset; width: 28px; height: 28px; border-radius: 6px; display: grid; place-items: center; color: var(--muted-fg); cursor: pointer; }
    .icon-btn:hover { background: var(--muted); color: var(--fg); }
    .icon-btn .ic { width: 16px; height: 16px; }
    .body { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .muted { color: var(--muted-fg); } .small { font-size: 12px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; border: 1px solid transparent; border-radius: 999px; padding: 2px 9px;
      font-size: 12px; font-weight: 600; }
    .badge.lg { font-size: 13px; padding: 4px 11px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .badge.recreate { color: var(--green); background: var(--green-bg); }
    .badge.maybe { color: var(--amber); background: var(--amber-bg); }
    .badge.skip { color: var(--red); background: var(--red-bg); }
    .badge.nodata { color: var(--muted-fg); background: var(--muted); }
    .verdict { display: flex; align-items: center; justify-content: space-between; }
    .score b { font-size: 24px; font-weight: 700; letter-spacing: -.03em; }
    .score .muted { font-size: 13px; margin-left: 2px; }
    .progress { height: 6px; background: var(--muted); border-radius: 999px; overflow: hidden; margin-top: -4px; }
    .bar { height: 100%; border-radius: 999px; transition: width .4s ease; }
    .bar.recreate { background: var(--green); } .bar.maybe { background: var(--amber); } .bar.skip { background: var(--red); }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .cell { padding: 9px 10px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); min-height: 54px; }
    .cell:nth-child(3n) { border-right: 0; } .cell:nth-last-child(-n+3) { border-bottom: 0; }
    .label { font-size: 11px; color: var(--muted-fg); font-weight: 500; }
    .value { font-size: 16px; font-weight: 600; letter-spacing: -.02em; margin-top: 1px; font-variant-numeric: tabular-nums; }
    .note { font-size: 10.5px; color: var(--muted-fg); }
    .metrics { background: var(--muted); }
    .list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .list li { display: flex; gap: 8px; align-items: flex-start; }
    .list .ic { color: var(--green); margin-top: 2px; }
    .alert { display: flex; gap: 10px; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 12px; }
    .alert .ic { margin-top: 1px; }
    .hint { display: flex; gap: 8px; font-size: 12px; align-items: flex-start; }
    .hint .ic { margin-top: 1px; }
    .link { all: unset; color: var(--fg); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; font-weight: 500; }
    .errline { margin-top: 6px; font-size: 11px; opacity: .75; font-family: ui-monospace, Menlo, monospace; word-break: break-word; }
    .alert.warn { color: var(--amber); background: var(--amber-bg); border-color: transparent; }
    .audio { display: flex; gap: 8px; align-items: center; font-size: 12px; }
    .audio span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .foot { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--border); }
    .btn { all: unset; flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; border-radius: 8px;
      font-size: 13px; font-weight: 500; cursor: pointer; transition: background .15s, opacity .15s; }
    .btn.full { flex: none; width: 100%; box-sizing: border-box; }
    .btn.outline { border: 1px solid var(--border); background: var(--bg); color: var(--fg); }
    .btn.outline:hover { background: var(--muted); }
    .btn.outline.saved { color: var(--amber); }
    .btn.primary { background: var(--primary); color: var(--primary-fg); }
    .btn.primary:hover { opacity: .9; }
    .btn:focus-visible, .icon-btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
    .skeleton { height: 12px; border-radius: 6px; background: var(--muted); animation: pulse 1.5s ease-in-out infinite; }
    .cell .skeleton { height: 10px; margin: 4px 0; }
    .w40 { width: 40%; } .w50 { width: 50%; } .w60 { width: 60%; } .w70 { width: 70%; }
    @keyframes pulse { 50% { opacity: .5; } }
    .toast { position: absolute; left: 14px; right: 14px; bottom: 60px; background: var(--fg); color: var(--bg); padding: 9px 12px;
      border-radius: 8px; font-size: 12px; font-weight: 500; opacity: 0; transform: translateY(6px); transition: .2s; pointer-events: none;
      box-shadow: 0 8px 24px rgba(0,0,0,.2); }
    .toast.show { opacity: 1; transform: none; }
    .logo.yt { background: #ff0033; }
    .vtitle { font-weight: 600; font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; color: var(--muted-fg);
      border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; margin-left: 6px; vertical-align: 1px; }
  `;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  root.ReelInsightUI = { IC, CSS, esc, svg };
})(globalThis);
