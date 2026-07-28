// Hand-authored dice geometry — ported from the dd-game dice3d widget.
//
// Each die is built from a THREE platonic-solid primitive whose triangles are
// clustered into logical faces by normal. Each logical face gets its own tile
// in a texture atlas (the face polygon is projected onto its plane and mapped
// into the tile), values are assigned so opposite faces sum to N+1, and a
// cannon-es convex-hull description is emitted alongside so the same shape can
// be handed to the physics world.
//
// Only the d6 (pip cube) and d20 (numbered icosahedron) paths are ported.
import * as THREE from 'three';

const TILE_MARGIN = 0.14;

// --- small vector helpers ---------------------------------------------------

const posKey = (v) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;

/** Newell's method — robust normal for a (near-)planar polygon. */
function newellNormal(corners) {
  const n = new THREE.Vector3();
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n.normalize();
}

function centroidOf(corners) {
  const c = new THREE.Vector3();
  for (const v of corners) c.add(v);
  return c.divideScalar(corners.length);
}

// --- face extraction from THREE primitives ----------------------------------

/**
 * Cluster the triangles of a convex primitive into logical faces by normal,
 * returning each face as an ordered perimeter of corner vertices.
 */
function facesFromPrimitive(prim) {
  const geom = prim.index ? prim.toNonIndexed() : prim;
  const pos = geom.getAttribute('position');
  const triCount = pos.count / 3;

  const clusters = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    const n = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();

    let cluster = clusters.find((cl) => cl.normal.dot(n) > 0.9999);
    if (!cluster) {
      cluster = { normal: n.clone(), cornersByKey: new Map() };
      clusters.push(cluster);
    }
    for (const v of [a, b, c]) {
      const key = posKey(v);
      if (!cluster.cornersByKey.has(key)) cluster.cornersByKey.set(key, v.clone());
    }
  }

  // Order each face's corners by angle around the centroid, in the face plane.
  return clusters.map((cl) => {
    const corners = [...cl.cornersByKey.values()];
    const centroid = centroidOf(corners);
    const n = cl.normal;
    const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tan = new THREE.Vector3().crossVectors(ref, n).normalize();
    const bitan = new THREE.Vector3().crossVectors(n, tan);
    return corners.sort((p, q) => {
      const dp = new THREE.Vector3().subVectors(p, centroid);
      const dq = new THREE.Vector3().subVectors(q, centroid);
      return Math.atan2(dp.dot(bitan), dp.dot(tan)) - Math.atan2(dq.dot(bitan), dq.dot(tan));
    });
  });
}

// --- value assignment — opposite faces sum to N+1 ---------------------------

function assignValues(normals) {
  const n = normals.length;
  const values = new Array(n).fill(0);
  const used = new Array(n).fill(false);
  let pair = 0;
  let paired = true;

  for (let i = 0; i < n && paired; i++) {
    if (used[i]) continue;
    const j = normals.findIndex((m, jj) => jj > i && !used[jj] && m.dot(normals[i]) < -0.999);
    if (j === -1) { paired = false; break; }
    used[i] = used[j] = true;
    values[i] = pair + 1;
    values[j] = n - pair;
    pair++;
  }

  if (!paired) for (let i = 0; i < n; i++) values[i] = i + 1;
  return values;
}

// --- geometry assembly ------------------------------------------------------

