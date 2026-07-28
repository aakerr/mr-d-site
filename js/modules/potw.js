// potw.js — "Place of the Week": a cinematic, touch-first geography voyage.
// Stage 0 launch screen → Stage 1 video/song intro → Stage 2 reveal modal →
// Stage 3 Google Maps 3D flight → Stage 4 tabbed lesson overlay (facts / sources / quiz).
// Owns ONLY this file. Renders its launch screen into #module-root and a full-screen
// cinematic overlay into #overlay-root, tearing everything down cleanly on unmount.
import { CONFIG } from '../config.js';
import { media } from '../core/media.js';
import { lock } from '../core/lock.js';
import { escapeHtml as esc } from '../core/escape.js';

// ---- module-scoped state (mount/unmount lifecycle owns all of this) ----------
let ctxRef = null;
let rootEl = null;            // Stage 0 mount target (inside #module-root)
let overlayEl = null;         // full-screen overlay (inside #overlay-root)
let mapEl = null;             // <gmp-map-3d>
let videoEl = null;           // intro <video>
let ytIntroEl = null;         // YouTube-embed intro container (when profile.videoUrl is a YT embed)
let ytPlayer = null;          // YT.Player instance (IFrame Player API)
let ytPollTimer = null;       // setInterval id polling getCurrentTime()/getDuration()
let ytSafetyArmed = false;    // safety auto-advance armed once duration is known
let ytApiPromise = null;      // memoized IFrame API loader (persists across opens)
let songEl = null;            // fallback audio element
let profile = null;           // active POTW profile snapshot
let activeKey = null;         // active POTW profile key (for media lookups)
let globe = null;             // Stage 0 three.js globe controller ({ dispose })
let mapReadyPromise = null;   // resolves true (map usable) | false (fallback)
let advanced = false;         // reached the reveal (intro handed off to map)
let usingFallback = false;    // intro fell back to the song
let cardShown = false;        // reveal card is visible (may be over live video)
let presLayerEl = null;       // full-screen presentation layer (over the map)
let presState = null;         // { type, count, idx, url, pdfKey, imgCache, pdfjs, pdfDoc, pageCache, token }
let presKeyHandler = null;    // keydown handler while presenting
let presResizeHandler = null; // debounced resize -> re-render at new viewport size
let presIdleTimer = null;     // hides the nav chrome after PRES_IDLE_MS
let gsClickHandler = null;    // gslides only: returns focus to Google's player
let flyMusicEl = null;        // flyover background track (element returned by ctx.audio.play)
let flyFadeTimer = null;      // interval id ramping flyMusicEl.volume down to 0
let flyFadeMs = 0;            // duration of the fade in flight, so a faster one can overtake it
let deckInfo = null;          // resolved deck for this voyage (null = no presentation)
let deckPromise = null;       // memoizes resolveDeck() for the current voyage
let previewMode = false;      // TEST FLIGHT: fly + orbit only, no intro/reveal/deck/lesson
let previewOnClose = null;    // callback so the admin panel can restore itself
let previewFlyMs = 0;         // shorter fly-to while previewing
let previewKeyHandler = null; // Esc-to-close while previewing
const timers = new Set();     // all pending setTimeout ids, cleared on teardown

// ---- tunable timing (one-line tweaks for the teacher) ------------------------
const FLY_TO_MS = 27000;      // camera fly-to duration (~27s — gentle on a big smartboard)
const ORBIT_MS = 240000;      // ms per slow-orbit revolution once landed
const LAND_SETTLE_MS = 300;   // pause after landing before lesson card + orbit start
// Flyover background music: starts on the "🚀 Fly to…" tap, fades out over this
// long the moment the presentation (or, with no deck, the lesson card) appears.
// IDEAL TRACK LENGTH ≈ 30s  =  27.0s flight + 0.3s settle + 3.0s fade.
const FLYOVER_FADE_MS = 3000;
const INTRO_FADE_MS = 1000;   // video/intro crossfade out to reveal the 3D map
const CARD_EARLY_S = 4;       // reveal card pops this many seconds before the video ends
const YT_CROP_PX = 120;       // overscan: player is this much taller than the 16:9 box,
                              // centered, so YouTube's title bar + watermark sit outside the crop
const YT_API_TIMEOUT_MS = 5000;   // if the IFrame API doesn't load in time, use a plain iframe
const YT_PLAIN_FALLBACK_S = 600;  // generous auto-advance for the plain-iframe fallback (Skip is primary)
const PRES_IDLE_MS = 3000;        // hide presentation nav chrome after this idle time
const PRES_CACHE_MAX = 8;         // max rendered PDF page canvases kept in memory
const PRES_DPR_CAP = 2;           // devicePixelRatio cap for crisp-but-cheap rendering
const TEST_FLY_MS = 8000;         // TEST FLIGHT fly-to (short — the teacher reruns it while planning)

// ---- tiny helpers ------------------------------------------------------------
function later(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.warn('potw:', e); } }, ms);
  timers.add(id);
  return id;
}
function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
function destCamera() {
  const c = profile.camera;
  return {
    center: { lat: c.center.lat, lng: c.center.lng, altitude: c.center.altitude },
    tilt: c.tilt, heading: c.heading, range: c.range,
  };
}

// =============================================================================
// STAGE 0 — launch screen (lives in #module-root)
// =============================================================================
function renderLaunch() {
  if (!rootEl) return;
  disposeGlobe(); // drop any prior globe before re-rendering
  rootEl.innerHTML = `
    <div class="potw-launch">
      <div class="potw-stars" aria-hidden="true"></div>
      <div class="potw-globe" aria-hidden="true"><span class="potw-globe-emoji">🌍</span></div>
      <h1 class="font-display potw-launch-title">Place of the Week</h1>
      <p class="potw-teaser">This week's destination is classified&hellip;</p>
      <button type="button" class="potw-launch-btn font-display">🌍 Launch Place of the Week</button>
    </div>`;
  rootEl.querySelector('.potw-launch-btn').addEventListener('click', openOverlay);
  mountGlobe(rootEl.querySelector('.potw-globe')); // async; falls back to the emoji on WebGL failure
}

// ---- Stage 0 real-3D globe (three.js) ---------------------------------------
function disposeGlobe() {
  if (globe) { try { globe.dispose(); } catch (e) {} globe = null; }
}

// Draw a recognizable equirectangular Earth onto an offscreen canvas (no external
// assets). Land shapes are simplified real coastline rings authored as [lon,lat],
// projected equirectangularly, so continents read correctly at a glance.
function drawEarthTexture() {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const X = (lon) => ((lon + 180) / 360) * W;
  const Y = (lat) => ((90 - lat) / 180) * H;

  // ocean
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#123463'); grad.addColorStop(0.5, '#1e3a8a'); grad.addColorStop(1, '#112a54');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);

  const poly = (ring, fill, stroke) => {
    g.beginPath();
    ring.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.lineWidth = 2; g.strokeStyle = stroke; g.lineJoin = 'round'; g.stroke(); }
  };

  const GREEN = '#3d7a49', TAN = '#c2a86a', ICE = '#eaf1fb', COAST = '#274b32', OCEAN = '#1e3a8a';

  // ---- simplified continent + island coastlines ([lon, lat]) ----------------
  const northAmerica = [
    [-165,60],[-168,65],[-156,71],[-130,70],[-105,69],[-82,73],[-78,62],[-64,60],
    [-55,52],[-66,44],[-70,41],[-75,35],[-81,25],[-84,30],[-90,29],[-97,28],[-97,22],
    [-95,18],[-88,21],[-87,15],[-83,9],[-96,16],[-106,20],[-112,24],[-117,32],
    [-123,38],[-124,48],[-137,58],[-152,59],
  ];
  const southAmerica = [
    [-78,8],[-72,11],[-62,10],[-52,5],[-48,-1],[-35,-6],[-39,-14],[-48,-25],[-54,-34],
    [-62,-40],[-65,-45],[-69,-52],[-74,-50],[-73,-42],[-71,-33],[-70,-18],[-76,-14],
    [-81,-5],[-80,1],
  ];
  const africa = [
    [-17,15],[-16,20],[-10,26],[0,32],[10,34],[20,32],[25,32],[32,31],[35,28],[37,22],
    [40,15],[43,11],[51,12],[48,5],[41,-2],[40,-10],[35,-18],[35,-24],[27,-33],[20,-35],
    [16,-29],[12,-17],[9,-1],[9,4],[3,6],[-4,5],[-8,4],[-13,8],
  ];
  const europe = [
    [-9,44],[-9,37],[-6,36],[0,39],[3,43],[7,44],[10,44],[12,42],[15,40],[18,40],[16,42],
    [13,45],[13,54],[10,57],[5,61],[7,63],[12,66],[16,69],[24,71],[28,70],[30,66],[24,60],
    [20,56],[12,54],[4,51],[-2,48],[-5,48],[-2,43],
  ];
  const asia = [
    [28,41],[36,37],[36,31],[42,37],[50,40],[54,37],[56,26],[61,25],[66,25],[68,24],
    [72,29],[88,28],[92,22],[98,16],[100,13],[100,8],[104,10],[109,11],[108,16],[106,21],
    [110,22],[113,23],[121,31],[122,37],[126,40],[122,40],[124,48],[131,45],[140,53],
    [157,61],[163,60],[170,66],[180,66],[175,68],[160,70],[140,73],[110,74],[100,77],
    [90,75],[70,73],[60,69],[50,68],[40,66],[38,64],[33,66],[30,60],[30,50],
  ];
  const arabia = [
    [43,13],[35,29],[38,30],[48,30],[50,27],[57,25],[60,22],[57,17],[52,14],[45,12],
  ];
  const india = [
    [68,24],[70,20],[73,16],[76,9],[78,8],[80,13],[84,18],[87,21],[89,22],[92,21],
    [90,26],[80,29],[72,29],
  ];
  const australia = [
    [114,-22],[114,-26],[115,-33],[123,-34],[131,-31],[135,-35],[138,-35],[141,-38],
    [147,-38],[150,-37],[153,-28],[146,-19],[145,-15],[142,-11],[137,-12],[136,-15],
    [130,-12],[123,-16],[121,-20],
  ];
  const greenland = [[-45,60],[-50,64],[-55,70],[-40,78],[-22,70],[-20,64],[-42,60]];
  const antarctica = [
    [-180,-63],[-140,-66],[-100,-72],[-60,-63],[-20,-70],[20,-68],[60,-66],[100,-66],
    [140,-66],[180,-70],[180,-90],[-180,-90],
  ];

  const islands = [
    [[-8,50],[-5,58],[-2,57],[-3,54],[1,52],[-6,50]],                 // British Isles
    [[-24,64],[-14,65],[-19,66],[-24,64]],                            // Iceland
    [[130,31],[135,34],[138,35],[141,41],[143,43],[140,38],[137,35],[132,33]], // Japan
    [[109,2],[117,5],[119,1],[114,-4],[110,-2]],                      // Borneo
    [[95,5],[100,0],[104,-5],[100,-3],[96,2]],                        // Sumatra
    [[105,-6],[114,-8],[110,-8],[106,-7]],                            // Java
    [[131,-1],[141,-3],[147,-8],[140,-9],[133,-4]],                   // New Guinea
    [[120,14],[124,17],[126,9],[122,7],[120,10]],                     // Philippines
    [[173,-41],[175,-37],[178,-38],[176,-45],[168,-46],[171,-42]],    // New Zealand
    [[43,-12],[50,-15],[49,-25],[45,-25],[43,-16]],                   // Madagascar
    [[80,6],[82,7],[81,9],[80,8]],                                    // Sri Lanka
  ];

  // fill land (green), then ice sheets, then arid overlays, then inland seas
  const greenRings = [northAmerica, southAmerica, africa, europe, asia, arabia, india, australia, ...islands];
  greenRings.forEach((r) => poly(r, GREEN, COAST));
  poly(greenland, ICE, '#cdd9e8');
  poly(antarctica, ICE, null);
  g.fillStyle = 'rgba(234,241,251,0.45)'; g.fillRect(0, 0, W, H * 0.04); // north ice cap

  // arid regions (tan) — irregular so they read as deserts, not blocks
  [
    [[-11,17],[2,15],[16,16],[26,19],[30,25],[26,30],[12,31],[-2,29],[-10,24]], // Sahara
    [[39,17],[46,14],[52,18],[52,25],[47,29],[41,28],[38,22]],                  // Arabian interior
    [[123,-21],[132,-23],[139,-25],[138,-29],[130,-30],[124,-27]],              // Australian outback
  ].forEach((r) => poly(r, TAN, null));

  // inland seas / bays (ocean overlay) so they read correctly
  [
    [[-95,51],[-92,62],[-80,63],[-78,55],[-85,51]],   // Hudson Bay
    [[-92,45],[-76,44],[-78,49],[-90,49]],            // Great Lakes (suggestion)
    [[28,41],[41,42],[41,46],[30,47]],                // Black Sea
    [[48,37],[54,40],[53,46],[49,45]],                // Caspian Sea
    [[48,30],[56,26],[54,24],[49,29]],                // Persian Gulf
  ].forEach((r) => poly(r, OCEAN, null));

  return cv;
}

async function mountGlobe(container) {
  if (!container) return;
  let THREE;
  try { THREE = await import('three'); } catch (e) { return; } // keep emoji fallback
  if (!rootEl || !container.isConnected) return;               // unmounted while loading
  try {
    const size = 168;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, 3.4);

    const tex = new THREE.CanvasTexture(drawEarthTexture());
    tex.colorSpace = THREE.SRGBColorSpace;
    const geometry = new THREE.SphereGeometry(1, 48, 48);
    const material = new THREE.MeshPhongMaterial({ map: tex, specular: 0x2a4a7a, shininess: 8 });
    const sphere = new THREE.Mesh(geometry, material);

    // Axial tilt (~23.4°) around Z so the vertical spin axis leans authentically.
    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = THREE.MathUtils.degToRad(23.4);
    tiltGroup.add(sphere);
    scene.add(tiltGroup);

    scene.add(new THREE.AmbientLight(0x99aabb, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(3, 1.5, 2.5);
    scene.add(dir);

    disposeGlobe(); // dispose any prior before claiming the slot
    const emoji = container.querySelector('.potw-globe-emoji');
    if (emoji) emoji.style.display = 'none';
    renderer.domElement.className = 'potw-globe-canvas';
    container.appendChild(renderer.domElement);

    let raf = 0; let running = true;
    const tick = () => {
      if (!running) return;
      sphere.rotation.y += 0.0035; // west -> east (correct Earth spin)
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    const onVis = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; tick(); }
    };
    document.addEventListener('visibilitychange', onVis);
    tick();

    globe = {
      dispose() {
        running = false; cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVis);
        try { geometry.dispose(); material.dispose(); tex.dispose(); renderer.dispose(); } catch (e) {}
        const el = renderer.domElement;
        if (el && el.parentNode) el.parentNode.removeChild(el);
        if (emoji) emoji.style.display = '';
      },
    };
  } catch (e) {
    // WebGL unavailable / context creation failed — keep the emoji (CSS opacity pulse).
    console.warn('potw: 3D globe unavailable, using emoji fallback');
  }
}

