/* ============================================================
   anything.html — TRANSMISSION 002.5
   Minimal JS:
     1. Live transmission clock (top bar + closing stamp)
     2. Sticky-nav scroll state
     3. Hero video best-effort autoplay + meter
     4. Frame discovery (probe assets/frames/ until first 404)
     5. Scroll-driven CinemaScope canvas — bound to .tx-scope__pin
     6. Synthetic X/Y/Z readout cycles with scroll
   ============================================================ */

(() => {
  'use strict';

  /* ---------- helpers ---------- */
  const $  = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);
  const pad = (n, w = 2) => String(n).padStart(w, '0');

  /* ---------- 1. Live clocks ---------- */
  const clockTop   = $('tx-clock');
  const clockClose = $('tx-close-clock');
  function tickClocks() {
    const now = new Date();
    const t = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    if (clockTop)   clockTop.textContent   = t;
    if (clockClose) clockClose.textContent = t;
  }
  tickClocks();
  setInterval(tickClocks, 1000);

  /* ---------- 2. Top-bar scrolled state ---------- */
  const nav = $('nav');
  if (nav) {
    let pending = false;
    const upd = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        nav.classList.toggle('is-scrolled', window.scrollY > 24);
        pending = false;
      });
    };
    window.addEventListener('scroll', upd, { passive: true });
    upd();
  }

  /* ---------- 3. Hero scroll-driven canvas + HUD meter ----------
     Same pattern as the Sights scrolly: a tall .tx-hero section with a
     sticky inner pin. As the user scrolls through the section, scroll
     progress (0 -> 1) maps to a frame index (1 -> N), and we redraw the
     canvas + update the HUD meter / frame readout. */
  const heroSection = document.querySelector('.tx-hero[data-flipbook]');
  const heroCanvas  = $('hero-canvas');
  const heroCtx     = heroCanvas ? heroCanvas.getContext('2d', { alpha: false }) : null;
  const meterFill   = $('tx-meter');
  const hudFrame    = $('tx-hud-frame');

  if (heroSection && heroCanvas && heroCtx) {
    const HERO_TOTAL    = Number(heroSection.dataset.frames) || 192;
    const HERO_BASE     = (heroSection.dataset.framesDir || 'assets/ring-frames').replace(/\/$/, '') + '/';
    const HERO_PAD      = 3;
    const heroFrames    = new Array(HERO_TOTAL + 1);
    const heroLoaded    = new Array(HERO_TOTAL + 1);
    let   heroLastIdx   = -1;
    let   heroTicking   = false;

    const heroUrl = (i) => HERO_BASE + 'frame_' + String(i).padStart(HERO_PAD, '0') + '.jpg';

    function loadHeroFrame(i) {
      if (heroFrames[i]) return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { heroLoaded[i] = true; if (i === 1) drawHero(1); };
      img.src = heroUrl(i);
      heroFrames[i] = img;
    }

    // Eager-load the first frame + last frame so we have bookends immediately.
    loadHeroFrame(1);
    loadHeroFrame(HERO_TOTAL);

    // Idle-load the remaining frames in order so scrubbing has something to show.
    (function queue(next) {
      const step = (deadline) => {
        while (next <= HERO_TOTAL && (!deadline || deadline.timeRemaining() > 4)) {
          loadHeroFrame(next++);
        }
        if (next <= HERO_TOTAL) queue(next);
      };
      if ('requestIdleCallback' in window) {
        requestIdleCallback(step, { timeout: 2000 });
      } else {
        setTimeout(() => step({ timeRemaining: () => 8 }), 50);
      }
    })(2);

    function sizeHeroCanvas() {
      const dpr  = Math.min(window.devicePixelRatio || 1, 2);
      const rect = heroCanvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width  * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (heroCanvas.width !== w || heroCanvas.height !== h) {
        heroCanvas.width  = w;
        heroCanvas.height = h;
      }
    }

    function drawHero(idx) {
      // Walk back to the nearest already-loaded frame so scrub never blanks out.
      let pick = idx;
      while (pick > 1 && !heroLoaded[pick]) pick--;
      const img = heroFrames[pick];
      if (!img || !img.naturalWidth) return;

      sizeHeroCanvas();
      const cw = heroCanvas.width, ch = heroCanvas.height;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      // Cover-fit the 16:9 frame into the 16:11 stack so the ring stays
      // centered while the cinemascope letterbox crop is preserved.
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale, dh = ih * scale;
      const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
      heroCtx.fillStyle = '#060504';
      heroCtx.fillRect(0, 0, cw, ch);
      heroCtx.drawImage(img, dx, dy, dw, dh);
    }

    function onHeroScroll() {
      if (heroTicking) return;
      heroTicking = true;
      requestAnimationFrame(() => {
        const rect       = heroSection.getBoundingClientRect();
        const vh         = window.innerHeight || document.documentElement.clientHeight;
        const scrollable = Math.max(1, heroSection.offsetHeight - vh);
        const passed     = Math.min(scrollable, Math.max(0, -rect.top));
        const progress   = passed / scrollable;
        const idx        = Math.min(HERO_TOTAL, Math.max(1, Math.round(progress * (HERO_TOTAL - 1)) + 1));

        if (idx !== heroLastIdx) {
          heroLastIdx = idx;
          drawHero(idx);
          if (hudFrame) {
            hudFrame.textContent = String(idx).padStart(3, '0') + ' / ' + String(HERO_TOTAL).padStart(3, '0');
          }
        }
        if (meterFill) {
          meterFill.style.setProperty('--p', (progress * 100).toFixed(1) + '%');
        }
        heroTicking = false;
      });
    }

    window.addEventListener('scroll', onHeroScroll, { passive: true });
    window.addEventListener('resize', onHeroScroll, { passive: true });
    onHeroScroll();
  }

  /* ============================================================
     4 & 5. Frame discovery + scroll-driven canvas
     ============================================================ */

  const FRAME_BASE = 'assets/ring-frames/';
  const FRAME_PAD  = 3;
  const FRAME_EXT  = '.jpg';
  const MAX_PROBE  = 300;
  const BATCH      = 24;

  const canvas        = $('frames-canvas');
  const ctx           = canvas ? canvas.getContext('2d', { alpha: false }) : null;
  const loader        = $('frames-loader');
  const loaderFill    = $('frames-loader-fill');
  const loaderHint    = $('frames-loader-hint');
  const sideNum       = $('frames-side-num');
  const sideTotal     = $('frames-side-total');
  const readoutFrame  = $('readout-frame');
  const readoutX      = $('readout-x');
  const readoutY      = $('readout-y');
  const readoutZ      = $('readout-z');
  const pinWrap       = document.querySelector('.tx-scope__pin');

  let frames = [];
  let frameCount = 0;
  let currentFrame = -1;

  const url = (i) => FRAME_BASE + 'frame_' + String(i).padStart(FRAME_PAD, '0') + FRAME_EXT;
  function loadImg(u) {
    return new Promise((ok, fail) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => ok(img);
      img.onerror = () => fail();
      img.src = u;
    });
  }

  async function discover() {
    let i = 1;
    while (i <= MAX_PROBE) {
      const batch = [];
      for (let j = 0; j < BATCH && i + j <= MAX_PROBE; j++) {
        batch.push(loadImg(url(i + j)).then(img => ({ ok: true, idx: i + j, img }),
                                            () => ({ ok: false, idx: i + j })));
      }
      const out = (await Promise.all(batch)).sort((a, b) => a.idx - b.idx);
      let stop = false;
      for (const r of out) {
        if (r.ok) {
          frames[r.idx] = r.img;
          frameCount = r.idx;
          if (loaderFill) {
            const cappedPct = Math.min(100, Math.round((r.idx / Math.max(r.idx, 60)) * 100));
            loaderFill.style.right = `${100 - cappedPct}%`;
          }
        } else {
          stop = true; break;
        }
      }
      if (stop) break;
      i += BATCH;
    }
    return frameCount;
  }

  function sizeCanvas() {
    if (!canvas) return;
    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width  = Math.max(1, Math.floor(rect.width  * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    if (currentFrame >= 1) drawFrame(currentFrame);
  }

  function drawFrame(i) {
    if (!ctx || !frames[i]) return;
    const img = frames[i];
    const cw = canvas.width, ch = canvas.height;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    // padded cover — slightly under-fill to keep edges clean inside the letterbox
    const scale = Math.max(cw / iw, ch / ih) * 0.96;
    const dw = iw * scale, dh = ih * scale;
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    ctx.fillStyle = '#060504';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function getProgress() {
    if (!pinWrap) return 0;
    const rect = pinWrap.getBoundingClientRect();
    const scrollable = pinWrap.offsetHeight - window.innerHeight;
    const scrolled   = Math.max(0, Math.min(scrollable, -rect.top));
    return scrollable > 0 ? scrolled / scrollable : 0;
  }

  let pending = false;
  function onScopeScroll() {
    if (pending || frameCount === 0) return;
    pending = true;
    requestAnimationFrame(() => {
      const p = getProgress();
      const idx = Math.min(frameCount, Math.max(1, Math.round(p * (frameCount - 1)) + 1));
      if (idx !== currentFrame) {
        currentFrame = idx;
        drawFrame(idx);
        if (sideNum)      sideNum.textContent      = pad(idx, 3);
        if (readoutFrame) readoutFrame.textContent = `${pad(idx, 3)} / ${pad(frameCount, 3)}`;
        // Synthetic specimen coordinates — phase-shifted across the scroll so the
        // readout feels alive but not random.
        const t = p * Math.PI * 2;
        if (readoutX) readoutX.textContent = pad(Math.round(1500 + Math.sin(t) * 1200), 4);
        if (readoutY) readoutY.textContent = pad(Math.round(1500 + Math.cos(t * 1.3) * 1100), 4);
        if (readoutZ) readoutZ.textContent = pad(Math.round(1500 + Math.sin(t * 0.7 + 1) * 900), 4);
      }
      pending = false;
    });
  }

  async function boot() {
    if (!canvas) return;
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);

    try {
      const total = await discover();
      if (total === 0) {
        if (loaderHint) {
          loaderHint.innerHTML =
            'Frame buffer empty. Run <code>scripts/gen-ring-dissection-frames.ps1</code> to populate ' +
            '<code>assets/ring-frames/</code>. This page will pick them up automatically.';
        }
        return;
      }
      if (sideTotal)    sideTotal.textContent    = pad(total, 3);
      if (readoutFrame) readoutFrame.textContent = `001 / ${pad(total, 3)}`;
      if (loader) loader.classList.add('is-hidden');

      currentFrame = 1;
      drawFrame(1);
      window.addEventListener('scroll', onScopeScroll, { passive: true });
      onScopeScroll();
    } catch (err) {
      console.error(err);
      if (loaderHint) loaderHint.textContent = 'Could not load frames. Make sure the page is served over HTTP, not file://.';
    }
  }

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
