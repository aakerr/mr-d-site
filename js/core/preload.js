// preload.js — the first-run loading gate.
//
// The first visit on a new machine used to stream assets as screens asked for
// them: backgrounds arrived half a second late, the flyover music stuttered
// mid-flight, and the POTW intro video lost the race and fell back to its
// song — all cache misses, all gone on the second visit. The owner's call:
// block ONCE, up front, with an honest progress bar, and pull EVERYTHING —
// art, sound effects, music, and the two intro films — so the very first
// class period plays like the hundredth.
//
// Mechanics: every file goes through fetch() into the HTTP cache, one at a
// time (matching the idle warm-up in main.js, which stays as the safety net
// for cache evictions on later visits). Progress counts files, plus a
// fractional byte-count inside the file currently streaming, so the two big
// films at the end crawl smoothly instead of freezing the bar. A finished
// gate stamps localStorage and never runs again until MANIFEST_VERSION bumps.
// "Start without waiting" skips the gate for a teacher in a hurry — the idle
// warm-up picks up whatever was left.
import { CONFIG } from '../config.js';

const FLAG_KEY = 'mrd-assets-warmed';
const MANIFEST_VERSION = 'v6';   // v6: the owner recut the procession film (1080p) — re-pull it

// Grouped so the caption can say what is loading in classroom words.
// Order: small and immediately-visible first, the two films last.
const MANIFEST = [
  { label: 'the crests and icons', files: [
    'images/camelot-shield.png', 'images/atlantis-shield.png', 'images/valhalla-shield.png',
    'images/rivendell-shield.png', 'images/class-shield.png',
    'images/icon-points.png', 'images/icon-potw.png', 'images/icon-quest.png', 'images/icon-battle.png',
    'images/icon-market.png', 'images/icon-dice.png', 'images/icon-wheel.png', 'images/icon-scales.png',
    'images/icon-trivia.png', 'images/sword-forged.png',
    'images/quest-academic.png', 'images/quest-community.png', 'images/quest-habit.png', 'images/quest-service.png',
  ] },
  { label: 'the magic shop', files: [
    'images/shop/sword-of-destiny.png', 'images/shop/net-of-entrapment.png', 'images/shop/legendary-ice-axe.png',
    'images/shop/cloak-of-invisibility.png', 'images/shop/catapult.png', 'images/shop/staff-of-ra.png',
    'images/shop/warhorse.png', 'images/shop/shield-of-protection.png', 'images/shop/gauntlet-of-defense.png',
    'images/shop/bow-of-seeking.png', 'images/shop/eye-of-horus.png', 'images/shop/stone-of-seeing.png',
    'images/shop/shroud-of-secrecy.png', 'images/shop/time-turner.png', 'images/shop/bag-of-holding.png',
  ] },
  { label: 'the painted halls', files: [
    'images/header-camelot-v2.jpg', 'images/header-atlantis-v2.jpg',
    'images/header-valhalla-v2.jpg', 'images/header-rivendell-v2.jpg',
    'images/four-armies.jpg', 'images/quest-hall.jpg', 'images/magic-shop.jpg',
    'images/potw-background.jpg', 'images/die-of-destiny.jpg', 'images/council-chamber.jpg',
    'images/wheel-background.jpg', 'images/wheel-outside.png', 'images/wheel-center.png',
    'images/wheel-center-fate.png',
    'images/trivia-background.jpg', 'images/trivia-card.png',
  ] },
  { label: 'the sound effects', files: [
    'sfx/battle_day.mp3', 'sfx/swords_clashing.mp3', 'sfx/defensive_block-1.mp3',
    'sfx/points_awarded.mp3', 'sfx/mythical_relic.mp3', 'sfx/timer-end.mp3',
    'sfx/trivia-card-reveal.mp3', 'sfx/trivia-question-reveal.mp3', 'sfx/trivia-answer-reveal.mp3',
    'sfx/trivia-correct-answer.mp3', 'sfx/trivia-wrong-answer.mp3',
  ] },
  { label: 'the music', files: [
    'music/the-grand-pavilion.mp3', 'music/honor-roll.mp3', 'music/the-long-road-ahead.mp3',
    'music/bridging-the-path.mp3', 'music/storming-the-gates.mp3', 'music/looming-roll.mp3',
    'music/breath-of-fate.mp3', 'music/vanguard-charge.mp3', 'music/ancient-sands.mp3',
    'music/travel-zoom.mp3',
  ] },
  { label: 'the intro films (the big ones)', files: [
    'videos/classic.mp4', 'videos/rock.mp4', 'videos/trivia-tuesday-short.mp4',
  ] },
];

