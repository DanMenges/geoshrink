(function () {
  const GN = window.GN = window.GN || {};
  const KEY = 'geoTrainProgress';
  const SCHEMA_VERSION = 1;

  function defaults() {
    return { schemaVersion: SCHEMA_VERSION, modeState: {} };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== SCHEMA_VERSION) return defaults();
      return Object.assign(defaults(), parsed);
    } catch (e) {
      return defaults();
    }
  }

  let warnedOnce = false;
  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      if (!warnedOnce && GN.hud) {
        warnedOnce = true;
        GN.hud.showToast("Progress won't be saved this session");
      }
      return false;
    }
  }

  function getModeState(modeId) {
    const data = load();
    return data.modeState[modeId] || null;
  }
  function setModeState(modeId, state) {
    const data = load();
    data.modeState[modeId] = state;
    save(data);
  }
  function reset() {
    save(defaults());
  }

  GN.storage = { load, save, getModeState, setModeState, reset, KEY };
})();
