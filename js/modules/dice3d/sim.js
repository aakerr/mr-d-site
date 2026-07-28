// 3D physics dice simulation: THREE render scene + cannon-es rigid-body world.
// Ported/adapted from the dd-game dice3d widget (Rapier -> cannon-es, R3F -> vanilla).
//
// Public factory: createDiceSim({ container, audio }) -> {
//   roll(mode): Promise<[{ value, display }]>,  // physics decides the result
//   clear(), resize(), dispose(), isRolling()
// }
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { getDieGeometry, readFace } from './geometry.js';
import { createDiceTexture } from './textures.js';

// --- tunable look + feel ----------------------------------------------------
const CONFIG = {
  dice: {
    d6:  { diceColor: '#3b82f6', numberColor: '#f8fafc', accent: '#3b82f6' },
    d20: { diceColor: '#f59e0b', numberColor: '#1f2937', accent: '#f59e0b' },
  },
  trayColor: '#111827',
  trayRimColor: '#1f2937',
  gravity: -9.82 * 2,   // snappy rolls
  restitution: 0.55,    // livelier — dice visibly bounce several times
  friction: 0.14,       // slick so they skitter and roll longer before settling
};

// Physics rest-detection (ported from Die.tsx).
const REST_LIN_VEL = 0.16;
const REST_ANG_VEL = 0.22;
const REST_FRAMES = 10;
const REST_MAX_Y = 2.0;   // a die centre above this is still airborne (big dice)
const COCKED_DOT = 0.92;
const MAX_NUDGES = 3;
const WALL_HEIGHT = 7;
const SUBSTEPS = 8;       // headroom so fast dice never tunnel a wall/floor

// --- theatrical roll dynamics (all tunable) --------------------------------
const ROLL = {
  spawnHeight: 5.5,          // higher launch arc
  spawnStagger: 1.6,         // extra height per additional die
  downVelocity: -3.0,        // initial downward kick → a harder first strike
  launchSpeed: 5.6,          // lateral launch speed (single die, across centre)
  launchSpeedVar: 3.0,       // random extra lateral speed
  launchSpeed2: 3.6,         // per-die outward speed for multi-dice
  spin: 24,                  // angular-velocity magnitude (was 14) → more tumble
  minRollMs: 3100,           // never read the face before this (keeps rolls lively)
  hardCapMs: 6000,           // a roll can NEVER run longer than this
  dampRampStartMs: 4000,     // after this, bleed off velocity so it must settle
  dampRampPerFrame: 0.93,    // fraction of velocity retained each frame while ramping
  settleAnticipationMs: 420, // beat between physics rest and the result pop
  impactMinSpeed: 2.0,       // ignore impacts gentler than this (no sfx/shake)
  impactSfxThrottleMs: 90,   // at most ~11 bounce thuds per second
  shakeSpeed: 6.0,           // impact speed above which the stage shakes
  shakeMs: 130,              // shake duration
  shakePx: 3,                // max shake offset in px
};

// --- fate weighting (teacher-configured drama) -----------------------------
// The physics roll stays 100% real. Before the roll is shown, we invisibly
// pre-simulate the exact same throw to see which face WOULD land, pick a desired
// target value (biased to the die's UPPER half with probability FATE_HIGH_CHANCE),
// then pre-rotate the die's starting orientation by a ROTATIONAL SYMMETRY of its
// own shape so the identical tumble lands the target face up instead. Because a
// symmetry leaves the collision shape unchanged, the visible physics is genuine;
// we ALWAYS display the actually-settled face and fall back to the real result
// on the rare numerical divergence (never snapping the mesh).
// Nudges are disabled while fate is on so the pre-sim and visible roll agree.
//
// Fate is PER-INSTANCE (createDiceSim({ fate })). It defaults to true so the
// classroom Die of Destiny keeps its weighting, but any other consumer (e.g. a
// paid Magic Shop gamble) must pass fate:false to get genuinely uniform rolls.
const FATE_DEFAULT = true;
const FATE_HIGH_CHANCE = 0.60;

// 3d6 is a real mode, not two throws stitched together. Several of Mr. D's
// weapons roll 3d6 x100, and faking it as 2d6 followed by a single d6 split the
// most dramatic moment of his game into two beats — the class watched, waited,
// then watched again. All three dice now leave the hand together.
const MODE_DICE = { '1d6': ['d6'], '2d6': ['d6', 'd6'], '3d6': ['d6', 'd6', 'd6'], d20: ['d20'] };