// =============================================================================
// STAGE 1 — open overlay, preload map, play intro video (fall back to song)
// =============================================================================
async function openOverlay() {
  const host = document.getElementById('overlay-root');
  if (!host || overlayEl) return;
  profile = ctxRef.store.getPotwProfile();
  if (!profile) { console.warn('potw: no active profile'); return; }
  activeKey = (typeof ctxRef.store.getActivePotwKey === 'function')
    ? ctxRef.store.getActivePotwKey()
    : ctxRef.store.getState().potw.active;

  advanced = false;
  usingFallback = false;
  cardShown = false;
  ytIntroEl = null; ytPlayer = null; ytPollTimer = null; ytSafetyArmed = false;
  deckInfo = null; deckPromise = null;   // re-resolve the deck for this voyage
  const shortName = profile.title.split(/\s+/).pop();

  overlayEl = document.createElement('div');
  overlayEl.className = 'potw-overlay';
  // Building the template can throw on a malformed profile (hand-edited or
  // restored from a damaged backup). overlayEl is already set by then, and a
  // throw between here and appendChild used to leave it pointing at a
  // detached node — the `if (overlayEl) return` guard above then swallowed
  // every later Launch tap until the module was remounted. On failure: log,
  // reset, and leave the button alive for after the profile is repaired.
  try {
    overlayEl.innerHTML = `
    <div class="potw-map-layer"></div>

    <div class="potw-intro-layer">
      <video class="potw-video" playsinline></video>
      <div class="potw-song">
        <div class="potw-song-globe" aria-hidden="true">🌍</div>
        <div class="font-display potw-song-title">PLACE OF THE WEEK</div>
        <div class="potw-song-sub">Fasten your seatbelts&hellip;</div>
      </div>
      <button type="button" class="potw-skip">Skip &#9197;</button>
    </div>

    <div class="potw-reveal">
      <div class="potw-eyebrow">This Week's Destination</div>
      <div class="font-display potw-title">${esc(profile.title.toUpperCase())}</div>
      <button type="button" class="potw-fly-btn font-display">🚀 Fly to ${esc(shortName)}</button>
    </div>

    <div class="potw-lesson">${buildLessonHTML()}</div>

    <header class="potw-head potw-chrome">
      <button type="button" class="potw-home">🏠 Main Screen</button>
      <div class="potw-quick" role="group" aria-label="Quick launch"></div>
      <button type="button" class="potw-end">✕ End Voyage</button>
    </header>

    <button type="button" class="potw-lesson-btn">📋 Lesson</button>`;
  } catch (e) {
    console.warn('potw: this destination profile could not be rendered — check it in Admin → Place of the Week', e);
    overlayEl = null;
    return;
  }
  host.appendChild(overlayEl);

  // --- create the 3D map now so it can load during the ~37s intro -----------
  createMap3d();

  // --- wire controls --------------------------------------------------------
  overlayEl.querySelector('.potw-skip').addEventListener('click', advanceToReveal);
  overlayEl.querySelector('.potw-fly-btn').addEventListener('click', gotoFlight);
  overlayEl.querySelector('.potw-lesson-btn').addEventListener('click', toggleLessonCard);
  overlayEl.querySelector('.potw-end').addEventListener('click', closeOverlay);
  overlayEl.querySelector('.potw-home').addEventListener('click', goHome);
  buildQuickLaunch();   // async: profile.links + stored assets as header buttons
  wireLesson();

  // Overlay chrome (header + presentation bar) fades when idle, returns on input.
  ['mousemove', 'pointerdown', 'touchstart'].forEach((evt) =>
    overlayEl.addEventListener(evt, pokeChrome, { passive: true }));

  // --- resolve the intro source, in priority order --------------------------
  // 1) teacher-dropped blob  2) profile.videoUrl (YouTube embed -> iframe, else
  //    direct/relative -> <video>)  3) static CONFIG.POTW_VIDEO  4) song fallback
  const blobVideoUrl = await media.url(`potw:${activeKey}:video`);
  if (!overlayEl) return; // torn down while awaiting IndexedDB
  const url = profile.videoUrl;

  if (blobVideoUrl) {
    startVideoIntro(blobVideoUrl, true);            // local blob — guaranteed present
  } else if (url && isYouTubeEmbed(url)) {
    startYouTubeIntro(url);                          // embedded player (Skip / timer advance)
  } else if (url) {
    startVideoIntro(url, false);                    // direct .mp4 / relative path
  } else {
    startVideoIntro(CONFIG.POTW_VIDEO, false);      // today's static-file behavior
  }
}

function isYouTubeEmbed(u) {
  return typeof u === 'string' && /(?:^|\/\/)(?:www\.)?youtube(?:-nocookie)?\.com\/embed\//i.test(u);
}

// <video> intro (blob / direct .mp4 / relative / static). Full behavior set:
// aspect-contain, last-2s card, crossfade on 'ended', error -> song fallback.
function startVideoIntro(src, isBlob) {
  videoEl = overlayEl.querySelector('.potw-video');
  let videoOk = false;
  const markOk = () => { videoOk = true; };
  videoEl.addEventListener('playing', markOk);
  videoEl.addEventListener('canplaythrough', markOk);
  videoEl.addEventListener('timeupdate', onVideoTimeUpdate); // pop card in last 2s
  videoEl.addEventListener('ended', advanceToReveal);        // then crossfade to map
  videoEl.addEventListener('error', startSongFallback);
  videoEl.src = src;

  // A local blob is guaranteed present, so skip the 2s race for it — but keep
  // the error handler regardless (a corrupt/undecodable source still falls back).
  if (!isBlob) {
    later(() => { if (!videoOk && !advanced && !usingFallback) startSongFallback(); }, 2000);
  }

  const p = videoEl.play();
  if (p && typeof p.catch === 'function') {
    p.catch(() => { if (!advanced && !usingFallback) startSongFallback(); });
  }
}

// YouTube-embed intro via the official IFrame Player API. Chrome (controls/title/
// captions) is suppressed; real duration/ended drive the last-2s card + crossfade,
// exactly like the <video> path. Falls back to a plain iframe if the API won't load.
function extractYouTubeId(u) {
  const m = /\/embed\/([^/?&#]+)/.exec(u || '');
  return m ? m[1] : '';
}

// Load https://www.youtube.com/iframe_api once; resolve with window.YT.
// Defensive against onYouTubeIframeAPIReady already being defined (chain it).
function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { if (typeof prev === 'function') prev(); } catch (e) {}
      resolve(window.YT);
    };
    if (!document.getElementById('potw-yt-api')) {
      const s = document.createElement('script');
      s.id = 'potw-yt-api';
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('YouTube IFrame API failed to load'));
      document.head.appendChild(s);
    }
  });
  return ytApiPromise;
}

function startYouTubeIntro(url) {
  const vid = overlayEl.querySelector('.potw-video');
  if (vid) vid.style.display = 'none';      // hide the unused <video>
  videoEl = vid;                            // keep ref so teardown pause() is safe
  const videoId = extractYouTubeId(url);

  ytIntroEl = document.createElement('div');
  ytIntroEl.className = 'potw-yt';
  ytIntroEl.innerHTML = `<div class="potw-yt-box" style="--yt-crop:${YT_CROP_PX}px"><div class="potw-yt-player"></div></div>`;
  const intro = overlayEl.querySelector('.potw-intro-layer');
  intro.insertBefore(ytIntroEl, intro.firstChild); // Skip button (later sibling, z-50) stays on top

  // Race the API load against a timeout; whichever wins, only act once.
  let settled = false;
  const fbId = later(() => { if (!settled) { settled = true; startYouTubePlainFallback(url); } }, YT_API_TIMEOUT_MS);
  loadYouTubeApi().then((YT) => {
    if (settled || !overlayEl || !ytIntroEl) return;
    settled = true; clearTimeout(fbId); timers.delete(fbId);
    createYtPlayer(YT, videoId);
  }).catch(() => {
    if (settled || !overlayEl || !ytIntroEl) return;
    settled = true; clearTimeout(fbId); timers.delete(fbId);
    startYouTubePlainFallback(url);
  });
}

// Turn off captions best-effort. Auto-captions often load only once playback
// starts, so this must run on PLAYING (and a couple of retries), not just onReady.
function killYtCaptions(p) {
  if (!p) return;
  try { p.setOption('captions', 'track', {}); } catch (x) {}
  try { p.setOption('cc', 'track', {}); } catch (x) {}
  try { p.unloadModule('captions'); } catch (x) {}
  try { p.unloadModule('cc'); } catch (x) {}
}

function createYtPlayer(YT, videoId) {
  const target = ytIntroEl && ytIntroEl.querySelector('.potw-yt-player');
  if (!target) return;
  ytPlayer = new YT.Player(target, {
    videoId,
    width: '100%', height: '100%',
    playerVars: {
      autoplay: 1, controls: 0, rel: 0, iv_load_policy: 3, disablekb: 1,
      fs: 0, playsinline: 1, cc_load_policy: 0, modestbranding: 1,
    },
    events: {
      onReady: (e) => {
        killYtCaptions(e.target);        // keep sound; captions off (best-effort)
        try { e.target.playVideo(); } catch (x) {}
        // Backstop: if PLAYING never arrives (blocked autoplay the teacher then
        // resolves, or a dropped event), show the player anyway rather than
        // leaving a black box for the whole intro.
        later(revealYtPlayer, 2500);
      },
      onStateChange: onYtStateChange,
    },
  });
}

// Fade the player in once it is genuinely playing. A safety timer also reveals
// it regardless, so a missed PLAYING event can never leave a black rectangle
// where the intro should be — better a visible glyph than no video at all.
function revealYtPlayer() {
  const box = ytIntroEl && ytIntroEl.querySelector('.potw-yt-box');
  if (box) box.classList.add('is-live');
}

function onYtStateChange(e) {
  const YT = window.YT;
  if (!YT || !YT.PlayerState) return;
  if (e.data === YT.PlayerState.PLAYING) {
    killYtCaptions(ytPlayer);            // captions load with playback — kill them now
    revealYtPlayer();                    // now it's really playing, fade it up
    armYtSafety();   // safety auto-advance once real duration is known
    startYtPoll();   // last-2s card poll + continuous caption suppression
  } else if (e.data === YT.PlayerState.ENDED) {
    advanceToReveal();
  }
}

// Poll real playback time: continuously keep captions off (they re-arm per cue),
// and pop the card in the final 2s (parity with the <video> path). Runs until
// teardown clears the interval.
function startYtPoll() {
  if (ytPollTimer) return;
  ytPollTimer = setInterval(() => {
    if (!ytPlayer || !overlayEl) return;
    killYtCaptions(ytPlayer);
    let d = 0, c = 0;
    try { d = ytPlayer.getDuration(); c = ytPlayer.getCurrentTime(); } catch (x) { return; }
    if (isFinite(d) && d > 0 && d - c <= CARD_EARLY_S) showRevealCard();
  }, 250);
}

// Arm a safety auto-advance at duration+10s (only once duration is known), so a
// missed ENDED event still hands off to the map. Skip always works regardless.
function armYtSafety() {
  if (ytSafetyArmed || !ytPlayer) return;
  let d = 0;
  try { d = ytPlayer.getDuration(); } catch (x) {}
  if (isFinite(d) && d > 0) { ytSafetyArmed = true; later(advanceToReveal, (d + 10) * 1000); }
}

// Plain-iframe fallback when the IFrame API won't load: Skip + a generous timer.
function startYouTubePlainFallback(url) {
  if (!overlayEl || !ytIntroEl) return;
  const box = ytIntroEl.querySelector('.potw-yt-box');
  if (!box) return;
  box.innerHTML = '';
  const id = extractYouTubeId(url);
  const src = `https://www.youtube.com/embed/${id}?autoplay=1&controls=0&rel=0&iv_load_policy=3&disablekb=1&fs=0&playsinline=1&cc_load_policy=0&modestbranding=1`;
  const ifr = document.createElement('iframe');
  ifr.setAttribute('allow', 'autoplay; fullscreen');
  ifr.setAttribute('allowfullscreen', '');
  ifr.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  ifr.src = src;
  box.appendChild(ifr);
  // No API here, so no PLAYING event will ever arrive — reveal it directly or
  // the hide-until-playing rule would leave this path permanently black.
  revealYtPlayer();
  later(advanceToReveal, YT_PLAIN_FALLBACK_S * 1000);
}

// Destroy the YT player + poll and remove the container (stops audio immediately).
function destroyYtIntro() {
  if (ytPollTimer) { clearInterval(ytPollTimer); ytPollTimer = null; }
  if (ytPlayer) { try { ytPlayer.destroy(); } catch (e) {} ytPlayer = null; }
  if (ytIntroEl) { try { ytIntroEl.remove(); } catch (e) {} ytIntroEl = null; }
  ytSafetyArmed = false;
}

// Fallback: hide the (missing) video, play the theme song over an animated title.
async function startSongFallback() {
  if (usingFallback || advanced || cardShown || !overlayEl) return;
  usingFallback = true; // set synchronously to prevent a double fallback
  try { videoEl && videoEl.pause(); } catch (e) {}
  if (videoEl) videoEl.style.display = 'none';
  overlayEl.querySelector('.potw-song').style.display = 'flex';

  // Teacher-uploaded blob first (potw:<key>:song), else static CONFIG.POTW_SONG.
  const songSrc = (await media.url(`potw:${activeKey}:song`)) || CONFIG.POTW_SONG;
  if (advanced || !overlayEl) return; // skipped/torn down while awaiting

  songEl = ctxRef.audio.play(songSrc);
  if (songEl) {
    songEl.addEventListener('ended', advanceToReveal);
    // An uploaded song may be shorter than the config timer — prefer the shorter.
    songEl.addEventListener('loadedmetadata', () => {
      const d = songEl.duration;
      if (isFinite(d) && d > 0 && d < CONFIG.POTW_SONG_DURATION_S) later(advanceToReveal, d * 1000);
    });
  }
  later(advanceToReveal, CONFIG.POTW_SONG_DURATION_S * 1000);
}

