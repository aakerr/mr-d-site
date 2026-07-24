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
  restitution: 0.35,    // bouncy-but-settling
  friction: 0.25,
};

// Physics rest-detection (ported from Die.tsx).
const REST_LIN_VEL = 0.16;
const REST_ANG_VEL = 0.22;
const REST_FRAMES = 10;
const COCKED_DOT = 0.92;
const MAX_NUDGES = 3;
const WALL_HEIGHT = 7;

const MODE_DICE = { '1d6': ['d6'], '2d6': ['d6', 'd6'], d20: ['d20'] };

// ~300% larger dice on the smartboard (tray/camera framing unchanged).
const DIE_SCALE = 3;

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

export function createDiceSim({ container, audio }) {
  // --- renderer -----------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

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

  // --- live dice ----------------------------------------------------------
  let dice = [];         // { type, data, mesh, body, radius, restFrames, nudges, resolved, value, display }
  let rolling = false;
  let rollBaseAngle = 0;   // randomized per roll → no systematic spawn-side bias
  let rollDeadline = 0;
  let settleResolve = null;
  let pauseAt = 0;

  function removeDie(die) {
    scene.remove(die.mesh);
    world.removeBody(die.body);
  }

  function clear() {
    for (const die of dice) removeDie(die);
    dice = [];
    renderOnce();
  }

  function spawnDie(type, i, count) {
    const data = getDieGeometry(type);
    const { material } = getMaterial(type, currentHouse);
    const mesh = new THREE.Mesh(data.geometry, material);
    mesh.scale.setScalar(DIE_SCALE);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const shape = type === 'd6'
      ? new CANNON.Box(new CANNON.Vec3(0.42 * DIE_SCALE, 0.42 * DIE_SCALE, 0.42 * DIE_SCALE))
      : new CANNON.ConvexPolyhedron({
          vertices: data.convex.vertices.map(
            (v) => new CANNON.Vec3(v[0] * DIE_SCALE, v[1] * DIE_SCALE, v[2] * DIE_SCALE)),
          faces: data.convex.faces,
        });

    const body = new CANNON.Body({ mass: 1, material: diceMat, shape });
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.15;
    body.sleepTimeLimit = 0.4;
    body.linearDamping = 0.06;
    body.angularDamping = 0.14;

    const radius = data.radius * DIE_SCALE;
    const margin = radius + 0.5;
    const spread = (v, half) => Math.max(-half + margin, Math.min(half - margin, v));
    const minDim = Math.min(trayW, trayD);
    const rnd = () => (Math.random() - 0.5);

    // Per-roll random base angle removes the old deterministic +x (right-side)
    // bias: index 0 no longer always maps to angle 0. Dice fan out symmetrically
    // around that random angle so 2d6 still starts on opposite sides.
    const gx = rollBaseAngle + i * (Math.PI * 2 / count);

    let ox, oz, vx, vz;
    if (count === 1) {
      // Single die: spawn offset to a random side, then fling the impulse back
      // ACROSS the center → the die traverses the middle and, with damping,
      // tends to settle centrally instead of hugging one wall.
      const off = minDim * 0.22;
      ox = Math.cos(gx) * off;
      oz = Math.sin(gx) * off;
      const spd = 2.6 + Math.random() * 1.4;
      vx = -Math.cos(gx) * spd + rnd() * 1.6;
      vz = -Math.sin(gx) * spd + rnd() * 1.6;
    } else {
      // Multiple dice: symmetric offsets + gentle outward impulse so the large
      // dice spread apart and never pile into each other at dead center.
      const off = minDim * 0.24;
      ox = Math.cos(gx) * off;
      oz = Math.sin(gx) * off;
      vx = Math.cos(gx) * 2.4 + rnd() * 2;
      vz = Math.sin(gx) * 2.4 + rnd() * 2;
    }

    const x = spread(ox + rnd() * 1.0, trayW / 2);
    const z = spread(oz + rnd() * 1.0, trayD / 2);
    // Spawn just above the tray — low enough that the drop-in stays within the
    // frame, high enough (plus the strong spin below) to tumble convincingly.
    body.position.set(x, 3.4 + i * 1.9, z);
    body.quaternion.setFromEuler(
      Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
    body.angularVelocity.set(rnd() * 14, rnd() * 14, rnd() * 14);
    body.velocity.set(vx, -1, vz);
    world.addBody(body);

    return {
      type, data, mesh, body, radius,
      restFrames: 0, nudges: 0, resolved: false, value: null, display: null,
    };
  }

  function setAccent(hex) {
    rim.color.set(hex);
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
    dice = types.map((t, i) => spawnDie(t, i, types.length));
    rolling = true;
    rollDeadline = performance.now() + 3500;
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
    const overdue = now > rollDeadline;
    let allResolved = true;

    for (const die of dice) {
      if (die.resolved) continue;
      const b = die.body;
      const speed = b.velocity.length();
      const spin = b.angularVelocity.length();

      if ((speed < REST_LIN_VEL && spin < REST_ANG_VEL && b.position.y < 1.8) || overdue) {
        die.restFrames++;
      } else {
        die.restFrames = 0;
      }
      if (die.restFrames < REST_FRAMES && !overdue) { allResolved = false; continue; }

      _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      const [faceIdx, alignment] = readFace(die.data, _q);

      if (alignment < COCKED_DOT && die.nudges < MAX_NUDGES && !overdue) {
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
    pauseAt = now + 900;
    audio?.sfx?.('thud');
    const results = dice.map((d) => ({ value: d.value, display: d.display }));
    if (settleResolve) { settleResolve(results); settleResolve = null; }
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
    world.step(1 / 60, dt, 6);
    syncMeshes();
    if (rolling) checkRest(now);
    renderer.render(scene, camera);

    // Idle the loop once nothing is moving and the settle grace has elapsed.
    if (!rolling && now > pauseAt) {
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
    ro.disconnect();
    clear();
    clearTray();
    for (const { texture, material } of matCache.values()) {
      texture.dispose();
      material.dispose();
    }
    matCache.clear();
    // Shared cached die geometries are disposed too (cache is per-module-load).
    for (const type of ['d6', 'd20']) {
      try { getDieGeometry(type).geometry.dispose(); } catch (e) { /* ignore */ }
    }
    scene.clear();
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return {
    roll,
    clear,
    resize,
    setHouse,
    dispose,
    isRolling: () => rolling,
  };
}
