// shop.js — Friday Magical Item Shop. Houses spend accumulated TERM points on
// items that attack rivals or protect their standings before scores lock.
// The item catalog is teacher-editable (Admin) and lives in the store —
// this module renders whatever store.getShopItems() returns, live.
// Owns ONLY this file. Follows ARCHITECTURE.md contract.
import { media } from '../core/media.js';

const STYLE_ID = 'shop-styles';
const PURPLE = '#a78bfa';
const PURPLE_SOFT = 'rgba(167,139,250,0.35)';
const KNOWN_KINDS = new Set(['attack', 'steal', 'shield']);

// ---- module-scoped lifecycle state -----------------------------------------
let ctxRef = null;
let rootEl = null;
let unsub = null;
let clickHandler = null;
let currentRenderFn = null; // set while mounted; lets async media loads trigger a re-render
const timers = new Set();

// image URL resolution cache — persists across mount/unmount, keyed by media key
const mediaUrlCache = new Map(); // mediaKey -> url string | null (null = resolved, no file)
const mediaFetching = new Set();

// ---- per-mount UI state -----------------------------------------------------
function initState(store) {
  const activeHouse = store.getActiveHouse();
  return {
    buyerId: activeHouse ? activeHouse.id : Object.values(store.HOUSES)[0].id,
    targetPicker: null,     // itemId currently choosing a target ('attack' items)
    confirm: null,          // { itemId, buyerId, targetId }
  };
}