function buildDie(type, facePerimeters, labelFn) {
  const count = facePerimeters.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  // First pass: normals + planar projection of every face into its atlas tile.
  const built = facePerimeters.map((corners) => {
    let n = newellNormal(corners);
    const centroid = centroidOf(corners);
    if (n.dot(centroid) < 0) {
      // Reverse winding but keep corner 0 first — label layouts rely on order.
      corners = [corners[0], ...corners.slice(1).reverse()];
      n = n.clone().negate();
    }
    const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tan = new THREE.Vector3().crossVectors(ref, n).normalize();
    const bitan = new THREE.Vector3().crossVectors(n, tan);

    const raw = corners.map((v) => new THREE.Vector2(v.dot(tan), v.dot(bitan)));
    const min = new THREE.Vector2(Infinity, Infinity);
    const max = new THREE.Vector2(-Infinity, -Infinity);
    for (const p of raw) { min.min(p); max.max(p); }
    const span = Math.max(max.x - min.x, max.y - min.y);
    const scale = (1 - 2 * TILE_MARGIN) / span;
    const mid = new THREE.Vector2().addVectors(min, max).multiplyScalar(0.5);
    const corners2D = raw.map(
      (p) => new THREE.Vector2(0.5 + (p.x - mid.x) * scale, 0.5 + (p.y - mid.y) * scale),
    );
    const centroid2D = corners2D
      .reduce((acc, p) => acc.add(p), new THREE.Vector2())
      .divideScalar(corners2D.length);
    return { corners, corners2D, centroid2D, normal: n };
  });

  const values = assignValues(built.map((f) => f.normal));

  // Second pass: fan-triangulate each face into a flat, atlas-UV'd buffer.
  const positions = [];
  const normals = [];
  const uvs = [];
  let radius = 0;

  built.forEach((face, fi) => {
    const col = fi % cols;
    const row = Math.floor(fi / cols);
    const toAtlas = (p) => [(col + p.x) / cols, (row + p.y) / rows];
    for (const v of face.corners) radius = Math.max(radius, v.length());
    for (let i = 1; i < face.corners.length - 1; i++) {
      for (const idx of [0, i, i + 1]) {
        const v = face.corners[idx];
        positions.push(v.x, v.y, v.z);
        normals.push(face.normal.x, face.normal.y, face.normal.z);
        uvs.push(...toAtlas(face.corners2D[idx]));
      }
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const faces = built.map((face, fi) => ({
    normal: face.normal.clone(),
    value: values[fi],
    display: String(values[fi]),
    labels: labelFn(face, fi, values),
  }));

  return {
    type,
    geometry,
    faces,
    cols,
    rows,
    radius,
    readDirection: new THREE.Vector3(0, 1, 0),
    convex: buildConvex(built),
  };
}

/**
 * Emit a cannon-es-friendly convex description: a de-duplicated vertex list and
 * per-face index arrays, wound so each face's cross product points outward.
 */
function buildConvex(built) {
  const vertexIndex = new Map();
  const vertices = [];
  const indexOf = (v) => {
    const key = posKey(v);
    let idx = vertexIndex.get(key);
    if (idx === undefined) {
      idx = vertices.length;
      vertices.push([v.x, v.y, v.z]);
      vertexIndex.set(key, idx);
    }
    return idx;
  };

  const faces = built.map((face) => {
    let corners = face.corners;
    // Ensure CCW-as-seen-from-outside: cross of first three should align normal.
    const c0 = corners[0], c1 = corners[1], c2 = corners[2];
    const cross = new THREE.Vector3()
      .subVectors(c1, c0)
      .cross(new THREE.Vector3().subVectors(c2, c0));
    if (cross.dot(face.normal) < 0) corners = [corners[0], ...corners.slice(1).reverse()];
    return corners.map(indexOf);
  });

  return { vertices, faces };
}

// --- label layouts ----------------------------------------------------------

/** Single centered number, top pointing from the first edge midpoint through centroid. */
function centeredLabel(size, underline69) {
  return (face, fi, values) => {
    const mid0 = new THREE.Vector2()
      .addVectors(face.corners2D[0], face.corners2D[1])
      .multiplyScalar(0.5);
    const up = new THREE.Vector2().subVectors(face.centroid2D, mid0).normalize();
    const text = String(values[fi]);
    return [{
      x: face.centroid2D.x,
      y: face.centroid2D.y,
      upX: up.x,
      upY: up.y,
      text,
      size: size * (text.length > 1 ? 0.78 : 1),
      underline: underline69 && (values[fi] % 10 === 6 || values[fi] % 10 === 9),
    }];
  };
}

/** Pip faces (d6): a single size-0 label tells textures.js to draw the pip pattern. */
const pipLabel = (face, fi, values) => [{
  x: face.centroid2D.x,
  y: face.centroid2D.y,
  upX: 0,
  upY: 1,
  text: String(values[fi]),
  size: 0,
  underline: false,
}];

// --- public builders --------------------------------------------------------

const builders = {
  d6: () => {
    const prim = new THREE.BoxGeometry(0.84, 0.84, 0.84);
    const perims = facesFromPrimitive(prim);
    prim.dispose();
    return buildDie('d6', perims, pipLabel);
  },
  d20: () => {
    const prim = new THREE.IcosahedronGeometry(0.64);
    const perims = facesFromPrimitive(prim);
    prim.dispose();
    return buildDie('d20', perims, centeredLabel(0.26, true));
  },
};

const geometryCache = new Map();

export function getDieGeometry(type) {
  let data = geometryCache.get(type);
  if (!data) {
    data = builders[type]();
    geometryCache.set(type, data);
  }
  return data;
}

/** Read the face pointing along the die's read direction. Returns [faceIdx, alignment]. */
export function readFace(data, quaternion) {
  let best = 0;
  let bestDot = -Infinity;
  const world = new THREE.Vector3();
  for (let i = 0; i < data.faces.length; i++) {
    world.copy(data.faces[i].normal).applyQuaternion(quaternion);
    const d = world.dot(data.readDirection);
    if (d > bestDot) { bestDot = d; best = i; }
  }
  return [best, bestDot];
}
