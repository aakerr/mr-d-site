// Canvas-drawn texture atlases for the dice — no external image assets.
// Ported from the dd-game dice3d widget (d6 pips + d20 numerals only).
//
// Each die type gets one atlas (one tile per face). Tiles are painted with the
// base color plus a soft radial shade for a stylized look, and the face labels
// computed in geometry.js are drawn engraved-style in the number color.
import * as THREE from 'three';

const TILE_PX = 256;
const FONT_STACK = '"Trebuchet MS", "Verdana", "Segoe UI", sans-serif';

/** Standard d6 pip positions on a [-1, 1] grid. */
const PIP_LAYOUTS = {
  1: [[0, 0]],
  2: [[-1, 1], [1, -1]],
  3: [[-1, 1], [0, 0], [1, -1]],
  4: [[-1, 1], [1, 1], [-1, -1], [1, -1]],
  5: [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]],
  6: [[-1, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]],
};

function drawEngraved(ctx, draw, numberColor) {
  // Fake an engraving: dark pass nudged toward the light, then the ink color.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  draw(-0.06);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  draw(0.07);
  ctx.fillStyle = numberColor;
  draw(0);
}

function drawPips(ctx, count, numberColor) {
  const layout = PIP_LAYOUTS[count] ?? PIP_LAYOUTS[1];
  const spacing = TILE_PX * 0.19;
  const r = TILE_PX * 0.075;
  drawEngraved(ctx, (dy) => {
    for (const [gx, gy] of layout) {
      ctx.beginPath();
      ctx.arc(gx * spacing, gy * spacing + dy * r * 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, numberColor);
}

function drawLabel(ctx, label, originX, originY, numberColor) {
  // Tile-local UV (y up) -> canvas pixels (y down).
  const px = originX + label.x * TILE_PX;
  const py = originY + (1 - label.y) * TILE_PX;
  const angle = Math.atan2(label.upX, label.upY);

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);

  if (label.size === 0) {
    drawPips(ctx, parseInt(label.text, 10), numberColor);
    ctx.restore();
    return;
  }

  const fontPx = label.size * TILE_PX;
  ctx.font = `700 ${fontPx}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  drawEngraved(ctx, (dy) => {
    ctx.fillText(label.text, 0, dy * fontPx);
    if (label.underline) {
      const w = ctx.measureText(label.text).width;
      ctx.fillRect(-w / 2, fontPx * (0.58 + dy), w, fontPx * 0.07);
    }
  }, numberColor);
  ctx.restore();
}

export function createDiceTexture(data, diceColor, numberColor) {
  const { cols, rows, faces } = data;
  const canvas = document.createElement('canvas');
  canvas.width = cols * TILE_PX;
  canvas.height = rows * TILE_PX;
  const ctx = canvas.getContext('2d');

  faces.forEach((face, fi) => {
    const col = fi % cols;
    const row = Math.floor(fi / cols);
    const x0 = col * TILE_PX;
    // UV row 0 sits at the bottom of the (flipY) canvas.
    const y0 = (rows - 1 - row) * TILE_PX;

    ctx.fillStyle = diceColor;
    ctx.fillRect(x0, y0, TILE_PX, TILE_PX);

    // Soft center glow + corner shade for a stylized beveled feel.
    const g = ctx.createRadialGradient(
      x0 + TILE_PX / 2, y0 + TILE_PX / 2, TILE_PX * 0.1,
      x0 + TILE_PX / 2, y0 + TILE_PX / 2, TILE_PX * 0.75,
    );
    g.addColorStop(0, 'rgba(255,255,255,0.14)');
    g.addColorStop(0.55, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, TILE_PX, TILE_PX);

    for (const label of face.labels) drawLabel(ctx, label, x0, y0, numberColor);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  return tex;
}