function later(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.warn('shop:', e); } }, ms);
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
  .shop-root{position:relative;height:100%;overflow-y:auto;padding:1.25rem clamp(1rem,3vw,2rem) 2rem;
    background:radial-gradient(ellipse at 50% -10%,rgba(88,28,135,.4),#0b0f19 55%),
      radial-gradient(ellipse at 100% 100%,rgba(76,29,149,.22),transparent 60%),#0b0f19;}
  .shop-header{text-align:center;margin-bottom:1.25rem;}
  .shop-title{font-family:'Cinzel',Georgia,serif;font-weight:800;
    font-size:clamp(1.4rem,3.4vw,2.4rem);color:${PURPLE};letter-spacing:.05em;
    text-shadow:0 0 26px ${PURPLE_SOFT};}
  .shop-subtitle{color:#c4b5fd;font-style:italic;font-size:clamp(.85rem,1.5vw,1.05rem);margin-top:.35rem;}

  .shop-buyer-row{display:flex;flex-wrap:wrap;gap:.6rem;justify-content:center;margin-bottom:.9rem;}
  .shop-buyer-chip{min-height:52px;padding:0 1.1rem;border-radius:1rem;font-weight:800;font-size:.95rem;
    border:2px solid var(--sb-accent,#374151);background:#111827;color:var(--sb-accent,#e5e7eb);
    cursor:pointer;display:flex;align-items:center;gap:.5rem;transition:transform .15s ease,background .15s ease;touch-action:manipulation;}
  .shop-buyer-chip:active{transform:scale(.95);}
  .shop-buyer-chip[data-active="true"]{background:var(--sb-soft,rgba(255,255,255,.08));
    box-shadow:0 0 0 3px var(--sb-soft,transparent);}
  .shop-buyer-thumb{width:28px;height:28px;border-radius:.4rem;overflow:hidden;flex-shrink:0;border:1px solid var(--sb-accent,#374151);}
  .shop-buyer-thumb img{width:100%;height:100%;object-fit:cover;}

  .shop-treasury{max-width:420px;margin:0 auto 1.5rem;text-align:center;background:#141225;
    border:2px solid ${PURPLE}; border-radius:1.25rem;padding:.85rem 1.25rem;
    box-shadow:0 0 26px ${PURPLE_SOFT};}
  .shop-treasury .lbl{font-size:.75rem;letter-spacing:.2em;text-transform:uppercase;color:#c4b5fd;}
  .shop-treasury .val{font-size:2rem;font-weight:800;color:#fde68a;font-variant-numeric:tabular-nums;}

  .shop-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.1rem;max-width:1200px;margin:0 auto;}
  .shop-empty{max-width:600px;margin:0 auto;text-align:center;color:#9ca3af;font-style:italic;padding:2rem;
    border:1px dashed #4c1d95;border-radius:1.25rem;}
  .shop-card{position:relative;border-radius:1.5rem;border:2px solid #4c1d95;
    background:linear-gradient(160deg,rgba(30,20,55,.92),rgba(11,15,25,.96));
    padding:1.4rem 1.2rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:.6rem;
    box-shadow:0 12px 34px rgba(76,29,149,.25);transition:transform .18s ease,box-shadow .18s ease;}
  .shop-card:hover{transform:translateY(-3px);box-shadow:0 16px 42px rgba(76,29,149,.4);}
  .shop-card-broken{border-color:#7f1d1d;border-style:dashed;opacity:.85;}
  .shop-card-emoji{font-size:3.4rem;filter:drop-shadow(0 4px 14px rgba(167,139,250,.5));}
  .shop-card-art{width:84px;height:84px;display:flex;align-items:center;justify-content:center;}
  .shop-card-img{width:100%;height:100%;object-fit:cover;border-radius:1rem;box-shadow:0 4px 14px rgba(167,139,250,.45);}
  .shop-card-name{font-weight:800;font-size:1.2rem;color:#e9d5ff;}
  .shop-cost-badge{position:absolute;top:14px;right:14px;background:${PURPLE};color:#1e1b3a;
    font-weight:800;font-size:.85rem;padding:.3rem .65rem;border-radius:999px;}
  .shop-flavor{color:#9ca3af;font-size:.9rem;line-height:1.4;min-height:2.6em;}
  .shop-broken-note{color:#fca5a5;font-size:.75rem;font-weight:700;background:rgba(127,29,29,.25);
    border:1px solid rgba(239,68,68,.4);border-radius:.6rem;padding:.4rem .6rem;}
  .shop-buy-btn{width:100%;min-height:56px;border-radius:1rem;font-weight:800;font-size:1.05rem;
    border:none;cursor:pointer;margin-top:.4rem;color:#fff;
    background:linear-gradient(135deg,#a855f7,#7e22ce);box-shadow:0 8px 22px rgba(168,85,247,.4);
    transition:transform .14s ease,filter .14s ease,opacity .14s ease;touch-action:manipulation;}
  .shop-buy-btn:active:not(:disabled){transform:scale(.95);}
  .shop-buy-btn:hover:not(:disabled){filter:brightness(1.12);}
  .shop-buy-btn:disabled{opacity:.4;cursor:not-allowed;filter:grayscale(.3);}
  .shop-buy-btn.shop-active{background:linear-gradient(135deg,#16a34a,#15803d);box-shadow:0 8px 22px rgba(22,163,74,.4);}
  .shop-card.shake{animation:shop-shake .4s ease;}
  @keyframes shop-shake{
    0%,100%{transform:translateX(0);}
    20%{transform:translateX(-8px);}
    40%{transform:translateX(7px);}
    60%{transform:translateX(-5px);}
    80%{transform:translateX(3px);}
  }
  .shop-shield-remain{font-size:.75rem;color:#93c5fd;font-weight:700;}

  /* target picker */
  .shop-target-picker{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;width:100%;}
  .shop-target-chip{min-height:48px;padding:0 .9rem;border-radius:.85rem;font-weight:700;font-size:.85rem;
    border:2px solid var(--tc-accent,#374151);background:#111827;color:var(--tc-accent,#e5e7eb);
    cursor:pointer;display:flex;align-items:center;gap:.4rem;touch-action:manipulation;
    transition:transform .12s ease;}
  .shop-target-chip:active{transform:scale(.93);}
  .shop-target-thumb{width:22px;height:22px;border-radius:.3rem;overflow:hidden;border:1px solid var(--tc-accent,#374151);}
  .shop-target-thumb img{width:100%;height:100%;object-fit:cover;}
  .shop-target-cancel{min-height:44px;padding:0 .9rem;border-radius:.75rem;background:transparent;
    border:1px solid #4b5563;color:#9ca3af;font-weight:600;cursor:pointer;}

  /* confirm modal */
  .shop-modal-backdrop{position:fixed;inset:0;z-index:65;background:rgba(0,0,0,.72);
    display:flex;align-items:center;justify-content:center;padding:1.5rem;
    animation:shop-fade-in .2s ease both;}
  @keyframes shop-fade-in{from{opacity:0;}to{opacity:1;}}
  .shop-modal{width:min(440px,100%);background:#141225;border:2px solid ${PURPLE};border-radius:1.5rem;
    padding:1.75rem;box-shadow:0 24px 70px rgba(0,0,0,.7),0 0 60px ${PURPLE_SOFT};
    animation:shop-pop-in .25s cubic-bezier(.175,.885,.32,1.275) both;text-align:center;}
  @keyframes shop-pop-in{0%{opacity:0;transform:scale(.85) translateY(10px);}100%{opacity:1;transform:scale(1) translateY(0);}}
  .shop-modal-emoji{font-size:3rem;margin-bottom:.4rem;}
  .shop-modal-title{font-weight:800;font-size:1.3rem;color:#e9d5ff;margin-bottom:.6rem;}
  .shop-modal-body{color:#d1d5db;font-size:1rem;line-height:1.5;margin-bottom:1.4rem;}
  .shop-modal-body b{color:#fde68a;}
  .shop-modal-actions{display:flex;gap:.75rem;}
  .shop-modal-btn{flex:1;min-height:52px;border-radius:.85rem;font-weight:800;font-size:1rem;
    border:none;cursor:pointer;touch-action:manipulation;transition:transform .12s ease;}
  .shop-modal-btn:active{transform:scale(.95);}
  .shop-modal-confirm{background:linear-gradient(135deg,#a855f7,#7e22ce);color:#fff;}
  .shop-modal-cancel{background:#1f2937;color:#e5e7eb;border:1px solid #374151;}

  /* result banner */
  .shop-banner{position:fixed;top:22px;left:50%;transform:translateX(-50%);z-index:70;
    background:#141225;border:2px solid ${PURPLE};border-radius:1rem;padding:.9rem 1.4rem;
    font-weight:800;color:#f9fafb;box-shadow:0 12px 34px rgba(0,0,0,.6),0 0 30px ${PURPLE_SOFT};
    animation:shop-banner-in .35s cubic-bezier(.175,.885,.32,1.275) both;text-align:center;max-width:90vw;}
  .shop-banner.shop-banner-out{animation:shop-banner-out .3s ease forwards;}
  @keyframes shop-banner-in{0%{opacity:0;transform:translate(-50%,-16px) scale(.9);}100%{opacity:1;transform:translate(-50%,0) scale(1);}}
  @keyframes shop-banner-out{to{opacity:0;transform:translate(-50%,-16px) scale(.9);}}

  /* toast (insufficient funds) */
  .shop-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:70;
    background:#7f1d1d;border:2px solid #ef4444;color:#fee2e2;font-weight:700;
    padding:.75rem 1.3rem;border-radius:.85rem;box-shadow:0 12px 30px rgba(0,0,0,.6);
    animation:shop-banner-in .3s ease both;}

  /* small print / mini standings */
  .shop-footer{max-width:1200px;margin:2rem auto 0;display:flex;flex-wrap:wrap;gap:1rem;
    align-items:center;justify-content:space-between;border-top:1px solid #374151;padding-top:1rem;}
  .shop-lockline{color:#9ca3af;font-size:.85rem;font-style:italic;}
  .shop-mini-standings{display:flex;gap:.6rem;flex-wrap:wrap;}
  .shop-mini-chip{display:flex;align-items:center;gap:.4rem;padding:.35rem .7rem;border-radius:999px;
    background:#111827;border:1px solid var(--mc-accent,#374151);font-size:.8rem;font-weight:700;
    color:var(--mc-accent,#e5e7eb);}
  .shop-mini-dot{width:8px;height:8px;border-radius:50%;background:var(--mc-accent,#666);}

  @media (prefers-reduced-motion:reduce){
    .shop-card.shake,.shop-banner,.shop-toast,.shop-modal,.shop-modal-backdrop{animation:none;}
  }
  `;
  document.head.appendChild(style);
}

// =============================================================================
// helpers — attack math
// =============================================================================
function otherHouses(store, buyerId) {
  return Object.values(store.HOUSES).filter((h) => h.id !== buyerId);
}

function topHouseExcluding(store, buyerId) {
  const totals = store.getTotals('term').filter((t) => t.house.id !== buyerId);
  return totals[0] ? totals[0].house : null;
}

function shieldRemaining(store, houseId) {
  const state = store.getState();
  const expiry = (state.shields || {})[houseId] || 0;
  const ms = expiry - Date.now();
  if (ms <= 0) return null;
  const totalMins = Math.max(1, Math.round(ms / 60000));
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hrs > 0 ? `${hrs}h ${mins}m left` : `${mins}m left`;
}

// =============================================================================
// item catalog helpers — validation + image resolution
// =============================================================================
function itemIssues(item) {
  if (!item || typeof item !== 'object') return ['missing item'];
  const issues = [];
  if (!item.name) issues.push('missing name');
  if (!(Number(item.cost) > 0)) issues.push('invalid cost');
  if (!item.effect || !KNOWN_KINDS.has(item.effect.kind)) issues.push('unknown effect');
  else if (!(Number(item.effect.amount) > 0)) issues.push('invalid amount');
  return issues;
}

// Returns a resolved <img> src string, null (no image / resolution failed), or
// undefined (a media: lookup is still in flight — caller should show the emoji
// for now; `onReady` fires once the async lookup settles so the caller can redraw).
function resolveItemImage(item, onReady) {
  const raw = item.image;
  if (!raw) return null;
  if (raw.startsWith('media:')) {
    const key = raw.slice(6);
    if (mediaUrlCache.has(key)) return mediaUrlCache.get(key);
    if (!mediaFetching.has(key)) {
      mediaFetching.add(key);
      media.url(key)
        .then((url) => { mediaUrlCache.set(key, url || null); mediaFetching.delete(key); onReady && onReady(); })
        .catch(() => { mediaUrlCache.set(key, null); mediaFetching.delete(key); onReady && onReady(); });
    }
    return undefined;
  }
  return raw; // plain URL / path
}

function itemArtHtml(item) {
  const resolved = resolveItemImage(item, () => { if (currentRenderFn) currentRenderFn(); });
  if (resolved) {
    return `<div class="shop-card-art"><img src="${esc(resolved)}" alt="${esc(item.name)}" class="shop-card-img"
      onerror="this.parentElement.innerHTML='<div class=&quot;shop-card-emoji&quot;>${esc(item.emoji || '✨')}</div>';" /></div>`;
  }
  return `<div class="shop-card-emoji">${esc(item.emoji || '✨')}</div>`;
}

// =============================================================================
// RENDER
// =============================================================================
function buyerChip(store, s, house) {
  const active = s.buyerId === house.id;
  return `
    <button type="button" class="shop-buyer-chip" data-buyer="${house.id}" data-active="${active}"
      style="--sb-accent:${house.accent};--sb-soft:${house.accentSoft}">
      <span class="shop-buyer-thumb" style="border-color:${house.accent}">${houseImg(house, 'w-full h-full')}</span>
      ${esc(house.name)}
    </button>`;
}

function itemCard(store, s, item) {
  const issues = itemIssues(item);
  if (issues.length) {
    return `
      <div class="shop-card shop-card-broken" data-card="${esc(item?.id || 'unknown')}">
        <div class="shop-card-emoji">❓</div>
        <div class="shop-card-name">${esc(item?.name || 'Unknown Item')}</div>
        <div class="shop-flavor">${esc(item?.desc || '')}</div>
        <div class="shop-broken-note">⚠️ Misconfigured — ask your teacher to fix this item in Admin.</div>
        <button type="button" class="shop-buy-btn" disabled>Unavailable</button>
      </div>`;
  }

  const treasury = store.getTotal(s.buyerId, 'term');
  const affordable = treasury >= item.cost;
  const art = itemArtHtml(item);

  if (item.effect.kind === 'shield') {
    const shielded = store.isShielded(s.buyerId);
    const remain = shielded ? shieldRemaining(store, s.buyerId) : null;
    return `
      <div class="shop-card" data-card="${esc(item.id)}">
        <div class="shop-cost-badge">${item.cost} pts</div>
        ${art}
        <div class="shop-card-name">${esc(item.name)}</div>
        <div class="shop-flavor">${esc(item.desc)}</div>
        ${shielded ? `<div class="shop-shield-remain">🛡️ ACTIVE — ${remain || 'protected'}</div>` : ''}
        <button type="button" class="shop-buy-btn ${shielded ? 'shop-active' : ''}" data-buy="${esc(item.id)}"
          ${shielded ? 'disabled' : (affordable ? '' : 'disabled')}>
          ${shielded ? 'ACTIVE' : 'BUY'}
        </button>
      </div>`;
  }

  if (item.effect.kind === 'attack' && s.targetPicker === item.id) {
    const targets = otherHouses(store, s.buyerId);
    return `
      <div class="shop-card" data-card="${esc(item.id)}">
        <div class="shop-cost-badge">${item.cost} pts</div>
        ${art}
        <div class="shop-card-name">${esc(item.name)}</div>
        <div class="shop-flavor">Choose a target house:</div>
        <div class="shop-target-picker">
          ${targets.map((h) => `
            <button type="button" class="shop-target-chip" data-target-item="${esc(item.id)}" data-target-house="${h.id}" style="--tc-accent:${h.accent}">
              <span class="shop-target-thumb" style="border-color:${h.accent}">${houseImg(h, 'w-full h-full')}</span>
              ${esc(h.name)}
            </button>`).join('')}
        </div>
        <button type="button" class="shop-target-cancel" data-target-cancel="${esc(item.id)}">Cancel</button>
      </div>`;
  }

  return `
    <div class="shop-card" data-card="${esc(item.id)}">
      <div class="shop-cost-badge">${item.cost} pts</div>
      ${art}
      <div class="shop-card-name">${esc(item.name)}</div>
      <div class="shop-flavor">${esc(item.desc)}</div>
      <button type="button" class="shop-buy-btn" data-buy="${esc(item.id)}" ${affordable ? '' : 'disabled'}>BUY</button>
    </div>`;
}

function confirmModalHtml(store, s) {
  if (!s.confirm) return '';
  const item = store.getShopItems().find((i) => i.id === s.confirm.itemId);
  if (!item || itemIssues(item).length) return '';
  const { buyerId, targetId } = s.confirm;
  const buyer = store.HOUSES[buyerId];
  const target = targetId != null ? store.HOUSES[targetId] : null;
  const amount = item.effect.amount;
  const shieldWarn = target && store.isShielded(target.id)
    ? `<br><br>⚠️ ${esc(target.name)} is shielded — the attack will be <b>blocked</b>, but the cost is still paid.`
    : '';
  let bodyHtml = '';
  if (item.effect.kind === 'steal') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to steal <b>${amount} pts</b> from the leading rival, <b>${target ? esc(target.name) : '—'}</b>.${shieldWarn}`;
  } else if (item.effect.kind === 'attack') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to deduct <b>${amount} pts</b> from <b>${target ? esc(target.name) : '—'}</b>.${shieldWarn}`;
  } else if (item.effect.kind === 'shield') {
    bodyHtml = `<b>${esc(buyer.name)}</b> will spend <b>${item.cost} pts</b> to raise the ${esc(item.name)}, blocking incoming attacks for <b>${amount} hour${amount === 1 ? '' : 's'}</b>.`;
  }
  return `
    <div class="shop-modal-backdrop" data-modal-backdrop>
      <div class="shop-modal">
        <div class="shop-modal-emoji">${esc(item.emoji || '✨')}</div>
        <div class="shop-modal-title">Confirm: ${esc(item.name)}</div>
        <div class="shop-modal-body">${bodyHtml}</div>
        <div class="shop-modal-actions">
          <button type="button" class="shop-modal-btn shop-modal-cancel" data-modal-cancel>Cancel</button>
          <button type="button" class="shop-modal-btn shop-modal-confirm" data-modal-confirm>Confirm Purchase</button>
        </div>
      </div>
    </div>`;
}

function miniStandingsHtml(store) {
  const totals = store.getTotals('term');
  return totals.map((t) => `
    <div class="shop-mini-chip" style="--mc-accent:${t.house.accent}">
      <span class="shop-mini-dot"></span>${esc(t.house.name)} · ${t.total}
    </div>`).join('');
}

function render(s) {
  if (!rootEl) return;
  const store = ctxRef.store;
  const houses = Object.values(store.HOUSES);
  const buyer = store.HOUSES[s.buyerId];
  const treasury = store.getTotal(s.buyerId, 'term');
  const items = store.getShopItems();

  rootEl.innerHTML = `
    <div class="shop-root">
      <div class="shop-header">
        <div class="shop-title font-display">🔮 THE FRIDAY MAGIC SHOP</div>
        <div class="shop-subtitle">Spend your hoard. Strike your rivals. Guard your gold.</div>
      </div>

      <div class="shop-buyer-row">${houses.map((h) => buyerChip(store, s, h)).join('')}</div>

      <div class="shop-treasury">
        <div class="lbl">🪙 Treasury &mdash; ${esc(buyer.name)}</div>
        <div class="val">${treasury} pts</div>
      </div>

      <div class="shop-grid">
        ${items.length ? items.map((it) => itemCard(store, s, it)).join('') : '<div class="shop-empty">The shop shelves are empty — check back after your teacher stocks it in Admin.</div>'}
      </div>

      <div class="shop-footer">
        <div class="shop-lockline">⏰ Weekly scores lock Friday at final bell</div>
        <div class="shop-mini-standings">${miniStandingsHtml(store)}</div>
      </div>
    </div>
    ${confirmModalHtml(store, s)}
  `;
}

// =============================================================================
// feedback: banner / toast / shake
// =============================================================================
function showBanner(text) {
  const el = document.createElement('div');
  el.className = 'shop-banner';
  el.textContent = text;
  rootEl.appendChild(el);
  later(() => {
    el.classList.add('shop-banner-out');
    later(() => el.remove(), 300);
  }, 2200);
}

function showToast(text) {
  const existing = rootEl.querySelector('.shop-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'shop-toast';
  el.textContent = text;
  rootEl.appendChild(el);
  later(() => el.remove(), 2000);
}

function shakeCard(itemId) {
  const card = rootEl.querySelector(`[data-card="${itemId}"]`);
  if (!card) return;
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
  later(() => card.classList.remove('shake'), 400);
}

// =============================================================================
// purchase resolution
// =============================================================================
function resolvePurchase(s) {
  const store = ctxRef.store;
  const audio = ctxRef.audio;
  const item = store.getShopItems().find((i) => i.id === s.confirm.itemId);
  if (!item || itemIssues(item).length) { s.confirm = null; render(s); return; }
  const { buyerId, targetId } = s.confirm;
  const buyer = store.HOUSES[buyerId];
  const target = targetId != null ? store.HOUSES[targetId] : null;
  const amount = item.effect.amount;
  const emoji = item.emoji || '✨';

  const ok = store.purchase(buyerId, item.cost, item.name);
  if (!ok) { showToast('Not enough points'); s.confirm = null; render(s); return; }
  audio.sfx('coin');

  if (item.effect.kind === 'shield') {
    store.activateShield(buyerId, amount);
    showBanner(`${buyer.name} raised the ${item.name}! ${emoji}`);
  } else if (item.effect.kind === 'steal') {
    if (target && store.isShielded(target.id)) {
      audio.sfx('sword');
      showBanner(`🛡️ ${target.name} blocked the ${item.name} from ${buyer.name}!`);
    } else if (target) {
      store.addPoints(target.id, -amount, { reason: `${item.name} from ${buyer.name}`, tag: 'attack' });
      store.addPoints(buyerId, amount, { reason: `${item.name} loot from ${target.name}`, tag: 'attack' });
      audio.sfx('thud');
      showBanner(`${buyer.name} stole ${amount} pts from ${target.name}! ${emoji}`);
    }
  } else if (item.effect.kind === 'attack') {
    if (target && store.isShielded(target.id)) {
      audio.sfx('sword');
      showBanner(`🛡️ ${target.name} blocked the ${item.name} from ${buyer.name}!`);
    } else if (target) {
      store.addPoints(target.id, -amount, { reason: `${item.name} from ${buyer.name}`, tag: 'attack' });
      audio.sfx('thud');
      showBanner(`${buyer.name} struck ${target.name} for ${amount} pts! ${emoji}`);
    }
  }

  s.confirm = null;
  s.targetPicker = null;
  render(s);
}

// =============================================================================
// Module contract
// =============================================================================
export default {
  id: 'shop',
  title: 'Magic Shop',
  icon: '🔮',
  order: 35,
  showTile: true,

  mount(el, ctx) {
    ctxRef = ctx;
    rootEl = el;
    injectStyles();
    const store = ctx.store;
    const s = initState(store);

    const doRender = () => render(s);
    currentRenderFn = doRender;
    doRender();

    clickHandler = (e) => {
      const buyerBtn = e.target.closest('[data-buyer]');
      if (buyerBtn) {
        s.buyerId = Number(buyerBtn.getAttribute('data-buyer'));
        s.targetPicker = null;
        doRender();
        return;
      }

      const buyBtn = e.target.closest('[data-buy]');
      if (buyBtn && !buyBtn.disabled) {
        const itemId = buyBtn.getAttribute('data-buy');
        const item = store.getShopItems().find((i) => i.id === itemId);
        if (!item || itemIssues(item).length) return;
        const treasury = store.getTotal(s.buyerId, 'term');
        if (treasury < item.cost) { showToast('Not enough points'); shakeCard(itemId); return; }

        if (item.effect.kind === 'shield') {
          s.confirm = { itemId, buyerId: s.buyerId, targetId: null };
          doRender();
          return;
        }
        if (item.effect.kind === 'steal') {
          const target = topHouseExcluding(store, s.buyerId);
          s.confirm = { itemId, buyerId: s.buyerId, targetId: target ? target.id : null };
          doRender();
          return;
        }
        if (item.effect.kind === 'attack') {
          s.targetPicker = itemId;
          doRender();
          return;
        }
        return;
      }

      const targetCancel = e.target.closest('[data-target-cancel]');
      if (targetCancel) { s.targetPicker = null; doRender(); return; }

      const targetPick = e.target.closest('[data-target-item]');
      if (targetPick) {
        const itemId = targetPick.getAttribute('data-target-item');
        const houseId = Number(targetPick.getAttribute('data-target-house'));
        s.confirm = { itemId, buyerId: s.buyerId, targetId: houseId };
        s.targetPicker = null;
        doRender();
        return;
      }

      const modalConfirm = e.target.closest('[data-modal-confirm]');
      if (modalConfirm) { resolvePurchase(s); return; }

      const modalCancel = e.target.closest('[data-modal-cancel]');
      const backdrop = e.target.matches('[data-modal-backdrop]') ? e.target : null;
      if (modalCancel || backdrop) { s.confirm = null; doRender(); return; }
    };
    rootEl.addEventListener('click', clickHandler);

    unsub = store.subscribe(doRender);
  },

  unmount() {
    clearTimers();
    if (unsub) { unsub(); unsub = null; }
    if (rootEl && clickHandler) rootEl.removeEventListener('click', clickHandler);
    clickHandler = null;
    rootEl = null;
    ctxRef = null;
    currentRenderFn = null;
  },
};
