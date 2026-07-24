// potw.js — "Place of the Week": a cinematic, touch-first geography voyage.
// Stage 0 launch screen → Stage 1 video/song intro → Stage 2 reveal modal →
// Stage 3 Google Maps 3D flight → Stage 4 tabbed lesson overlay (facts / sources / quiz).
// Owns ONLY this file. Renders its launch screen into #module-root and a full-screen
// cinematic overlay into #overlay-root, tearing everything down cleanly on unmount.
import { CONFIG } from '../config.js';
import { media } from '../core/media.js';

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
let presState = null;         // { type, count, idx, url, imgCache, pdfjs, pdfDoc, pageCache, token }
let presKeyHandler = null;    // keydown handler while presenting
const timers = new Set();     // all pending setTimeout ids, cleared on teardown

// ---- tunable timing (one-line tweaks for the teacher) ------------------------
const FLY_TO_MS = 27000;      // camera fly-to duration (~27s — gentle on a big smartboard)
const ORBIT_MS = 240000;      // ms per slow-orbit revolution once landed
const LAND_SETTLE_MS = 300;   // pause after landing before lesson card + orbit start
const INTRO_FADE_MS = 1000;   // video/intro crossfade out to reveal the 3D map
const CARD_EARLY_S = 4;       // reveal card pops this many seconds before the video ends
const YT_CROP_PX = 120;       // overscan: player is this much taller than the 16:9 box,
                              // centered, so YouTube's title bar + watermark sit outside the crop
const YT_API_TIMEOUT_MS = 5000;   // if the IFrame API doesn't load in time, use a plain iframe
const YT_PLAIN_FALLBACK_S = 600;  // generous auto-advance for the plain-iframe fallback (Skip is primary)