// =============================================================================
// OVERLAY HEADER — 🏠 Main Screen + quick launch for this destination's other
// resources (profile.links and stored non-slide assets). Auto-hides with the
// rest of the chrome and never overlaps the map or the slides.
// =============================================================================

// End the voyage AND leave the module: back to the dashboard in one tap.
function goHome() {
  closeOverlay();
  try { ctxRef && ctxRef.registry && ctxRef.registry.home(); } catch (e) { console.warn('potw:', e); }
}

// A quick link's URL is teacher-typed text about to become an href. Escaping
// alone does not help here — "javascript:…" is a perfectly escaped attribute
// value that still executes on click. Absolute URLs must be http(s); anything
// carrying another scheme gets no href and renders as an inert label.
function safeLinkUrl(url) {
  const u = String(url || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;   // no scheme — relative, fine
  return /^https?:/i.test(u) ? u : null;
}

function quickLinkHTML(title, url) {
  const safe = safeLinkUrl(url);
  return `<a class="potw-quick-btn"${safe ? ` href="${esc(safe)}" target="_blank" rel="noopener noreferrer"` : ''}>
    <span aria-hidden="true">🔗</span><span class="potw-quick-label">${esc(title)}</span><span class="potw-quick-out" aria-hidden="true">↗</span>
  </a>`;
}

// Fill the header's quick-launch strip. URL links render immediately; stored
// assets arrive from IndexedDB a moment later. No items = no clutter (the
// header just keeps 🏠 Main Screen and ✕ End Voyage).
async function buildQuickLaunch() {
  if (!overlayEl) return;
  const wrap = overlayEl.querySelector('.potw-quick');
  if (!wrap) return;

  const links = Array.isArray(profile.links) ? profile.links.filter((l) => l && l.url) : [];
  wrap.innerHTML = links.map((l) => quickLinkHTML(l.title || l.url, l.url)).join('');

  let assets = [];
  try { assets = await media.list(`potw:${activeKey}:asset:`); } catch (e) { assets = []; }
  if (!overlayEl || !wrap.isConnected) return;   // torn down while awaiting IndexedDB
  assets = (assets || []).filter(Boolean).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  assets.forEach((a) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'potw-quick-btn';
    btn.innerHTML = `<span aria-hidden="true">${assetIcon(a.type)}</span>
      <span class="potw-quick-label">${esc(a.name || a.key)}</span><span class="potw-quick-out" aria-hidden="true">↗</span>`;
    btn.addEventListener('click', async () => {
      const url = await media.url(a.key);
      if (!url) { btn.classList.add('potw-asset-missing'); return; }
      window.open(url, '_blank', 'noopener');
    });
    wrap.appendChild(btn);
  });
}

// =============================================================================
// STAGE 2 — reveal card (pops in over the still-playing video, then the video
// crossfades out to expose the 3D map parked at the Smithville start camera)
// =============================================================================

// Pop the destination card in — WITHOUT disturbing the video/song still playing.
function showRevealCard() {
  if (cardShown || !overlayEl) return;
  cardShown = true;
  overlayEl.querySelector('.potw-reveal').classList.add('show');
  const head = overlayEl.querySelector('.potw-head');
  if (head) head.classList.add('show');
  overlayEl.classList.add('head-on');   // nudges Skip clear of the header bar
  pokeChrome();
}

// During the last 2s of the video, reveal the card over the live video.
function onVideoTimeUpdate() {
  if (!videoEl) return;
  const d = videoEl.duration;
  // Guard NaN/Infinity (metadata not loaded / streamed) — 'ended' covers those.
  if (isFinite(d) && d > 0 && d - videoEl.currentTime <= CARD_EARLY_S) showRevealCard();
}

// Hand the intro off to the map: card stays, video/song layer crossfades away.
// Fired by video 'ended', song end/timer, and the Skip button.
function advanceToReveal() {
  if (advanced || !overlayEl) return;
  advanced = true;
  showRevealCard(); // no-op if timeupdate already showed it
  try { videoEl && videoEl.pause(); } catch (e) {}
  try { ctxRef.audio.stopAll(); } catch (e) {}   // stop the song track if any
  songEl = null;
  // Stop any YouTube player immediately (a hidden iframe keeps playing audio).
  destroyYtIntro();

  const intro = overlayEl.querySelector('.potw-intro-layer');
  intro.style.transition = `opacity ${INTRO_FADE_MS}ms ease`;
  intro.style.opacity = '0';
  intro.style.pointerEvents = 'none';
  later(() => { if (intro) intro.style.display = 'none'; }, INTRO_FADE_MS);
}

// Build the <gmp-map-3d> parked at the Smithville start camera, plus the
// readiness promise (true = usable, false = Maps never loaded). Shared by the
// full voyage and TEST FLIGHT so there is one copy of the map setup.
function createMap3d() {
  mapEl = document.createElement('gmp-map-3d');
  mapEl.setAttribute('mode', 'hybrid');
  mapEl.setAttribute('center', '40.8653,-81.8604,500'); // Smithville, OH
  mapEl.setAttribute('range', '3000');
  mapEl.setAttribute('tilt', '45');
  mapEl.setAttribute('heading', '0');
  mapEl.setAttribute('default-ui-hidden', '');
  overlayEl.querySelector('.potw-map-layer').appendChild(mapEl);

  // Resolve true when the custom element is usable, false if Maps never loads.
  mapReadyPromise = ('customElements' in window)
    ? Promise.race([
        customElements.whenDefined('gmp-map-3d').then(() => true),
        new Promise((r) => later(() => r(false), 4000)),
      ]).catch(() => false)
    : Promise.resolve(false);
}

// =============================================================================
// STAGE 3 — 3D flight (graceful fallback if Maps is unavailable)
// Shared by the classroom voyage and TEST FLIGHT; `previewMode` suppresses the
// reveal card, the presentation auto-launch and the lesson card.
// =============================================================================

// ---- flyover background music -----------------------------------------------
// Starts on the "🚀 Fly to…" tap (the reveal card waits for a human, so nothing
// earlier could stay in sync) and fades out when the destination is reached.
//
// ONE track for every destination, chosen in Admin → Settings → 🎵 Background
// music, where the rest of the app's music already lived. It used to be chosen
// per destination in the POTW editor — an upload block and a URL field that
// between them made "where do I change the music?" a two-answer question. Old
// per-destination choices (profile.flyoverUrl, potw:<key>:flyover blobs) are
// retired and simply not read; store.getFlyoverTrack() hands back the global
// choice, or CONFIG.POTW_FLYOVER_DEFAULT when the teacher has picked nothing.
function startFlyoverMusic() {
  if (previewMode || flyMusicEl || !overlayEl) return;
  const src = ctxRef.store?.getFlyoverTrack?.() || CONFIG.POTW_FLYOVER_DEFAULT || '';
  if (!src) return;   // nothing set — silence, no error
  try {
    // ctx.audio honours the sound switch (a muted track still returns an element
    // at volume 0, which the fade below then ramps harmlessly).
    const el = ctxRef.audio.play(src, { loop: true });
    if (!el) return;
    flyMusicEl = el;
    el.addEventListener('error', () => { if (flyMusicEl === el) stopFlyoverMusic(); });
  } catch (e) { console.warn('potw: flyover music unavailable', e); }
}

// Smooth ramp to silence, then stop and release the element. Idempotent.
function fadeOutFlyoverMusic(ms = FLYOVER_FADE_MS) {
  const el = flyMusicEl;
  if (!el) return;
  // A SHORTER fade must be able to overtake a longer one already running.
  // Arrival starts the leisurely 3s fade, then openPresentation() asks for a
  // fast 900ms one — but it runs after an await, so the slow fade had already
  // claimed the timer and the old guard made the fast request a no-op. The
  // music then trailed under the opening slide, which is exactly what the
  // fast fade exists to prevent.
  if (flyFadeTimer) {
    if (ms >= flyFadeMs) return;              // already fading at least this fast
    clearInterval(flyFadeTimer);
    flyFadeTimer = null;
  }
  flyFadeMs = ms;
  const from = Number(el.volume) || 0;
  const t0 = Date.now();
  flyFadeTimer = setInterval(() => {
    if (!flyMusicEl) { stopFlyoverMusic(); return; }
    const k = Math.min(1, (Date.now() - t0) / Math.max(1, ms));
    try { el.volume = Math.max(0, Math.min(1, from * (1 - k))); } catch (e) {}
    if (k >= 1) stopFlyoverMusic();
  }, 50);
}

// Belt and braces: if a background loop is somehow running (a future screen
// assignment, a stray preview), silence it when a deck takes over.
function stopAmbientIfAny() {
  import('../core/ambient.js').then((m) => m.stopAmbient && m.stopAmbient()).catch(() => {});
}

function stopFlyoverMusic() {
  if (flyFadeTimer) { clearInterval(flyFadeTimer); flyFadeTimer = null; }
  flyFadeMs = 0;
  const el = flyMusicEl;
  flyMusicEl = null;
  if (!el) return;
  try { el.pause(); } catch (e) {}
  try { el.removeAttribute('src'); el.load(); } catch (e) {}
}

function gotoFlight() {
  if (!overlayEl) return;
  startFlyoverMusic();   // music rides the whole flight, from this tap
  const reveal = overlayEl.querySelector('.potw-reveal');
  if (reveal) {                       // absent in preview mode
    reveal.style.transition = 'opacity .6s ease';
    reveal.style.opacity = '0';
    reveal.style.pointerEvents = 'none';
    later(() => { if (reveal) reveal.style.display = 'none'; }, 650);
  }
  const flyMs = previewMode ? previewFlyMs : FLY_TO_MS;

  mapReadyPromise.then((ready) => {
    if (!overlayEl) return; // torn down mid-flight
    let flying = false;
    if (ready && mapEl && typeof mapEl.flyCameraTo === 'function') {
      try {
        mapEl.flyCameraTo({ endCamera: destCamera(), durationMillis: flyMs });
        flying = true;
      } catch (e) {
        console.warn('potw: flyCameraTo failed, using fallback', e);
      }
    }
    if (!flying) showMapFallback();

    // After landing: start the slow orbit, then either auto-launch the
    // presentation (if this destination has one) or slide the lesson card up.
    later(() => {
      if (flying && typeof mapEl.flyCameraAround === 'function') {
        try {
          mapEl.flyCameraAround({ camera: destCamera(), durationMillis: ORBIT_MS, repeatCount: 10 });
        } catch (e) { console.warn('potw: flyCameraAround failed', e); }
      }
      if (previewMode) return;   // TEST FLIGHT ends here: fly + orbit only
      // The lesson card is no longer the gatekeeper: a deck opens on arrival.
      resolveDeck().then((deck) => {
        if (!overlayEl) return;
        if (deck) openPresentation();
        else slideLesson();
        fadeOutFlyoverMusic();   // arrived: hand the room over to the lesson
      });
    }, flying ? flyMs + LAND_SETTLE_MS : 700);
  });
}

function showMapFallback() {
  if (!overlayEl) return;
  const layer = overlayEl.querySelector('.potw-map-layer');
  if (!layer || layer.querySelector('.potw-map-fallback')) return;
  const fb = document.createElement('div');
  fb.className = 'potw-map-fallback';
  fb.innerHTML = `
    <div class="potw-fb-globe" aria-hidden="true">🌍</div>
    <div class="font-display potw-fb-title">${esc(profile.title)}</div>
    <div class="potw-fb-sub">${esc(profile.subtitle)}</div>
    <div class="potw-fb-note">Live 3D globe unavailable — showing offline view</div>`;
  layer.appendChild(fb);
}

// =============================================================================
// STAGE 4 — lesson overlay card (tabs: facts / sources / quiz)
// =============================================================================
function slideLesson() {
  if (!overlayEl) return;
  overlayEl.querySelector('.potw-lesson').classList.add('show');
  const btn = overlayEl.querySelector('.potw-lesson-btn');
  if (btn) { btn.style.display = 'block'; btn.textContent = '📋 Hide Lesson'; }
}

