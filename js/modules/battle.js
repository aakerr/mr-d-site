// battle.js — "Battle Day!" cinematic mode.
// Landing (armed ignition button) -> full-screen cinematic overlay (#overlay-root)
// -> Combat Mode (house battle cards, quick strikes, link to Magic Shop).
// Owns ONLY this file. Follows ARCHITECTURE.md contract.

const STYLE_ID = 'battle-styles';

// ---- module-scoped lifecycle state -----------------------------------------
let ctxRef = null;
let rootEl = null;            // mount target inside #module-root
let overlayEl = null;         // cinematic overlay inside #overlay-root
let unsub = null;             // store subscription
let view = 'landing';         // 'landing' | 'combat'
const timers = new Set();

function later(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.warn('battle:', e); } }, ms);
  timers.add(id);
  return id;
}
function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function houseImg(house, cls) {
  return `<img src="${house.image}" alt="${esc(house.name)} artwork" class="${cls}"
    onerror="this.onerror=null;this.style.display='none';" />`;
}

// =============================================================================
// STYLES
// =============================================================================
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
  /* ---- landing ---- */
  .battle-landing{position:relative;height:100%;display:flex;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;overflow:hidden;gap:1.5rem;
    background:radial-gradient(ellipse at 50% 30%,#2a0a0a 0%,#0b0f19 68%);}
  .battle-landing-eyebrow{color:#f87171;letter-spacing:.35em;text-transform:uppercase;
    font-size:clamp(.85rem,1.6vw,1.1rem);font-weight:700;}
  .battle-landing-title{font-size:clamp(1.5rem,3.2vw,2.25rem);color:#9ca3af;margin-bottom:.5rem;}
  .battle-ignite-btn{position:relative;background:linear-gradient(135deg,#7f1d1d,#b91c1c 45%,#ef4444);
    color:#fff;font-family:'Cinzel',Georgia,serif;font-weight:800;
    font-size:clamp(1.6rem,4.2vw,3rem);padding:clamp(24px,4vw,44px) clamp(40px,6vw,72px);
    border:3px solid #fca5a5;border-radius:1.5rem;min-height:48px;cursor:pointer;
    letter-spacing:.04em;box-shadow:0 0 0 0 rgba(239,68,68,.55),0 20px 60px rgba(0,0,0,.6);
    animation:battle-pulse-glow 2s ease-in-out infinite;transition:transform .15s ease;}
  .battle-ignite-btn:hover{transform:scale(1.04);}
  .battle-ignite-btn:active{transform:scale(.96);}
  @keyframes battle-pulse-glow{
    0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.55),0 20px 60px rgba(0,0,0,.6);}
    50%{box-shadow:0 0 50px 14px rgba(239,68,68,.65),0 20px 70px rgba(0,0,0,.7);}
  }
  .battle-landing-sub{color:#6b7280;font-size:clamp(.9rem,1.6vw,1.1rem);max-width:32rem;}

  /* ---- cinematic overlay ---- */
  .battle-cinematic{position:fixed;inset:0;z-index:60;overflow:hidden;
    background:radial-gradient(ellipse at 50% 50%,rgba(127,29,29,.35),#000 78%);
    display:flex;align-items:center;justify-content:center;}
  .battle-vignette{position:absolute;inset:0;pointer-events:none;
    box-shadow:inset 0 0 0 0 rgba(239,68,68,0);animation:battle-vignette-pulse 2.5s ease-in-out;}
  @keyframes battle-vignette-pulse{
    0%{box-shadow:inset 0 0 0 0 rgba(239,68,68,0);}
    30%{box-shadow:inset 0 0 140px 40px rgba(239,68,68,.55);}
    60%{box-shadow:inset 0 0 90px 20px rgba(239,68,68,.35);}
    100%{box-shadow:inset 0 0 60px 10px rgba(239,68,68,.25);}
  }
  .battle-swords-wrap{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%);
    display:flex;align-items:center;justify-content:center;pointer-events:none;}
  .battle-sword{font-size:clamp(4rem,10vw,8rem);position:absolute;
    filter:drop-shadow(0 0 24px rgba(255,180,120,.6));}
  .battle-sword-a{animation:battle-slam-a .7s cubic-bezier(.2,.9,.3,1.4) both;}
  .battle-sword-b{animation:battle-slam-b .7s cubic-bezier(.2,.9,.3,1.4) both;}
  @keyframes battle-slam-a{
    0%{transform:translate(-220px,-40px) rotate(-120deg) scale(.4);opacity:0;}
    70%{transform:translate(6px,0) rotate(-52deg) scale(1.15);opacity:1;}
    100%{transform:translate(0,0) rotate(-45deg) scale(1);opacity:1;}
  }
  @keyframes battle-slam-b{
    0%{transform:translate(220px,-40px) rotate(120deg) scale(.4);opacity:0;}
    70%{transform:translate(-6px,0) rotate(52deg) scale(1.15);opacity:1;}
    100%{transform:translate(0,0) rotate(45deg) scale(1);opacity:1;}
  }
  .battle-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;
    animation:battle-flash-pop .35s ease .55s both;}
  @keyframes battle-flash-pop{0%{opacity:0;}30%{opacity:.85;}100%{opacity:0;}}
  .battle-stamp{position:absolute;top:64%;left:50%;transform:translate(-50%,-50%);
    display:flex;gap:clamp(4px,.8vw,10px);font-family:'Cinzel',Georgia,serif;
    font-weight:800;font-size:clamp(2rem,6vw,4.5rem);color:#fca5a5;
    text-shadow:0 0 30px rgba(239,68,68,.8),0 4px 10px rgba(0,0,0,.8);}
  .battle-stamp span{display:inline-block;opacity:0;animation:battle-letter-stamp .35s ease both;}
  @keyframes battle-letter-stamp{
    0%{opacity:0;transform:scale(3) rotate(-8deg);}
    60%{opacity:1;transform:scale(.9) rotate(2deg);}
    100%{opacity:1;transform:scale(1) rotate(0);}
  }

  /* screen shake applied to #module-root during impact */
  .battle-shake{animation:battle-shake-kf .5s cubic-bezier(.36,.07,.19,.97) both;}
  @keyframes battle-shake-kf{
    0%,100%{transform:translate(0,0);}
    10%{transform:translate(-10px,-4px);}
    20%{transform:translate(9px,3px);}
    30%{transform:translate(-8px,4px);}
    40%{transform:translate(7px,-3px);}
    50%{transform:translate(-6px,2px);}
    60%{transform:translate(5px,-2px);}
    70%{transform:translate(-4px,2px);}
    80%{transform:translate(3px,-1px);}
    90%{transform:translate(-2px,1px);}
  }

  /* ---- combat mode ---- */
  .battle-combat{position:relative;height:100%;overflow-y:auto;overflow-x:hidden;
    padding:1.25rem clamp(1rem,3vw,2rem) 2rem;
    background:radial-gradient(ellipse at 50% -10%,rgba(153,27,27,.4),#0b0f19 55%),
      radial-gradient(ellipse at 100% 100%,rgba(127,29,29,.25),transparent 60%),#0b0f19;}
  .battle-embers{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0;}
  .battle-ember{position:absolute;bottom:-10px;border-radius:50%;
    background:radial-gradient(circle,#fca5a5,#ef4444 60%,transparent 75%);
    animation:battle-ember-rise linear infinite;opacity:.85;}
  @keyframes battle-ember-rise{
    0%{transform:translateY(0) translateX(0);opacity:0;}
    10%{opacity:.9;}
    100%{transform:translateY(-620px) translateX(var(--ember-drift,20px));opacity:0;}
  }
  .battle-header{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;
    text-align:center;gap:.35rem;margin-bottom:1.25rem;}
  .battle-header-title{font-family:'Cinzel',Georgia,serif;font-weight:800;
    font-size:clamp(1.4rem,3.4vw,2.4rem);color:#fca5a5;letter-spacing:.06em;
    text-shadow:0 0 26px rgba(239,68,68,.55);}
  .battle-header-sub{color:#f87171;letter-spacing:.2em;text-transform:uppercase;
    font-size:clamp(.75rem,1.3vw,.95rem);font-weight:700;}

  .battle-grid{position:relative;z-index:1;display:grid;grid-template-columns:repeat(2,1fr);
    gap:1rem;max-width:1100px;margin:0 auto;}
  @media (max-width:760px){.battle-grid{grid-template-columns:1fr;}}
  .battle-card{position:relative;border-radius:1.25rem;border:2px solid var(--bc-accent,#374151);
    background:linear-gradient(160deg,rgba(17,24,39,.92),rgba(11,15,25,.96));
    padding:1rem;display:flex;flex-direction:column;gap:.65rem;overflow:hidden;
    box-shadow:0 10px 30px rgba(0,0,0,.5);transition:transform .18s ease,box-shadow .18s ease;}
  .battle-card:hover{transform:translateY(-2px);}
  .battle-card-top{display:flex;align-items:center;gap:.75rem;}
  .battle-card-thumb{width:56px;height:56px;border-radius:.85rem;overflow:hidden;flex-shrink:0;
    border:2px solid var(--bc-accent,#374151);background:#1f2937;}
  .battle-card-thumb img{width:100%;height:100%;object-fit:cover;}
  .battle-card-name{font-weight:800;font-size:1.15rem;color:var(--bc-accent,#f9fafb);}
  .battle-shield-badge{margin-left:auto;font-size:.75rem;font-weight:700;padding:.3rem .55rem;
    border-radius:999px;background:rgba(59,130,246,.2);border:1px solid rgba(96,165,250,.6);
    color:#93c5fd;white-space:nowrap;}
  .battle-card-totals{display:flex;gap:.75rem;}
  .battle-total-chip{flex:1;background:#111827;border:1px solid #374151;border-radius:.75rem;
    padding:.5rem .6rem;text-align:center;}
  .battle-total-chip .lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;}
  .battle-total-chip .val{font-size:1.35rem;font-weight:800;color:#f9fafb;}
  .battle-card-actions{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:auto;}
  .battle-strike-btn{min-height:52px;border-radius:.85rem;font-weight:800;font-size:.95rem;
    cursor:pointer;border:none;transition:transform .12s ease,filter .12s ease;touch-action:manipulation;}
  .battle-strike-btn:active{transform:scale(.94);}
  .battle-strike-victory{background:linear-gradient(135deg,#16a34a,#15803d);color:#f0fdf4;}
  .battle-strike-defeat{background:linear-gradient(135deg,#991b1b,#7f1d1d);color:#fee2e2;}
  .battle-strike-btn:hover{filter:brightness(1.12);}
  .battle-float{position:absolute;top:6px;left:50%;transform:translateX(-50%);font-weight:800;
    font-size:1.3rem;pointer-events:none;text-shadow:0 2px 8px rgba(0,0,0,.7);
    animation:battle-float-up 1.1s ease-out forwards;z-index:5;}
  @keyframes battle-float-up{
    0%{opacity:0;transform:translate(-50%,0) scale(.85);}
    15%{opacity:1;transform:translate(-50%,-6px) scale(1.15);}
    75%{opacity:1;transform:translate(-50%,-40px) scale(1);}
    100%{opacity:0;transform:translate(-50%,-60px) scale(1);}
  }

  .battle-action-row{position:relative;z-index:1;display:flex;flex-wrap:wrap;gap:1rem;
    justify-content:center;margin:1.75rem auto 0;max-width:1100px;}
  .battle-shop-btn,.battle-end-btn{min-height:56px;padding:0 1.75rem;border-radius:1rem;
    font-weight:800;font-size:1.05rem;cursor:pointer;border:2px solid transparent;
    transition:transform .15s ease,filter .15s ease;touch-action:manipulation;}
  .battle-shop-btn:active,.battle-end-btn:active{transform:scale(.96);}
  .battle-shop-btn{background:linear-gradient(135deg,#a855f7,#7e22ce);color:#faf5ff;
    box-shadow:0 8px 26px rgba(168,85,247,.4);}
  .battle-end-btn{background:transparent;border-color:#4b5563;color:#e5e7eb;}
  .battle-end-btn:hover{border-color:#ef4444;color:#fca5a5;}

  @media (prefers-reduced-motion:reduce){
    .battle-ignite-btn,.battle-sword-a,.battle-sword-b,.battle-vignette,.battle-flash,
    .battle-stamp span,.battle-shake,.battle-ember{animation:none;}
  }
  `;
  document.head.appendChild(style);
}

// =============================================================================
// LANDING VIEW
// =============================================================================
function renderLanding() {
  if (!rootEl) return;
  view = 'landing';
  rootEl.innerHTML = `
    <div class="battle-landing">
      <div class="battle-landing-eyebrow">Friday Showdown</div>
      <div class="battle-landing-title">The houses stand ready&hellip;</div>
      <button type="button" class="battle-ignite-btn font-display">⚔️ BATTLE DAY!</button>
      <p class="battle-landing-sub">Tap to ignite Combat Mode — double points, quick strikes, and the Magic Shop are all live.</p>
    </div>`;
  rootEl.querySelector('.battle-ignite-btn').addEventListener('click', triggerCinematic);
}

// =============================================================================
// CINEMATIC ENTRY (overlay in #overlay-root)
// =============================================================================
function triggerCinematic() {
  const host = document.getElementById('overlay-root');
  if (!host || overlayEl) return;

  ctxRef.audio.sfx('sword');
  ctxRef.audio.say("It's Battle Day! Attack!", { rate: 1.05, pitch: 0.8 });

  overlayEl = document.createElement('div');
  overlayEl.className = 'battle-cinematic';
  const letters = 'BATTLE DAY'.split('');
  overlayEl.innerHTML = `
    <div class="battle-vignette"></div>
    <div class="battle-flash"></div>
    <div class="battle-swords-wrap">
      <span class="battle-sword battle-sword-a">🗡️</span>
      <span class="battle-sword battle-sword-b">🗡️</span>
    </div>
    <div class="battle-stamp">
      ${letters.map((ch, i) => `<span style="animation-delay:${0.55 + i * 0.07}s">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('')}
    </div>`;
  host.appendChild(overlayEl);

  const mainEl = document.getElementById('module-root');
  if (mainEl) {
    mainEl.classList.remove('battle-shake');
    void mainEl.offsetWidth;
    mainEl.classList.add('battle-shake');
    later(() => mainEl.classList.remove('battle-shake'), 550);
  }

  later(() => {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    renderCombat();
  }, 2500);
}

// =============================================================================
// COMBAT MODE VIEW
// =============================================================================
function emberField(count = 16) {
  let html = '';
  for (let i = 0; i < count; i++) {
    const left = Math.round(Math.random() * 100);
    const size = 3 + Math.round(Math.random() * 5);
    const dur = 3.5 + Math.random() * 3.5;
    const delay = Math.random() * 5;
    const drift = Math.round((Math.random() - 0.5) * 60);
    html += `<span class="battle-ember" style="left:${left}%;width:${size}px;height:${size}px;
      animation-duration:${dur.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s;--ember-drift:${drift}px;"></span>`;
  }
  return html;
}

function houseCardHtml(store, house) {
  const week = store.getTotal(house.id, 'week');
  const term = store.getTotal(house.id, 'term');
  const shielded = store.isShielded(house.id);
  return `
    <div class="battle-card" style="--bc-accent:${house.accent}" data-house-card="${house.id}">
      <div class="battle-card-top">
        <div class="battle-card-thumb">${houseImg(house, 'w-full h-full')}</div>
        <div class="battle-card-name">${esc(house.name)}</div>
        ${shielded ? '<span class="battle-shield-badge">🛡️ Shielded</span>' : ''}
      </div>
      <div class="battle-card-totals">
        <div class="battle-total-chip"><div class="lbl">Week</div><div class="val">${week}</div></div>
        <div class="battle-total-chip"><div class="lbl">Term</div><div class="val">${term}</div></div>
      </div>
      <div class="battle-card-actions">
        <button type="button" class="battle-strike-btn battle-strike-victory" data-strike="10" data-house="${house.id}">+10 Victory</button>
        <button type="button" class="battle-strike-btn battle-strike-defeat" data-strike="-10" data-house="${house.id}">−10 Defeat</button>
      </div>
    </div>`;
}

function renderCombat() {
  if (!rootEl) return;
  view = 'combat';
  const store = ctxRef.store;
  const houses = Object.values(store.HOUSES);

  rootEl.innerHTML = `
    <div class="battle-combat">
      <div class="battle-embers">${emberField()}</div>
      <div class="battle-header">
        <div class="battle-header-sub">Friday Combat Protocol</div>
        <div class="battle-header-title font-display">⚔️ COMBAT MODE — DOUBLE OR NOTHING FRIDAY</div>
      </div>
      <div class="battle-grid">
        ${houses.map((h) => houseCardHtml(store, h)).join('')}
      </div>
      <div class="battle-action-row">
        <button type="button" class="battle-shop-btn">🛒 Open Magic Shop</button>
        <button type="button" class="battle-end-btn">🏳️ End Battle</button>
      </div>
    </div>`;

  rootEl.querySelector('.battle-shop-btn').addEventListener('click', () => ctxRef.registry.navigate('shop'));
  rootEl.querySelector('.battle-end-btn').addEventListener('click', endBattle);

  rootEl.querySelectorAll('[data-strike]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const houseId = Number(btn.getAttribute('data-house'));
      const delta = Number(btn.getAttribute('data-strike'));
      const reason = delta > 0 ? 'Battle Day Victory' : 'Battle Day Defeat';
      ctxRef.store.addPoints(houseId, delta, { reason, tag: 'battle' });
      ctxRef.audio.sfx(delta > 0 ? 'coin' : 'thud');
      const card = rootEl.querySelector(`[data-house-card="${houseId}"]`);
      if (card) {
        card.style.position = card.style.position || 'relative';
        const badge = document.createElement('div');
        badge.className = 'battle-float';
        badge.style.color = delta > 0 ? '#4ade80' : '#f87171';
        badge.textContent = `${delta > 0 ? '+' : ''}${delta}`;
        card.appendChild(badge);
        later(() => badge.remove(), 1200);
      }
    });
  });
}

function endBattle() {
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  const mainEl = document.getElementById('module-root');
  if (mainEl) mainEl.classList.remove('battle-shake');
  renderLanding();
}

// =============================================================================
// Module contract
// =============================================================================
export default {
  id: 'battle',
  title: 'Battle Day',
  icon: '⚔️',
  order: 30,
  showTile: true,

  mount(el, ctx) {
    ctxRef = ctx;
    rootEl = el;
    injectStyles();
    renderLanding();
    unsub = ctx.store.subscribe(() => { if (view === 'combat') renderCombat(); });
  },

  unmount() {
    clearTimers();
    if (unsub) { unsub(); unsub = null; }
    if (overlayEl) { try { overlayEl.remove(); } catch (e) {} overlayEl = null; }
    const mainEl = document.getElementById('module-root');
    if (mainEl) mainEl.classList.remove('battle-shake');
    rootEl = null;
    ctxRef = null;
    view = 'landing';
  },
};
