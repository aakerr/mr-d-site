// carousel.js — one horizontal card-strip implementation, shared by any screen
// that offers a carousel instead of a scrolling grid.
//
// WHY THIS EXISTS: the Quests board grew a carousel inline, and every round of
// polish on the grid then had to be hand-copied into it. Three separate
// divergences came out of that — a missing top gap, a description crushed to
// 5px, and an Accept button that was two different heights depending on the
// view. Anything both screens should share belongs here; anything genuinely
// specific to one screen (card internals, what "3 lines of description" means)
// stays in that screen.
//
// The caller owns the CARDS. This module owns the strip, the arrows, the
// counter, and which card is centred.
//
// Sizing is by CSS variable so each screen can set its own card width without
// forking this file:
//   --carousel-card-w    width of one card (default 250px)
//   --carousel-card-maxh max card height   (default 340px)

import { escapeAttr } from './escape.js';

const STYLE_ID = 'shared-carousel-styles';

export function injectCarouselStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  /* min-width:0 and max-width:100% are load-bearing. A flex item defaults to
     min-width:auto, so inside a ROW flex container the wrap sizes to the
     strip's full scroll width instead of the space available — 3400px inside a
     1200px shell, which pushes every card off-screen and leaves an empty band.
     The column-flex hosts happened not to hit it; the Magic Shop did. */
  .car-wrap{flex:1;min-width:0;max-width:100%;min-height:0;
    position:relative;display:flex;align-items:center;}
  .car-strip{flex:1;min-width:0;height:100%;display:flex;align-items:center;
    gap:var(--carousel-gap,14px);overflow-x:auto;overflow-y:hidden;
    /* NO scroll-behavior:smooth. On a scroll-snap:mandatory container it
       swallows programmatic scrolls entirely — scrollBy, scrollIntoView and
       scrollTo({behavior:'smooth'}) all leave the strip exactly where it was,
       while a plain scrollLeft assignment works. Measured, not guessed. */
    scroll-snap-type:x mandatory;
    /* Half a card of side padding so the first and last can still reach dead
       centre, and a bottom lane so cards never run under the counter. */
    padding:clamp(6px,1vh,12px) calc(50% - (var(--carousel-card-w,250px) / 2)) clamp(20px,3vh,26px);
    scrollbar-width:none;}
  .car-strip::-webkit-scrollbar{display:none;}

  .car-strip > *{flex:0 0 var(--carousel-card-w,250px);height:100%;
    max-height:var(--carousel-card-maxh,340px);scroll-snap-align:center;
    transform:scale(.84);opacity:.42;filter:saturate(.6);
    transition:transform .28s ease,opacity .28s ease,filter .28s ease,border-color .28s ease;
    transform-origin:center center;}
  /* Scale 1, never above it: a scaled-up focus card overflows the strip when a
     screen puts anything else above the carousel, and collides with the
     counter. The contrast comes from the neighbours receding instead. */
  .car-strip > .is-focus{transform:scale(1);opacity:1;filter:none;}

  .car-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:3;
    width:44px;height:44px;border-radius:999px;cursor:pointer;
    border:1px solid var(--color-line,#374151);background:rgba(17,24,39,.9);
    color:var(--accent,#f59e0b);font-size:1.6rem;line-height:1;
    display:flex;align-items:center;justify-content:center;}
  .car-arrow:hover{border-color:var(--accent,#f59e0b);background:var(--color-card2,#1f2937);}
  .car-arrow[disabled]{opacity:.25;cursor:default;}
  .car-prev{left:0;} .car-next{right:0;}
  .car-counter{position:absolute;bottom:0;left:50%;transform:translateX(-50%);
    color:var(--color-text-soft,#9ca3af);font-size:.8rem;font-variant-numeric:tabular-nums;
    pointer-events:none;}
  html[data-mode="light"] .car-arrow{background:rgba(255,255,255,.92);}
  `;
  document.head.appendChild(s);
}

/**
 * Wrap caller-rendered cards in the carousel chrome.
 * `cardsHtml` must be the cards themselves — each becomes a strip child.
 */
export function carouselHtml(cardsHtml, { label = 'items' } = {}) {
  return `
    <div class="car-wrap">
      <button type="button" class="car-arrow car-prev" data-car="prev" aria-label="Previous ${escapeAttr(label)}">‹</button>
      <div class="car-strip" data-car-strip>${cardsHtml}</div>
      <button type="button" class="car-arrow car-next" data-car="next" aria-label="More ${escapeAttr(label)}">›</button>
      <div class="car-counter" data-car-counter></div>
    </div>`;
}

/**
 * Wire a rendered carousel. Safe to call on every render — it re-reads the DOM
 * and attaches to the new strip. Returns a teardown function.
 *
 * `root` is any ancestor of the strip. `restoreLeft` re-applies a previously
 * captured scroll position (screens re-render often; without this the strip
 * jumps back to the first card).
 */
export function wireCarousel(root, { restoreLeft = 0 } = {}) {
  // Self-cleaning: screens re-render constantly and the click listener lives on
  // `root`, which SURVIVES those re-renders. A caller that forgets to tear down
  // would stack a listener per render and fire an arrow N times per tap. Undo
  // our own previous wiring first so that cannot happen.
  if (root && root.__carTeardown) { try { root.__carTeardown(); } catch (e) {} root.__carTeardown = null; }

  const strip = root && root.querySelector('[data-car-strip]');
  if (!strip) return () => {};
  const counter = root.querySelector('[data-car-counter]');
  const prev = root.querySelector('[data-car="prev"]');
  const next = root.querySelector('[data-car="next"]');
  const cards = [...strip.children];
  if (!cards.length) return () => {};

  if (restoreLeft) strip.scrollLeft = restoreLeft;

  const mark = () => {
    const mid = strip.getBoundingClientRect().left + strip.clientWidth / 2;
    let best = 0, bestD = Infinity;
    cards.forEach((c, i) => {
      const b = c.getBoundingClientRect();
      const d = Math.abs((b.left + b.width / 2) - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    cards.forEach((c, i) => c.classList.toggle('is-focus', i === best));
    // The index lives on the element, NOT inferred from .is-focus when an arrow
    // is pressed: the class is set a frame later, so reading it back made every
    // click after the first recompute the same card and stand still.
    strip.dataset.idx = String(best);
    if (counter) counter.textContent = `${best + 1} of ${cards.length}`;
    if (prev) prev.disabled = best === 0;
    if (next) next.disabled = best === cards.length - 1;
  };

  const go = (dir) => {
    const cur = Number(strip.dataset.idx || 0);
    const i = Math.min(cards.length - 1, Math.max(0, cur + dir));
    strip.dataset.idx = String(i);
    // Plain assignment — see the scroll-behavior note in the styles above.
    strip.scrollLeft = cards[i].offsetLeft - (strip.clientWidth - cards[i].offsetWidth) / 2;
    mark();
  };

  let raf = null;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; mark(); });
  };
  const onClick = (e) => {
    const b = e.target.closest('[data-car]');
    if (!b || !root.contains(b)) return;
    go(b.dataset.car === 'next' ? 1 : -1);
  };

  strip.addEventListener('scroll', onScroll);
  root.addEventListener('click', onClick);
  mark();

  const teardown = () => {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    strip.removeEventListener('scroll', onScroll);
    root.removeEventListener('click', onClick);
    if (root.__carTeardown === teardown) root.__carTeardown = null;
  };
  root.__carTeardown = teardown;
  return teardown;
}

/** Current scroll offset, so a caller can carry it across a re-render. */
export function carouselScrollLeft(root) {
  const strip = root && root.querySelector('[data-car-strip]');
  return strip ? strip.scrollLeft : 0;
}
