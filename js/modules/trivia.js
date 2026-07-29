// trivia.js — Trivia Tuesday.
// Mr. D's own ritual, transcribed from his own message: every Tuesday he asks
// the class one question — right answer earns the house 100 points, wrong
// earns nothing. This screen is the stage for that moment: the question in
// big type, a deliberate REVEAL, then the teacher's verdict. Nothing is
// automatic; the teacher taps every step, same as reading the question aloud.
//
// The pool lives in the store (state.trivia.questions, loaded in 🗝️ Admin →
// ❓ Trivia). Every core answers the same questions in the same order, each
// at its own pace — "this week's question" for a core is simply the first
// one that core hasn't answered yet.
// Owns ONLY this file. Follows ARCHITECTURE.md contract.
import { lock } from '../core/lock.js';
import { escapeHtml as esc } from '../core/escape.js';
import { prefersReducedMotion } from '../core/util.js';

let store, audio, registryRef;
let rootEl = null;
let unsub = null;
let revealed = false;        // the answer is on stage for the current question
let unsealing = false;       // glyphs mid-fade; the answer follows in a beat
let unsealTimer = null;
let verdictInFlight = false; // mid-PIN-check; blocks a double tap
let lastVerdict = null;      // { won, points, houseName, qId } — the splash just shown

// The entrance, on the owner's timing: the screen opens on the temple and its
// music ALONE, the card sweeps in a second later (its own sound), and the
// question appears on the parchment a beat after that. Replayed whenever a
// different core takes the stage — each class period gets the show.
let entrancePhase = 'bg';    // 'bg' -> 'conjure' -> 'card' -> 'text' (house line) -> 'question' -> 'ready'
let enteredKey = null;       // which core the current entrance played for
let entranceTimers = [];     // pending phase timers, cleared on unmount/re-key

// Owner call: the recordings ship a touch hot — play them all at 75%.
const TRIVIA_SFX_VOL = 0.75;

function clearEntranceTimers() {
  entranceTimers.forEach((id) => clearTimeout(id));
  entranceTimers = [];
}

