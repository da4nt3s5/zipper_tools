/* ============================================================
   app.js — zipper_tools
   Flow:
     1. Page load  → modal centered, no navbar, bg frozen
     2. Submit     → modal fades out, navbar + terminal appear,
                     terminal types the command then calls real API
     3. new submit → terminal hides, modal reappears
     4. nav login  → modal reappears with LOGIN tab active
   ============================================================ */

(function () {
  'use strict';

  /* ── Helpers ── */
  function ri(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function rh(n)    { return Array.from({ length: n }, () => ri(0, 15).toString(16)).join(''); }
  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  /* ── Safe text (canvas fillText is already XSS-safe, but truncate long lines) ── */
  function safeText(str, maxLen) {
    const s = String(str == null ? '' : str);
    return maxLen && s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
  }

  /* ══════════════════════════════════════
     1. BACKGROUND CANVAS (frozen on load)
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

  function showModal() {
    layerTerminal.classList.remove('on');
    layerModal.classList.add('on');
  }

  function showTerminal() {
    layerModal.classList.remove('on');
    layerTerminal.classList.add('on');
  }

  /* ══════════════════════════════════════
     3. TAB SWITCHING
  ══════════════════════════════════════ */
  const ALL_TABS = ['file', 'url', 'search', 'login'];

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
    if (active) {
      active.style.display = 'block';
      active.classList.add('active-tc');
    }
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
  let tlines       = [];      // all lines, never truncated
  let tw, th, tmax;
  let cursorLine   = null;
  let animRunning  = false;
  let scrollOffset = 0;       // lines scrolled up from bottom (0 = bottom)

  function resizeTerm() {
    const nav = document.querySelector('.navbar');
    tw = termCanvas.width  = window.innerWidth;
    th = termCanvas.height = window.innerHeight - (nav ? nav.offsetHeight : 46);
    tmax = Math.floor(th / TLH) - 1;
  }

  function termColor(line) {
    if (line.includes('❯') || line.includes('~/')) return '#7dcfff';
    if (line.includes('✓'))                        return '#9ece6a';
    if (line.includes('finished'))                  return '#9ece6a';
    if (line.includes('Error') || line.includes('error')) return '#f87171';
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

    const total  = tlines.length;
    const end    = Math.max(0, total - scrollOffset);
    const start  = Math.max(0, end - tmax);
    const visible = tlines.slice(start, end);

    visible.forEach((line, i) => {
      termCtx.fillStyle = termColor(line);
      termCtx.fillText(line, 14, (i + 1) * TLH);
    });

    // Cursor — only shown when at the bottom
    if (cursorLine !== null && scrollOffset === 0) {
      const row = Math.min(total, tmax);
      const cx  = 14 + termCtx.measureText(cursorLine).width;
      if (Math.floor(Date.now() / 350) % 2 === 0) {
        termCtx.fillStyle = '#9ece6a';
        termCtx.fillRect(cx, row * TLH - 13, 8, 15);
      }
    }

    // Scrollbar
    if (total > tmax) {
      const barH    = th * (tmax / total);
      const barTop  = th * (start / total);
      termCtx.fillStyle = '#1a2240';
      termCtx.fillRect(tw - 4, 0, 4, th);
      termCtx.fillStyle = scrollOffset > 0 ? '#3d5a9a' : '#2a3860';
      termCtx.fillRect(tw - 4, barTop, 4, barH);
    }

    // Scroll hint when there's content above
    if (scrollOffset === 0 && total > tmax) {
      termCtx.fillStyle = '#2a3860';
      termCtx.font = '11px monospace';
      termCtx.fillText('↑ scroll to see full output', tw - 180, th - 6);
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

  // Scroll with mouse wheel
  termCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    const step = e.deltaMode === 1 ? 3 : Math.ceil(Math.abs(e.deltaY) / 40);
    scrollOffset = Math.max(0, Math.min(
      scrollOffset + (e.deltaY < 0 ? step : -step),
      Math.max(0, tlines.length - tmax)
    ));
  }, { passive: false });

  // Scroll with keyboard when terminal is visible
  window.addEventListener('keydown', e => {
    if (!layerTerminal.classList.contains('on')) return;
    const maxOff = Math.max(0, tlines.length - tmax);
    if (e.key === 'ArrowUp')   scrollOffset = Math.min(scrollOffset + 3, maxOff);
    if (e.key === 'ArrowDown') scrollOffset = Math.max(scrollOffset - 3, 0);
    if (e.key === 'Home')      scrollOffset = maxOff;
    if (e.key === 'End')       scrollOffset = 0;
  });

  function pushLine(line) {
    tlines.push(line);
    // Auto-scroll to bottom during animation (unless user has scrolled up)
    if (scrollOffset === 0 && animRunning) scrollOffset = 0;
  }

  /** Replaces the last pushed line in-place. */
  function replaceLast(line) {
    if (tlines.length > 0) tlines[tlines.length - 1] = line;
  }

  /** Scroll to the top of all accumulated lines. */
  function scrollToTop() {
    scrollOffset = Math.max(0, tlines.length - tmax);
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

  /* ══════════════════════════════════════
     5. API HELPERS
  ══════════════════════════════════════ */
  async function apiSubmitFile(fileObj) {
    const fd = new FormData();
    fd.append('file', fileObj);
    const r = await fetch('/submit', { method: 'POST', body: fd });
    const body = await r.json();
    if (!r.ok) throw new Error(body.detail || r.statusText);
    return body; // { job_id }
  }

  async function apiSubmitUrl(url) {
    const r = await fetch('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'url', url }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.detail || r.statusText);
    return body; // { job_id }
  }

  async function apiGetJob(jobId) {
    const r = await fetch(`/jobs/${encodeURIComponent(jobId)}`);
    const body = await r.json();
    if (!r.ok) throw new Error(body.detail || r.statusText);
    return body;
  }

  async function apiListJobs(q) {
    const url = q ? `/jobs?q=${encodeURIComponent(q)}` : '/jobs';
    const r = await fetch(url);
    const body = await r.json();
    if (!r.ok) throw new Error(body.detail || r.statusText);
    return body; // { jobs: [...] }
  }

  /* ══════════════════════════════════════
     6. RESULTS FORMATTER
  ══════════════════════════════════════ */
  function* formatJobResults(job) {
    const tools = job.results && job.results.tools ? job.results.tools : [];
    let hasAny = false;

    for (const t of tools) {
      const output = t.output || {};
      for (const fname of Object.keys(output)) {
        const content = output[fname];
        if (!content) continue;

        // Structured findings (hallazgos)
        if (content.hallazgos && Array.isArray(content.hallazgos)) {
          for (const finding of content.hallazgos) {
            const tipo = safeText(finding.tipo, 60);
            const results = finding.results || [];
            if (!results.length) continue;
            yield `  [${tipo}]`;
            for (const r of results) {
              yield `    ${safeText(r, 120)}`;
              hasAny = true;
            }
          }
        } else if (typeof content === 'string') {
          const lines = content.split('\n').slice(0, 80);
          for (const l of lines) {
            yield `  ${safeText(l.trim(), 120)}`;
            hasAny = true;
          }
        }
      }
    }

    if (!hasAny) yield '  No findings';
  }

  /* ══════════════════════════════════════
     7. TERMINAL FLOWS
  ══════════════════════════════════════ */
  async function runSubmit(type, displayArg, apiCall) {
    resizeTerm();
    tlines = [];
    scrollOffset = 0;
    cursorLine = null;
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
      replaceLast(`  Status   finished`);
      pushLine('');

      for (const line of formatJobResults(job)) {
        pushLine(line);
        await sleep(20);
      }

    } catch (err) {
      replaceLast(`  Error    ${safeText(err.message, 100)}`);
    }

    pushLine('');
    pushLine('~/zipper_tools ❯ ');
    cursorLine = '~/zipper_tools ❯ ';
    scrollToTop();
  }

  async function runSearch(query) {
    resizeTerm();
    tlines = [];
    scrollOffset = 0;
    cursorLine = null;
    startRenderLoop();

    const isJobId = /^[0-9a-f-]{8,36}$/i.test(query.trim());

    if (isJobId) {
      await typePrompt(`~/zipper_tools ❯ zipper jobs ${safeText(query, 40)}`);
      pushLine('  Looking up job…');
      try {
        const job = await apiGetJob(query.trim());
        replaceLast(`  Job ID   ${safeText(job.job_id, 40)}`);
        pushLine(`  Kind     ${safeText(job.kind, 20)}`);
        pushLine(`  Status   ${safeText(job.status, 20)}`);
        pushLine('');
        for (const line of formatJobResults(job)) {
          pushLine(line);
          await sleep(20);
        }
      } catch (err) {
        replaceLast(`  Error    ${safeText(err.message, 100)}`);
      }
    } else {
      await typePrompt(`~/zipper_tools ❯ zipper jobs --search "${safeText(query, 60)}"`);
      pushLine('  Searching…');
      try {
        const { jobs } = await apiListJobs(query);
        replaceLast(`  ${jobs.length} job(s) found`);
        pushLine('');
        for (const j of jobs) {
          pushLine(`  ${safeText(j.job_id, 36)}  ${safeText(j.kind || '-', 6)}  ${safeText(j.status, 12)}`);
          await sleep(30);
        }
        if (!jobs.length) pushLine('  No matching jobs');
      } catch (err) {
        replaceLast(`  Error    ${safeText(err.message, 100)}`);
      }
    }

    pushLine('');
    pushLine('~/zipper_tools ❯ ');
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
    // Basic URL validation
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

  /* FILE — click to browse */
  const fileInput  = document.getElementById('fileInput');
  const browseLink = document.querySelector('.browse-link');
  if (browseLink) browseLink.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) return;
    showTerminal();
    setTimeout(() => runSubmit('file', safeText(f.name, 40), () => apiSubmitFile(f)), 320);
  });

  /* FILE — drag & drop */
  const dropCard = document.querySelector('#tc-file .card');
  if (dropCard) {
    dropCard.addEventListener('dragover', e => {
      e.preventDefault();
      dropCard.style.borderColor = '#3d5a9a';
    });
    dropCard.addEventListener('dragleave', () => {
      dropCard.style.borderColor = '';
    });
    dropCard.addEventListener('drop', e => {
      e.preventDefault();
      dropCard.style.borderColor = '';
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
    switchTab('file');
    showModal();
  });

  document.getElementById('btnNavLogin').addEventListener('click', () => {
    animRunning = false;
    switchTab('login');
    showModal();
  });

  /* ══════════════════════════════════════
     10. LOGIN (placeholder)
  ══════════════════════════════════════ */
  document.getElementById('signinBtn').addEventListener('click', function () {
    const email = document.querySelector('#tc-login input[type="email"]').value.trim();
    if (!email) {
      this.style.borderColor = '#6a2a4a';
      this.style.color       = '#c06080';
      this.textContent       = 'Enter email ↑';
      setTimeout(() => {
        this.style.borderColor = '';
        this.style.color       = '';
        this.textContent       = 'Sign in';
      }, 1500);
      return;
    }
    this.textContent = 'Signing in…';
    /* TODO: replace with real auth call */
    setTimeout(() => { this.textContent = 'Sign in'; }, 2000);
  });

  /* ══════════════════════════════════════
     11. INPUT STYLE FIX (browser autofill override)
  ══════════════════════════════════════ */
  document.querySelectorAll('input').forEach(inp => {
    inp.style.setProperty('background',       'transparent', 'important');
    inp.style.setProperty('background-color', 'transparent', 'important');
    inp.style.setProperty('color',            '#c0caf5',     'important');
  });

  window.addEventListener('resize', () => {
    if (layerTerminal.classList.contains('on')) resizeTerm();
  });

})();
