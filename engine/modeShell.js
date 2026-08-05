(function () {
  const GN = window.GN = window.GN || {};

  const modes = {};
  function registerMode(id, def) { modes[id] = def; }

  let current = null;
  let roundId = 0;

  function scheduleTimeout(fn, delay) {
    const my = roundId;
    return setTimeout(() => { if (my === roundId) fn(); }, delay);
  }
  function bumpRound() { roundId++; }

  function makeSelection() {
    const set = new Set();
    return {
      has: (i) => set.has(i),
      toggle: (i) => { set.has(i) ? set.delete(i) : set.add(i); },
      add: (i) => set.add(i),
      remove: (i) => set.delete(i),
      clear: () => set.clear(),
      values: () => [...set],
      get size() { return set.size; },
    };
  }

  function buildContext(extra) {
    return Object.assign({
      map: GN.map,
      hud: GN.hud,
      scheduleTimeout,
      bumpRound,
      selection: makeSelection(),
    }, extra);
  }

  function start(modeId, options) {
    if (current && current.def.teardown) {
      try { current.def.teardown(current.ctx); } catch (e) { console.error(e); }
    }
    bumpRound();
    GN.hud.hideWin();
    GN.hud.hideTooltip();
    GN.map.resetRotation();
    const def = modes[modeId];
    const newCtx = buildContext(options || {});
    current = { def, ctx: newCtx, id: modeId, startOptions: options };
    def.setup(newCtx);
  }

  function restartCurrent() {
    if (!current) return;
    start(current.id, current.startOptions);
  }

  function stop() {
    if (current && current.def.teardown) {
      try { current.def.teardown(current.ctx); } catch (e) { console.error(e); }
    }
    bumpRound();
    current = null;
  }

  GN.modeShell = {
    registerMode, start, restartCurrent, stop, scheduleTimeout, bumpRound,
    get current() { return current; },
  };
})();
