// publish.js — the class-facing standings page.
//
// WHAT THIS IS FOR: Mr. D keeps a Google Classroom page per class period. He
// wanted each one to show that house's points, updating itself. Classroom
// cannot read a feed, and this app runs on localhost where nothing on the
// internet can reach it — but Classroom is very good at holding a LINK. So the
// app publishes a small standings file to the GitHub repo that already serves
// this site, and each class gets one permanent link to a page that reads it.
// He pins the link once; it is current forever after.
//
// WHAT LEAVES THE MACHINE: house names, their point totals, the term label and
// a timestamp. Nothing else. The app has never held a student roster, so there
// is no personal data here to leak — which is the whole reason this is safe to
// put on a public page at a school.
//
// WHERE THE TOKEN LIVES — the one decision worth reading:
// A GitHub token is stored in its own localStorage key, NOT in the app's state.
// That is deliberate. Backups serialise the state object and get copied to
// OneDrive/iCloud; a token living in there would ride along into a synced file
// and, from there, anywhere that folder is shared. Keeping it in a separate key
// means backups never contain it. The cost is that a restored machine must be
// given the token again, which is the correct trade.
import { store } from './store.js';

const TOKEN_KEY = 'mrd-publish-token';    // deliberately NOT in the store — see above
const FILE_PATH = 'standings.json';

let lastPublish = null;
let lastError = null;
let publishing = false;

function cfg() {
  try { return store.getSettings().publish || {}; } catch (e) { return {}; }
}

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
}

export function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t.trim());
    else localStorage.removeItem(TOKEN_KEY);
    lastError = null;
    return true;
  } catch (e) { return false; }
}

// Everything the public page needs, and nothing it does not.
export function buildStandings() {
  const totals = store.getTotals('term');
  const week = store.getTermInfo ? store.getTermInfo() : null;
  return {
    updatedAt: new Date().toISOString(),
    term: week && week.label ? week.label : '',
    houses: totals.map((t, i) => ({
      core: t.house.core,
      name: t.house.name,
      motto: t.house.motto || '',
      accent: t.house.accent,
      crest: t.house.image || '',
      total: t.total,
      rank: i + 1,
    })),
  };
}

function apiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// GitHub's contents API needs the current blob sha to replace a file. A 404
// simply means this is the first publish.
async function currentSha(owner, repo, branch, token) {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${FILE_PATH}?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(url, { headers: apiHeaders(token) });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const j = await res.json();
    return j.sha || null;
  } catch (e) { return null; }
}

// btoa() throws on anything outside Latin-1, and house names are teacher-typed
// (a motto with a curly quote is enough). Encode as UTF-8 bytes first.
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