function buildLessonHTML() {
  // A hand-edited or partially-restored profile may be missing any of these
  // three arrays — a .map on undefined here used to throw inside openOverlay
  // and brick the Launch button until remount. An empty section reads fine;
  // a dead Launch button in front of the class does not.
  const factList = Array.isArray(profile.quickFacts) ? profile.quickFacts : [];
  const sourceList = Array.isArray(profile.primarySources) ? profile.primarySources : [];
  const quizList = Array.isArray(profile.quiz) ? profile.quiz : [];

  const facts = factList.map((f, i) =>
    `<div class="potw-fact"><span class="n">${i + 1}</span><span>${esc(f)}</span></div>`).join('');

  const sources = sourceList.map((s) =>
    `<button type="button" class="potw-source">
       <span class="glyph" aria-hidden="true">${esc(s.emoji)}</span>
       <span class="potw-source-body">
         <h4>${esc(s.name)}</h4>
         <p>${esc(s.desc)}</p>
       </span>
     </button>`).join('');

  const houses = Object.values(ctxRef.store.HOUSES);
  const points = bountyPoints();
  const quiz = quizList.map((q, qi) => {
    // The store ledger is the source of truth: a bounty already paid for this
    // profile+week stays locked across relaunches and across class periods.
    const paid = ctxRef.store.getPaidBounty(activeKey, qi);
    const winner = paid ? ctxRef.store.HOUSES[paid.houseId] : null;
    const awards = houses.map((h) => {
      const isWinner = !!winner && winner.id === h.id;
      const cls = `potw-award${paid ? (isWinner ? ' won' : ' awarded') : ''}`;
      return `<button type="button" class="${cls}" data-q="${qi}" data-house="${h.id}"
        style="--acc:${h.accent}"${paid ? ' disabled' : ''}>
         ${esc(h.name)}<small>+${points}</small>
       </button>`;
    }).join('');
    const paidNote = winner
      ? `<div class="potw-bounty-paid" data-paid="${qi}">✓ ${esc(winner.name)} won this bounty</div>`
      : `<div class="potw-bounty-paid" data-paid="${qi}" hidden></div>`;
    return `<div class="potw-quiz">
       <div class="potw-q">${esc(q.q)}</div>
       <button type="button" class="potw-reveal-ans" data-q="${qi}">Tap to reveal answer</button>
       <div class="potw-ans" data-q="${qi}">${esc(q.a)}</div>
       <div class="potw-awards">${awards}</div>
       ${paidNote}
     </div>`;
  }).join('');

  // Shown when a deck exists — including a PDF discovered among stored assets,
  // which resolves asynchronously (wireLesson reveals the button when ready).
  const hasPres = !!(profile.presentation && profile.presentation.type);
  const presBtn =
    `<button type="button" class="potw-pres-launch font-display"${hasPres ? '' : ' style="display:none"'}>📽️ Launch Presentation</button>`;

  // "Resources" tab: URL links (from profile.links) + stored assets (async via
  // media.list). The tab is provisional — shown immediately if links exist, and
  // otherwise revealed once stored assets are found (removed if neither exist).
  const links = Array.isArray(profile.links) ? profile.links.filter((l) => l && l.url) : [];
  const hasLinks = links.length > 0;
  const linksTab =
    `<button type="button" class="potw-tab potw-tab-res" data-tab="links"${hasLinks ? '' : ' style="display:none"'}>🔗 Resources</button>`;
  const linksPanel =
    `<div class="potw-panel" data-panel="links">
       <div class="potw-res-assets"><div class="potw-res-loading"><span class="potw-spin" aria-hidden="true"></span> Loading files&hellip;</div></div>
       ${hasLinks ? `<div class="potw-res-group">Links</div>${links.map(linkCardHTML).join('')}` : ''}
     </div>`;

  return `
    ${presBtn}
    <div class="potw-tabs" role="tablist">
      <button type="button" class="potw-tab active" data-tab="facts">Quick Facts</button>
      <button type="button" class="potw-tab" data-tab="sources">Primary Sources</button>
      <button type="button" class="potw-tab" data-tab="quiz">House Bounty Quiz</button>
      ${linksTab}
    </div>
    <div class="potw-panel active" data-panel="facts">${facts}</div>
    <div class="potw-panel" data-panel="sources">${sources}</div>
    <div class="potw-panel" data-panel="quiz">${quiz}</div>
    ${linksPanel}`;
}

// ---- Resources: URL links + stored assets (potw:<key>:asset:<n>) -------------
function linkCardHTML(l) {
  const safe = safeLinkUrl(l.url);   // same rule as the header quick links
  return `<a class="potw-link"${safe ? ` href="${esc(safe)}" target="_blank" rel="noopener noreferrer"` : ''}>
    <span class="potw-link-ico" aria-hidden="true">🔗</span><span>${esc(l.title || l.url)}</span>
  </a>`;
}
function assetIcon(type) {
  const t = String(type || '');
  if (t.startsWith('image/')) return '🖼️';
  if (t === 'application/pdf' || t.endsWith('/pdf')) return '📄';
  if (t.startsWith('video/')) return '🎬';
  if (t.startsWith('audio/')) return '🎵';
  return '📎';
}
function assetCardHTML(a) {
  const isImage = String(a.type || '').startsWith('image/');
  const isPdf = isPdfAsset(a);
  return `<button type="button" class="potw-asset" data-key="${esc(a.key)}" data-image="${isImage ? '1' : '0'}" data-pdf="${isPdf ? '1' : '0'}" data-name="${esc(a.name || '')}">
    <span class="potw-asset-ico" aria-hidden="true">${assetIcon(a.type)}</span>
    <span class="potw-asset-body">
      <span class="potw-asset-name">${esc(a.name || a.key)}</span>
      <span class="potw-asset-type">${isPdf ? 'Presentation • opens in app' : esc(a.type || 'file')}</span>
    </span>
  </button>`;
}

async function loadResources() {
  if (!overlayEl) return;
  const tab = overlayEl.querySelector('.potw-tab-res');
  const panel = overlayEl.querySelector('.potw-panel[data-panel="links"]');
  if (!tab || !panel) return;
  const links = Array.isArray(profile.links) ? profile.links.filter((l) => l && l.url) : [];

  let assets = [];
  try { assets = await media.list(`potw:${activeKey}:asset:`); } catch (e) { assets = []; }
  if (!overlayEl) return; // torn down while awaiting IndexedDB
  assets = (assets || []).filter(Boolean).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const box = panel.querySelector('.potw-res-assets');
  if (!assets.length) {
    if (box) box.remove();                       // no files — drop the loading spinner
    if (!links.length) { tab.remove(); panel.remove(); return; } // nothing at all
    return;                                      // links-only: tab already shown
  }
  if (box) {
    box.innerHTML = `<div class="potw-res-group">Files</div>${assets.map(assetCardHTML).join('')}`;
    wireAssetCards(box);
  }
  tab.style.display = ''; // ensure the tab is visible (assets exist even if no links)
}

function wireAssetCards(scope) {
  scope.querySelectorAll('.potw-asset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      // A PDF is ALWAYS a presentation — open the in-app viewer, never a new tab.
      if (btn.dataset.pdf === '1') {
        openPresentation({ type: 'pdf', pdfKey: btn.dataset.key, url: '', count: 0 });
        return;
      }
      const url = await media.url(btn.dataset.key);
      if (!url) { btn.classList.add('potw-asset-missing'); return; }
      if (btn.dataset.image === '1') openLightbox(url, btn.dataset.name);
      else window.open(url, '_blank', 'noopener'); // non-PDF, non-image → new tab
    });
  });
}

// Full-screen letterboxed image lightbox; tap anywhere or ✕ to close.
function openLightbox(url, name) {
  if (!overlayEl) return;
  const lb = document.createElement('div');
  lb.className = 'potw-lightbox';
  lb.innerHTML = `<img class="potw-lightbox-img" alt="${esc(name || '')}">
    <button type="button" class="potw-lightbox-close" aria-label="Close">✕</button>`;
  lb.querySelector('img').src = url;
  lb.addEventListener('click', () => { try { lb.remove(); } catch (e) {} });
  overlayEl.appendChild(lb);
}

function wireLesson() {
  // Presentation launcher — reveal once a deck is known (configured or a PDF asset)
  const presBtn = overlayEl.querySelector('.potw-pres-launch');
  if (presBtn) {
    presBtn.addEventListener('click', () => openPresentation());
    resolveDeck().then((deck) => {
      if (!overlayEl || !presBtn.isConnected) return;
      presBtn.style.display = deck ? '' : 'none';
    });
  }

  // Resources: async-load stored assets and finalize the tab
  loadResources();

  // Tabs
  overlayEl.querySelectorAll('.potw-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      overlayEl.querySelectorAll('.potw-tab').forEach((t) => t.classList.toggle('active', t === tab));
      overlayEl.querySelectorAll('.potw-panel').forEach((p) =>
        p.classList.toggle('active', p.dataset.panel === name));
    });
  });

  // Primary-source cards: tap to enlarge/highlight (single active at a time)
  overlayEl.querySelectorAll('.potw-source').forEach((card) => {
    card.addEventListener('click', () => {
      const on = card.classList.contains('active');
      overlayEl.querySelectorAll('.potw-source').forEach((c) => c.classList.remove('active'));
      if (!on) card.classList.add('active');
    });
  });

  // Quiz: tap-to-reveal answers
  overlayEl.querySelectorAll('.potw-reveal-ans').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ans = overlayEl.querySelector(`.potw-ans[data-q="${btn.dataset.q}"]`);
      if (ans) ans.classList.add('show');
      btn.textContent = 'Answer revealed';
      btn.disabled = true;
    });
  });

  // Quiz: award bounties — ONE payout per question per profile+week, enforced by
  // the store ledger (not just the DOM), so relaunching cannot pay twice.
  overlayEl.querySelectorAll('.potw-award').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const qi = Number(btn.dataset.q);
      const houseId = Number(btn.dataset.house);
      // Defensive on both hops: these buttons only render when quiz entries
      // exist, but a malformed entry (no question text) must degrade to a
      // short ledger label, not a throw that eats the payout tap.
      const q = (Array.isArray(profile.quiz) && profile.quiz[qi]) || {};
      const points = bountyPoints();

      // Paying a bounty is real points, so it asks for the teacher PIN if one is
      // set. The presentation stays up behind the pad; a refusal pays nothing.
      const liveOverlay = overlayEl;
      if (!(await lock.requireUnlock('award this bounty'))) return;
      if (overlayEl !== liveOverlay || btn.disabled) return;   // lesson closed while the pad was open

      // payBountyChecked awards the points AND records the payment — and says
      // which of two very different "no"s it is. Already claimed → the ledger
      // knows the winner, lock the buttons to match. Refused (a frozen house
      // cannot earn) → nothing was recorded and the question is still open, so
      // say why and leave all four buttons live for another winner. The old
      // path greyed out every button on any falsy result, which turned one
      // frozen house into a permanently dead question.
      const res = ctxRef.store.payBountyChecked(activeKey, qi, houseId, points, String(q.q || '').slice(0, 40));
      if (!res.ok) {
        if (res.reason === 'already-paid') { lockBounty(qi, null); return; }
        bountyNotice(qi, res.message);
        return;
      }
      lockBounty(qi, btn);

      ctxRef.audio.sfx('coin');
      const f = document.createElement('span');
      f.className = 'potw-float';
      f.textContent = `+${points}`;
      btn.appendChild(f);
      later(() => f.remove(), 1000);
    });
  });
}