const STYLE = `
  .trivia-root{position:relative;height:100%;overflow:hidden;display:flex;flex-direction:column;
    align-items:center;justify-content:center;
    /* The owner's temple: Anubis and Horus flank the braziers. Painted dark
       already — the scrim is a whisper, mostly to seat the card's shadow. */
    background:linear-gradient(180deg,rgba(6,8,14,.25),rgba(6,8,14,.15) 40%,rgba(6,8,14,.3)),
      url('images/trivia-background.jpg') center center/cover no-repeat,#0b0f19;}

  /* The card is the owner's painted 1920x1280 canvas (art centred with
     transparent margins). Height-fit to the room, width-capped for narrow
     screens; every zone below is a % of this box, so they ride any size. */
  .trivia-cardwrap{position:relative;height:min(97%,64vw);aspect-ratio:3/2;}
  .trivia-entering{animation:trivia-card-in .8s cubic-bezier(.2,.9,.3,1.04) both;}

  /* ---- the conjuring (0.8s-2s): embers build where the card will stand ---- */
  .trivia-conjure{position:relative;width:min(60%,700px);height:60%;pointer-events:none;}
  .trivia-conjure-glow{position:absolute;left:50%;top:58%;width:46%;aspect-ratio:1;
    transform:translate(-50%,-50%);border-radius:50%;
    background:radial-gradient(circle,rgba(251,191,36,.5),rgba(217,119,6,.22) 45%,transparent 70%);
    filter:blur(6px);animation:trivia-conjure-swell 1.2s ease-in both;}
  @keyframes trivia-conjure-swell{from{opacity:0;transform:translate(-50%,-50%) scale(.2);}
    60%{opacity:.7;}to{opacity:1;transform:translate(-50%,-50%) scale(1.06);}}
  .trivia-ember{position:absolute;left:50%;top:62%;width:var(--s,6px);height:var(--s,6px);
    border-radius:50%;background:radial-gradient(circle,#ffe9a8,#f59e0b 55%,rgba(217,119,6,0) 80%);
    box-shadow:0 0 10px rgba(251,191,36,.8);opacity:0;
    animation:trivia-ember-rise var(--t,900ms) ease-out var(--d,0ms) infinite;}
  @keyframes trivia-ember-rise{
    0%{opacity:0;transform:translate(-50%,0) scale(.5);}
    18%{opacity:1;}
    100%{opacity:0;transform:translate(calc(-50% + var(--dx,0px)),-240px) scale(1.05);}}
  @keyframes trivia-card-in{from{opacity:0;transform:translateY(50px) scale(.94);}to{opacity:1;transform:none;}}
  /* The dressing arrives in three beats after the card lands: the house line
     and labels first ("text", silent), the question with its own sound a
     breath later ("question"), the hieroglyph seal last ("ready"). The
     question element itself fades independently of its zone. */
  .trivia-zone,.trivia-hot > span,.trivia-progress{opacity:0;transition:opacity .55s ease;}
  /* Long fades: the question and the seal each arrive OVER their sound. */
  .trivia-q{opacity:0;transition:opacity 1.3s ease;}
  .trivia-zone-a{transition:opacity 1.3s ease;}
  .trivia-texted .trivia-zone-q,.trivia-texted .trivia-hot > span,.trivia-texted .trivia-progress{opacity:1;}
  .trivia-questioned .trivia-q{opacity:1;}
  .trivia-ready .trivia-zone-a{opacity:1;}
  .trivia-texted .trivia-hot-veiled > span{opacity:.45;}
  .trivia-card-art{width:100%;height:100%;display:block;max-width:none;
    filter:drop-shadow(0 30px 60px rgba(0,0,0,.6));}

  /* ---- text zones over the parchment ---- */
  .trivia-zone{position:absolute;display:flex;flex-direction:column;align-items:center;
    justify-content:center;text-align:center;pointer-events:none;}
  .trivia-zone-q{left:23.5%;width:53%;top:28%;height:19.5%;gap:.35em;}
  .trivia-eyebrow{font-family:'Cinzel',Georgia,serif;font-weight:700;letter-spacing:.14em;
    text-transform:uppercase;font-size:clamp(.6rem,1.5vh,1rem);color:#7a5a2e;}
  /* House names stay the eyebrow's own ink — the accent colours vanished
     into the parchment (Valhalla's amber especially). Consistent beats
     branded, on the owner's call. */
  .trivia-eyebrow b{color:inherit;}
  .trivia-q{font-family:Georgia,'Times New Roman',serif;font-weight:700;color:#3b2a16;
    font-size:clamp(1.1rem,3.6vh,2.3rem);line-height:1.2;text-wrap:balance;}
  /* Tucked onto the card's bottom frame rail, inside the painted border. */
  .trivia-progress{position:absolute;right:22.5%;bottom:2%;font-family:Georgia,serif;font-style:italic;
    font-size:clamp(.6rem,1.4vh,.9rem);color:#c9a35f;text-shadow:0 1px 3px rgba(0,0,0,.8);}

  /* The answer scroll: hieroglyphs guard it until the reveal. */
  .trivia-zone-a{left:30.5%;width:39%;top:55.8%;height:7.4%;overflow:hidden;}
  .trivia-glyphs{font-size:clamp(1rem,3.4vh,2.1rem);line-height:1;color:#6d4f26;letter-spacing:.12em;
    animation:trivia-glyph-shimmer 3.2s ease-in-out infinite;white-space:nowrap;}
  @keyframes trivia-glyph-shimmer{0%,100%{opacity:.75;}50%{opacity:.45;}}
  .trivia-glyphs-out{animation:trivia-glyphs-fade .7s ease both;}
  @keyframes trivia-glyphs-fade{from{opacity:.75;filter:blur(0);}
    to{opacity:0;filter:blur(3px);transform:scale(1.04);}}
  .trivia-a{font-family:Georgia,'Times New Roman',serif;font-weight:700;color:#3b2a16;
    font-size:clamp(1rem,3vh,2rem);line-height:1.15;
    animation:trivia-a-in .9s ease both;}
  @keyframes trivia-a-in{from{opacity:0;transform:scale(.96);}to{opacity:1;transform:none;}}

  /* ---- hotspots over the painted buttons ---- */
  /* Transparent layers covering each button's interior (not the bevel), per
     the owner's spec: invisible at rest, a soft gold glow on hover, pressed
     scale on tap. Labels ride ON the paint, so the points stay live. */
  .trivia-hot{position:absolute;background:transparent;border:none;cursor:pointer;
    touch-action:manipulation;display:flex;align-items:center;justify-content:center;
    border-radius:min(1.2vw,16px);padding:0;
    font-family:'Cinzel',Georgia,serif;font-weight:800;letter-spacing:.06em;
    transition:box-shadow .18s ease,filter .18s ease,transform .12s ease;}
  .trivia-hot:hover:not(:disabled){box-shadow:0 0 34px rgba(251,191,36,.55),
    inset 0 0 30px rgba(251,191,36,.28);filter:brightness(1.06);}
  .trivia-hot:active:not(:disabled){transform:scale(.97);}
  .trivia-hot:disabled{cursor:default;}
  /* An inactive painted button reads inactive: a dark veil sits over the
     paint until its moment comes. */
  .trivia-hot-veiled{background:rgba(8,6,3,.5);box-shadow:none!important;}
  .trivia-hot-veiled > span{opacity:.45;}

  .trivia-hot-reveal{left:35%;width:30.4%;top:69.2%;height:6.1%;}
  .trivia-hot-reveal > span{color:#f5d78e;font-size:clamp(.85rem,2.4vh,1.5rem);
    text-shadow:0 2px 6px rgba(0,0,0,.8);}
  .trivia-hot-win{left:23.2%;width:22.4%;top:82%;height:8%;}
  .trivia-hot-lose{left:54.6%;width:22.4%;top:82%;height:8%;}
  .trivia-hot-win > span,.trivia-hot-lose > span{color:#f0e2c0;font-size:clamp(.8rem,2.2vh,1.35rem);
    text-shadow:0 2px 6px rgba(0,0,0,.75);}

  /* ---- verdict splash (kept from v1 — plays over the temple itself) ---- */
  .trivia-splash{position:relative;display:flex;flex-direction:column;align-items:center;
    gap:clamp(.6rem,1.8vh,1.2rem);animation:trivia-a-in .45s ease both;}
  .trivia-splash-big{font-family:'Cinzel',Georgia,serif;font-weight:800;line-height:1.05;
    font-size:clamp(2.4rem,7vw,5rem);}
  .trivia-splash-win{color:#6ee7b7;text-shadow:0 0 46px rgba(52,211,153,.6),0 3px 12px rgba(0,0,0,.9);}
  .trivia-splash-lose{color:#d6c9a8;text-shadow:0 2px 10px rgba(0,0,0,.9);}
  .trivia-splash-sub{color:#f0e2c0;font-size:clamp(1rem,2.2vw,1.4rem);text-shadow:0 2px 8px rgba(0,0,0,.85);}
  .trivia-btn{border:none;border-radius:1rem;cursor:pointer;touch-action:manipulation;
    font-family:'Cinzel',Georgia,serif;font-weight:800;letter-spacing:.04em;
    font-size:clamp(1.05rem,2.2vw,1.5rem);padding:clamp(.8rem,2vh,1.1rem) clamp(1.6rem,3.5vw,2.6rem);
    min-height:56px;transition:transform .15s ease,box-shadow .15s ease;}
  .trivia-btn:active{transform:scale(.97);}
  .trivia-next-btn{background:rgba(8,6,3,.55);border:2px solid #a4772e;color:#f5d78e;}
  .trivia-next-btn:hover{border-color:#fbbf24;box-shadow:0 0 24px rgba(251,191,36,.4);}

  /* quiet states (no core picked / empty pool) speak from the question zone */
  .trivia-quiet{font-family:Georgia,serif;font-style:italic;color:#5d452a;
    font-size:clamp(.95rem,2.6vh,1.6rem);line-height:1.45;}
  .trivia-quiet b{font-style:normal;}
`;