export async function publishStandings() {
  if (publishing) return { ok: false, reason: 'Already publishing.' };
  const { owner, repo, branch = 'main' } = cfg();
  const token = getToken();
  if (!owner || !repo) { lastError = 'Not set up yet.'; return { ok: false, reason: lastError }; }
  if (!token) { lastError = 'No access token saved.'; return { ok: false, reason: lastError }; }

  publishing = true;
  try {
    const body = JSON.stringify(buildStandings(), null, 2);
    const sha = await currentSha(owner, repo, branch, token);
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${FILE_PATH}`, {
      method: 'PUT',
      headers: { ...apiHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Update class standings',
        content: toBase64(body),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!res.ok) {
      // Translate the three failures a teacher can actually act on.
      if (res.status === 401) lastError = 'That access token was refused. It may have expired or been typed incorrectly.';
      else if (res.status === 403) lastError = 'That token does not have permission to write to this repository.';
      else if (res.status === 404) lastError = 'That owner/repository was not found, or the token cannot see it.';
      else lastError = `GitHub said no (${res.status}).`;
      return { ok: false, reason: lastError };
    }
    lastPublish = Date.now();
    lastError = null;
    lastPublishedSig = standingsSignature();
    return { ok: true, at: lastPublish };
  } catch (e) {
    lastError = 'Could not reach GitHub — is this computer online?';
    return { ok: false, reason: lastError };
  } finally {
    publishing = false;
  }
}

// ---- publishing without being asked ---------------------------------------
// The teacher should not have to remember this. Once it is set up, any change
// that moves points republishes on its own, debounced hard: a Battle Day can
// fire a dozen awards in a minute and each one is a commit to GitHub, so the
// app waits for the dust to settle rather than writing twelve times.
const AUTO_DEBOUNCE_MS = 45000;   // 45s of quiet before publishing
let autoTimer = null;
let subscribed = false;
let lastPublishedSig = null;

// Only republish when the NUMBERS changed. A store change is fired by anything
// — opening a screen, tweaking a setting — and none of that belongs on the
// class page.
function standingsSignature() {
  try {
    return store.getTotals('term').map((t) => `${t.house.core}:${t.total}`).join('|');
  } catch (e) { return null; }
}

function scheduleAutoPublish() {
  const st = cfg();
  if (!st.owner || !st.repo || st.enabled === false || !getToken()) return;
  const sig = standingsSignature();
  if (sig == null || sig === lastPublishedSig) return;
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    autoTimer = null;
    const before = standingsSignature();
    const r = await publishStandings();
    if (r.ok) lastPublishedSig = before;
  }, AUTO_DEBOUNCE_MS);
}

export function initAutoPublish() {
  if (subscribed) return;
  subscribed = true;
  try {
    lastPublishedSig = standingsSignature();   // a fresh load is not a change
    store.subscribe(scheduleAutoPublish);
  } catch (e) { console.warn('publish: subscribe failed', e); }
}

// Called by Backup & Close, so the day always ends published even if the
// debounce was still counting down.
export async function publishIfDue() {
  const st = cfg();
  if (!st.owner || !st.repo || st.enabled === false || !getToken()) return null;
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  const sig = standingsSignature();
  const r = await publishStandings();
  if (r.ok) lastPublishedSig = sig;
  return r;
}

export function publishStatus() {
  const { owner, repo, branch = 'main', enabled } = cfg();
  return {
    configured: !!(owner && repo && getToken()),
    enabled: enabled !== false,
    owner: owner || '',
    repo: repo || '',
    branch,
    hasToken: !!getToken(),
    lastPublish,
    lastError,
    publishing,
  };
}

// ---- the paste-it-yourself version -----------------------------------------
// The published page depends on the school letting github.io through, and a
// lot of districts block it wholesale — students use GitHub Pages to host
// filter-bypass proxies, so the whole domain gets categorised as personal web
// hosting. This is the version that cannot be blocked, because the text ends
// up INSIDE the Classroom post: nothing external to fetch, nothing to filter.
// The trade is that it is frozen at the moment he pastes it.
//
// `core` picks whose post this is (their house leads, and is marked in the
// table); omit it for a plain leaderboard.
export function standingsText(core) {
  const totals = store.getTotals('term');
  const term = store.getTermInfo ? store.getTermInfo() : null;
  const mine = core ? totals.find((t) => t.house.core === core) : null;
  const medals = ['🥇', '🥈', '🥉', '4️⃣'];

  const lines = [];
  if (mine) {
    const rank = totals.findIndex((t) => t.house.core === mine.house.core) + 1;
    const ordinal = ['', '1st', '2nd', '3rd', '4th'][rank] || `${rank}th`;
    lines.push(`🏆 ${mine.house.name.toUpperCase()} — ${mine.total} points`);
    lines.push(`Currently ${ordinal} of ${totals.length}.`);
    lines.push('');
    lines.push('All houses:');
  } else {
    lines.push('🏆 HOUSE STANDINGS');
    lines.push('');
  }

  totals.forEach((t, i) => {
    const marker = mine && t.house.core === mine.house.core ? '  ← us' : '';
    lines.push(`${medals[i] || `${i + 1}.`} ${t.house.name} — ${t.total}${marker}`);
  });

  lines.push('');
  if (term && term.label) lines.push(term.label);
  lines.push(`Updated ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`);
  return lines.join('\n');
}

// The link a teacher pins in each Classroom page.
export function classLink(core) {
  const { owner, repo } = cfg();
  if (!owner || !repo) return '';
  return `https://${owner}.github.io/${repo}/standings.html?core=${core}`;
}