// Points per bounty — teacher-configurable per destination later.
function bountyPoints() {
  const n = Number(profile && profile.bountyPoints);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

// A refusal speaks where the paid note would appear, then withdraws — unlike
// the paid note, the question is still open and the buttons stay live.
function bountyNotice(qi, message) {
  if (!overlayEl) return;
  const note = overlayEl.querySelector(`.potw-bounty-paid[data-paid="${qi}"]`);
  if (!note) return;
  if (!note.hidden && !note.classList.contains('refused')) return;   // a real paid note is never clobbered
  note.textContent = message;
  note.classList.add('refused');
  note.hidden = false;
  later(() => {
    if (!note.isConnected || !note.classList.contains('refused')) return;
    note.classList.remove('refused');
    note.textContent = '';
    note.hidden = true;
  }, 4500);
}

// Lock a question's four buttons and show who won, from the ledger.
function lockBounty(qi, winnerBtn) {
  if (!overlayEl) return;
  const rec = ctxRef.store.getPaidBounty(activeKey, qi);
  const winnerId = rec ? Number(rec.houseId) : (winnerBtn ? Number(winnerBtn.dataset.house) : null);
  overlayEl.querySelectorAll(`.potw-award[data-q="${qi}"]`).forEach((b) => {
    b.disabled = true;
    b.classList.add(Number(b.dataset.house) === winnerId ? 'won' : 'awarded');
  });
  const note = overlayEl.querySelector(`.potw-bounty-paid[data-paid="${qi}"]`);
  const house = winnerId ? ctxRef.store.HOUSES[winnerId] : null;
  if (note && house) { note.textContent = `✓ ${house.name} won this bounty`; note.hidden = false; }
}

// =============================================================================
// STAGE 5 — full-screen presentation viewer (over the orbiting map)
// Contract: profile.presentation = { type:'pdf'|'images'|'gslides', url?, count? }
//   images: media key  potw:<key>:slide:NNN  (3-digit, 1-based, up to count)
//   pdf:    media key  potw:<key>:slides.pdf
//   gslides: presentation.url is a docs.google.com /embed URL
// =============================================================================
// Vendored locally so the viewer works on school networks that block CDNs.
// NOTE: a dynamic import() resolves against THIS MODULE's url (js/modules/),
// not the page, so './vendor/…' would look in js/modules/vendor/. Resolving
// against import.meta.url yields absolute URLs that are correct for both the
// import and the worker, on localhost and on the Pages subpath (/mr-d-site/).
const PDFJS_URL = new URL('../../vendor/pdf.min.mjs', import.meta.url).href;
const PDFJS_WORKER = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
const pad3 = (n) => String(n).padStart(3, '0');
const presErrorHTML = (msg) =>
  `<div class="potw-pres-error"><div class="big" aria-hidden="true">⚠️</div><div>${esc(msg)}</div></div>`;

function isPdfAsset(a) {
  const t = String((a && a.type) || ''), n = String((a && a.name) || '');
  return t === 'application/pdf' || t.endsWith('/pdf') || /\.pdf$/i.test(n);
}

// Resolve a presentable deck for this destination (memoized per voyage):
//   (a) profile.presentation exactly as configured by the teacher, else
//   (b) FALLBACK: any stored asset that is a PDF becomes the deck automatically.
// Returns { type, url, count, pdfKey } or null when there is nothing to present.
function resolveDeck() {
  if (deckPromise) return deckPromise;
  deckPromise = (async () => {
    const pres = profile && profile.presentation;
    if (pres && pres.type) {
      deckInfo = {
        type: pres.type,
        url: pres.url || '',
        count: Number(pres.count) || 0,
        pdfKey: pres.type === 'pdf' ? `potw:${activeKey}:slides.pdf` : '',
      };
      return deckInfo;
    }
    let assets = [];
    try { assets = await media.list(`potw:${activeKey}:asset:`); } catch (e) { assets = []; }
    const pdf = (assets || []).filter(Boolean).sort((a, b) => (a.key < b.key ? -1 : 1)).find(isPdfAsset);
    deckInfo = pdf ? { type: 'pdf', url: '', count: 0, pdfKey: pdf.key } : null;
    return deckInfo;
  })();
  return deckPromise;
}

// Open the in-app viewer. `deck` defaults to the resolved deck for this voyage;
// callers may pass an explicit deck (e.g. tapping a PDF in the Resources tab).
async function openPresentation(deck) {
  if (!overlayEl || presLayerEl) return;
  const d = deck || deckInfo || (await resolveDeck());
  if (!overlayEl || presLayerEl || !d || !d.type) return;
  // The deck owns the room from here: fade the app's music out quickly rather
  // than trailing under the teacher's opening line. Anything the class hears
  // after this point should be coming from the presentation itself.
  fadeOutFlyoverMusic(900);
  try { stopAmbientIfAny(); } catch (e) { /* ambience isn't assigned to POTW anyway */ }
  // (No sound here. 'coin' is the REWARD chime — nothing was earned by opening
  // a deck, and a stray chime over the teacher's first sentence just reads as
  // a glitch. The visual transition is the cue.)

  // Hide the lesson card while presenting (ambient orbit keeps running).
  const lesson = overlayEl.querySelector('.potw-lesson');
  if (lesson) lesson.classList.remove('show');

  presState = {
    type: d.type, count: Number(d.count) || 0, idx: 1, url: d.url || '',
    pdfKey: d.pdfKey || `potw:${activeKey}:slides.pdf`,
    imgCache: {}, pdfjs: null, pdfDoc: null, pageCache: new Map(), token: 0, gsIframe: null,
  };

  // One slim control bar along the bottom: prev/next at the ends, the counter
  // centred, grid + close alongside. Google Slides is a different animal — the
  // deck keeps its transitions/animations/embedded video and Google's own
  // player drives it, so our slide controls step aside there (see below).
  const isGslides = d.type === 'gslides';
  const hint = isGslides
    ? `<div class="potw-pres-hint">Google runs this deck — use your remote, the arrow keys, or the controls at the bottom of the slides.
         <span class="potw-pres-tip">Sound tip: audio dropped into Slides may stay silent in a published deck — an embedded YouTube video plays fine.</span></div>`
    : (remoteHintDismissed() ? '' : `<div class="potw-pres-hint">Your presenter remote works — or use the arrow keys.
         <button type="button" class="potw-hint-x" aria-label="Got it">✕</button></div>`);
  const gsLeft = isGslides
    ? `<button type="button" class="potw-pres-focus">🎯 Give remote control to slides</button>` : '';
  const gsRight = isGslides
    ? `<a class="potw-pres-open" href="${esc(gslidesOpenUrl(d))}" target="_blank" rel="noopener noreferrer">⧉ Open full screen in Google Slides</a>` : '';

  presLayerEl = document.createElement('div');
  presLayerEl.className = 'potw-pres' + (isGslides ? ' gslides' : '');
  presLayerEl.innerHTML = `
    <div class="potw-pres-stage"></div>
    <div class="potw-pres-overview"><div class="potw-pres-thumbs"></div></div>
    <footer class="potw-pres-bar potw-chrome">
      <div class="potw-pres-progress"><div class="potw-pres-fill"></div></div>
      <div class="potw-pres-side">
        <button type="button" class="potw-pres-arrow potw-pres-prev" aria-label="Previous slide">&#8249;</button>
        <button type="button" class="potw-pres-grid" aria-label="Slide overview (G)">▦</button>
        ${gsLeft}
      </div>
      <div class="potw-pres-mid">
        <div class="potw-pres-counter">&mdash;</div>
        ${hint}
      </div>
      <div class="potw-pres-side end">
        ${gsRight}
        <button type="button" class="potw-pres-close">✕ Back to ${esc(profile.title)}</button>
        <button type="button" class="potw-pres-arrow potw-pres-next" aria-label="Next slide">&#8250;</button>
      </div>
    </footer>`;
  overlayEl.appendChild(presLayerEl);

  presLayerEl.querySelector('.potw-pres-close').addEventListener('click', closePresentation);
  const hintX = presLayerEl.querySelector('.potw-hint-x');
  if (hintX) hintX.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissRemoteHint();
    const h = presLayerEl && presLayerEl.querySelector('.potw-pres-hint');
    if (h) h.remove();
  });
  pokeChrome();
  if (isGslides) {
    const focusBtn = presLayerEl.querySelector('.potw-pres-focus');
    if (focusBtn) focusBtn.addEventListener('click', (e) => { e.stopPropagation(); focusDeck(); });
    // Any tap on our own chrome (or on the deck) steals focus from Google's
    // player, which would silently kill the presenter remote — so hand focus
    // straight back after every click anywhere in the voyage overlay.
    gsClickHandler = () => { later(focusDeck, 60); };
    overlayEl.addEventListener('click', gsClickHandler);
  } else {
    presLayerEl.querySelector('.potw-pres-prev').addEventListener('click', (e) => { e.stopPropagation(); presGo(-1); });
    presLayerEl.querySelector('.potw-pres-next').addEventListener('click', (e) => { e.stopPropagation(); presGo(1); });
    presLayerEl.querySelector('.potw-pres-grid').addEventListener('click', (e) => { e.stopPropagation(); toggleOverview(); });
    const stage = presLayerEl.querySelector('.potw-pres-stage');
    stage.addEventListener('click', (e) => { // tap right-half = next, left-half = back
      if (isOverviewOpen()) return;
      const r = stage.getBoundingClientRect();
      presGo(e.clientX - r.left < r.width / 2 ? -1 : 1);
    });

    // Re-render at the new viewport size (debounced) so slides stay crisp.
    let rzTimer = 0;
    presResizeHandler = () => {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => {
        if (!presState || !presLayerEl) return;
        if (presState.type === 'pdf') { presState.pageCache.clear(); presShowPdfPage(); }
      }, 200);
    };
    window.addEventListener('resize', presResizeHandler);
  }

  presKeyHandler = (e) => {
    if (!presLayerEl) return;
    pokeChrome();
    if (e.key === 'Escape') {
      if (isOverviewOpen()) { toggleOverview(false); return; }
      closePresentation(); return;
    }
    if (!presState || presState.type === 'gslides') return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Spacebar') { e.preventDefault(); presGo(1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); presGo(-1); }
    else if (k === 'Home') { e.preventDefault(); presGoTo(1); }
    else if (k === 'End') { e.preventDefault(); presGoTo(presState.count); }
    else if (k === 'g' || k === 'G') { e.preventDefault(); toggleOverview(); }
  };
  window.addEventListener('keydown', presKeyHandler);

  if (d.type === 'images') { presUpdateCounter(); await presShowImage(); }
  else if (d.type === 'pdf') { await presInitPdf(); }
  else { presRenderGslides(); }
}

// ---- chrome idle fade (header + presentation bar together) ----
function pokeChrome() {
  if (!overlayEl) return;
  overlayEl.classList.remove('idle');
  clearTimeout(presIdleTimer);
  presIdleTimer = setTimeout(() => {
    if (overlayEl && !isOverviewOpen()) overlayEl.classList.add('idle');
  }, PRES_IDLE_MS);
}

// "Your presenter remote works" hint — shown until the teacher dismisses it once.
const REMOTE_HINT_KEY = 'mrd:potw:remote-hint';
function remoteHintDismissed() {
  try { return localStorage.getItem(REMOTE_HINT_KEY) === '1'; } catch (e) { return false; }
}
function dismissRemoteHint() {
  try { localStorage.setItem(REMOTE_HINT_KEY, '1'); } catch (e) {}
}

function presUpdateCounter() {
  if (!presLayerEl || !presState) return;
  const c = presLayerEl.querySelector('.potw-pres-counter');
  if (c) c.textContent = `${presState.idx} / ${presState.count}`;
  const fill = presLayerEl.querySelector('.potw-pres-fill');
  if (fill) fill.style.width = presState.count > 0 ? `${(presState.idx / presState.count) * 100}%` : '0%';
  presLayerEl.querySelectorAll('.potw-thumb').forEach((t) =>
    t.classList.toggle('active', Number(t.dataset.i) === presState.idx));
}

function presGoTo(n) {
  if (!presState || presState.count <= 0) return;
  const next = Math.min(presState.count, Math.max(1, n));
  if (next === presState.idx) return;
  presState.idx = next;
  presUpdateCounter();
  pokeChrome();
  if (presState.type === 'images') presShowImage();
  else if (presState.type === 'pdf') presShowPdfPage();
}

function presGo(delta) {
  if (!presState) return;
  presGoTo(presState.idx + delta);
}

// ---- slide overview (thumbnail grid) ----
function isOverviewOpen() {
  const ov = presLayerEl && presLayerEl.querySelector('.potw-pres-overview');
  return !!(ov && ov.classList.contains('show'));
}

function toggleOverview(force) {
  const ov = presLayerEl && presLayerEl.querySelector('.potw-pres-overview');
  if (!ov || !presState) return;
  const open = force === undefined ? !ov.classList.contains('show') : !!force;
  ov.classList.toggle('show', open);
  if (open) { if (overlayEl) overlayEl.classList.remove('idle'); buildThumbs(); }
  else pokeChrome();
}

