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

  get(id) { return mods.get(id); },
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
    next.mount(el, ctx);
    window.dispatchEvent(new CustomEvent('module:navigate', { detail: { id } }));
  },

  home() { registry.navigate('dashboard'); },
};