// ---- tiny helpers ------------------------------------------------------------
function later(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { console.warn('potw:', e); } }, ms);
  timers.add(id);
  return id;
}
function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
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
  const shortName = profile.title.split(/\s+/).pop();

  overlayEl = document.createElement('div');
  overlayEl.className = 'potw-overlay';
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

    <button type="button" class="potw-end">✕ End Voyage</button>`;
  host.appendChild(overlayEl);

  // --- create the 3D map now so it can load during the ~37s intro -----------
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

  // --- wire controls --------------------------------------------------------
  overlayEl.querySelector('.potw-skip').addEventListener('click', advanceToReveal);
  overlayEl.querySelector('.potw-fly-btn').addEventListener('click', gotoFlight);
  overlayEl.querySelector('.potw-end').addEventListener('click', closeOverlay);
  wireLesson();

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
      },
      onStateChange: onYtStateChange,
    },
  });
}

function onYtStateChange(e) {
  const YT = window.YT;
  if (!YT || !YT.PlayerState) return;
  if (e.data === YT.PlayerState.PLAYING) {
    killYtCaptions(ytPlayer);            // captions load with playback — kill them now
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
// STAGE 2 — reveal card (pops in over the still-playing video, then the video
// crossfades out to expose the 3D map parked at the Smithville start camera)
// =============================================================================

// Pop the destination card in — WITHOUT disturbing the video/song still playing.
function showRevealCard() {
  if (cardShown || !overlayEl) return;
  cardShown = true;
  overlayEl.querySelector('.potw-reveal').classList.add('show');
  overlayEl.querySelector('.potw-end').style.display = 'block';
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

// =============================================================================
// STAGE 3 — 3D flight (graceful fallback if Maps is unavailable)
// =============================================================================
function gotoFlight() {
  if (!overlayEl) return;
  const reveal = overlayEl.querySelector('.potw-reveal');
  reveal.style.transition = 'opacity .6s ease';
  reveal.style.opacity = '0';
  reveal.style.pointerEvents = 'none';
  later(() => { if (reveal) reveal.style.display = 'none'; }, 650);

  mapReadyPromise.then((ready) => {
    if (!overlayEl) return; // torn down mid-flight
    let flying = false;
    if (ready && mapEl && typeof mapEl.flyCameraTo === 'function') {
      try {
        mapEl.flyCameraTo({ endCamera: destCamera(), durationMillis: FLY_TO_MS });
        flying = true;
      } catch (e) {
        console.warn('potw: flyCameraTo failed, using fallback', e);
      }
    }
    if (!flying) showMapFallback();

    // After landing (~7.7s): reveal the lesson card and begin the slow orbit.
    later(() => {
      slideLesson();
      if (flying && typeof mapEl.flyCameraAround === 'function') {
        try {
          mapEl.flyCameraAround({ camera: destCamera(), durationMillis: ORBIT_MS, repeatCount: 10 });
        } catch (e) { console.warn('potw: flyCameraAround failed', e); }
      }
    }, flying ? FLY_TO_MS + LAND_SETTLE_MS : 700);
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
}

function buildLessonHTML() {
  const facts = profile.quickFacts.map((f, i) =>
    `<div class="potw-fact"><span class="n">${i + 1}</span><span>${esc(f)}</span></div>`).join('');

  const sources = profile.primarySources.map((s) =>
    `<button type="button" class="potw-source">
       <span class="glyph" aria-hidden="true">${esc(s.emoji)}</span>
       <span class="potw-source-body">
         <h4>${esc(s.name)}</h4>
         <p>${esc(s.desc)}</p>
       </span>
     </button>`).join('');

  const houses = Object.values(ctxRef.store.HOUSES);
  const quiz = profile.quiz.map((q, qi) => {
    const awards = houses.map((h) =>
      `<button type="button" class="potw-award" data-q="${qi}" data-house="${h.id}" style="--acc:${h.accent}">
         ${esc(h.name)}<small>+50</small>
       </button>`).join('');
    return `<div class="potw-quiz">
       <div class="potw-q">${esc(q.q)}</div>
       <button type="button" class="potw-reveal-ans" data-q="${qi}">Tap to reveal answer</button>
       <div class="potw-ans" data-q="${qi}">${esc(q.a)}</div>
       <div class="potw-awards">${awards}</div>
     </div>`;
  }).join('');

  const presBtn = profile.presentation && profile.presentation.type
    ? `<button type="button" class="potw-pres-launch font-display">📽️ Launch Presentation</button>`
    : '';

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
  return `<a class="potw-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
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
  return `<button type="button" class="potw-asset" data-key="${esc(a.key)}" data-image="${isImage ? '1' : '0'}" data-name="${esc(a.name || '')}">
    <span class="potw-asset-ico" aria-hidden="true">${assetIcon(a.type)}</span>
    <span class="potw-asset-body">
      <span class="potw-asset-name">${esc(a.name || a.key)}</span>
      <span class="potw-asset-type">${esc(a.type || 'file')}</span>
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
      const url = await media.url(btn.dataset.key);
      if (!url) { btn.classList.add('potw-asset-missing'); return; }
      if (btn.dataset.image === '1') openLightbox(url, btn.dataset.name);
      else window.open(url, '_blank', 'noopener'); // pdf / text / other → new tab
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
  // Presentation launcher (present only when the profile has a deck)
  const presBtn = overlayEl.querySelector('.potw-pres-launch');
  if (presBtn) presBtn.addEventListener('click', openPresentation);

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

  // Quiz: award bounties (one house per question)
  overlayEl.querySelectorAll('.potw-award').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const qi = btn.dataset.q;
      const houseId = Number(btn.dataset.house);
      const q = profile.quiz[qi];
      ctxRef.store.addPoints(houseId, 50, { reason: `POTW Bounty: ${q.q.slice(0, 40)}`, tag: 'potw' });
      ctxRef.audio.sfx('coin');

      // +50 float-up
      const f = document.createElement('span');
      f.className = 'potw-float';
      f.textContent = '+50';
      btn.appendChild(f);
      later(() => f.remove(), 1000);

      // lock this question's four buttons; keep the winner lit
      overlayEl.querySelectorAll(`.potw-award[data-q="${qi}"]`).forEach((b) => {
        b.disabled = true;
        b.classList.add(b === btn ? 'won' : 'awarded');
      });
    });
  });
}

// =============================================================================
// STAGE 5 — full-screen presentation viewer (over the orbiting map)
// Contract: profile.presentation = { type:'pdf'|'images'|'gslides', url?, count? }
//   images: media key  potw:<key>:slide:NNN  (3-digit, 1-based, up to count)
//   pdf:    media key  potw:<key>:slides.pdf
//   gslides: presentation.url is a docs.google.com /embed URL
// =============================================================================
const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';
const pad3 = (n) => String(n).padStart(3, '0');
const presErrorHTML = (msg) =>
  `<div class="potw-pres-error"><div class="big" aria-hidden="true">⚠️</div><div>${esc(msg)}</div></div>`;

async function openPresentation() {
  if (!overlayEl || presLayerEl) return;
  const pres = profile.presentation;
  if (!pres || !pres.type) return;
  try { ctxRef.audio.sfx('coin'); } catch (e) {}

  // Hide the lesson card while presenting (ambient orbit keeps running).
  const lesson = overlayEl.querySelector('.potw-lesson');
  if (lesson) lesson.classList.remove('show');

  presState = {
    type: pres.type, count: Number(pres.count) || 0, idx: 1, url: pres.url || '',
    imgCache: {}, pdfjs: null, pdfDoc: null, pageCache: new Map(), token: 0,
  };

  const isGslides = pres.type === 'gslides';
  const nav = isGslides ? '' : `
    <button type="button" class="potw-pres-arrow potw-pres-prev" aria-label="Previous slide">&#8249;</button>
    <button type="button" class="potw-pres-arrow potw-pres-next" aria-label="Next slide">&#8250;</button>
    <div class="potw-pres-counter">&mdash;</div>`;
  presLayerEl = document.createElement('div');
  presLayerEl.className = 'potw-pres';
  presLayerEl.innerHTML = `
    <div class="potw-pres-stage"></div>
    ${nav}
    <button type="button" class="potw-pres-close">✕ Back to ${esc(profile.title)}</button>`;
  overlayEl.appendChild(presLayerEl);

  presLayerEl.querySelector('.potw-pres-close').addEventListener('click', closePresentation);
  if (!isGslides) {
    presLayerEl.querySelector('.potw-pres-prev').addEventListener('click', (e) => { e.stopPropagation(); presGo(-1); });
    presLayerEl.querySelector('.potw-pres-next').addEventListener('click', (e) => { e.stopPropagation(); presGo(1); });
    const stage = presLayerEl.querySelector('.potw-pres-stage');
    stage.addEventListener('click', (e) => { // tap right-half = next, left-half = back
      const r = stage.getBoundingClientRect();
      presGo(e.clientX - r.left < r.width / 2 ? -1 : 1);
    });
  }
  presKeyHandler = (e) => {
    if (!presLayerEl) return;
    if (e.key === 'Escape') { closePresentation(); return; }
    if (presState && presState.type !== 'gslides') {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); presGo(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); presGo(-1); }
    }
  };
  window.addEventListener('keydown', presKeyHandler);

  if (pres.type === 'images') { presUpdateCounter(); await presShowImage(); }
  else if (pres.type === 'pdf') { await presInitPdf(); }
  else { presRenderGslides(); }
}

function presUpdateCounter() {
  if (!presLayerEl || !presState) return;
  const c = presLayerEl.querySelector('.potw-pres-counter');
  if (c) c.textContent = `${presState.idx} / ${presState.count}`;
}

function presGo(delta) {
  if (!presState || presState.count <= 0) return;
  const next = Math.min(presState.count, Math.max(1, presState.idx + delta));
  if (next === presState.idx) return;
  presState.idx = next;
  presUpdateCounter();
  if (presState.type === 'images') presShowImage();
  else if (presState.type === 'pdf') presShowPdfPage();
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
    const url = await media.url(`potw:${activeKey}:slides.pdf`);
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
async function presShowPdfPage() {
  const st = presState;
  const stage = presLayerEl && presLayerEl.querySelector('.potw-pres-stage');
  if (!stage || !st || !st.pdfDoc) return;
  const idx = st.idx;
  const cached = st.pageCache.get(idx);
  if (cached) { stage.innerHTML = ''; stage.appendChild(cached); return; }
  const token = ++st.token;
  try {
    const page = await st.pdfDoc.getPage(idx);
    if (presState !== st || token !== st.token || !presLayerEl) return;
    const dpr = window.devicePixelRatio || 1;
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
    if (presState !== st || token !== st.token || !presLayerEl) return;
    st.pageCache.set(idx, canvas);
    stage.innerHTML = ''; stage.appendChild(canvas);
  } catch (e) {
    console.warn('potw: PDF render failed', e);
    if (presState === st && token === st.token && presLayerEl) stage.innerHTML = presErrorHTML(`Could not render page ${idx}`);
  }
}

// ---- google slides ----
function presRenderGslides() {
  const st = presState;
  const stage = presLayerEl && presLayerEl.querySelector('.potw-pres-stage');
  if (!stage || !st) return;
  if (!st.url) { stage.innerHTML = presErrorHTML('No presentation link set'); return; }
  stage.innerHTML = `<div class="potw-pres-shimmer"></div>`;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('allow', 'fullscreen');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.addEventListener('load', () => { const sh = stage.querySelector('.potw-pres-shimmer'); if (sh) sh.remove(); });
  iframe.src = st.url; // needs internet; embed provides its own click nav
  stage.appendChild(iframe);
}

// Tear the presentation layer down (PDF doc/canvases destroyed, listeners dropped).
// Does NOT revoke media object URLs — media.js owns their lifecycle.
function destroyPresentation() {
  if (presKeyHandler) { try { window.removeEventListener('keydown', presKeyHandler); } catch (e) {} presKeyHandler = null; }
  if (presState) {
    if (presState.pdfDoc) { try { presState.pdfDoc.destroy(); } catch (e) {} }
    if (presState.pageCache) presState.pageCache.clear();
  }
  if (presLayerEl) { try { presLayerEl.remove(); } catch (e) {} presLayerEl = null; }
  presState = null;
}

// ✕ Back: destroy the layer and bring the lesson card back over the orbiting map.
function closePresentation() {
  destroyPresentation();
  if (overlayEl) { const l = overlayEl.querySelector('.potw-lesson'); if (l) l.classList.add('show'); }
}

// =============================================================================
// Teardown
// =============================================================================
function closeOverlay() {
  clearTimers();
  destroyPresentation();
  try { ctxRef && ctxRef.audio.stopAll(); } catch (e) {}
  if (videoEl) { try { videoEl.pause(); } catch (e) {} }
  destroyYtIntro();
  if (mapEl) { try { mapEl.remove(); } catch (e) {} mapEl = null; }
  if (overlayEl) { try { overlayEl.remove(); } catch (e) {} overlayEl = null; }
  videoEl = null; songEl = null; mapReadyPromise = null;
  advanced = false; usingFallback = false; cardShown = false;
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
    width:auto !important;aspect-ratio:16 / 9 !important;border:0 !important;background:#000;pointer-events:none;}
  .potw-song{position:absolute;inset:0;display:none;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;
    background:radial-gradient(ellipse at 50% 40%,#111827,#000 72%);}
  .potw-song-globe{font-size:7rem;animation:potw-spin 9s linear infinite;
    filter:drop-shadow(0 0 40px rgba(245,158,11,.5));}
  .potw-song-title{font-size:clamp(2.2rem,6vw,4rem);color:#f59e0b;letter-spacing:.16em;
    margin:1rem 0 .5rem;text-shadow:0 0 44px rgba(245,158,11,.55);
    animation:potw-pulse 1.8s ease-in-out infinite;}
  .potw-song-sub{color:#9ca3af;letter-spacing:.25em;text-transform:uppercase;font-size:1rem;}
  .potw-skip{position:absolute;top:18px;right:18px;z-index:50;min-height:44px;
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
  .potw-end{position:absolute;top:18px;right:18px;z-index:55;display:none;min-height:44px;
    padding:10px 18px;border-radius:.6rem;background:rgba(17,24,39,.85);border:1px solid #374151;
    color:#e5e7eb;font-weight:600;cursor:pointer;transition:background .2s ease,border-color .2s ease;}
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
  .potw-pres{position:absolute;inset:0;z-index:58;background:#000;display:flex;align-items:center;justify-content:center;}
  .potw-pres-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    overflow:hidden;background:#000;cursor:pointer;}
  .potw-pres-stage img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;}
  .potw-pres-stage canvas{max-width:100%;max-height:100%;display:block;box-shadow:0 0 40px rgba(0,0,0,.6);}
  .potw-pres-stage iframe{width:100%;height:100%;border:0;background:#000;}
  .potw-pres-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:60;width:72px;height:72px;
    min-width:64px;min-height:64px;border-radius:50%;border:1px solid #374151;background:rgba(17,24,39,.6);
    color:#f9fafb;font-size:2.6rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
    transition:background .2s ease,transform .12s ease;}
  .potw-pres-arrow:hover{background:rgba(245,158,11,.35);}
  .potw-pres-arrow:active{transform:translateY(-50%) scale(.94);}
  .potw-pres-prev{left:20px;} .potw-pres-next{right:20px;}
  .potw-pres-counter{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:60;
    background:rgba(0,0,0,.55);border:1px solid #374151;border-radius:999px;padding:8px 18px;
    color:#e5e7eb;font-weight:700;letter-spacing:.06em;font-size:1.05rem;}
  .potw-pres-close{position:absolute;top:18px;right:18px;z-index:61;min-height:48px;padding:12px 18px;
    border-radius:.6rem;background:rgba(17,24,39,.85);border:1px solid #374151;color:#e5e7eb;font-weight:700;cursor:pointer;
    transition:background .2s ease,border-color .2s ease;}
  .potw-pres-close:hover{background:rgba(239,68,68,.25);border-color:#ef4444;}
  .potw-pres-error{color:#f9fafb;text-align:center;padding:24px;max-width:32rem;line-height:1.5;}
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
  @media (prefers-reduced-motion:reduce){
    .potw-globe-emoji,.potw-song-globe,.potw-fb-globe,.potw-stars,.potw-song-title,.potw-fly-btn{animation:none;}
  }`;
  document.head.appendChild(style);
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
  },

  unmount() {
    clearTimers();
    disposeGlobe();
    destroyPresentation();
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
  },
};