function buildThumbs() {
  const wrap = presLayerEl && presLayerEl.querySelector('.potw-pres-thumbs');
  const st = presState;
  if (!wrap || !st || wrap.childElementCount) return; // build once
  for (let i = 1; i <= st.count; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'potw-thumb' + (i === st.idx ? ' active' : '');
    b.dataset.i = String(i);
    b.innerHTML = `<span class="potw-thumb-box"></span><span class="potw-thumb-n">${i}</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); presGoTo(i); toggleOverview(false); });
    wrap.appendChild(b);
    renderThumb(b, i);
  }
}

async function renderThumb(btn, i) {
  const st = presState;
  const box = btn.querySelector('.potw-thumb-box');
  if (!box || !st) return;
  try {
    if (st.type === 'images') {
      const u = await presResolveImg(i);
      if (presState !== st || !u) return;
      const im = new Image(); im.src = u; im.alt = '';
      box.appendChild(im);
    } else if (st.type === 'pdf' && st.pdfDoc) {
      const page = await st.pdfDoc.getPage(i);
      if (presState !== st) return;
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 200 / base.width });
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.floor(vp.width)); cv.height = Math.max(1, Math.floor(vp.height));
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      if (presState !== st) return;
      box.appendChild(cv);
    }
  } catch (e) { /* thumbnail is decorative — ignore failures */ }
}

// ---- images ----
async function presResolveImg(i) {
  if (!presState || i < 1 || i > presState.count) return null;
  if (presState.imgCache[i] !== undefined) return presState.imgCache[i];
  const u = await media.url(`potw:${activeKey}:slide:${pad3(i)}`);
  if (presState) presState.imgCache[i] = u || null; // cache misses too
  return u;
}
async function presShowImage() {
  const st = presState;
  const stage = presLayerEl && presLayerEl.querySelector('.potw-pres-stage');
  if (!stage || !st) return;
  const idx = st.idx;
  const u = await presResolveImg(idx);
  if (presState !== st || !presLayerEl) return; // switched/closed while awaiting
  if (!u) { stage.innerHTML = presErrorHTML(`Slide ${idx} image not found`); return; }
  let img = stage.querySelector('img');
  if (!img) { stage.innerHTML = ''; img = document.createElement('img'); stage.appendChild(img); }
  img.alt = `Slide ${idx}`;
  img.src = u;
  // preload neighbours
  [idx - 1, idx + 1].forEach((j) => { presResolveImg(j).then((uu) => { if (uu) { const im = new Image(); im.src = uu; } }); });
}

// ---- pdf (PDF.js loaded on demand) ----
async function presInitPdf() {
  const st = presState;
  const stage = presLayerEl && presLayerEl.querySelector('.potw-pres-stage');
  if (!stage || !st) return;
  stage.innerHTML = `<div class="potw-pres-shimmer"></div>`;
  try {
    const pdfjs = await import(/* @vite-ignore */ PDFJS_URL);
    if (presState !== st || !presLayerEl) return;
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    st.pdfjs = pdfjs;
    const url = await media.url(st.pdfKey);
    if (presState !== st || !presLayerEl) return;
    if (!url) { stage.innerHTML = presErrorHTML('No PDF found for this destination'); return; }
    const buf = await (await fetch(url)).arrayBuffer();
    if (presState !== st || !presLayerEl) return;
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    if (presState !== st || !presLayerEl) { try { doc.destroy(); } catch (e) {} return; }
    st.pdfDoc = doc;
    st.count = doc.numPages;
    st.idx = 1;
    presUpdateCounter();
    await presShowPdfPage();
  } catch (e) {
    console.warn('potw: PDF load failed', e);
    if (presState === st && presLayerEl) stage.innerHTML = presErrorHTML('Could not open the PDF');
  }
}
// Render one page to a canvas sized to the current stage (letterboxed, never
// scrolling), at capped devicePixelRatio so it stays crisp on the smartboard.
async function renderPdfCanvas(st, idx, stage) {
  const page = await st.pdfDoc.getPage(idx);
  if (presState !== st || !presLayerEl) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, PRES_DPR_CAP);
  const base = page.getViewport({ scale: 1 });
  const rect = stage.getBoundingClientRect();
  const fit = Math.min(rect.width / base.width, rect.height / base.height) || 1;
  const vp = page.getViewport({ scale: fit * dpr });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  canvas.style.width = Math.floor(vp.width / dpr) + 'px';
  canvas.style.height = Math.floor(vp.height / dpr) + 'px';
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  if (presState !== st || !presLayerEl) return null;
  return canvas;
}

// Keep memory bounded: drop the oldest cached pages that aren't nearby.
function trimPageCache(st) {
  if (!st || !st.pageCache) return;
  for (const k of [...st.pageCache.keys()]) {
    if (st.pageCache.size <= PRES_CACHE_MAX) break;
    if (Math.abs(k - st.idx) <= 1) continue;
    st.pageCache.delete(k);
  }
}

async function presShowPdfPage() {
  const st = presState;
  const stage = presLayerEl && presLayerEl.querySelector('.potw-pres-stage');
  if (!stage || !st || !st.pdfDoc) return;
  const idx = st.idx;
  const cached = st.pageCache.get(idx);
  if (cached) { stage.innerHTML = ''; stage.appendChild(cached); presPreloadPdf(st, idx, stage); return; }
  const token = ++st.token;
  try {
    const canvas = await renderPdfCanvas(st, idx, stage);
    if (!canvas || presState !== st || token !== st.token || !presLayerEl) return;
    st.pageCache.set(idx, canvas);
    trimPageCache(st);
    stage.innerHTML = ''; stage.appendChild(canvas);
    presPreloadPdf(st, idx, stage);
  } catch (e) {
    console.warn('potw: PDF render failed', e);
    if (presState === st && token === st.token && presLayerEl) stage.innerHTML = presErrorHTML(`Could not render page ${idx}`);
  }
}

// Pre-render the next and previous pages so advancing is instant.
function presPreloadPdf(st, idx, stage) {
  [idx + 1, idx - 1].forEach(async (j) => {
    if (j < 1 || j > st.count || st.pageCache.has(j)) return;
    try {
      const cv = await renderPdfCanvas(st, j, stage);
      if (cv && presState === st && !st.pageCache.has(j)) { st.pageCache.set(j, cv); trimPageCache(st); }
    } catch (e) { /* preload is best-effort */ }
  });
}

// ---- google slides ----
// Google Slides is the RICH path: a published embed keeps slide transitions,
// object animations and embedded YouTube video, which a PDF export throws away.
// Google publishes no postMessage API, so this page genuinely cannot drive the
// deck — but a presenter remote sends plain PageUp/PageDown keystrokes, and
// Google's own player handles those whenever the iframe holds focus. So instead
// of faking prev/next we manage focus, and keep Google's control bar visible
// for direct taps on the smartboard.

// Keep the teacher's embed URL, but make sure it does not auto-run.
function gslidesEmbedUrl(raw) {
  const u = String(raw || '');
  if (!u) return '';
  try {
    const url = new URL(u, window.location.href);
    // FORCED, not defaulted. Google's "Publish to web" dialog ticks "Start
    // slideshow as soon as the player loads" by default and offers no "never"
    // in its auto-advance list — the shortest option is every 3 seconds. Left
    // alone, a lesson deck flips slides on its own while the teacher is still
    // talking about the first one. Overriding here means the teacher cannot
    // get this wrong in Google's dialog, and decks saved before this are
    // corrected too, since this runs at render time.
    // Wanting Google's own auto-play is what "⧉ Open full screen" is for.
    url.searchParams.set('start', 'false');
    url.searchParams.set('loop', 'false');
    url.searchParams.set('delayms', '86400000');   // a day, in case anything starts it anyway
    return url.href;
  } catch (e) { return u; }
}

// A link the teacher can open in Google's own full-screen player (speaker notes,
// presenter view). Prefers an explicit `presentation.openUrl` if Admin stores
// one; otherwise derived from the embed URL: /d/e/<token>/embed → /pub (a
// published deck), /d/<id>/embed → /present (a shared deck).
function gslidesOpenUrl(d) {
  const explicit = d && (d.openUrl || d.sourceUrl);
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const u = String((d && d.url) || '');
  if (!u) return '';
  try {
    const url = new URL(u, window.location.href);
    if (/\/presentation\/d\/e\//.test(url.pathname)) url.pathname = url.pathname.replace(/\/embed\/?$/, '/pub');
    else url.pathname = url.pathname.replace(/\/embed\/?$/, '/present');
    return url.href;
  } catch (e) { return u; }
}

// Hand keyboard/remote control back to Google's player.
function focusDeck() {
  const ifr = presState && presState.gsIframe;
  if (!ifr || !ifr.isConnected) return;
  try { ifr.contentWindow && ifr.contentWindow.focus(); } catch (e) {}
  try { ifr.focus({ preventScroll: true }); } catch (e) { try { ifr.focus(); } catch (x) {} }
}

function presRenderGslides() {
  const st = presState;
  const stage = presLayerEl && presLayerEl.querySelector('.potw-pres-stage');
  if (!stage || !st) return;
  if (!st.url) { stage.innerHTML = presErrorHTML('No presentation link set'); return; }
  stage.innerHTML = `<div class="potw-pres-shimmer"></div>`;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('allow', 'fullscreen; autoplay');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  let loaded = false;
  iframe.addEventListener('load', () => {
    loaded = true;
    const sh = stage.querySelector('.potw-pres-shimmer'); if (sh) sh.remove();
    focusDeck();                       // hand the keyboard/remote to Google
    later(focusDeck, 400);             // ...again once its player has settled
  });
  // Google's own control bar stays (rm=minimal is deliberately NOT used): it is
  // the only on-screen way to page through this deck by touch.
  iframe.src = gslidesEmbedUrl(st.url);
  st.gsIframe = iframe;
  stage.appendChild(iframe);
  focusDeck();

  // If the embed never loads (offline, blocked, or a share link that isn't an
  // /embed URL), say so plainly instead of leaving a black rectangle.
  later(() => {
    if (loaded || presState !== st || !presLayerEl) return;
    const sh = stage.querySelector('.potw-pres-shimmer'); if (sh) sh.remove();
    const note = document.createElement('div');
    note.className = 'potw-pres-error potw-pres-note';
    note.innerHTML = `<div class="big" aria-hidden="true">⚠️</div>
      <div>This Google Slides deck isn't loading. Check the internet connection, and make sure the link came from
      <b>File → Share → Publish to the web → Embed</b>.<br><br>
      No internet in the room? A PDF uploaded here is offline-safe and fully controlled by this app.</div>`;
    stage.appendChild(note);
  }, 8000);
}

// Tear the presentation layer down (PDF doc/canvases destroyed, listeners dropped).
// Does NOT revoke media object URLs — media.js owns their lifecycle.
function destroyPresentation() {
  if (presKeyHandler) { try { window.removeEventListener('keydown', presKeyHandler); } catch (e) {} presKeyHandler = null; }
  if (presResizeHandler) { try { window.removeEventListener('resize', presResizeHandler); } catch (e) {} presResizeHandler = null; }
  if (gsClickHandler) {
    try { overlayEl && overlayEl.removeEventListener('click', gsClickHandler); } catch (e) {}
    gsClickHandler = null;
  }
  clearTimeout(presIdleTimer); presIdleTimer = null;
  if (presState) {
    if (presState.pdfDoc) { try { presState.pdfDoc.destroy(); } catch (e) {} }
    if (presState.pageCache) presState.pageCache.clear();
  }
  if (presLayerEl) { try { presLayerEl.remove(); } catch (e) {} presLayerEl = null; }
  presState = null;
}

// ✕ Back: destroy the layer and return to the orbiting map. The lesson card is
// NOT forced back into view — a subtle "📋 Lesson" control offers it on demand.
function closePresentation() {
  destroyPresentation();
  stopFlyoverMusic();      // already faded in the normal flow; belt and braces
  if (!overlayEl) return;
  const btn = overlayEl.querySelector('.potw-lesson-btn');
  if (btn) btn.style.display = 'block';
  pokeChrome();            // bring the header back with the deck gone
}

// Toggle the lesson card over the orbiting map (opt-in, never automatic when a
// deck exists). Keeps the card and all its tabs/quiz behaviour intact.
function toggleLessonCard() {
  if (!overlayEl) return;
  const card = overlayEl.querySelector('.potw-lesson');
  const btn = overlayEl.querySelector('.potw-lesson-btn');
  if (!card) return;
  const open = !card.classList.contains('show');
  card.classList.toggle('show', open);
  if (btn) btn.textContent = open ? '📋 Hide Lesson' : '📋 Lesson';
}

// =============================================================================
// Teardown
// =============================================================================
function closeOverlay() {
  clearTimers();
  destroyPresentation();
  stopFlyoverMusic();
  try { ctxRef && ctxRef.audio.stopAll(); } catch (e) {}
  if (videoEl) { try { videoEl.pause(); } catch (e) {} }
  destroyYtIntro();
  if (mapEl) { try { mapEl.remove(); } catch (e) {} mapEl = null; }
  if (overlayEl) { try { overlayEl.remove(); } catch (e) {} overlayEl = null; }
  videoEl = null; songEl = null; mapReadyPromise = null;
  advanced = false; usingFallback = false; cardShown = false;
  deckInfo = null; deckPromise = null;
  // Stage 0 launch screen remains mounted in #module-root underneath.
}

// =============================================================================
// Scoped styles (potw- prefixed) — injected once, removed on unmount
// =============================================================================
function injectStyles() {
  if (document.getElementById('potw-styles')) return;
  const style = document.createElement('style');
  style.id = 'potw-styles';
  style.textContent = `
  /* ---- Stage 0 launch ---- */
  .potw-launch{position:relative;height:100%;display:flex;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;overflow:hidden;
    background:radial-gradient(ellipse at 50% 38%,#111827,#0b0f19 72%);}
  .potw-stars{position:absolute;inset:0;pointer-events:none;opacity:.55;
    background-image:
      radial-gradient(2px 2px at 20px 30px, rgba(255,255,255,.6), transparent),
      radial-gradient(1.5px 1.5px at 130px 90px, rgba(255,255,255,.45), transparent),
      radial-gradient(1px 1px at 210px 160px, rgba(255,255,255,.4), transparent),
      radial-gradient(1.5px 1.5px at 90px 230px, rgba(255,255,255,.35), transparent);
    background-repeat:repeat;background-size:300px 300px;animation:potw-drift 90s linear infinite;}
  .potw-globe{width:168px;height:168px;display:flex;align-items:center;justify-content:center;
    filter:drop-shadow(0 0 26px rgba(59,130,246,.35));}
  .potw-globe-emoji{font-size:6rem;animation:potw-globe-pulse 3.2s ease-in-out infinite;}
  .potw-globe-canvas{width:168px;height:168px;display:block;}
  .potw-launch-title{font-size:clamp(2rem,5vw,3.25rem);color:#f59e0b;letter-spacing:.05em;
    margin:.5rem 0 .25rem;text-shadow:0 0 34px rgba(245,158,11,.45);}
  .potw-teaser{color:#9ca3af;font-size:clamp(1rem,2.2vw,1.35rem);margin-bottom:2rem;
    letter-spacing:.03em;font-style:italic;}
  .potw-launch-btn{background:linear-gradient(135deg,#f59e0b,#b45309);color:#0b0f19;
    font-weight:800;font-size:clamp(1.1rem,2.4vw,1.6rem);padding:20px 42px;border:none;
    border-radius:1rem;min-height:48px;cursor:pointer;box-shadow:0 12px 44px rgba(245,158,11,.42);
    transition:transform .2s ease,box-shadow .2s ease;}
  .potw-launch-btn:hover{transform:scale(1.04);box-shadow:0 16px 54px rgba(245,158,11,.55);}
  .potw-launch-btn:active{transform:scale(.98);}

  /* ---- overlay shell ---- */
  .potw-overlay{position:fixed;inset:0;z-index:60;background:#000;overflow:hidden;
    color:#f9fafb;font-family:Inter,system-ui,sans-serif;}
  .potw-map-layer{position:absolute;inset:0;z-index:1;}
  .potw-map-layer gmp-map-3d{width:100%;height:100%;display:block;}
  .potw-map-fallback{position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;padding:24px;
    background:radial-gradient(ellipse at 50% 32%,#1f2937,#0b0f19 72%);}
  .potw-fb-globe{font-size:5.5rem;animation:potw-spin 16s linear infinite;}
  .potw-fb-title{font-size:clamp(2rem,5vw,3rem);color:#f59e0b;margin-top:.5rem;
    text-shadow:0 0 30px rgba(245,158,11,.5);}
  .potw-fb-sub{color:#9ca3af;font-size:1.15rem;margin-top:.4rem;}
  .potw-fb-note{color:#6b7280;margin-top:1rem;font-size:.95rem;}

  /* ---- Stage 1 intro ---- */
  .potw-intro-layer{position:absolute;inset:0;z-index:30;background:#000;
    transition:opacity .8s ease;}
  /* fit-by-width: full width, correct aspect ratio, clean black letterbox bars */
  .potw-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;}
  /* YouTube-embed intro — 16:9 letterboxed on black */
  .potw-yt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000;}
  /* 16:9 visible letterbox; the player is overscanned taller (var --yt-crop) and
     centered so YouTube's title bar + watermark are cropped outside this box. */
  .potw-yt-box{position:relative;width:min(100%, 177.78vh);aspect-ratio:16 / 9;max-height:100%;
    overflow:hidden;background:#000;}
  .potw-yt-box iframe,.potw-yt-box .potw-yt-player{position:absolute !important;top:50% !important;
    left:50% !important;transform:translate(-50%,-50%) !important;height:calc(100% + var(--yt-crop,120px)) !important;
    width:auto !important;aspect-ratio:16 / 9 !important;border:0 !important;background:#000;pointer-events:none;
    /* Held invisible until the player reports PLAYING (.is-live below). The box
       behind is already black, so the buffering frames — and any paused glyph
       YouTube draws before playback truly starts — happen out of sight. */
    opacity:0;transition:opacity .45s ease;}
  .potw-yt-box.is-live iframe,.potw-yt-box.is-live .potw-yt-player{opacity:1;}
  .potw-song{position:absolute;inset:0;display:none;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;
    background:radial-gradient(ellipse at 50% 40%,#111827,#000 72%);}
  .potw-song-globe{font-size:7rem;animation:potw-spin 9s linear infinite;
    filter:drop-shadow(0 0 40px rgba(245,158,11,.5));}
  .potw-song-title{font-size:clamp(2.2rem,6vw,4rem);color:#f59e0b;letter-spacing:.16em;
    margin:1rem 0 .5rem;text-shadow:0 0 44px rgba(245,158,11,.55);
    animation:potw-pulse 1.8s ease-in-out infinite;}
  .potw-song-sub{color:#9ca3af;letter-spacing:.25em;text-transform:uppercase;font-size:1rem;}
  /* Skip stays reachable for the last seconds of the video, once the reveal
     card (and with it the overlay header) has appeared above it. */
  .potw-overlay.head-on .potw-skip{top:80px;}
  .potw-skip{position:absolute;top:18px;right:18px;z-index:64;min-height:44px;
    padding:10px 18px;border-radius:.6rem;background:rgba(0,0,0,.55);border:1px solid #374151;
    color:#e5e7eb;font-weight:600;cursor:pointer;transition:background .2s ease;}
  .potw-skip:hover{background:rgba(0,0,0,.8);}

  /* ---- Stage 2 reveal ---- */
  .potw-reveal{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
    z-index:40;display:none;flex-direction:column;align-items:center;text-align:center;
    background:rgba(0,0,0,.82);backdrop-filter:blur(12px);border:3px solid #f59e0b;
    border-radius:1.5rem;padding:44px clamp(28px,6vw,64px);
    box-shadow:0 24px 70px rgba(0,0,0,.7),0 0 60px rgba(245,158,11,.25);}
  .potw-reveal.show{display:flex;animation:potw-popin .8s cubic-bezier(.175,.885,.32,1.275) both;}
  .potw-eyebrow{color:#9ca3af;letter-spacing:.3em;text-transform:uppercase;
    font-size:clamp(.85rem,1.6vw,1.1rem);}
  .potw-title{font-size:clamp(2.4rem,7vw,4.5rem);color:#f59e0b;margin:.4rem 0 1.5rem;
    text-shadow:0 0 32px rgba(245,158,11,.6);line-height:1.05;}
  .potw-fly-btn{background:linear-gradient(135deg,#f59e0b,#b45309);color:#0b0f19;
    font-weight:800;font-size:clamp(1.1rem,2.6vw,1.6rem);padding:18px 40px;border:none;
    border-radius:2.5rem;min-height:48px;cursor:pointer;box-shadow:0 12px 34px rgba(245,158,11,.5);
    animation:potw-pulse-scale 1.5s ease-in-out infinite;}
  .potw-fly-btn:active{transform:scale(.97);}

  /* ---- End Voyage ---- */
  /* ---- TEST FLIGHT (admin preview) ---- */
  .potw-preview-label{position:absolute;top:18px;left:18px;z-index:57;display:flex;align-items:center;gap:10px;
    padding:12px 18px;border-radius:.75rem;background:rgba(11,15,25,.82);border:1px solid rgba(245,158,11,.6);
    backdrop-filter:blur(8px);color:#f9fafb;font-weight:800;font-size:clamp(1rem,2vw,1.25rem);
    box-shadow:0 10px 30px rgba(0,0,0,.5);max-width:70vw;}
  .potw-preview-label .tag{background:#f59e0b;color:#0b0f19;border-radius:.4rem;padding:3px 9px;
    font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;}
  .potw-preview-close{position:absolute;top:18px;right:18px;z-index:57;min-height:48px;padding:12px 20px;
    border-radius:.6rem;background:rgba(17,24,39,.9);border:1px solid #374151;color:#e5e7eb;
    font-weight:700;cursor:pointer;transition:background .2s ease,border-color .2s ease;}
  .potw-preview-close:hover{background:rgba(239,68,68,.3);border-color:#ef4444;}
  .potw-preview .potw-map-fallback{z-index:5;}

  /* subtle opt-in access to the lesson card once the deck has been shown */
  .potw-lesson-btn{position:absolute;left:18px;bottom:18px;z-index:56;display:none;min-height:44px;
    padding:10px 16px;border-radius:.6rem;background:rgba(17,24,39,.7);border:1px solid #374151;
    color:#9ca3af;font-weight:600;cursor:pointer;transition:background .2s ease,color .2s ease,border-color .2s ease;}
  .potw-lesson-btn:hover{background:rgba(17,24,39,.95);color:#f9fafb;border-color:#f59e0b;}

  /* ---- overlay header: 🏠 Main Screen + quick launch + End Voyage ---- */
  .potw-head{position:absolute;top:0;left:0;right:0;z-index:63;display:none;align-items:center;gap:12px;
    padding:10px 14px;min-height:64px;
    background:linear-gradient(180deg,rgba(11,15,25,.94),rgba(11,15,25,.55) 78%,rgba(11,15,25,0));
    border-bottom:1px solid rgba(55,65,81,.55);backdrop-filter:blur(8px);}
  .potw-head.show{display:flex;}
  .potw-home{flex-shrink:0;min-height:48px;padding:12px 20px;border-radius:.7rem;
    background:linear-gradient(135deg,#f59e0b,#b45309);border:none;color:#0b0f19;font-weight:800;
    font-size:1rem;cursor:pointer;box-shadow:0 6px 20px rgba(245,158,11,.35);
    transition:transform .15s ease,box-shadow .2s ease;}
  .potw-home:hover{box-shadow:0 10px 26px rgba(245,158,11,.5);}
  .potw-home:active{transform:scale(.97);}
  .potw-quick{flex:1;display:flex;align-items:center;gap:10px;overflow-x:auto;overflow-y:hidden;
    scrollbar-width:thin;padding:2px;}
  .potw-quick-btn{display:inline-flex;align-items:center;gap:8px;flex-shrink:0;max-width:22rem;
    min-height:48px;padding:12px 16px;border-radius:.7rem;background:rgba(31,41,55,.9);
    border:1px solid #374151;border-left:3px solid #3b82f6;color:#f9fafb;font-weight:700;
    font-size:.95rem;text-decoration:none;cursor:pointer;white-space:nowrap;
    transition:background .2s ease,border-color .2s ease;}
  .potw-quick-btn:hover{background:#243044;border-color:#3b82f6;}
  .potw-quick-btn:active{transform:scale(.98);}
  .potw-quick-label{overflow:hidden;text-overflow:ellipsis;}
  .potw-quick-out{color:#9ca3af;font-weight:800;}

  .potw-end{flex-shrink:0;min-height:48px;padding:12px 18px;border-radius:.7rem;
    background:rgba(17,24,39,.85);border:1px solid #374151;
    color:#e5e7eb;font-weight:700;cursor:pointer;transition:background .2s ease,border-color .2s ease;}
  .potw-end:hover{background:rgba(239,68,68,.25);border-color:#ef4444;}

  /* ---- Stage 4 lesson ---- */
  .potw-lesson{position:absolute;left:50%;bottom:-130%;transform:translateX(-50%);z-index:35;
    width:90%;max-width:48rem;background:rgba(17,24,39,.92);backdrop-filter:blur(14px);
    border:1px solid rgba(245,158,11,.5);border-radius:1.5rem;padding:20px;
    box-shadow:0 22px 64px rgba(0,0,0,.85);display:flex;flex-direction:column;
    max-height:72vh;transition:bottom .8s cubic-bezier(.175,.885,.32,1.275);}
  .potw-lesson.show{bottom:24px;}
  .potw-tabs{display:flex;gap:8px;margin-bottom:16px;}
  .potw-tab{flex:1;min-height:48px;padding:12px 8px;border-radius:.75rem;border:1px solid #374151;
    background:#1f2937;color:#e5e7eb;font-weight:700;font-size:clamp(.85rem,1.6vw,1rem);
    cursor:pointer;transition:background .2s ease,color .2s ease,border-color .2s ease;}
  .potw-tab.active{background:#f59e0b;color:#0b0f19;border-color:#f59e0b;}
  .potw-panel{display:none;overflow-y:auto;padding-right:4px;}
  .potw-panel.active{display:block;}

  .potw-fact{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;background:#1f2937;
    border:1px solid #374151;border-left:3px solid #f59e0b;border-radius:.75rem;margin-bottom:10px;
    color:#e5e7eb;line-height:1.5;}
  .potw-fact .n{color:#f59e0b;font-weight:800;flex-shrink:0;}

  .potw-source{display:flex;gap:16px;align-items:center;width:100%;text-align:left;padding:16px;
    background:#1f2937;border:1px solid #374151;border-radius:1rem;margin-bottom:12px;cursor:pointer;
    color:inherit;transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease;}
  .potw-source .glyph{font-size:3rem;line-height:1;flex-shrink:0;}
  .potw-source h4{color:#f9fafb;font-weight:700;margin-bottom:4px;font-size:1.05rem;}
  .potw-source p{color:#9ca3af;font-size:.95rem;line-height:1.45;}
  .potw-source.active{border-color:#f59e0b;transform:scale(1.02);
    box-shadow:0 0 30px rgba(245,158,11,.35);}
  .potw-source.active .glyph{font-size:3.6rem;}

  .potw-quiz{padding:16px;background:#1f2937;border:1px solid #374151;border-radius:1rem;margin-bottom:14px;}
  .potw-q{color:#f9fafb;font-weight:700;font-size:1.05rem;margin-bottom:10px;line-height:1.4;}
  .potw-reveal-ans{min-height:44px;padding:10px 16px;border-radius:.6rem;border:1px dashed #f59e0b;
    background:transparent;color:#f59e0b;font-weight:600;cursor:pointer;margin-bottom:12px;
    transition:background .2s ease;}
  .potw-reveal-ans:hover{background:rgba(245,158,11,.12);}
  .potw-reveal-ans:disabled{opacity:.5;cursor:default;border-style:solid;}
  .potw-ans{display:none;color:#34d399;font-weight:700;margin-bottom:12px;font-size:1.05rem;}
  .potw-ans.show{display:block;}
  .potw-awards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
  .potw-award{position:relative;overflow:visible;min-height:56px;border-radius:.75rem;
    border:2px solid var(--acc);background:rgba(255,255,255,.05);color:#f9fafb;font-weight:700;
    font-size:clamp(.75rem,1.5vw,.95rem);cursor:pointer;transition:transform .12s ease,background .2s ease;}
  .potw-award small{display:block;color:var(--acc);font-weight:800;margin-top:2px;}
  .potw-award:hover:not(:disabled){background:rgba(255,255,255,.1);}
  .potw-award:active:not(:disabled){transform:scale(.95);}
  .potw-award:disabled{cursor:default;}
  .potw-award.awarded{opacity:.35;}
  .potw-award.won{opacity:1;background:var(--acc);color:#0b0f19;}
  .potw-award.won small{color:#0b0f19;}
  .potw-bounty-paid{margin-top:10px;color:#34d399;font-weight:700;font-size:.95rem;
    display:flex;align-items:center;gap:6px;}
  .potw-bounty-paid[hidden]{display:none;}
  .potw-bounty-paid.refused{color:#fbbf24;}
  .potw-float{position:absolute;top:-6px;left:50%;color:#f59e0b;font-weight:800;font-size:1.35rem;
    pointer-events:none;text-shadow:0 2px 8px rgba(0,0,0,.6);animation:potw-float 1s ease-out forwards;}

  .potw-link{display:flex;align-items:center;gap:12px;min-height:56px;padding:16px 18px;margin-bottom:12px;
    background:#1f2937;border:1px solid #374151;border-left:3px solid #f59e0b;border-radius:.9rem;
    color:#f9fafb;font-weight:700;font-size:1.05rem;text-decoration:none;
    transition:background .2s ease,border-color .2s ease;}
  .potw-link:hover{background:#243044;border-color:#f59e0b;}
  .potw-link:active{transform:scale(.99);}
  .potw-link-ico{flex-shrink:0;}
  .potw-link span:last-child{overflow-wrap:anywhere;}

  .potw-pres-launch{width:100%;margin-bottom:14px;min-height:48px;border:none;border-radius:.9rem;cursor:pointer;
    background:linear-gradient(135deg,#f59e0b,#b45309);color:#0b0f19;font-weight:800;
    font-size:clamp(1rem,2.2vw,1.2rem);letter-spacing:.02em;box-shadow:0 8px 24px rgba(245,158,11,.35);
    transition:transform .15s ease,box-shadow .2s ease;}
  .potw-pres-launch:hover{box-shadow:0 12px 32px rgba(245,158,11,.5);}
  .potw-pres-launch:active{transform:scale(.98);}

  /* ---- Stage 5 presentation viewer ---- */
  .potw-pres{position:absolute;inset:0;z-index:58;background:#000;display:flex;align-items:center;justify-content:center;
    --head-h:64px;--bar-h:78px;}
  /* the stage is inset by the header + control bar so chrome NEVER covers a slide */
  .potw-pres-stage{position:absolute;top:var(--head-h);bottom:var(--bar-h);left:0;right:0;
    display:flex;align-items:center;justify-content:center;
    overflow:hidden;background:#000;cursor:pointer;}
  .potw-pres-stage img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;}
  .potw-pres-stage canvas{max-width:100%;max-height:100%;display:block;box-shadow:0 0 40px rgba(0,0,0,.6);}
  .potw-pres-stage iframe{width:100%;height:100%;border:0;background:#000;}
  /* ---- one slim control bar along the bottom (footer) ---- */
  .potw-pres-bar{position:absolute;left:0;right:0;bottom:0;z-index:63;height:var(--bar-h);
    display:grid;grid-template-columns:minmax(0,1fr) minmax(0,auto) minmax(0,1fr);
    align-items:center;gap:12px;padding:0 14px;
    background:linear-gradient(0deg,rgba(11,15,25,.96),rgba(11,15,25,.7) 70%,rgba(11,15,25,0));
    border-top:1px solid rgba(55,65,81,.55);backdrop-filter:blur(8px);}
  .potw-pres-side{display:flex;align-items:center;gap:12px;min-width:0;}
  .potw-pres-side.end{justify-content:flex-end;}
  .potw-pres-mid{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
    min-width:0;max-width:100%;overflow:hidden;text-align:center;}
  .potw-pres-arrow{width:64px;height:56px;min-width:56px;min-height:56px;border-radius:.75rem;
    border:1px solid #374151;background:rgba(31,41,55,.9);
    color:#f9fafb;font-size:2.2rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
    transition:background .2s ease,transform .12s ease,border-color .2s ease;}
  .potw-pres-arrow:hover{background:rgba(245,158,11,.35);border-color:#f59e0b;}
  .potw-pres-arrow:active{transform:scale(.94);}
  .potw-pres-counter{color:#e5e7eb;font-weight:800;letter-spacing:.06em;font-size:1.1rem;}
  .potw-pres-hint{display:flex;align-items:center;gap:8px;color:#9ca3af;font-size:.8rem;line-height:1.35;
    max-width:100%;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .potw-pres-tip{color:#6b7280;max-width:100%;overflow:hidden;text-overflow:ellipsis;}
  .potw-hint-x{min-width:28px;min-height:28px;border-radius:50%;border:1px solid #374151;
    background:transparent;color:#9ca3af;font-size:.75rem;line-height:1;cursor:pointer;flex-shrink:0;}
  .potw-hint-x:hover{background:rgba(255,255,255,.08);color:#f9fafb;}
  /* idle fade: chrome disappears while presenting, returns on move/tap/key */
  .potw-chrome{transition:opacity .3s ease;}
  .potw-overlay.idle .potw-chrome{opacity:0;pointer-events:none;}
  .potw-pres-grid{min-width:56px;min-height:56px;
    border-radius:.75rem;background:rgba(31,41,55,.9);border:1px solid #374151;color:#e5e7eb;
    font-size:1.4rem;line-height:1;cursor:pointer;transition:background .2s ease,border-color .2s ease;}
  .potw-pres-grid:hover{background:rgba(245,158,11,.3);border-color:#f59e0b;}
  .potw-pres-progress{position:absolute;left:0;right:0;top:0;height:4px;
    background:rgba(255,255,255,.12);}
  .potw-pres-fill{height:100%;width:0;background:linear-gradient(90deg,#f59e0b,#fbbf24);
    transition:width .25s ease;}
  /* Google runs its own deck in a cross-origin iframe — our slide controls
     cannot reach it, so they are hidden rather than left there teasing. */
  .potw-pres.gslides .potw-pres-prev,.potw-pres.gslides .potw-pres-next,
  .potw-pres.gslides .potw-pres-grid,.potw-pres.gslides .potw-pres-counter,
  .potw-pres.gslides .potw-pres-progress{display:none;}
  /* the gslides bar carries more words, so it stacks: hint row, then controls */
  .potw-pres.gslides{--bar-h:124px;}
  .potw-pres.gslides .potw-pres-bar{grid-template-columns:1fr 1fr;grid-template-rows:auto auto;
    grid-template-areas:"hint hint" "left right";align-content:center;gap:8px 12px;padding:10px 14px;}
  .potw-pres.gslides .potw-pres-mid{grid-area:hint;max-width:100%;}
  .potw-pres.gslides .potw-pres-side{grid-area:left;}
  .potw-pres.gslides .potw-pres-side.end{grid-area:right;}
  .potw-pres.gslides .potw-pres-hint{font-size:.88rem;color:#e5e7eb;flex-direction:column;gap:2px;
    align-items:center;}
  .potw-pres.gslides .potw-pres-focus,.potw-pres.gslides .potw-pres-open,
  .potw-pres.gslides .potw-pres-close{max-width:26rem;}
  .potw-pres-focus{min-height:56px;padding:12px 18px;border-radius:.75rem;cursor:pointer;min-width:0;
    max-width:18rem;overflow:hidden;text-overflow:ellipsis;
    background:linear-gradient(135deg,#f59e0b,#b45309);border:none;color:#0b0f19;font-weight:800;
    white-space:nowrap;box-shadow:0 6px 20px rgba(245,158,11,.3);transition:transform .15s ease;}
  .potw-pres-focus:active{transform:scale(.97);}
  .potw-pres-open{display:inline-flex;align-items:center;min-height:56px;padding:12px 18px;min-width:0;
    max-width:18rem;overflow:hidden;text-overflow:ellipsis;
    border-radius:.75rem;background:rgba(31,41,55,.9);border:1px solid #374151;color:#e5e7eb;
    font-weight:700;text-decoration:none;white-space:nowrap;transition:background .2s ease,border-color .2s ease;}
  .potw-pres-open:hover{background:#243044;border-color:#3b82f6;}
  .potw-pres-overview{position:absolute;inset:0;z-index:62;display:none;overflow-y:auto;
    background:rgba(11,15,25,.96);padding:calc(var(--head-h) + 24px) 24px calc(var(--bar-h) + 24px);}
  .potw-pres-overview.show{display:block;}
  .potw-pres-thumbs{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));}
  .potw-thumb{position:relative;padding:0;border:2px solid #374151;border-radius:.6rem;overflow:hidden;
    background:#111827;cursor:pointer;aspect-ratio:4 / 3;display:flex;align-items:center;justify-content:center;
    transition:border-color .2s ease,transform .15s ease;}
  .potw-thumb:hover{border-color:#9ca3af;transform:scale(1.03);}
  .potw-thumb.active{border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.35);}
  .potw-thumb-box{width:100%;height:100%;display:flex;align-items:center;justify-content:center;}
  .potw-thumb-box img,.potw-thumb-box canvas{max-width:100%;max-height:100%;object-fit:contain;display:block;}
  .potw-thumb-n{position:absolute;bottom:4px;right:6px;background:rgba(0,0,0,.7);color:#e5e7eb;
    font-size:.8rem;font-weight:700;border-radius:.3rem;padding:1px 6px;}
  .potw-pres-close{min-height:56px;padding:12px 18px;max-width:18rem;min-width:0;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap;
    border-radius:.75rem;background:rgba(31,41,55,.9);border:1px solid #374151;color:#e5e7eb;font-weight:700;cursor:pointer;
    transition:background .2s ease,border-color .2s ease;}
  .potw-pres-close:hover{background:rgba(239,68,68,.25);border-color:#ef4444;}
  .potw-pres-error{color:#f9fafb;text-align:center;padding:24px;max-width:32rem;line-height:1.5;}
  .potw-pres-note{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:34rem;
    background:rgba(11,15,25,.95);border:1px solid #374151;border-radius:1rem;
    box-shadow:0 20px 60px rgba(0,0,0,.7);}
  .potw-pres-error .big{font-size:3rem;margin-bottom:.5rem;}
  .potw-pres-shimmer{position:absolute;inset:0;background:linear-gradient(100deg,#0b0f19 30%,#1f2937 50%,#0b0f19 70%);
    background-size:200% 100%;animation:potw-shimmer 1.4s linear infinite;}

  /* ---- Resources: stored assets + spinner + image lightbox ---- */
  .potw-res-group{color:#9ca3af;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
    font-size:.8rem;margin:4px 2px 10px;}
  .potw-res-loading{display:flex;align-items:center;gap:10px;color:#9ca3af;padding:14px 4px;}
  .potw-spin{width:18px;height:18px;border-radius:50%;border:2px solid #374151;border-top-color:#f59e0b;
    display:inline-block;animation:potw-spin .8s linear infinite;}
  .potw-asset{display:flex;align-items:center;gap:14px;width:100%;text-align:left;min-height:56px;
    padding:14px 16px;margin-bottom:12px;background:#1f2937;border:1px solid #374151;border-left:3px solid #3b82f6;
    border-radius:.9rem;color:#f9fafb;cursor:pointer;transition:background .2s ease,border-color .2s ease;}
  .potw-asset:hover{background:#243044;border-color:#3b82f6;}
  .potw-asset:active{transform:scale(.99);}
  .potw-asset.potw-asset-missing{opacity:.5;border-left-color:#ef4444;}
  .potw-asset-ico{font-size:1.8rem;flex-shrink:0;line-height:1;}
  .potw-asset-body{display:flex;flex-direction:column;min-width:0;}
  .potw-asset-name{font-weight:700;overflow-wrap:anywhere;}
  .potw-asset-type{color:#9ca3af;font-size:.85rem;overflow-wrap:anywhere;}
  .potw-lightbox{position:absolute;inset:0;z-index:65;background:rgba(0,0,0,.92);
    display:flex;align-items:center;justify-content:center;cursor:zoom-out;animation:potw-fade .2s ease both;}
  .potw-lightbox-img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;}
  .potw-lightbox-close{position:absolute;top:18px;right:18px;min-height:48px;min-width:48px;padding:10px 16px;
    border-radius:.6rem;background:rgba(17,24,39,.85);border:1px solid #374151;color:#e5e7eb;font-weight:700;cursor:pointer;}
  .potw-lightbox-close:hover{background:rgba(239,68,68,.25);border-color:#ef4444;}

  /* ---- keyframes ---- */
  @keyframes potw-shimmer{to{background-position:-200% 0;}}
  @keyframes potw-spin{to{transform:rotate(360deg);}}
  @keyframes potw-drift{to{background-position:300px 300px;}}
  @keyframes potw-pulse{0%,100%{opacity:1;}50%{opacity:.45;}}
  @keyframes potw-pulse-scale{0%,100%{transform:scale(1);}50%{transform:scale(1.06);}}
  @keyframes potw-fade{from{opacity:0;}to{opacity:1;}}
  @keyframes potw-globe-pulse{0%,100%{opacity:1;}50%{opacity:.6;}}
  @keyframes potw-popin{0%{transform:translate(-50%,-50%) scale(.6);opacity:0;}
    100%{transform:translate(-50%,-50%) scale(1);opacity:1;}}
  @keyframes potw-float{0%{opacity:1;transform:translate(-50%,0);}
    100%{opacity:0;transform:translate(-50%,-42px);}}
  /* narrow screens: keep the touch targets, drop the words */
  @media (max-width:900px){
    .potw-pres-hint{display:none;}
    .potw-pres-close{max-width:9rem;}
    .potw-quick-btn{max-width:11rem;}
  }
  @media (prefers-reduced-motion:reduce){
    .potw-globe-emoji,.potw-song-globe,.potw-fb-globe,.potw-stars,.potw-song-title,.potw-fly-btn{animation:none;}
  }`;
  document.head.appendChild(style);
}

// =============================================================================
// TEST FLIGHT (admin preview) — reuses the same overlay/map/flight machinery in
// a 'preview' mode: no intro video, no reveal card, no presentation, no lesson
// card, and no change to which destination is scheduled/active.
// =============================================================================

// A camera is usable only with real finite coordinates in range. Null island
// (0,0) is treated as "not set" — it is the classic unparsed-link result.
function validCamera(c) {
  const lat = c && c.center && Number(c.center.lat);
  const lng = c && c.center && Number(c.center.lng);
  if (!isFinite(lat) || !isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return false;
  return true;
}

function previewNoCoords(host, name) {
  overlayEl = document.createElement('div');
  overlayEl.className = 'potw-overlay potw-preview';
  overlayEl.innerHTML = `
    <div class="potw-map-layer"></div>
    <div class="potw-preview-label"><span class="tag">Test Flight</span>${esc(name)}</div>
    <div class="potw-map-fallback">
      <div class="potw-fb-globe" aria-hidden="true">🧭</div>
      <div class="font-display potw-fb-title">No location set</div>
      <div class="potw-fb-sub">Paste a Google Maps link with coordinates, then test the flight.</div>
      <div class="potw-fb-note">Nothing was changed — close to go back to editing.</div>
    </div>
    <button type="button" class="potw-preview-close">✕ Close</button>`;
  host.appendChild(overlayEl);
  overlayEl.querySelector('.potw-preview-close').addEventListener('click', closePreview);
}

/**
 * Open an immediate 3D preview flight for a destination.
 * @param {object}   opts
 * @param {object}   opts.profile  destination-like { title, subtitle?, camera }
 *                                 (may be UNSAVED editor values)
 * @param {function} [opts.onClose] called after teardown so the caller can restore itself
 * @param {number}   [opts.flyMs]   fly-to duration (default TEST_FLY_MS ≈ 8s)
 * @returns {boolean} false if a POTW overlay is already open
 */
export function testFlight({ profile: p, onClose, flyMs } = {}) {
  const host = document.getElementById('overlay-root');
  if (!host || overlayEl) return false;   // never stack over a live voyage
  injectStyles();

  previewMode = true;
  previewOnClose = typeof onClose === 'function' ? onClose : null;
  previewFlyMs = Number(flyMs) > 0 ? Number(flyMs) : TEST_FLY_MS;
  const name = (p && p.title) || 'Untitled destination';

  if (!p || !validCamera(p.camera)) { previewNoCoords(host, name); return true; }

  // Preview profile drives destCamera()/showMapFallback(); the store is untouched.
  const c = p.camera;
  profile = {
    title: name,
    subtitle: p.subtitle || `${Number(c.center.lat).toFixed(4)}, ${Number(c.center.lng).toFixed(4)}`,
    camera: {
      center: {
        lat: Number(c.center.lat), lng: Number(c.center.lng),
        altitude: Number(c.center.altitude) || 0,
      },
      tilt: Number(c.tilt) || 45,
      heading: Number(c.heading) || 0,
      range: Number(c.range) || 2000,
    },
  };

  overlayEl = document.createElement('div');
  overlayEl.className = 'potw-overlay potw-preview';
  overlayEl.innerHTML = `
    <div class="potw-map-layer"></div>
    <div class="potw-preview-label"><span class="tag">Test Flight</span>${esc(name)}</div>
    <button type="button" class="potw-preview-close">✕ Close</button>`;
  host.appendChild(overlayEl);
  overlayEl.querySelector('.potw-preview-close').addEventListener('click', closePreview);

  previewKeyHandler = (e) => { if (e.key === 'Escape') closePreview(); };
  window.addEventListener('keydown', previewKeyHandler);

  createMap3d();   // same map setup as the classroom voyage
  gotoFlight();    // same flight code, short duration, preview suppressions
  return true;
}

// Tear the preview down completely and hand control back to the caller.
function closePreview() {
  const cb = previewOnClose;
  previewOnClose = null;
  if (previewKeyHandler) {
    try { window.removeEventListener('keydown', previewKeyHandler); } catch (e) {}
    previewKeyHandler = null;
  }
  closeOverlay();          // timers, map element, overlay, audio
  previewMode = false;
  previewFlyMs = 0;
  profile = null;
  // If the POTW module itself isn't mounted, don't leave its styles behind.
  if (!rootEl) { const st = document.getElementById('potw-styles'); if (st) st.remove(); }
  if (cb) { try { cb(); } catch (e) { console.warn('potw: testFlight onClose failed', e); } }
}

// =============================================================================
// Module contract
// =============================================================================
export default {
  id: 'potw',
  title: 'Place of the Week',
  icon: '🌍',
  order: 20,
  showTile: true,
  tileClass: '',

  mount(el, ctx) {
    ctxRef = ctx;
    rootEl = el;
    injectStyles();
    renderLaunch();
    // Warm the YouTube IFrame API now, while the teacher is still looking at
    // the launch button. Fetching it on the launch CLICK meant the player was
    // built in a promise callback a second or more later — by then the click's
    // transient activation can be gone, unmuted autoplay is refused, and the
    // player renders its paused state until our playVideo() kicks it. That is
    // the pause glyph. Pre-warming makes the promise resolve instantly, so the
    // player is created while the gesture still counts. Failure is harmless:
    // startYouTubeIntro re-requests it and falls back to a plain iframe.
    try { loadYouTubeApi().catch(() => {}); } catch (e) { /* never block mount */ }
  },

  unmount() {
    clearTimers();
    disposeGlobe();
    destroyPresentation();
    stopFlyoverMusic();
    if (previewKeyHandler) {
      try { window.removeEventListener('keydown', previewKeyHandler); } catch (e) {}
      previewKeyHandler = null;
    }
    previewMode = false; previewOnClose = null; previewFlyMs = 0;
    try { ctxRef && ctxRef.audio.stopAll(); } catch (e) {}
    if (videoEl) { try { videoEl.pause(); } catch (e) {} }
    destroyYtIntro();
    if (mapEl) { try { mapEl.remove(); } catch (e) {} mapEl = null; }
    if (overlayEl) { try { overlayEl.remove(); } catch (e) {} overlayEl = null; }
    const st = document.getElementById('potw-styles');
    if (st) st.remove();
    rootEl = null; profile = null;
    videoEl = null; songEl = null; mapReadyPromise = null;
    advanced = false; usingFallback = false; cardShown = false;
  deckInfo = null; deckPromise = null;
  },
};
