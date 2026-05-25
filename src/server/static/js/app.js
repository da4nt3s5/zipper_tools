/* ============================================================
   app.js — zipper_tools
   Layers: 1=modal  2=terminal  3=addTool  4=users
   ============================================================ */

(function () {
  'use strict';

  /* ── Helpers ── */
  function ri(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function rh(n)    { return Array.from({ length: n }, () => ri(0, 15).toString(16)).join(''); }
  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function safeText(str, maxLen) {
    const s = String(str == null ? '' : str);
    return maxLen && s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
  }

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);  ctx.arcTo(x + w, y,     x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);  ctx.arcTo(x,     y + h, x,     y + h - r, r);
    ctx.lineTo(x,     y + r);  ctx.arcTo(x,     y,     x + r, y,         r);
    ctx.closePath();
  }

  /* ══════════════════════════════════════
     0. AUTH STATE
  ══════════════════════════════════════ */
  let authToken = localStorage.getItem('zt_token') || null;
  let authUser  = null;  // { username, role, must_change_password }

  function ah(extra) {
    const h = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
    return Object.assign(h, extra || {});
  }

  async function checkAuth() {
    if (!authToken) return;
    try {
      const r = await fetch('/auth/me', { headers: ah() });
      if (!r.ok) { _clearAuth(); return; }
      authUser = await r.json();
      _applyAuthUI();
      if (authUser.must_change_password) {
        document.getElementById('tabChangePwd').style.display = '';
        switchTab('changepwd');
      }
    } catch { _clearAuth(); }
  }

  function _clearAuth() {
    authToken = null; authUser = null;
    localStorage.removeItem('zt_token');
  }

  function _applyAuthUI() {
    if (!authUser) return;
    // navbar user info
    const info = document.getElementById('navUserInfo');
    info.textContent = `${authUser.username}  [${authUser.role}]`;
    info.style.display = '';
    // login → logout
    const btn = document.getElementById('btnNavLogin');
    btn.textContent = 'logout';
    btn.dataset.mode = 'logout';
    // add tool (admin + user)
    if (['admin', 'user'].includes(authUser.role)) {
      document.getElementById('btnAddTool').style.display = '';
    }
    // users panel (admin only)
    if (authUser.role === 'admin') {
      document.getElementById('btnUsers').style.display = '';
    }
  }

  /* ══════════════════════════════════════
     1. BACKGROUND CANVAS
  ══════════════════════════════════════ */
  const bgCanvas = document.getElementById('zbg');
  const bgCtx    = bgCanvas.getContext('2d');
  const BLH      = 16;

  function resizeBg() {
    bgCanvas.width  = window.innerWidth;
    bgCanvas.height = window.innerHeight;
    drawBgStatic();
  }

  const BG_SEED = [
    () => `~/zipper_tools ❯ zipper jobs --limit 6`,
    () => `  ${rh(8)}  malware.apk            8.7/100   finished`,
    () => `  ${rh(8)}  invoice.pdf            0.0/100   finished`,
    () => `  ${rh(8)}  update.exe             6.3/100   finished`,
    () => `  ${rh(8)}  dropper.dll            9.1/100   finished`,
    () => `  ${rh(8)}  app-release.apk        4.2/100   finished`,
    () => ``,
    () => `~/zipper_tools ❯ zipper iocs ${rh(8)}`,
    () => `  [domain] fir-app.firebaseio.com`,
    () => `  [ip]     185.220.101.47`,
    () => `  [key]    AIzaSy${rh(18)}...`,
    () => `  [hash]   ${rh(32)}`,
    () => ``,
    () => `~/zipper_tools ❯ `,
  ];

  function bgColor(line) {
    if (line.includes('❯') || line.includes('~/')) return '#4a7aaa';
    if (line.includes('[domain]'))                  return '#3a5a8a';
    if (line.includes('[ip]'))                      return '#5a5a20';
    if (line.includes('[key]'))                     return '#6a3030';
    return '#2a3860';
  }

  function drawBgStatic() {
    const w = bgCanvas.width, h = bgCanvas.height;
    const maxL = Math.floor(h / BLH) + 1;
    const lines = BG_SEED.map(fn => fn());
    while (lines.length < maxL) lines.unshift('');
    bgCtx.fillStyle = '#070810';
    bgCtx.fillRect(0, 0, w, h);
    bgCtx.globalAlpha = 0.22;
    bgCtx.font = '13px monospace';
    lines.slice(-maxL).forEach((line, i) => {
      bgCtx.fillStyle = bgColor(line);
      bgCtx.fillText(line, 14, (i + 1) * BLH);
    });
    bgCtx.globalAlpha = 1;
  }

  window.addEventListener('resize', resizeBg);
  resizeBg();

  /* ══════════════════════════════════════
     2. LAYER SWITCHING
  ══════════════════════════════════════ */
  const layerModal    = document.getElementById('layerModal');
  const layerTerminal = document.getElementById('layerTerminal');
  const layerAddTool  = document.getElementById('layerAddTool');
  const layerUsers    = document.getElementById('layerUsers');

  function showLayer(el) {
    [layerModal, layerTerminal, layerAddTool, layerUsers]
      .forEach(l => l.classList.remove('on'));
    el.classList.add('on');
  }

  function showModal()    { showLayer(layerModal); }
  function showTerminal() {
    showLayer(layerTerminal);
    if (!animRunning) { resizeTerm(); startRenderLoop(); }
  }
  function showAddTool()  { showLayer(layerAddTool); }
  function showUsers()    { showLayer(layerUsers); loadUsersList(); }

  /* ══════════════════════════════════════
     3. TAB SWITCHING
  ══════════════════════════════════════ */
  const ALL_TABS = ['file', 'url', 'search', 'login', 'changepwd'];

  function switchTab(name) {
    document.querySelectorAll('.tp[data-t]').forEach(t => t.classList.remove('active'));
    const tab = document.querySelector(`.tp[data-t="${name}"]`);
    if (tab) tab.classList.add('active');
    ALL_TABS.forEach(id => {
      const el = document.getElementById('tc-' + id);
      if (!el) return;
      el.classList.remove('active-tc');
      el.style.display = 'none';
    });
    const active = document.getElementById('tc-' + name);
    if (active) { active.style.display = 'block'; active.classList.add('active-tc'); }
  }

  document.querySelectorAll('.tp[data-t]').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.t));
  });

  /* ══════════════════════════════════════
     4. TERMINAL CANVAS
  ══════════════════════════════════════ */
  const termCanvas = document.getElementById('termCanvas');
  const termCtx    = termCanvas.getContext('2d');
  const TLH        = 18;
  let tlines       = [];
  let tw, th, tmax;
  let cursorLine   = null;
  let animRunning  = false;
  let scrollOffset = 0;

  // Structured result state for collapsible blocks
  let preResultLines  = [];
  let resultBlocks    = [];   // { title, lines, expanded }
  let postResultLines = [];

  function resizeTerm() {
    const nav = document.querySelector('.navbar');
    tw = termCanvas.width  = window.innerWidth;
    th = termCanvas.height = window.innerHeight - (nav ? nav.offsetHeight : 46);
    tmax = Math.floor(th / TLH) - 1;
  }

  function termColor(line) {
    const stripped = line.replace(/^\s+/, '');
    if (stripped.startsWith('▼') || stripped.startsWith('▶')) return '#7aa2f7';
    if (line.includes('❯') || line.includes('~/')) return '#7dcfff';
    if (line.includes('✓'))                        return '#9ece6a';
    if (line.includes('finished'))                  return '#9ece6a';
    if (line.includes('encrypted') || line.includes('Error') || line.includes('error')) return '#f87171';
    if (line.includes('warning') || line.includes('Warning')) return '#e0af68';
    if (line.includes('[domain]'))                  return '#60a5fa';
    if (line.includes('[ip]'))                      return '#f59e0b';
    if (line.includes('[key]') || line.includes('[api_key]') || line.includes('[firebase]')) return '#f87171';
    if (line.includes('[hash]') || line.includes('[url]')) return '#a78bfa';
    if (line.includes('['))                         return '#e0af68';
    if (line.startsWith('  '))                      return '#8899cc';
    return '#3d5280';
  }

  function renderTerm() {
    termCtx.fillStyle = '#070810';
    termCtx.fillRect(0, 0, tw, th);
    termCtx.font = '14px monospace';

    const total   = tlines.length;
    const end     = Math.max(0, total - scrollOffset);
    const start   = Math.max(0, end - tmax);
    const visible = tlines.slice(start, end);

    visible.forEach((line, i) => {
      termCtx.fillStyle = termColor(line);
      termCtx.fillText(line, 14, (i + 1) * TLH);
    });

    if (cursorLine !== null && scrollOffset === 0) {
      const row = Math.min(total, tmax);
      const cx  = 14 + termCtx.measureText(cursorLine).width;
      if (Math.floor(Date.now() / 350) % 2 === 0) {
        termCtx.fillStyle = '#9ece6a';
        termCtx.fillRect(cx, row * TLH - 13, 8, 15);
      }
    }

    const g = _sbGeo();
    if (g) {
      const R = g.SW / 2;
      termCtx.fillStyle = '#0e1220';
      _roundRect(termCtx, g.trackX, g.PAD, g.SW, g.trackH, R); termCtx.fill();
      termCtx.fillStyle = sbDrag ? '#5a7acc' : (scrollOffset > 0 ? '#3d5a9a' : '#1e2e52');
      _roundRect(termCtx, g.trackX, g.thumbY, g.SW, g.thumbH, R); termCtx.fill();
      termCtx.font = '10px monospace';
      termCtx.fillStyle = scrollOffset < g.maxOff ? '#3d5a9a' : '#1e2e52';
      termCtx.fillText('▲', g.trackX + 1, g.PAD - 1);
      termCtx.fillStyle = scrollOffset > 0 ? '#3d5a9a' : '#1e2e52';
      termCtx.fillText('▼', g.trackX + 1, th - 2);
      termCtx.font = '14px monospace';
    }
  }

  function startRenderLoop() {
    if (animRunning) return;
    animRunning = true;
    (function loop() {
      if (!animRunning) return;
      renderTerm();
      requestAnimationFrame(loop);
    })();
  }

  // ── Scrollbar geometry helper ──────────────────────────────
  function _sbGeo() {
    const total = tlines.length;
    if (total <= tmax || !tw || !th) return null;
    const SW = 10, PAD = 4;
    const trackX = tw - SW - 6;
    const trackH = th - PAD * 2;
    const thumbH = Math.max(30, trackH * (tmax / total));
    const maxOff = Math.max(1, total - tmax);
    const thumbY = PAD + (trackH - thumbH) * (1 - scrollOffset / maxOff);
    return { trackX, trackH, thumbH, thumbY, PAD, SW, maxOff };
  }

  // ── Scrollbar drag state ────────────────────────────────────
  let sbDrag = false, sbDragY0 = 0, sbDragOff0 = 0;

  termCanvas.addEventListener('mousedown', e => {
    const g = _sbGeo(); if (!g) return;
    const rect = termCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < g.trackX || x > g.trackX + g.SW) return;
    if (y < g.PAD    || y > g.PAD + g.trackH) return;
    e.preventDefault();
    if (y >= g.thumbY && y <= g.thumbY + g.thumbH) {
      sbDrag = true; sbDragY0 = y; sbDragOff0 = scrollOffset;
    } else {
      // Click on track → jump
      const ratio = (y - g.PAD) / (g.trackH - g.thumbH);
      scrollOffset = Math.round(Math.max(0, Math.min(g.maxOff * (1 - ratio), g.maxOff)));
    }
  });

  window.addEventListener('mousemove', e => {
    if (!sbDrag) return;
    const g = _sbGeo(); if (!g) { sbDrag = false; return; }
    const rect = termCanvas.getBoundingClientRect();
    const dy   = (e.clientY - rect.top) - sbDragY0;
    const movable = g.trackH - g.thumbH;
    if (movable <= 0) return;
    scrollOffset = Math.max(0, Math.min(Math.round(sbDragOff0 - (dy / movable) * g.maxOff), g.maxOff));
  });

  window.addEventListener('mouseup', () => { sbDrag = false; });

  termCanvas.addEventListener('mousemove', e => {
    const rect = termCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;

    // Check scrollbar hover
    const g = _sbGeo();
    if (g && x >= g.trackX && x <= g.trackX + g.SW && y >= g.PAD && y <= g.PAD + g.trackH) {
      termCanvas.style.cursor = 'ns-resize';
      return;
    }

    // Check block header hover
    if (!resultBlocks.length) { termCanvas.style.cursor = ''; return; }
    const clickedRow = Math.floor(y / TLH);
    const total      = tlines.length;
    const end        = Math.max(0, total - scrollOffset);
    const start      = Math.max(0, end - tmax);
    const absIdx     = start + clickedRow;
    let lineIdx = preResultLines.length;
    let onHeader = false;
    for (let i = 0; i < resultBlocks.length; i++) {
      if (absIdx === lineIdx) { onHeader = true; break; }
      lineIdx++;
      if (resultBlocks[i].expanded) lineIdx += resultBlocks[i].lines.length;
    }
    termCanvas.style.cursor = onHeader ? 'pointer' : '';
  });

  termCanvas.addEventListener('click', e => {
    if (!resultBlocks.length) return;
    const rect       = termCanvas.getBoundingClientRect();
    const clickedRow = Math.floor((e.clientY - rect.top) / TLH);
    const total      = tlines.length;
    const end        = Math.max(0, total - scrollOffset);
    const start      = Math.max(0, end - tmax);
    const absIdx     = start + clickedRow;

    let lineIdx = preResultLines.length;
    for (let i = 0; i < resultBlocks.length; i++) {
      if (absIdx === lineIdx) {
        resultBlocks[i].expanded = !resultBlocks[i].expanded;
        rebuildTlines();
        if (resultBlocks[i].expanded) {
          // Scroll so this block's header lands at the top of the view
          let hIdx = preResultLines.length;
          for (let j = 0; j < i; j++) {
            hIdx++;
            if (resultBlocks[j].expanded) hIdx += resultBlocks[j].lines.length;
          }
          scrollOffset = Math.max(0, tlines.length - tmax - hIdx);
        } else {
          scrollOffset = Math.min(scrollOffset, Math.max(0, tlines.length - tmax));
        }
        return;
      }
      lineIdx++;
      if (resultBlocks[i].expanded) lineIdx += resultBlocks[i].lines.length;
    }
  });

  termCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    const step = e.deltaMode === 1 ? 3 : Math.ceil(Math.abs(e.deltaY) / 40);
    scrollOffset = Math.max(0, Math.min(
      scrollOffset + (e.deltaY < 0 ? step : -step),
      Math.max(0, tlines.length - tmax)
    ));
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (!layerTerminal.classList.contains('on')) return;
    const maxOff = Math.max(0, tlines.length - tmax);
    if (e.key === 'ArrowUp'   || e.key === 'PageUp')   scrollOffset = Math.min(scrollOffset + (e.key === 'PageUp' ? tmax : 3), maxOff);
    if (e.key === 'ArrowDown' || e.key === 'PageDown') scrollOffset = Math.max(scrollOffset - (e.key === 'PageDown' ? tmax : 3), 0);
    if (e.key === 'Home') scrollOffset = maxOff;
    if (e.key === 'End')  scrollOffset = 0;
  });

  function pushLine(line) { tlines.push(line); }
  function replaceLast(line) { if (tlines.length > 0) tlines[tlines.length - 1] = line; }
  function scrollToTop() { scrollOffset = Math.max(0, tlines.length - tmax); }

  // Scroll so the result block headers start at top (or show all if they fit)
  function scrollToResults() {
    if (!resultBlocks.length) { scrollToTop(); return; }
    const targetStart = preResultLines.length;
    const candidate   = tlines.length - tmax - targetStart;
    scrollOffset = candidate > 0 ? candidate : 0;
  }

  function rebuildTlines() {
    tlines = [...preResultLines];
    for (const block of resultBlocks) {
      const arrow = block.expanded ? '▼' : '▶';
      const titleStr = block.title.startsWith('[') ? block.title : `[${block.title}]`;
      tlines.push(`  ${arrow} ${titleStr}  (${block.lines.length})`);
      if (block.expanded) {
        for (const l of block.lines) tlines.push(l);
      }
    }
    tlines = [...tlines, ...postResultLines];
  }

  async function typePrompt(text) {
    for (let c = 0; c <= text.length; c++) {
      cursorLine = text.slice(0, c);
      await sleep(36);
    }
    pushLine(text);
    cursorLine = null;
    await sleep(130);
  }

  window.addEventListener('resize', () => {
    if (layerTerminal.classList.contains('on')) resizeTerm();
  });

  /* ══════════════════════════════════════
     5. API HELPERS
  ══════════════════════════════════════ */
  async function apiSubmitFile(fileObj) {
    const fd = new FormData();
    fd.append('file', fileObj);
    const r = await fetch('/submit', { method: 'POST', headers: ah(), body: fd });
    const body = await r.json();
    if (r.status === 401) throw new Error('Login required');
    if (!r.ok) throw new Error(body.detail || r.statusText);
    return body;
  }

  async function apiSubmitUrl(url) {
    const r = await fetch('/submit', {
      method: 'POST',
      headers: ah({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ type: 'url', url }),
    });
    const body = await r.json();
    if (r.status === 401) throw new Error('Login required');
    if (!r.ok) throw new Error(body.detail || r.statusText);
    return body;
  }

  async function apiGetJob(jobId) {
    const r = await fetch(`/jobs/${encodeURIComponent(jobId)}`, { headers: ah() });
    const body = await r.json();
    if (!r.ok) throw new Error(body.detail || r.statusText);
    return body;
  }

  async function apiListJobs(q) {
    const url = q ? `/jobs?q=${encodeURIComponent(q)}` : '/jobs';
    const r = await fetch(url, { headers: ah() });
    const body = await r.json();
    if (!r.ok) throw new Error(body.detail || r.statusText);
    return body;
  }

  /* ══════════════════════════════════════
     6. RESULTS FORMATTER
  ══════════════════════════════════════ */

  // Parse raw text output into [{ title, lines }] groups by [Category] headers
  function _parseCats(text) {
    const result = [];
    let cur = null, curLines = [];
    for (const raw of text.split('\n')) {
      const m = raw.trim().match(/^\[([^\]]+)\]$/);
      if (m) {
        if (cur !== null && curLines.length) result.push({ title: cur, lines: curLines });
        cur = m[1]; curLines = [];
      } else if (cur !== null && raw.trim()) {
        const val = raw.trim().replace(/^-\s*/, '');
        if (val) curLines.push(`  - ${safeText(val, 118)}`);
      }
    }
    if (cur !== null && curLines.length) result.push({ title: cur, lines: curLines });
    return result;
  }

  // Build one collapsible block per category. All start COLLAPSED.
  function buildResultBlocks(job) {
    const tools = job.results?.tools || [];
    const blocks = [];
    for (const t of tools) {
      const output = t.output || {};
      for (const fname of Object.keys(output)) {
        const content = output[fname];
        if (!content) continue;
        if (content.hallazgos && Array.isArray(content.hallazgos)) {
          // Structured: one block per category
          for (const finding of content.hallazgos) {
            const lines = (finding.results || []).map(r => `  - ${safeText(r, 118)}`);
            if (lines.length) blocks.push({ title: safeText(finding.tipo, 60), lines, expanded: false });
          }
        } else if (typeof content === 'string') {
          const cats = _parseCats(content);
          if (cats.length) {
            for (const c of cats) blocks.push({ title: c.title, lines: c.lines, expanded: false });
          } else {
            // No categories — single block with raw lines
            const raw = content.split('\n').map(l => `  ${safeText(l.trimEnd(), 118)}`).filter(l => l.trim());
            if (raw.length) blocks.push({ title: `${t.status === 'ok' ? '✓' : '✗'} output`, lines: raw, expanded: false });
          }
        }
      }
    }
    return blocks;
  }

  /* ══════════════════════════════════════
     7. TERMINAL FLOWS
  ══════════════════════════════════════ */
  async function runSubmit(type, displayArg, apiCall) {
    resizeTerm();
    tlines = []; scrollOffset = 0; cursorLine = null;
    preResultLines = []; resultBlocks = []; postResultLines = [];
    startRenderLoop();

    await typePrompt(`~/zipper_tools ❯ zipper submit ${displayArg}`);
    pushLine('  Submitting…');

    try {
      const { job_id } = await apiCall();
      replaceLast('  Submitting…  ████████████  ✓');
      pushLine(`  Job ID   ${safeText(job_id, 40)}`);
      pushLine('  Status   running…');
      await sleep(400);
      const job = await apiGetJob(job_id);
      replaceLast('  Status   finished');
      pushLine('');

      preResultLines  = [...tlines];
      resultBlocks    = buildResultBlocks(job);
      postResultLines = resultBlocks.length
        ? ['', '~/zipper_tools ❯ ']
        : ['  No findings', '', '~/zipper_tools ❯ '];
      rebuildTlines();

    } catch (err) {
      replaceLast(`  Error    ${safeText(err.message, 100)}`);
      pushLine('');
      pushLine('~/zipper_tools ❯ ');
    }

    cursorLine = '~/zipper_tools ❯ ';
    scrollToResults();
  }

  async function runSearch(query) {
    resizeTerm();
    tlines = []; scrollOffset = 0; cursorLine = null;
    preResultLines = []; resultBlocks = []; postResultLines = [];
    startRenderLoop();

    const isJobId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.trim());
    if (isJobId) {
      await typePrompt(`~/zipper_tools ❯ zipper jobs ${safeText(query, 40)}`);
      pushLine('  Looking up…');
      try {
        const job = await apiGetJob(query.trim());
        replaceLast(`  Job ID   ${safeText(job.job_id, 40)}`);
        pushLine(`  Kind     ${safeText(job.kind, 20)}`);
        pushLine(`  Status   ${safeText(job.status, 20)}`);
        pushLine('');

        preResultLines  = [...tlines];
        resultBlocks    = buildResultBlocks(job);
        postResultLines = resultBlocks.length
          ? ['', '~/zipper_tools ❯ ']
          : ['  No findings', '', '~/zipper_tools ❯ '];
        rebuildTlines();
        scrollToResults();

      } catch (err) {
        replaceLast(`  Error    ${safeText(err.message, 100)}`);
        pushLine('');
        pushLine('~/zipper_tools ❯ ');
      }
    } else {
      await typePrompt(`~/zipper_tools ❯ zipper jobs --search "${safeText(query, 60)}"`);
      pushLine('  Searching…');
      try {
        const { jobs } = await apiListJobs(query);
        replaceLast(`  ${jobs.length} job(s) found`);
        pushLine('');
        for (const j of jobs) {
          const label = j.filename ? safeText(j.filename, 24) : (j.url ? safeText(j.url, 24) : '-');
          pushLine(`  ${safeText(j.job_id, 36)}  ${safeText(j.kind || '-', 6)}  ${safeText(j.status, 10)}  ${label}`);
          await sleep(30);
        }
        if (!jobs.length) pushLine('  No matching jobs');
      } catch (err) { replaceLast(`  Error    ${safeText(err.message, 100)}`); }
      pushLine('');
      pushLine('~/zipper_tools ❯ ');
    }

    cursorLine = '~/zipper_tools ❯ ';
    scrollToTop();
  }

  /* ══════════════════════════════════════
     8. SUBMIT HANDLERS
  ══════════════════════════════════════ */
  function shakeField(sel) {
    const row = document.querySelector(sel);
    if (!row) return;
    row.style.borderColor = '#f87171';
    setTimeout(() => { row.style.borderColor = ''; }, 1000);
  }

  /* URL */
  document.getElementById('submitUrl').addEventListener('click', () => {
    const val = document.getElementById('urlInput').value.trim();
    if (!val) { shakeField('#tc-url .field-row'); return; }
    try { new URL(val); } catch { shakeField('#tc-url .field-row'); return; }
    showTerminal();
    setTimeout(() => runSubmit('url', `"${safeText(val, 80)}"`, () => apiSubmitUrl(val)), 320);
  });
  document.getElementById('urlInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('submitUrl').click();
  });

  /* SEARCH */
  document.getElementById('submitSearch').addEventListener('click', () => {
    const val = document.getElementById('searchInput').value.trim();
    if (!val) { shakeField('#tc-search .field-row'); return; }
    showTerminal();
    setTimeout(() => runSearch(val), 320);
  });
  document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('submitSearch').click();
  });

  /* FILE — browse */
  const fileInput  = document.getElementById('fileInput');
  const browseLink = document.querySelector('.browse-link');
  if (browseLink) browseLink.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) return;
    fileInput.value = '';  // reset so same file can be selected again
    showTerminal();
    setTimeout(() => runSubmit('file', safeText(f.name, 40), () => apiSubmitFile(f)), 320);
  });

  /* FILE — drag & drop */
  const dropCard = document.getElementById('dropCard');
  if (dropCard) {
    dropCard.addEventListener('dragover', e => {
      e.preventDefault(); dropCard.style.borderColor = '#3d5a9a';
    });
    dropCard.addEventListener('dragleave', () => { dropCard.style.borderColor = ''; });
    dropCard.addEventListener('drop', e => {
      e.preventDefault(); dropCard.style.borderColor = '';
      const f = e.dataTransfer.files[0];
      if (!f) return;
      showTerminal();
      setTimeout(() => runSubmit('file', safeText(f.name, 40), () => apiSubmitFile(f)), 320);
    });
  }

  /* ══════════════════════════════════════
     9. NAVBAR BUTTONS
  ══════════════════════════════════════ */
  document.getElementById('btnNewSubmit').addEventListener('click', () => {
    animRunning = false;
    fileInput.value = '';  // reset so re-selecting same file works
    switchTab('file');
    showModal();
  });

  document.getElementById('btnCloseModal').addEventListener('click', () => {
    showTerminal();
  });

  document.getElementById('btnAddTool').addEventListener('click', () => {
    document.getElementById('atMsg').textContent = '';
    showAddTool();
  });

  document.getElementById('btnUsers').addEventListener('click', () => {
    showUsers();
  });

  document.getElementById('btnNavLogin').addEventListener('click', function () {
    if (this.dataset.mode === 'logout') {
      _clearAuth();
      this.textContent = 'login';
      this.dataset.mode = '';
      document.getElementById('navUserInfo').style.display = 'none';
      document.getElementById('btnAddTool').style.display = 'none';
      document.getElementById('btnUsers').style.display = 'none';
      switchTab('login');
      showModal();
    } else {
      animRunning = false;
      switchTab('login');
      showModal();
    }
  });

  /* ══════════════════════════════════════
     10. LOGIN
  ══════════════════════════════════════ */
  document.getElementById('signinBtn').addEventListener('click', async function () {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPwd').value;
    const msgEl    = document.getElementById('loginMsg');

    if (!username || !password) {
      msgEl.style.color = '#f87171';
      msgEl.textContent = 'Ingresa usuario y contraseña';
      return;
    }

    this.textContent = 'Signing in…';
    msgEl.textContent = '';

    try {
      const r    = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await r.json();
      if (!r.ok) {
        msgEl.style.color = '#f87171';
        msgEl.textContent = body.detail || 'Error';
        this.textContent = 'Sign in';
        return;
      }

      authToken = body.token;
      authUser  = { username: body.username, role: body.role, must_change_password: body.must_change_password };
      localStorage.setItem('zt_token', authToken);
      _applyAuthUI();
      document.getElementById('loginPwd').value = '';
      msgEl.textContent = '';

      if (body.must_change_password) {
        document.getElementById('tabChangePwd').style.display = '';
        switchTab('changepwd');
      } else {
        showTerminal();
      }
    } catch (err) {
      msgEl.style.color = '#f87171';
      msgEl.textContent = safeText(err.message, 80);
    }
    this.textContent = 'Sign in';
  });

  document.getElementById('loginUser').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginPwd').focus();
  });
  document.getElementById('loginPwd').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('signinBtn').click();
  });

  /* ══════════════════════════════════════
     11. CHANGE PASSWORD
  ══════════════════════════════════════ */
  document.getElementById('cpSubmit').addEventListener('click', async function () {
    const newPwd  = document.getElementById('cpNewPwd').value;
    const confirm = document.getElementById('cpConfirmPwd').value;
    const msgEl   = document.getElementById('cpMsg');

    if (!newPwd || newPwd.length < 8) {
      msgEl.style.color = '#f87171';
      msgEl.textContent = 'Mínimo 8 caracteres';
      return;
    }
    if (newPwd !== confirm) {
      msgEl.style.color = '#f87171';
      msgEl.textContent = 'Las contraseñas no coinciden';
      return;
    }

    this.textContent = 'Saving…';
    try {
      const r = await fetch('/auth/change-password', {
        method: 'POST',
        headers: ah({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ new_password: newPwd }),
      });
      if (!r.ok) {
        const b = await r.json();
        msgEl.style.color = '#f87171';
        msgEl.textContent = b.detail || 'Error';
      } else {
        msgEl.style.color = '#9ece6a';
        msgEl.textContent = '✓ Contraseña actualizada';
        if (authUser) authUser.must_change_password = false;
        document.getElementById('tabChangePwd').style.display = 'none';
        document.getElementById('cpNewPwd').value = '';
        document.getElementById('cpConfirmPwd').value = '';
        setTimeout(() => { showTerminal(); }, 900);
      }
    } catch (err) {
      msgEl.style.color = '#f87171';
      msgEl.textContent = safeText(err.message, 80);
    }
    this.textContent = 'Cambiar contraseña';
  });

  /* ══════════════════════════════════════
     12. ADD TOOL MODAL
  ══════════════════════════════════════ */
  document.getElementById('btnCloseAddTool').addEventListener('click', () => showTerminal());

  document.getElementById('atSubmitBtn').addEventListener('click', async () => {
    const repoUrl = document.getElementById('atRepoUrl').value.trim();
    const msgEl   = document.getElementById('atMsg');

    if (!repoUrl) {
      msgEl.style.color = '#f87171';
      msgEl.textContent = 'Ingresa la URL del repositorio';
      return;
    }

    const kind        = document.querySelector('input[name="atKind"]:checked')?.value    || null;
    const runtimeType = document.querySelector('input[name="atRuntime"]:checked')?.value || null;
    const cmd         = document.getElementById('atCmd').value.trim() || null;

    msgEl.style.color = '#8899cc';
    msgEl.textContent = 'Adding tool…';

    try {
      const r    = await fetch('/tools/add', {
        method: 'POST',
        headers: ah({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ repo_url: repoUrl, kind, runtime_type: runtimeType, cmd }),
      });
      const body = await r.json();

      if (!r.ok) {
        msgEl.style.color = '#f87171';
        msgEl.textContent = safeText(body.detail || 'Error', 100);
      } else {
        msgEl.style.color = '#9ece6a';
        msgEl.textContent = `✓ Tool added  id: ${safeText(body.id || body.tool_id || '', 12)}`;
        document.getElementById('atRepoUrl').value = '';
        document.getElementById('atCmd').value = '';
      }
    } catch (err) {
      msgEl.style.color = '#f87171';
      msgEl.textContent = safeText(err.message, 80);
    }
  });

  /* ══════════════════════════════════════
     13. USERS MODAL
  ══════════════════════════════════════ */
  document.getElementById('btnCloseUsers').addEventListener('click', () => showTerminal());

  async function loadUsersList() {
    const listEl = document.getElementById('usersList');
    listEl.textContent = '';
    try {
      const r    = await fetch('/users', { headers: ah() });
      if (!r.ok) return;
      const { users } = await r.json();
      if (!users.length) {
        const p = document.createElement('p');
        p.className = 'at-hint';
        p.textContent = 'No hay usuarios';
        listEl.appendChild(p);
        return;
      }
      users.forEach(u => {
        const row  = document.createElement('div');
        row.className = 'user-item';

        const name = document.createElement('span');
        name.className = 'u-name';
        name.textContent = u.username;

        const role = document.createElement('span');
        role.className = 'u-role';
        role.textContent = u.role;

        const del = document.createElement('button');
        del.className = 'del-btn';
        del.textContent = 'delete';
        del.disabled = u.username === 'admin';
        del.addEventListener('click', async () => {
          if (!confirm(`¿Eliminar usuario "${u.username}"?`)) return;
          const rd = await fetch(`/users/${encodeURIComponent(u.username)}`, {
            method: 'DELETE', headers: ah(),
          });
          if (rd.ok) loadUsersList();
          else {
            const b = await rd.json();
            document.getElementById('nuMsg').textContent = b.detail || 'Error';
          }
        });

        row.appendChild(name);
        row.appendChild(role);
        row.appendChild(del);
        listEl.appendChild(row);
      });
    } catch { /* ignore */ }
  }

  document.getElementById('btnCreateUser').addEventListener('click', async () => {
    const username = document.getElementById('nuUsername').value.trim();
    const password = document.getElementById('nuPassword').value;
    const role     = document.getElementById('nuRole').value;
    const msgEl    = document.getElementById('nuMsg');

    if (!username || !password) {
      msgEl.style.color = '#f87171';
      msgEl.textContent = 'Completa usuario y contraseña';
      return;
    }

    try {
      const r    = await fetch('/users', {
        method: 'POST',
        headers: ah({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username, password, role }),
      });
      const body = await r.json();
      if (!r.ok) {
        msgEl.style.color = '#f87171';
        msgEl.textContent = body.detail || 'Error';
      } else {
        msgEl.style.color = '#9ece6a';
        msgEl.textContent = `✓ Usuario "${username}" creado`;
        document.getElementById('nuUsername').value = '';
        document.getElementById('nuPassword').value = '';
        loadUsersList();
      }
    } catch (err) {
      msgEl.style.color = '#f87171';
      msgEl.textContent = safeText(err.message, 80);
    }
  });

  /* ══════════════════════════════════════
     14. INPUT STYLE FIX (autofill override)
  ══════════════════════════════════════ */
  document.querySelectorAll('input').forEach(inp => {
    inp.style.setProperty('background',       'transparent', 'important');
    inp.style.setProperty('background-color', 'transparent', 'important');
    inp.style.setProperty('color',            '#c0caf5',     'important');
  });

  /* ══════════════════════════════════════
     15. ON LOAD — check saved auth token
  ══════════════════════════════════════ */
  checkAuth();

})();
