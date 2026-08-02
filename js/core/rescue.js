// rescue.js — the empty-board rescue.
//
// THE FAILURE THIS EXISTS FOR: the app's live data lives in this browser
// profile. A wiped profile, a "clear browsing data", a new Windows login, a
// reimaged school laptop — any of them hand the teacher a board reading all
// zeroes in front of a class. The backup folder may hold a perfect copy of the
// term sitting inches away, and nothing ever mentioned it: he would have had to
// know to open Admin, find Data & Safety, and pick Restore, at the exact moment
// he has the least patience for a menu.
//
// So: on boot, if the board is empty AND a backup exists, say so plainly and
// offer to put it back. One button. Nothing happens without a tap — a teacher
// genuinely starting a fresh term must be able to dismiss this and never see it
// again for that install.
import { store } from './store.js';
import { backup } from './backup.js';
import { storage } from './storage.js';

const DISMISS_KEY = 'mrd-rescue-dismissed';

// "Empty" means nothing a teacher would mourn: no points awarded, no quests
// finished, no planner events. Deliberately NOT "no settings" — a fresh
// install has plenty of shipped settings and zero history.
function boardIsEmpty() {
  try {
    const st = store.getState();
    if ((st.transactions || []).length) return false;
    if ((st.quests?.completed || []).length) return false;
    if ((st.planner?.events || st.events || []).length) return false;
    return true;
  } catch (e) { return false; }
}

function dismissed() {
  try { return storage.get(DISMISS_KEY) === '1'; } catch (e) { return false; }
}

const CSS = `
  #mrd-rescue{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;
    justify-content:center;padding:2rem;background:rgba(4,6,11,.92);}
  .mrd-rescue-card{max-width:44rem;width:100%;background:#111827;border:2px solid #f59e0b;
    border-radius:1.1rem;padding:1.8rem 2rem;box-shadow:0 30px 80px rgba(0,0,0,.6);}
  .mrd-rescue-title{font-family:'Cinzel',Georgia,serif;font-weight:800;color:#fbbf24;
    font-size:1.7rem;margin-bottom:.6rem;}
  .mrd-rescue-body{color:#e5e7eb;font-size:1.05rem;line-height:1.55;}
  .mrd-rescue-body b{color:#fde68a;}
  .mrd-rescue-meta{margin:1rem 0 0;padding:.8rem 1rem;border-radius:.6rem;
    background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);
    color:#fde68a;font-size:.95rem;}
  .mrd-rescue-row{display:flex;gap:.7rem;flex-wrap:wrap;margin-top:1.4rem;}
  .mrd-rescue-btn{min-height:48px;padding:.7rem 1.4rem;border-radius:.7rem;border:none;
    font-weight:800;font-size:1rem;cursor:pointer;}
  .mrd-rescue-yes{background:#f59e0b;color:#0b0f19;}
  .mrd-rescue-no{background:transparent;border:1px solid #4b5563;color:#9ca3af;}
  .mrd-rescue-no:hover{border-color:#9ca3af;color:#e5e7eb;}
  .mrd-rescue-note{margin-top:.9rem;color:#9ca3af;font-size:.85rem;line-height:1.45;}
`;

// Exported so the rescue screen can be SEEN without waiting for a disaster:
// Admin can preview it, and it can be verified in testing without staging a
// wiped browser profile and a granted folder handle (an OS-level dialog no
// automated check can drive). Showing it is inert — nothing restores until
// the teacher taps.
export function showLostTermDialog(found) {
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  const when = found.savedAt ? new Date(found.savedAt).toLocaleString() : 'an earlier session';
  const el = document.createElement('div');
  el.id = 'mrd-rescue';
  el.innerHTML = `
    <div class="mrd-rescue-card" role="dialog" aria-modal="true">
      <div class="mrd-rescue-title">⚠️ This board is empty — but a backup exists</div>
      <div class="mrd-rescue-body">
        Every point, quest and planner entry is missing from this computer. That usually means
        the browser's data was cleared, or this is a different login than the one you teach from.
        <b>Your backup folder still has your term.</b>
      </div>
      <div class="mrd-rescue-meta">
        Found <b>${found.name}</b> — saved ${when}, holding <b>${found.transactions}</b> point entries.
      </div>
      <div class="mrd-rescue-row">
        <button type="button" class="mrd-rescue-btn mrd-rescue-yes" data-rescue="restore">Put my term back</button>
        <button type="button" class="mrd-rescue-btn mrd-rescue-no" data-rescue="fresh">No — I am starting fresh</button>
      </div>
      <div class="mrd-rescue-note">Restoring replaces what is on screen now (which is nothing) and reloads.
        Choosing “starting fresh” keeps the empty board and stops asking on this computer.</div>
    </div>`;
  document.body.appendChild(el);

  el.querySelector('[data-rescue="fresh"]').addEventListener('click', () => {
    try { storage.set(DISMISS_KEY, '1'); } catch (e) { /* nothing to remember it with */ }
    el.remove(); st.remove();
  });

  el.querySelector('[data-rescue="restore"]').addEventListener('click', async () => {
    const btn = el.querySelector('[data-rescue="restore"]');
    btn.disabled = true;
    btn.textContent = 'Restoring…';
    const data = await backup.restoreLatest();
    if (!data) { btn.disabled = false; btn.textContent = 'Put my term back'; return; }
    try {
      await backup.restoreMedia();   // the PDFs, slides and songs too
      storage.set('mrd-classroom-os-v1', JSON.stringify(data));
      location.reload();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Put my term back';
    }
  });
}

// Runs once, after boot has settled. Never throws into the app.
export async function checkForLostTerm() {
  try {
    if (dismissed() || !boardIsEmpty()) return;
    // Give backup.js a moment to re-attach its folder handle on boot.
    await new Promise((r) => setTimeout(r, 1200));
    const found = await backup.peekLatest();
    if (!found || !found.transactions) return;
    showLostTermDialog(found);
  } catch (e) { console.warn('rescue: check failed', e); }
}
