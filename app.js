/* ============================================================
   app.js — zipper_tools
   Flow:
     1. Page load  → modal centered, no navbar, bg frozen
     2. Submit     → modal fades out, navbar + terminal appear,
                     terminal types the command
     3. new submit → terminal hides, modal reappears
     4. nav login  → modal reappears with LOGIN tab active
   ============================================================ */

(function () {
  'use strict';

  /* ── Helpers ── */
  function ri(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function rh(n)    { return Array.from({ length: n }, () => ri(0, 15).toString(16)).join(''); }
  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

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
     4. TERMINAL CANVAS ANIMATION
  ══════════════════════════════════════ */
  const termCanvas = document.getElementById('termCanvas');
  const termCtx    = termCanvas.getContext('2d');
  const TLH        = 18;
  let tlines       = [];
  let tw, th, tmax;
  let cursorLine   = null;
  let animRunning  = false;

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
    if (line.includes('Score'))                     return '#e0af68';
    if (line.includes('[domain]'))                  return '#60a5fa';
    if (line.includes('[ip]'))                      return '#f59e0b';
    if (line.includes('[key]'))                     return '#f87171';
    if (line.includes('[hash]'))                    return '#a78bfa';
    if (line.includes('Error'))                     return '#f87171';
    if (line.startsWith('  '))                      return '#8899cc';
    return '#3d5280';
  }

  function renderTerm() {
    termCtx.fillStyle = '#070810';
    termCtx.fillRect(0, 0, tw, th);
    termCtx.font = '14px monospace';

    tlines.slice(-tmax).forEach((line, i) => {
      termCtx.fillStyle = termColor(line);
      termCtx.fillText(line, 14, (i + 1) * TLH);
    });

    if (cursorLine !== null) {
      const row = Math.min(tlines.length, tmax);
      const cx  = 14 + termCtx.measureText(cursorLine).width;
      if (Math.floor(Date.now() / 350) % 2 === 0) {
        termCtx.fillStyle = '#9ece6a';
        termCtx.fillRect(cx, row * TLH - 13, 8, 15);
      }
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

  function pushLine(line) {
    tlines.push(line);
    if (tlines.length > tmax + 2) tlines.shift();
  }

  function buildScript(type, value) {
    const jobId = `${rh(8)}-${rh(4)}-${rh(4)}-${rh(4)}-${rh(12)}`;
    const score = ri(10, 97);
    const iocs  = ri(3, 28);
    const secs  = ri(90, 430);
    const sc    = score > 70 ? `${score}/100  ⚠ malicious` : `${score}/100  ✓ clean`;
    const arg   = type === 'url'    ? `"${value}"`
                : type === 'search' ? `--search "${value}"`
                : value;

    return [
      { type: 'prompt', text: `~/zipper_tools ❯ zipper submit ${arg}`,          speed: 36  },
      { type: 'output', text: `  Uploading...  ████████████  ✓`,                 delay: 300 },
      { type: 'output', text: `  Job ID   ${jobId}`,                             delay: 120 },
      { type: 'output', text: `  Status   queued`,                               delay: 80  },
      { type: 'blank',  text: ``,                                                delay: 260 },
      { type: 'prompt', text: `~/zipper_tools ❯ zipper status ${jobId.slice(0,8)}`, speed: 32 },
      { type: 'output', text: `  Status   running...`,                           delay: 900 },
      { type: 'output', text: `  Status   finished  (${secs}s)`,                 delay: 400 },
      { type: 'output', text: `  Score    ${sc}`,                                delay: 130 },
      { type: 'output', text: `  IOCs     ${iocs} indicators found`,             delay: 110 },
      { type: 'blank',  text: ``,                                                delay: 260 },
      { type: 'prompt', text: `~/zipper_tools ❯ zipper iocs ${jobId.slice(0,8)}`, speed: 32 },
      { type: 'output', text: `  [domain] ${['c2.evil.xyz','fir.app.firebaseio.com','drop.attacker.net'][ri(0,2)]}`, delay: 120 },
      { type: 'output', text: `  [ip]     ${ri(100,220)}.${ri(0,255)}.${ri(0,255)}.${ri(1,254)}`, delay: 110 },
      { type: 'output', text: `  [key]    AIzaSy${rh(12)}...`,                   delay: 110 },
      { type: 'output', text: `  [hash]   ${rh(20)}...`,                         delay: 110 },
      { type: 'blank',  text: ``,                                                delay: 200 },
      { type: 'idle',   text: `~/zipper_tools ❯ `,                              delay: 100 },
    ];
  }

  async function runScript(script) {
    resizeTerm();
    tlines = [];
    cursorLine = null;
    startRenderLoop();

    for (const step of script) {
      if (step.type === 'prompt') {
        const full = step.text;
        for (let c = 0; c <= full.length; c++) {
          cursorLine = full.slice(0, c);
          await sleep(step.speed || 36);
        }
        pushLine(full);
        cursorLine = null;
        await sleep(130);

      } else if (step.type === 'idle') {
        pushLine(step.text);
        cursorLine = step.text;

      } else {
        await sleep(step.delay || 100);
        pushLine(step.text);
      }
    }
  }

  /* ══════════════════════════════════════
     5. SUBMIT HANDLERS
  ══════════════════════════════════════ */
  function handleSubmit(type, value) {
    if (!value.trim()) return;
    showTerminal();
    setTimeout(() => runScript(buildScript(type, value)), 320);
  }

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
    handleSubmit('url', val);
  });
  document.getElementById('urlInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('submitUrl').click();
  });

  /* SEARCH */
  document.getElementById('submitSearch').addEventListener('click', () => {
    const val = document.getElementById('searchInput').value.trim();
    if (!val) { shakeField('#tc-search .field-row'); return; }
    handleSubmit('search', val);
  });
  document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('submitSearch').click();
  });

  /* FILE */
  const fileInput  = document.getElementById('fileInput');
  const browseLink = document.querySelector('.browse-link');
  if (browseLink) browseLink.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleSubmit('file', fileInput.files[0].name);
  });

  /* ══════════════════════════════════════
     6. NAVBAR BUTTONS
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
     7. LOGIN
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
     8. INPUT STYLE FIX (browser override)
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
