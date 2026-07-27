// Hero tuner — sliders over the five CSS variables that drive the house banner.
// Changes apply instantly and NOTHING is saved: a reload removes every trace, so
// there is no way to leave the app in a strange state by experimenting.
//
// Two ways in, both deliberate:
//   the hidden hotspot in the hero's bottom-left corner (see dashboard.js), and
//   import('/tools/hero-tuner.js').then(m => m.openHeroTuner())
// from the console.
export function openHeroTuner() {
  document.getElementById('hero-tuner')?.remove();
  const col = document.querySelector('.dash-hero .flex.flex-col');
  if (!col) return 'Open the Dashboard first (the screen with the big house banner), then run this again.';
  const crest = document.querySelector('.dash-hero img[alt$="crest"]');

  const FIELDS = [
    { var: '--name-fs',  label: 'House name',   min: 40, max: 260 },
    { var: '--motto-fs', label: 'Motto',        min: 10, max: 90  },
    { var: '--wel-fs',   label: '"WELCOME"',    min: 8,  max: 48  },
    { var: '--gap-top',  label: 'Gap above name', min: 0, max: 60 },
    { var: '--gap-bot',  label: 'Gap below name', min: 0, max: 60 },
    { var: '--crest-h',  label: 'Shield size',  min: 80, max: 320, target: '.dash-hero .relative.z-10' },
  ];
  // --crest-h ships as a clamp(), which parseFloat cannot read — so for that one
  // measure what the shield actually renders at instead of parsing the variable.
  const read = (f) => {
    if (f.var === '--crest-h') return Math.round(crest.getBoundingClientRect().height);
    const host = f.target ? document.querySelector(f.target) : col;
    return Math.round(parseFloat(getComputedStyle(host).getPropertyValue(f.var))) || 0;
  };

  const box = document.createElement('div');
  box.id = 'hero-tuner';
  box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;width:290px;padding:14px 16px;'
    + 'background:#0b0f19;color:#f9fafb;border:2px solid #f59e0b;border-radius:14px;'
    + 'font:13px/1.4 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6)';
  box.innerHTML = '<div style="font-weight:800;margin-bottom:8px">Hero tuner</div>';

  const out = document.createElement('div');
  out.style.cssText = 'margin-top:10px;padding:8px;background:#111827;border-radius:8px;'
    + 'font:12px/1.5 ui-monospace,Menlo,monospace;color:#fde68a;user-select:all;word-break:break-all';

  const refresh = () => {
    out.textContent = FIELDS.map((f) => `${f.label.replace(/"/g, '')}: ${read(f)}px`).join('  ·  ');
  };

  FIELDS.forEach((f) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:block;margin:8px 0';
    const val = read(f);
    row.innerHTML = `<span style="display:flex;justify-content:space-between">
      <span>${f.label}</span><b data-v style="color:#fde68a">${val}px</b></span>`;
    const s = document.createElement('input');
    s.type = 'range'; s.min = f.min; s.max = f.max; s.value = val;
    s.style.cssText = 'width:100%;accent-color:#f59e0b';
    s.oninput = () => {
      const host = f.target ? document.querySelector(f.target) : col;
      host.style.setProperty(f.var, s.value + 'px');
      row.querySelector('[data-v]').textContent = s.value + 'px';
      refresh();
    };
    row.appendChild(s);
    box.appendChild(row);
  });

  const close = document.createElement('button');
  close.textContent = 'Close';
  close.style.cssText = 'margin-top:10px;width:100%;padding:7px;border-radius:8px;border:1px solid #374151;'
    + 'background:transparent;color:#f9fafb;font:inherit;cursor:pointer';
  close.onclick = () => box.remove();

  box.appendChild(out);
  box.appendChild(close);
  document.body.appendChild(box);
  refresh();
  return 'Tuner open. Drag the sliders; the banner updates as you go. Nothing is saved — reload to undo.';
}
