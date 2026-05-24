/* ============================================================
   Tester Smart Watch Pro — product.html
   Minimal JS:
     1. Scroll-triggered reveals via IntersectionObserver
     2. Sticky-nav state toggle on scroll
     3. Best-effort autoplay for hero + dissection video on mobile
   ============================================================ */

(() => {
  'use strict';

  /* ---------- 1. Scroll reveals ---------- */
  const revealEls = document.querySelectorAll('[data-reveal]');
  revealEls.forEach((el) => {
    const delay = el.dataset.revealDelay;
    if (delay) el.style.setProperty('--reveal-delay', `${delay}ms`);
  });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  /* ---------- 2. Sticky-nav scroll state ---------- */
  const nav = document.getElementById('nav');
  if (nav) {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        nav.classList.toggle('is-scrolled', window.scrollY > 24);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- 3. Video autoplay resilience ----------
     Some mobile browsers won't autoplay until a play() call after
     load — call it explicitly, silently swallow failures. */
  document.querySelectorAll('video').forEach((v) => {
    const tryPlay = () => v.play().catch(() => {});
    if (v.readyState >= 2) tryPlay();
    else v.addEventListener('loadeddata', tryPlay, { once: true });
  });
})();