function injectStyles() {
  if (document.getElementById('trivia-styles')) return;
  const st = document.createElement('style');
  st.id = 'trivia-styles';
  st.textContent = STYLE;
  document.head.appendChild(st);
}

// ---- render -----------------------------------------------------------------

// Can this computer draw real Egyptian hieroglyphs (U+13000 block)? macOS
// and Win10+ ship fonts for the block; an older machine shows tofu boxes,
// which would wreck the effect — so measure once: a supported glyph and an
// unmapped codepoint render at different widths.
let glyphsOk = null;
function hieroglyphsSupported() {
  if (glyphsOk != null) return glyphsOk;
  try {
    const g = document.createElement('canvas').getContext('2d');
    g.font = '32px serif';
    glyphsOk = g.measureText('\u{13080}').width !== g.measureText('\u{10FFFE}').width;
  } catch (e) { glyphsOk = false; }
  return glyphsOk;
}

// The sealed answer: a run of hieroglyphs (curated, so nothing obscure drops
// out of a font's coverage), or ankhs-and-stars on a machine without the
// block. Deterministic per question — the seal shouldn't reshuffle every
// re-render of the same question.
const GLYPHS = [...'𓀀𓁹𓂀𓃭𓅓𓆣𓇳𓈖𓉐𓊽𓋹𓌳𓍑𓎛𓏏𓄿𓅱𓂋𓆑𓊖'];
const GLYPHS_FALLBACK = [...'☥✦◆✧☥✶◆✦☥✧'];
function sealedGlyphs(seedStr) {
  const set = hieroglyphsSupported() ? GLYPHS : GLYPHS_FALLBACK;
  let h = 0;
  for (const ch of String(seedStr)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [];
  for (let i = 0; i < 12; i += 1) { h = (h * 1103515245 + 12345) >>> 0; out.push(set[h % set.length]); }
  return out.join(' ');
}

function render() {
  if (!rootEl) return;
  const house = store.getActiveHouse();

  // A new audience (fresh mount, or the core switched) restarts the show.
  const key = house ? house.id : 'none';
  if (!lastVerdict && key !== enteredKey) {
    enteredKey = key;
    clearEntranceTimers();
    clearTimeout(unsealTimer); unsealing = false;
    entrancePhase = 'bg';
    // Owner's beats: temple+music alone, then the MAGIC starts — the card-
    // reveal recording begins and embers gather mid-stage — and at 2s the
    // card appears as if the fire conjured it. Question a second later, the
    // hieroglyph seal half a second after that.
    entranceTimers.push(setTimeout(() => {
      entrancePhase = 'conjure';
      audio?.sfx?.('triviacard', { volume: TRIVIA_SFX_VOL });
      render();
    }, 800));
    entranceTimers.push(setTimeout(() => {
      entrancePhase = 'card';
      render();
    }, 2000));
    // The house line and button labels dress the card first, in silence —
    // then a breath while the card-reveal recording finishes (the two sfx
    // overlapped and read as noise), THEN the question with its own sound,
    // and the hieroglyph seal a second after.
    entranceTimers.push(setTimeout(() => patchPhase('text'), 3000));
    // The sound leads, the ink follows: the question recording starts at
    // 4.6s ALONE, the question text starts its long fade 0.4s into it, and
    // the hieroglyph seal fades up a second later — both ride over the tail
    // of the sound rather than popping with its first note. These beats
    // PATCH the live card instead of re-rendering it: a rebuilt element
    // mounts at its final opacity, which is why the fades were pops.
    entranceTimers.push(setTimeout(() => {
      if (store.getActiveHouse() && store.nextTriviaFor(store.getActiveHouse().id)) audio?.sfx?.('triviaquestion', { volume: TRIVIA_SFX_VOL });
    }, 4600));
    entranceTimers.push(setTimeout(() => patchPhase('question'), 5000));
    entranceTimers.push(setTimeout(() => patchPhase('ready'), 6000));
  }

  const stage = lastVerdict ? splashHtml(lastVerdict)
    : entrancePhase === 'bg' ? ''
    : entrancePhase === 'conjure' ? conjureHtml()
    : cardHtml(house);
  rootEl.innerHTML = `
    <div class="trivia-root" style="--tr-accent:${house ? esc(house.accent) : '#7a5a2e'}">
      ${stage}
    </div>`;
  wire();
}

// Advance an entrance beat by adding classes to the card that is ALREADY on
// stage, so its transitions genuinely run — render() would rebuild the DOM
// and a fresh element simply appears at its final opacity. Falls back to a
// full render when there is no card to patch (quiet states, mid-splash).
function patchPhase(phase) {
  entrancePhase = phase;
  const wrap = rootEl && rootEl.querySelector('.trivia-cardwrap');
  if (!wrap) { render(); return; }
  wrap.classList.add('trivia-texted');
  if (phase === 'question' || phase === 'ready') wrap.classList.add('trivia-questioned');
  if (phase === 'ready') {
    wrap.classList.add('trivia-ready');
    // The render() that built this card disabled its buttons for the
    // entrance; the un-veiled ones wake up now.
    wrap.querySelectorAll('.trivia-hot').forEach((b) => {
      if (!b.classList.contains('trivia-hot-veiled') && b.hasAttribute('data-reveal')) b.disabled = false;
    });
  }
}

// The conjuring: embers kindle mid-stage and build — sparse at first, then a
// swelling amber glow — until the card arrives to answer them. Pure CSS
// particles; each ember gets its own drift, delay and size. Under reduced
// motion the fire is a single quiet glow instead of moving sparks.
function conjureHtml() {
  if (prefersReducedMotion()) {
    return `<div class="trivia-conjure"><div class="trivia-conjure-glow"></div></div>`;
  }
  let embers = '';
  for (let i = 0; i < 26; i += 1) {
    const dx = Math.round((Math.random() - 0.5) * 340);   // horizontal drift, widening the fire
    const delay = Math.round(Math.random() * 700);        // staggered kindling
    const dur = Math.round(650 + Math.random() * 500);
    const size = (4 + Math.random() * 7).toFixed(1);
    embers += `<span class="trivia-ember" style="--dx:${dx}px;--d:${delay}ms;--t:${dur}ms;--s:${size}px"></span>`;
  }
  return `<div class="trivia-conjure"><div class="trivia-conjure-glow"></div>${embers}</div>`;
}

// The whole painted card renders in every non-splash state — the art carries
// the title — with the question zone speaking for the quiet states and the
// buttons veiled until they mean something.
function cardHtml(house) {
  const q = house ? store.nextTriviaFor(house.id) : null;
  const prog = house ? store.triviaProgress(house.id) : { answered: 0, total: 0 };

  let qZone;
  if (!house) {
    qZone = `<div class="trivia-quiet">🔒 Pick a house core in the top bar —<br/>each class period answers its own question.</div>`;
  } else if (!prog.total) {
    qZone = `<div class="trivia-quiet">The question pool is empty.<br/>Load this term's questions in <b>🗝️ Admin → ❓ Trivia</b>.</div>`;
  } else if (!q) {
    const up = typeof store.triviaUpcoming === 'function' ? store.triviaUpcoming(house.id) : null;
    if (up) {
      const when = new Date(`${up.askOn}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      qZone = `<div class="trivia-quiet">The next question for <b>${esc(house.name)}</b> is sealed until<br/><b>${esc(when)}</b>. The fates are patient.</div>`;
    } else {
      qZone = `<div class="trivia-quiet"><b>${esc(house.name)}</b> has answered every question in the pool (${prog.answered} of ${prog.total}).<br/>Add more in <b>🗝️ Admin → ❓ Trivia</b>.</div>`;
    }
  } else {
    qZone = `
      <div class="trivia-eyebrow"><b>${esc(house.name)}</b> takes the stage · worth +${q.points}</div>
      <div class="trivia-q">${esc(q.q)}</div>`;
  }

  const ready = entrancePhase === 'ready';
  const questioned = ready || entrancePhase === 'question';
  const texted = questioned || entrancePhase === 'text';
  return `
    <div class="trivia-cardwrap ${entrancePhase === 'card' ? 'trivia-entering' : ''} ${texted ? 'trivia-texted' : ''} ${questioned ? 'trivia-questioned' : ''} ${ready ? 'trivia-ready' : ''}">
      <img class="trivia-card-art" src="images/trivia-card.png" alt="Trivia Tuesday" />
      <div class="trivia-zone trivia-zone-q">${qZone}</div>
      <div class="trivia-zone trivia-zone-a">
        ${q ? (revealed
          ? `<div class="trivia-a">${esc(q.a)}</div>`
          : `<div class="trivia-glyphs ${unsealing ? 'trivia-glyphs-out' : ''}" aria-hidden="true">${sealedGlyphs(q.id)}</div>`) : ''}
      </div>
      <button type="button" class="trivia-hot trivia-hot-reveal ${!q || revealed || unsealing ? 'trivia-hot-veiled' : ''}"
        data-reveal ${!q || revealed || unsealing || !ready ? 'disabled' : ''} title="Reveal the answer">
        <span>Reveal the Answer</span>
      </button>
      <button type="button" class="trivia-hot trivia-hot-win ${!q || !revealed ? 'trivia-hot-veiled' : ''}"
        data-verdict="win" data-q="${q ? esc(q.id) : ''}" ${!q || !revealed || !ready ? 'disabled' : ''}>
        <span>✓ Correct: +${q ? q.points : 100}</span>
      </button>
      <button type="button" class="trivia-hot trivia-hot-lose ${!q || !revealed ? 'trivia-hot-veiled' : ''}"
        data-verdict="lose" data-q="${q ? esc(q.id) : ''}" ${!q || !revealed || !ready ? 'disabled' : ''}>
        <span>✗ Incorrect: 0</span>
      </button>
      ${q ? `<div class="trivia-progress">Question ${prog.answered + 1} of ${prog.total} for ${esc(house.name)}</div>` : ''}
    </div>`;
}

function splashHtml(v) {
  return `
    <div class="trivia-splash">
      ${v.won
        ? `<div class="trivia-splash-big trivia-splash-win">+${v.points} to ${esc(v.houseName)}!</div>
           <div class="trivia-splash-sub">🎉 The scholars of ${esc(v.houseName)} earn their glory.</div>`
        : `<div class="trivia-splash-big trivia-splash-lose">Not this time…</div>
           <div class="trivia-splash-sub">The pool keeps its secret. No points move.</div>`}
      <button type="button" class="trivia-btn trivia-next-btn" data-continue>Continue</button>
    </div>`;
}

// ---- wiring -----------------------------------------------------------------

function wire() {
  if (!rootEl) return;
  // The reveal is a crossfade, not a swap: the hieroglyphs burn away first
  // (the recording covers it), then the answer fades up in their place.
  const revealBtn = rootEl.querySelector('[data-reveal]');
  if (revealBtn) revealBtn.addEventListener('click', () => {
    if (unsealing || revealed) return;
    unsealing = true;
    audio?.sfx?.('triviaanswer', { volume: TRIVIA_SFX_VOL });
    render();
    clearTimeout(unsealTimer);
    unsealTimer = setTimeout(() => { unsealing = false; revealed = true; render(); }, 700);
  });

  rootEl.querySelectorAll('[data-verdict]').forEach((btn) => {
    btn.addEventListener('click', () => giveVerdict(btn.dataset.q, btn.dataset.verdict === 'win'));
  });

  // Continue closes the ritual: back to the dashboard, not another question —
  // it's one question per Tuesday, and the next core is a top-bar switch away.
  const cont = rootEl.querySelector('[data-continue]');
  if (cont) cont.addEventListener('click', () => {
    lastVerdict = null; revealed = false;
    if (registryRef && typeof registryRef.navigate === 'function') registryRef.navigate('dashboard');
    else render();
  });
}

async function giveVerdict(questionId, won) {
  if (!rootEl || verdictInFlight) return;
  const house = store.getActiveHouse();
  if (!house) return;

  verdictInFlight = true;
  // Points move on ✓, so the verdict sits behind the teacher PIN when one is
  // set — the same promise every other award in the app keeps. ✗ passes the
  // same gate for symmetry: recording "they missed it" advances the pool,
  // which is a decision the class shouldn't be able to make from the board.
  const ok = await lock.requireUnlock('record the trivia verdict');
  if (!rootEl) { verdictInFlight = false; return; }
  if (!ok) { verdictInFlight = false; return; }

  const result = store.recordTrivia(house.id, questionId, won);
  verdictInFlight = false;
  if (!rootEl) return;
  if (!result.ok) { revealed = false; render(); return; }

  const q = store.getTriviaQuestions().find((x) => x.id === questionId);
  lastVerdict = { won, points: q ? q.points : 100, houseName: house.name, qId: questionId };
  revealed = false;
  audio?.sfx?.(won ? 'triviawin' : 'trivialose', { volume: TRIVIA_SFX_VOL });
  render();
}

// ---- module -----------------------------------------------------------------

export default {
  id: 'trivia',
  title: 'Trivia Tuesday',
  icon: '❓',
  order: 46,
  showTile: true,

  mount(el, ctx) {
    store = ctx.store;
    audio = ctx.audio;
    registryRef = ctx.registry;
    rootEl = el;
    revealed = false;
    lastVerdict = null;
    verdictInFlight = false;
    injectStyles();
    render();
    unsub = store.subscribe(() => {
      // A store change mid-splash must not wipe the splash — the class is
      // reading it. Everything else re-renders live (core switch, edits).
      if (!lastVerdict) render();
    });
  },

  unmount() {
    if (unsub) { unsub(); unsub = null; }
    clearEntranceTimers();
    clearTimeout(unsealTimer); unsealTimer = null; unsealing = false;
    enteredKey = null;
    entrancePhase = 'bg';
    rootEl = null;
    revealed = false;
    lastVerdict = null;
    verdictInFlight = false;
  },
};
