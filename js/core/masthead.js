// masthead.js — precision fitting for the Magic Shop / Quest Board mastheads.
//
// The rules these screens follow (teacher's spec):
//   1. The TEXT BLOCK and the POINTS PILL are centred perfectly on the SCREEN.
//      The leading icon is deliberately excluded from that centring — it hangs
//      to the left and is allowed to look off balance.
//   2. The second line is the EXACT ink width of the first line; we scale its
//      font size to make that true rather than nudging the copy.
//   3. The pill (ignoring the flanking shields) is that same exact width.
//   4. The icon is vertically centred on the FIRST LINE of text, not on the
//      whole text block.
//
// Widths are measured from inner <span class="mh-ink"> elements — a block-level
// heading always reports its container's width, not the width of its glyphs.

const MIN_PX = 8;
const MAX_PX = 220;

function ink(el) {
  return el ? el.getBoundingClientRect().width : 0;
}

/**
 * @param {object} parts
 * @param {HTMLElement} [parts.icon]    leading mark, absolutely positioned
 * @param {HTMLElement} parts.titleInk  <span> inside the title line
 * @param {HTMLElement} parts.subInk    <span> inside the subtitle line
 * @param {HTMLElement} [parts.headings] the text block to size
 * @param {HTMLElement} [parts.pill]     the points pill to size
 */
export function fitMasthead({ icon, titleInk, subInk, headings, pill }) {
  try {
    if (!titleInk || !subInk) return;
    const target = ink(titleInk);
    if (!target) return;

    // Scale the subtitle until its ink width matches the title's. Font metrics
    // aren't perfectly linear, so converge over a few passes.
    let size = parseFloat(getComputedStyle(subInk).fontSize) || 16;
    for (let i = 0; i < 5; i++) {
      const w = ink(subInk);
      if (!w) break;
      const next = Math.min(MAX_PX, Math.max(MIN_PX, size * (target / w)));
      if (Math.abs(next - size) < 0.05) break;
      size = next;
      subInk.style.fontSize = `${size}px`;
    }

    // Round UP (+1) so the block can never be a sub-pixel narrower than its own
    // text — that would wrap the line and shrink the next measurement.
    const width = Math.ceil(target) + 1;
    if (headings) headings.style.width = `${width}px`;
    if (pill) pill.style.width = `${width}px`;

    // Icon rides the FIRST LINE: centre it on the title's line box, not on the
    // whole text block. The header is top-aligned, so a margin does it.
    if (icon) {
      const tH = titleInk.getBoundingClientRect().height;
      const iH = icon.getBoundingClientRect().height;
      // May be negative: when the mark is taller than the title's line box it
      // must ride UP to stay centred on that first line.
      if (tH && iH) icon.style.marginTop = `${Math.round((tH - iH) / 2)}px`;
    }
  } catch (e) { /* presentation only — never break a screen over layout maths */ }
}

// Run now and again after webfonts settle, since Cinzel changes the metrics.
export function fitMastheadWhenReady(parts) {
  fitMasthead(parts);
  requestAnimationFrame(() => fitMasthead(parts));
  if (document.fonts?.ready) document.fonts.ready.then(() => fitMasthead(parts)).catch(() => {});
}