// ~300% larger dice on the smartboard (tray/camera framing unchanged).
// Default die size, tuned for the full-screen Die of Destiny tray. The Battle
// Day overlay passes its own smaller value: its panel is wider, so dice at this
// scale filled it completely.
const DIE_SCALE_DEFAULT = 3;

// Camera fit target: the fraction of the frame the tray's extreme corners are
// allowed to reach. < 1 guarantees the WHOLE tray rim stays on-screen with a
// margin on the binding axis (the tray width, at smartboard aspect) — i.e.
// clear space on the left and right. Lower = more margin.
const CAMERA_FILL = 0.84;
// Look-at height: lowering it aims the camera down so the tray rides higher in
// the stage, leaving breathing room at the bottom for the in-tray result number.
const CAMERA_TARGET_Y = -0.55;

/** Resolve base + engraving colors for a die given the active house (null = All). */
function colorsFor(type, house) {
  // Every house accent is bright, so dark engraving stays legible on all of them.
  if (house) return { diceColor: house.accent, numberColor: '#111827', accent: house.accent };
  return type === 'd6'
    ? { diceColor: '#3b82f6', numberColor: '#f8fafc', accent: '#3b82f6' }
    : { diceColor: '#f59e0b', numberColor: '#1f2937', accent: '#f59e0b' };
}

const accentKey = (house) => (house ? house.accent : 'default');

/** Tray footprint for a given canvas aspect ratio (ported from Tray.tsx).
 *  The aspect is capped well below the smartboard's 16:9 so the tray stays
 *  comparatively narrow — combined with CAMERA_FILL this leaves clear space on
 *  the left and right of the tray inside the stage box. Physics walls are built
 *  from the same w/d, so dice can never leave the visible tray. */
function traySize(aspect) {
  const a = Math.min(1.4, Math.max(0.55, aspect));
  const base = 9.5;
  return { w: base * Math.sqrt(a), d: base / Math.sqrt(a) };
}