function alreadyWarmed() {
  try { return localStorage.getItem(FLAG_KEY) === MANIFEST_VERSION; } catch (e) { return true; }
}

function stampWarmed() {
  try { localStorage.setItem(FLAG_KEY, MANIFEST_VERSION); } catch (e) { /* private mode — gate just runs again */ }
}

const OVERLAY_CSS = `
  #mrd-firstload{position:fixed;inset:0;z-index:2000;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:1.1rem;text-align:center;padding:2rem;
    background:radial-gradient(ellipse at 50% -20%,rgba(245,158,11,.12),transparent 55%),
      linear-gradient(180deg,#0b0f19,#0d1120 60%,#0b0f19);
    transition:opacity .6s ease;}
  #mrd-firstload.done{opacity:0;pointer-events:none;}
  .mrd-fl-title{font-family:'Cinzel',Georgia,serif;font-weight:800;letter-spacing:.06em;
    font-size:clamp(1.8rem,4.5vw,3rem);color:#fbbf24;line-height:1.1;
    text-shadow:0 0 40px rgba(251,191,36,.5),0 2px 10px rgba(0,0,0,.85);}
  .mrd-fl-sub{color:#9ca3af;font-style:italic;font-size:clamp(.95rem,2vw,1.2rem);max-width:34rem;line-height:1.5;}
  .mrd-fl-barwrap{width:min(560px,84vw);height:14px;border-radius:999px;overflow:hidden;
    background:rgba(255,255,255,.07);border:1px solid rgba(251,191,36,.35);}
  .mrd-fl-bar{height:100%;width:0%;border-radius:999px;
    background:linear-gradient(90deg,#d97706,#fbbf24);box-shadow:0 0 18px rgba(251,191,36,.6);
    transition:width .25s ease;}
  .mrd-fl-status{color:#d1d5db;font-size:clamp(.85rem,1.8vw,1.05rem);min-height:1.4em;}
  .mrd-fl-skip{margin-top:.4rem;background:transparent;border:1px solid #4b5563;color:#9ca3af;
    border-radius:.7rem;padding:.5rem 1.1rem;font-size:.9rem;cursor:pointer;}
  .mrd-fl-skip:hover{border-color:#fbbf24;color:#fde68a;}
`;

// Streams one file into the cache, reporting byte progress along the way.
async function warmFile(url, onFrac) {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) { await res.blob?.(); return; }
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (total) onFrac(Math.min(1, got / total));
    }
  } catch (e) { /* a missing file must not block the classroom */ }
}

export async function ensureAssetsWarm() {
  if (alreadyWarmed()) return;

  const st = document.createElement('style');
  st.textContent = OVERLAY_CSS;
  document.head.appendChild(st);

  const el = document.createElement('div');
  el.id = 'mrd-firstload';
  el.innerHTML = `
    <div class="mrd-fl-title">Mr. D's Classroom OS</div>
    <div class="mrd-fl-sub">First visit on this computer — gathering every painting, sound and film so
      nothing ever keeps the class waiting. This happens once.</div>
    <div class="mrd-fl-barwrap"><div class="mrd-fl-bar"></div></div>
    <div class="mrd-fl-status">Preparing…</div>
    <button type="button" class="mrd-fl-skip">Start without waiting →</button>`;
  document.body.appendChild(el);

  const bar = el.querySelector('.mrd-fl-bar');
  const status = el.querySelector('.mrd-fl-status');
  let skipped = false;
  el.querySelector('.mrd-fl-skip').addEventListener('click', () => { skipped = true; });

  const all = MANIFEST.flatMap((g) => g.files.map((f) => ({ f, label: g.label })));
  const total = all.length;
  let done = 0;
  const paint = (frac) => {
    const pct = Math.min(100, ((done + frac) / total) * 100);
    bar.style.width = `${pct.toFixed(1)}%`;
  };

  for (const { f, label } of all) {
    if (skipped) break;
    status.textContent = `Gathering ${label}… (${done + 1} of ${total})`;
    await warmFile(f, paint);
    done += 1;
    paint(0);
  }

  if (!skipped) {
    stampWarmed();
    status.textContent = 'The classroom is ready.';
    bar.style.width = '100%';
  }
  // Skipped or finished, the gate bows out the same way; the idle warm-up in
  // main.js quietly finishes anything a skip left behind.
  el.classList.add('done');
  setTimeout(() => { el.remove(); st.remove(); }, 700);
}
