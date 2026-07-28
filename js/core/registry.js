// Module registry — the plugin system. Modules register themselves and the
// registry handles mounting/unmounting into #module-root.
const mods = new Map();
let current = null;
let ctx = null;

export const registry = {
  init(context) { ctx = context; },

  register(module) {
    if (!module?.id || typeof module.mount !== 'function') {
      console.error('registry: invalid module', module);
      return;
    }
    mods.set(module.id, module);
  },

  modules() {
    return [...mods.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  },

  currentId() { return current?.id ?? null; },

  navigate(id) {
    const next = mods.get(id);
    if (!next) { console.error(`registry: no module '${id}'`); return; }
    const root = document.getElementById('module-root');
    try { current?.unmount?.(); } catch (e) { console.error(e); }
    root.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'module-view h-full';
    root.appendChild(el);
    current = next;
    try {
      next.mount(el, ctx);
    } catch (e) {
      // The root was already cleared, so a module that throws on mount would
      // otherwise leave a blank screen — and every later tap on its nav button
      // would repeat the blank. Show plain words in its place and put the real
      // error in the console; the rest of the app stays navigable.
      console.error(`registry: module '${id}' failed to mount`, e);
      el.innerHTML = `<div class="module-mount-error" style="display:flex;align-items:center;justify-content:center;height:100%;padding:2rem;text-align:center;color:#9ca3af">This screen failed to load — check the console, or reload.</div>`;
    }
    window.dispatchEvent(new CustomEvent('module:navigate', { detail: { id } }));
  },

  home() { registry.navigate('dashboard'); },
};