// Every call builds a fully self-contained instance: its own renderer, scene,
// cannon-es world, material cache and RAF loop. Nothing mutable is shared
// between instances, so several sims can run concurrently in different hosts.
// (The only cross-instance state is the immutable die-geometry cache in
// geometry.js, which is read-only and deliberately never disposed per-instance.)
export function createDiceSim({ container, audio, fate = FATE_DEFAULT, minRollMs, dieScale } = {}) {
  const DIE_SCALE = Number.isFinite(dieScale) && dieScale > 0 ? dieScale : DIE_SCALE_DEFAULT;
  const fateEnabled = !!fate;
  // Nudges would desync the visible roll from the fate pre-sim, so they are
  // only enabled when fate is off.
  const nudgesEnabled = !fateEnabled;
  const minRoll = Number.isFinite(minRollMs) ? Math.max(0, minRollMs) : ROLL.minRollMs;

  // --- renderer -----------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.willChange = 'transform';
  container.appendChild(canvas);

  const reducedMotion = !!(window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Impact feedback state (per-bounce thud throttle + brief stage shake).
  let lastImpactSfxT = 0;
  let shakeUntil = 0;
  let shakeMag = 0;

  // --- scene / camera -----------------------------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const VIEW_DIR = new THREE.Vector3(0, 1.25, 1).normalize();

  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x2a2f3a, 0.35);
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(5, 11, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  const sc = key.shadow.camera;
  sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.far = 34;
  const rim = new THREE.DirectionalLight(0x3b82f6, 0.6); // accent-tinted rim
  rim.position.set(-7, 5, -6);
  scene.add(ambient, hemi, key, rim);

  // --- physics world ------------------------------------------------------
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, CONFIG.gravity, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  const floorMat = new CANNON.Material('floor');
  const diceMat = new CANNON.Material('dice');
  world.addContactMaterial(new CANNON.ContactMaterial(floorMat, diceMat, {
    restitution: CONFIG.restitution, friction: CONFIG.friction,
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, {
    restitution: CONFIG.restitution, friction: CONFIG.friction,
  }));

  // Active house (null = All Cores → default per-type colors).
  let currentHouse = null;

  // --- material cache keyed by type + accent (one texture set per accent) --
  const matCache = new Map();
  function getMaterial(type, house) {
    const key = `${type}|${accentKey(house)}`;
    let m = matCache.get(key);
    if (!m) {
      const data = getDieGeometry(type);
      const { diceColor, numberColor } = colorsFor(type, house);
      const texture = createDiceTexture(data, diceColor, numberColor);
      const material = new THREE.MeshStandardMaterial({
        map: texture, roughness: 0.42, metalness: 0.08,
      });
      m = { texture, material };
      matCache.set(key, m);
    }
    return m;
  }

  const accentFor = (type) => colorsFor(type, currentHouse).accent;

  // --- tray (rebuilt on resize) -------------------------------------------
  let trayW = 10.5, trayD = 10.5;
  const trayMeshes = [];
  const trayBodies = [];

  function clearTray() {
    for (const m of trayMeshes) {
      scene.remove(m);
      m.geometry.dispose();
      if (m.material.map) m.material.map.dispose();
      m.material.dispose();
    }
    trayMeshes.length = 0;
    for (const b of trayBodies) world.removeBody(b);
    trayBodies.length = 0;
  }

  function buildTray() {
    clearTray();
    const w = trayW, d = trayD;

    // Floor: static body + felt mesh.
    const floorBody = new CANNON.Body({ mass: 0, material: floorMat });
    floorBody.addShape(new CANNON.Box(new CANNON.Vec3(w / 2 + 1, 0.5, d / 2 + 1)),
      new CANNON.Vec3(0, -0.5, 0));
    // Four tall invisible containment walls (well above the visible rim).
    const walls = [
      [[w / 2, WALL_HEIGHT / 2, 0.5], [0, WALL_HEIGHT / 2, -d / 2 - 0.5]],
      [[w / 2, WALL_HEIGHT / 2, 0.5], [0, WALL_HEIGHT / 2, d / 2 + 0.5]],
      [[0.5, WALL_HEIGHT / 2, d / 2 + 1], [-w / 2 - 0.5, WALL_HEIGHT / 2, 0]],
      [[0.5, WALL_HEIGHT / 2, d / 2 + 1], [w / 2 + 0.5, WALL_HEIGHT / 2, 0]],
    ];
    for (const [half, pos] of walls) {
      floorBody.addShape(new CANNON.Box(new CANNON.Vec3(...half)), new CANNON.Vec3(...pos));
    }
    world.addBody(floorBody);
    trayBodies.push(floorBody);

    // Felt floor mesh.
    const floorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.3, d),
      new THREE.MeshStandardMaterial({ color: CONFIG.trayColor, roughness: 0.95 }),
    );
    floorMesh.position.set(0, -0.15, 0);
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);
    trayMeshes.push(floorMesh);

    // Visible rim.
    const RIM_H = 0.5, RIM_T = 0.42;
    const rims = [
      [[w + RIM_T * 2, RIM_H, RIM_T], [0, RIM_H / 2, -d / 2 - RIM_T / 2]],
      [[w + RIM_T * 2, RIM_H, RIM_T], [0, RIM_H / 2, d / 2 + RIM_T / 2]],
      [[RIM_T, RIM_H, d], [-w / 2 - RIM_T / 2, RIM_H / 2, 0]],
      [[RIM_T, RIM_H, d], [w / 2 + RIM_T / 2, RIM_H / 2, 0]],
    ];
    for (const [size, pos] of rims) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...size),
        new THREE.MeshStandardMaterial({ color: CONFIG.trayRimColor, roughness: 0.55, metalness: 0.1 }),
      );
      mesh.position.set(...pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      trayMeshes.push(mesh);
    }
  }

  const _fitPts = [];
  function frameCamera() {
    camera.updateProjectionMatrix();
    // Sample the tray's extreme corners (rim footprint) at the felt and a little
    // above it, then binary-search the camera distance so the farthest-projecting
    // corner lands at CAMERA_FILL of the frame on whichever axis binds. This keeps
    // the whole rim on-screen with margin at ANY aspect (no cropping/spill).
    const hw = trayW / 2 + 0.6;
    const hd = trayD / 2 + 0.6;
    _fitPts.length = 0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [0, 1.4]) {
      _fitPts.push(new THREE.Vector3(sx * hw, sy, sz * hd));
    }
    const target = new THREE.Vector3(0, CAMERA_TARGET_Y, 0);
    let lo = 4, hi = 140;
    for (let it = 0; it < 46; it++) {
      const dist = (lo + hi) / 2;
      camera.position.copy(VIEW_DIR).multiplyScalar(dist).add(target);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      let maxN = 0;
      for (const p of _fitPts) {
        const q = p.clone().project(camera);
        maxN = Math.max(maxN, Math.abs(q.x), Math.abs(q.y));
      }
      if (maxN > CAMERA_FILL) lo = dist; else hi = dist;
    }
    camera.position.copy(VIEW_DIR).multiplyScalar(hi).add(target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  // --- throw generation + headless pre-simulation + fate ------------------

  // Uniform random orientation over SO(3) (Shoemake). A fair die must start
  // orientation-uniform; the previous per-axis Euler spin was NOT uniform.
  function randomQuaternion() {
    const u1 = Math.random(), u2 = Math.random(), u3 = Math.random();
    const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
    const t1 = 2 * Math.PI * u2, t2 = 2 * Math.PI * u3;
    return new THREE.Quaternion(s1 * Math.sin(t1), s1 * Math.cos(t1), s2 * Math.sin(t2), s2 * Math.cos(t2));
  }

  // Initial conditions for one die, generated once so the exact same throw can
  // be pre-simulated invisibly and then replayed on screen. orientMode 'euler'
  // reproduces the old biased spin (used only by the fairness audit baseline).
  function computeSpawn(type, i, count, orientMode) {
    const data = getDieGeometry(type);
    const radius = data.radius * DIE_SCALE;
    const margin = radius + 0.5;
    const spread = (v, half) => Math.max(-half + margin, Math.min(half - margin, v));
    const minDim = Math.min(trayW, trayD);
    const rnd = () => (Math.random() - 0.5);
    const gx = rollBaseAngle + i * (Math.PI * 2 / count);

    let ox, oz, vx, vz;
    if (count === 1) {
      const off = minDim * 0.22;
      ox = Math.cos(gx) * off; oz = Math.sin(gx) * off;
      const spd = ROLL.launchSpeed + Math.random() * ROLL.launchSpeedVar;
      vx = -Math.cos(gx) * spd + rnd() * 1.8;
      vz = -Math.sin(gx) * spd + rnd() * 1.8;
    } else {
      const off = minDim * 0.24;
      ox = Math.cos(gx) * off; oz = Math.sin(gx) * off;
      vx = Math.cos(gx) * ROLL.launchSpeed2 + rnd() * 2.2;
      vz = Math.sin(gx) * ROLL.launchSpeed2 + rnd() * 2.2;
    }

    const quaternion = orientMode === 'euler'
      ? new THREE.Quaternion().setFromEuler(new THREE.Euler(
          Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2))
      : randomQuaternion();

    return {
      position: new THREE.Vector3(
        spread(ox + rnd() * 1.0, trayW / 2),
        ROLL.spawnHeight + i * ROLL.spawnStagger,
        spread(oz + rnd() * 1.0, trayD / 2)),
      quaternion,
      velocity: new THREE.Vector3(vx, ROLL.downVelocity, vz),
      angularVelocity: new THREE.Vector3(rnd() * ROLL.spin, rnd() * ROLL.spin, rnd() * ROLL.spin),
    };
  }

  function makeDieShape(type) {
    const data = getDieGeometry(type);
    if (type === 'd6') {
      return new CANNON.Box(new CANNON.Vec3(0.42 * DIE_SCALE, 0.42 * DIE_SCALE, 0.42 * DIE_SCALE));
    }
    return new CANNON.ConvexPolyhedron({
      vertices: data.convex.vertices.map(
        (v) => new CANNON.Vec3(v[0] * DIE_SCALE, v[1] * DIE_SCALE, v[2] * DIE_SCALE)),
      faces: data.convex.faces,
    });
  }

  const HEADLESS_DT = 1 / 60;
  const RAMP_STEP = Math.round(ROLL.dampRampStartMs * 0.001 * 60);
  const CAP_STEP = Math.round(ROLL.hardCapMs * 0.001 * 60);

  // Invisible, deterministic simulation of a whole throw to rest. Mirrors the
  // visible loop (fixed step, damp ramp, velocity-threshold rest, NO nudges) and
  // returns each die's landing face. All dice are simulated together so die-die
  // collisions in 2d6 are reproduced.
  function simulateHeadless(entries) {
    const w = new CANNON.World({ gravity: new CANNON.Vec3(0, CONFIG.gravity, 0) });
    w.broadphase = new CANNON.SAPBroadphase(w);
    const fMat = new CANNON.Material('floor');
    const dMat = new CANNON.Material('dice');
    w.addContactMaterial(new CANNON.ContactMaterial(fMat, dMat, { restitution: CONFIG.restitution, friction: CONFIG.friction }));
    w.addContactMaterial(new CANNON.ContactMaterial(dMat, dMat, { restitution: CONFIG.restitution, friction: CONFIG.friction }));

    const W = trayW, D = trayD;
    const tb = new CANNON.Body({ mass: 0, material: fMat });
    tb.addShape(new CANNON.Box(new CANNON.Vec3(W / 2 + 1, 0.5, D / 2 + 1)), new CANNON.Vec3(0, -0.5, 0));
    const walls = [
      [[W / 2, WALL_HEIGHT / 2, 0.5], [0, WALL_HEIGHT / 2, -D / 2 - 0.5]],
      [[W / 2, WALL_HEIGHT / 2, 0.5], [0, WALL_HEIGHT / 2, D / 2 + 0.5]],
      [[0.5, WALL_HEIGHT / 2, D / 2 + 1], [-W / 2 - 0.5, WALL_HEIGHT / 2, 0]],
      [[0.5, WALL_HEIGHT / 2, D / 2 + 1], [W / 2 + 0.5, WALL_HEIGHT / 2, 0]],
    ];
    for (const [half, pos] of walls) tb.addShape(new CANNON.Box(new CANNON.Vec3(...half)), new CANNON.Vec3(...pos));
    w.addBody(tb);

    const sims = entries.map(({ type, ic }) => {
      const body = new CANNON.Body({ mass: 1, material: dMat, shape: makeDieShape(type) });
      body.allowSleep = false;
      body.linearDamping = 0.03;
      body.angularDamping = 0.07;
      body.position.set(ic.position.x, ic.position.y, ic.position.z);
      body.quaternion.set(ic.quaternion.x, ic.quaternion.y, ic.quaternion.z, ic.quaternion.w);
      body.velocity.set(ic.velocity.x, ic.velocity.y, ic.velocity.z);
      body.angularVelocity.set(ic.angularVelocity.x, ic.angularVelocity.y, ic.angularVelocity.z);
      w.addBody(body);
      return { data: getDieGeometry(type), body, restFrames: 0, resolved: false, faceIdx: 0, alignment: 0 };
    });

    const q = new THREE.Quaternion();
    for (let step = 0; step < CAP_STEP; step++) {
      w.step(HEADLESS_DT);
      const overdue = step >= CAP_STEP - 1;
      const ramping = step >= RAMP_STEP;
      let done = true;
      for (const d of sims) {
        if (d.resolved) continue;
        const b = d.body;
        if (ramping) {
          b.velocity.scale(ROLL.dampRampPerFrame, b.velocity);
          b.angularVelocity.scale(ROLL.dampRampPerFrame, b.angularVelocity);
        }
        const speed = b.velocity.length();
        const spin = b.angularVelocity.length();
        if ((speed < REST_LIN_VEL && spin < REST_ANG_VEL && b.position.y < REST_MAX_Y) || overdue) d.restFrames++;
        else d.restFrames = 0;
        if (d.restFrames < REST_FRAMES && !overdue) { done = false; continue; }
        q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        const [fi, al] = readFace(d.data, q);
        d.faceIdx = fi; d.alignment = al; d.resolved = true;
      }
      if (done) break;
    }
    return sims.map((d) => ({
      faceIdx: d.faceIdx, alignment: d.alignment,
      value: d.data.faces[d.faceIdx].value, display: d.data.faces[d.faceIdx].display,
    }));
  }

  // Pick a target value biased to the upper half (d20: 11-20, d6: 4-6).
  function pickTargetValue(type) {
    const sides = type === 'd20' ? 20 : 6;
    const half = sides / 2;
    const high = Math.random() < FATE_HIGH_CHANCE;
    return (high ? half + 1 : 1) + Math.floor(Math.random() * half);
  }

  function faceIndexOfValue(data, value) {
    return data.faces.findIndex((f) => f.value === value);
  }

  // Orthonormal frame (tangent, bitangent, normal) of a face in local space.
  function faceFrame(data, faceIdx) {
    const n = data.faces[faceIdx].normal.clone().normalize();
    const vi = data.convex.faces[faceIdx][0];
    const v = new THREE.Vector3(
      data.convex.vertices[vi][0], data.convex.vertices[vi][1], data.convex.vertices[vi][2]);
    const t = v.clone().addScaledVector(n, -v.dot(n)).normalize();
    const b = new THREE.Vector3().crossVectors(n, t);
    return new THREE.Matrix4().makeBasis(t, b, n);
  }

  // A rotational SYMMETRY of the die mapping the target face's flag onto the
  // landing face's flag (simply-transitive on flags for cube/icosahedron, so
  // this frame-match IS a genuine symmetry). Returns null if the sanity check
  // fails, in which case the caller skips fate for that die.
  function symmetryRotation(data, targetIdx, landingIdx) {
    const Ft = faceFrame(data, targetIdx);
    const Fl = faceFrame(data, landingIdx);
    const R = new THREE.Matrix4().multiplyMatrices(Fl, Ft.clone().invert());
    const q = new THREE.Quaternion().setFromRotationMatrix(R);
    const mapped = data.faces[targetIdx].normal.clone().applyQuaternion(q);
    return mapped.dot(data.faces[landingIdx].normal) > 0.999 ? q : null;
  }

  // --- live dice ----------------------------------------------------------
  let dice = [];         // { type, data, mesh, body, radius, restFrames, nudges, resolved, value, display }
  let rolling = false;
  let rollBaseAngle = 0;   // randomized per roll → no systematic spawn-side bias
  let rollStart = 0;
  let settleResolve = null;
  let settleTimer = null;
  let settlePending = null;  // resolver parked in the anticipation beat (see settle/dispose)
  let pauseAt = 0;
  const fateStats = { targeted: 0, hits: 0 };

  function removeDie(die) {
    die.body.removeEventListener('collide', onCollide);
    scene.remove(die.mesh);
    world.removeBody(die.body);
  }

  function clear() {
    for (const die of dice) removeDie(die);
    dice = [];
    renderOnce();
  }

  // Build a live die (mesh + rigid body) from precomputed initial conditions.
  // `target` is the fate-desired value (or null) for post-settle hit accounting.
  function spawnDie(type, ic, target) {
    const data = getDieGeometry(type);
    const { material } = getMaterial(type, currentHouse);
    const mesh = new THREE.Mesh(data.geometry, material);
    mesh.scale.setScalar(DIE_SCALE);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const body = new CANNON.Body({ mass: 1, material: diceMat, shape: makeDieShape(type) });
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.15;
    body.sleepTimeLimit = 0.4;
    body.linearDamping = 0.03;   // low → keeps skittering
    body.angularDamping = 0.07;  // low → keeps tumbling/rolling longer
    body.position.set(ic.position.x, ic.position.y, ic.position.z);
    body.quaternion.set(ic.quaternion.x, ic.quaternion.y, ic.quaternion.z, ic.quaternion.w);
    body.velocity.set(ic.velocity.x, ic.velocity.y, ic.velocity.z);
    body.angularVelocity.set(ic.angularVelocity.x, ic.angularVelocity.y, ic.angularVelocity.z);
    body.addEventListener('collide', onCollide);
    world.addBody(body);

    return {
      type, data, mesh, body, target,
      restFrames: 0, nudges: 0, resolved: false, value: null, display: null,
    };
  }

  function setAccent(hex) {
    rim.color.set(hex);
  }

  // Per-bounce feedback from cannon-es 'collide' events (physics-driven, honest).
  function onCollide(e) {
    if (!rolling || !e.contact) return;
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (v < ROLL.impactMinSpeed) return;
    const now = performance.now();
    // 'diceland', not 'thud'. This fires on EVERY qualifying impact while the
    // dice tumble, so it has to be a light tap. It shared the combat slot, and
    // the moment a teacher recorded a shield-block for Battle Day the tray
    // started playing a sword hitting a shield several times per roll — heavy,
    // far too loud, and out of step with the dice actually bouncing.
    if (now - lastImpactSfxT >= ROLL.impactSfxThrottleMs) {
      audio?.sfx?.('diceland');
      lastImpactSfxT = now;
    }
    if (v > ROLL.shakeSpeed) triggerShake((v - ROLL.shakeSpeed) / 8);
  }

  function triggerShake(intensity) {
    if (reducedMotion) return;
    shakeUntil = performance.now() + ROLL.shakeMs;
    shakeMag = Math.max(shakeMag, Math.min(1, intensity) * ROLL.shakePx);
  }

  function applyShake(now) {
    if (now < shakeUntil && shakeMag > 0) {
      const decay = (shakeUntil - now) / ROLL.shakeMs; // 1 → 0
      const m = shakeMag * decay;
      const dx = (Math.random() * 2 - 1) * m;
      const dy = (Math.random() * 2 - 1) * m;
      // scale(1.03) hides the sliver of stage revealed by the translate.
      canvas.style.transform = `translate(${dx}px,${dy}px) scale(1.03)`;
    } else if (shakeMag > 0 || canvas.style.transform) {
      shakeMag = 0;
      canvas.style.transform = '';
    }
  }

  /** Recolor dice to the active house (null = All → defaults). No remount needed. */
  function setHouse(house) {
    if (accentKey(house) === accentKey(currentHouse) && matCache.size) return;
    currentHouse = house;
    for (const die of dice) die.mesh.material = getMaterial(die.type, house).material;
    setAccent(colorsFor('d6', house).accent);
    renderOnce();
  }

  /** Roll the given mode; resolves with per-die results once physics settles. */
  function roll(mode) {
    if (rolling) return Promise.resolve(null);
    const types = MODE_DICE[mode] || ['d6'];
    clear();
    setAccent(accentFor(types[0]));
    audio?.sfx?.('roll');

    rollBaseAngle = Math.random() * Math.PI * 2;

    // Generate the throw once, then (optionally) apply fate weighting: pre-sim
    // all dice together to see where they land, pick a biased target per die,
    // and pre-rotate each start orientation by a symmetry so the same tumble
    // lands the target. The collision shapes are unchanged, so the roll is real.
    const ics = types.map((t, i) => computeSpawn(t, i, types.length));
    const targets = types.map(() => null);
    if (fateEnabled) {
      const landings = simulateHeadless(types.map((t, i) => ({ type: t, ic: ics[i] })));
      for (let i = 0; i < types.length; i++) {
        const data = getDieGeometry(types[i]);
        const targetVal = pickTargetValue(types[i]);
        const targetIdx = faceIndexOfValue(data, targetVal);
        const R = targetIdx >= 0 ? symmetryRotation(data, targetIdx, landings[i].faceIdx) : null;
        if (R) {
          ics[i].quaternion = ics[i].quaternion.clone().multiply(R);
          targets[i] = targetVal;
        }
      }
    }

    dice = types.map((t, i) => spawnDie(t, ics[i], targets[i]));
    rolling = true;
    rollStart = performance.now();
    startLoop();

    return new Promise((resolve) => { settleResolve = resolve; });
  }

  function nudge(die) {
    die.nudges++;
    die.restFrames = 0;
    die.body.wakeUp();
    const r = () => (Math.random() - 0.5);
    die.body.velocity.set(r() * 3, 4.5, r() * 3);
    die.body.angularVelocity.set(r() * 9, r() * 9, r() * 9);
  }

  const _q = new THREE.Quaternion();
  function checkRest(now) {
    const elapsed = now - rollStart;
    const overdue = elapsed > ROLL.hardCapMs;
    // Enforce a lively minimum: keep simulating (never read the settled face)
    // until minRollMs, so even a quick-settling die still gets a full roll.
    if (elapsed < minRoll && !overdue) return;
    // After the ramp point, bleed velocity every frame so even a die that keeps
    // skittering is guaranteed to come to rest well before the hard cap.
    const ramping = elapsed > ROLL.dampRampStartMs;
    let allResolved = true;

    for (const die of dice) {
      if (die.resolved) continue;
      const b = die.body;
      if (ramping) {
        b.velocity.scale(ROLL.dampRampPerFrame, b.velocity);
        b.angularVelocity.scale(ROLL.dampRampPerFrame, b.angularVelocity);
      }
      const speed = b.velocity.length();
      const spin = b.angularVelocity.length();

      if ((speed < REST_LIN_VEL && spin < REST_ANG_VEL && b.position.y < REST_MAX_Y) || overdue) {
        die.restFrames++;
      } else {
        die.restFrames = 0;
      }
      if (die.restFrames < REST_FRAMES && !overdue) { allResolved = false; continue; }

      _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      const [faceIdx, alignment] = readFace(die.data, _q);

      if (nudgesEnabled && alignment < COCKED_DOT && die.nudges < MAX_NUDGES && !overdue) {
        nudge(die);
        allResolved = false;
        continue;
      }
      die.resolved = true;
      const face = die.data.faces[faceIdx];
      die.value = face.value;
      die.display = face.display;
    }

    if (allResolved && dice.length) settle(now);
  }

  function settle(now) {
    rolling = false;
    pauseAt = now + 900 + ROLL.settleAnticipationMs;
    // NO SOUND HERE. The die's last bounce already played one through
    // onCollide, and that bounce IS the landing — settle() only runs once rest
    // detection has seen ten consecutive still frames, which measured over a
    // second after the final contact. A cue at this moment therefore arrives
    // when the dice have visibly been sitting there, reading as a stray noise
    // rather than part of the roll. Measured on a real d20 roll: nine impact
    // taps, the last gap 1116ms.
    // Fate accounting: we always DISPLAY the real settled face; a target miss
    // (rare numerical divergence) just means the physics face is shown instead.
    for (const d of dice) {
      if (d.target == null) continue;
      fateStats.targeted++;
      if (d.value === d.target) fateStats.hits++;
      else console.warn(`dice: fate miss — wanted ${d.target}, physics gave ${d.value} (${d.type}); showing real face`);
    }
    const results = dice.map((d) => ({ value: d.value, display: d.display }));
    // Brief anticipation beat: dice are at rest, but hold the result reveal a
    // moment so the number pop lands with weight. Capture the resolver locally
    // so a later roll can never resolve this promise with the wrong values.
    const resolve = settleResolve;
    settleResolve = null;
    // Parked where dispose() can still reach it — a caller is awaiting this
    // resolver through the whole anticipation beat, and losing it here would
    // strand them exactly like losing settleResolve mid-tumble.
    settlePending = resolve;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settlePending = null; if (resolve) resolve(results); }, ROLL.settleAnticipationMs);
  }

  // --- render loop (render-on-demand; idles when settled) -----------------
  let rafId = null;
  let last = 0;

  function syncMeshes() {
    for (const die of dice) {
      die.mesh.position.copy(die.body.position);
      die.mesh.quaternion.copy(die.body.quaternion);
    }
  }

  function renderOnce() {
    syncMeshes();
    renderer.render(scene, camera);
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000 || 0, 1 / 30);
    last = now;
    world.step(1 / 60, dt, SUBSTEPS);
    syncMeshes();
    if (rolling) checkRest(now);
    applyShake(now);
    renderer.render(scene, camera);

    // Idle the loop once nothing is moving, the settle grace has elapsed, and
    // the impact shake has finished.
    if (!rolling && now > pauseAt && now >= shakeUntil) {
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (rafId != null) return;
    last = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  // --- resize -------------------------------------------------------------
  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const dims = traySize(w / h);
    trayW = dims.w;
    trayD = dims.d;
    buildTray();
    frameCamera();
    renderOnce();
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);

  // initial build
  buildTray();
  resize();

  // --- teardown -----------------------------------------------------------
  function dispose() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    clearTimeout(settleTimer);
    settleTimer = null;
    // A caller can still be awaiting roll() right now — mid-tumble
    // (settleResolve) or in the settle-anticipation beat (settlePending).
    // Dropping either strands that await forever, and the strike it was
    // driving with it. Resolve with null: the callers read null as
    // "cancelled" and stand down cleanly.
    const abandoned = settleResolve || settlePending;
    settleResolve = null;
    settlePending = null;
    if (abandoned) abandoned(null);
    canvas.style.transform = '';
    ro.disconnect();
    clear();
    clearTray();
    for (const { texture, material } of matCache.values()) {
      texture.dispose();
      material.dispose();
    }
    matCache.clear();
    // NOTE: the die geometries in geometry.js are an immutable module-level
    // cache SHARED by every sim instance. Disposing them here would yank the
    // buffers out from under any concurrently-running sim, so we deliberately
    // leave them alone. They are two small BufferGeometries that live for the
    // lifetime of the page — bounded, not a leak.
    scene.clear();
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  // Automated headless distribution test. Runs `n` full throws (no rendering)
  // and tallies the settled value per face. opts.fate applies the fate pipeline;
  // opts.orient ('euler'|'uniform') selects the spawn-orientation model (used to
  // show the fairness before/after). Returns { counts, targeted, hits }.
  function audit(mode, n, opts = {}) {
    const types = MODE_DICE[mode] || ['d6'];
    const orient = opts.orient || 'uniform';
    const savedAngle = rollBaseAngle;
    const counts = {};
    let targeted = 0, hits = 0;

    for (let r = 0; r < n; r++) {
      rollBaseAngle = Math.random() * Math.PI * 2;
      const ics = types.map((t, i) => computeSpawn(t, i, types.length, orient));
      const landings = simulateHeadless(types.map((t, i) => ({ type: t, ic: ics[i] })));

      if (!opts.fate) {
        for (const l of landings) counts[l.value] = (counts[l.value] || 0) + 1;
        continue;
      }

      const fated = types.map((t, i) => {
        const data = getDieGeometry(t);
        const tv = pickTargetValue(t);
        const ti = faceIndexOfValue(data, tv);
        const R = ti >= 0 ? symmetryRotation(data, ti, landings[i].faceIdx) : null;
        if (!R) return { ic: ics[i], target: null };
        return { ic: { ...ics[i], quaternion: ics[i].quaternion.clone().multiply(R) }, target: tv };
      });
      const finals = simulateHeadless(types.map((t, i) => ({ type: t, ic: fated[i].ic })));
      for (let i = 0; i < types.length; i++) {
        const v = finals[i].value;
        counts[v] = (counts[v] || 0) + 1;
        if (fated[i].target != null) { targeted++; if (v === fated[i].target) hits++; }
      }
    }

    rollBaseAngle = savedAngle;
    return { counts, targeted, hits };
  }

  return {
    roll,
    clear,
    resize,
    setHouse,
    dispose,
    isRolling: () => rolling,
    audit,
    getFateStats: () => ({ ...fateStats }), // console-only dev tool — no app code calls this
  };
}
