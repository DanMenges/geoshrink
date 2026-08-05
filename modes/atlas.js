(function () {
  const GN = window.GN = window.GN || {};

  // Free-roam world overview: nothing is graded or eliminated here, every
  // playable country gets a continent color and the biggest ones get a
  // persistent name label — drag to rotate, wheel/pinch to zoom, same as
  // every other mode's map, just with no round/score/target attached.
  const CONTINENT_CLASS = { Africa: 'cont-1', Americas: 'cont-2', Asia: 'cont-3', Europe: 'cont-4', Oceania: 'cont-5' };
  const CONTINENT_ORDER = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];
  const LABEL_COUNT = 55; // biggest countries by area always show a name; the rest are one hover away

  function classFor(idx, ctx) {
    const meta = ctx.data.metaByIdx(idx);
    return (meta && CONTINENT_CLASS[meta.continent]) || 'cont-other';
  }

  function tooltipText(idx, ctx) {
    const meta = ctx.data.metaByIdx(idx);
    if (meta && meta.capital) {
      const popTxt = meta.population ? ' (~' + meta.population.toLocaleString() + ')' : '';
      return ctx.data.names[idx] + ' — ' + meta.capital + popTxt;
    }
    return ctx.data.names[idx];
  }

  // Log-scaled 0-1 population level per playable index, for the Population
  // theme's heatmap. Kept local to Atlas rather than reading map.js's
  // per-path --pop (which would mean a getComputedStyle read per country).
  function computePopLevels(ctx, indices) {
    const raw = {};
    indices.forEach((i) => {
      const meta = ctx.data.metaByIdx(i);
      raw[i] = meta && meta.population ? Math.log10(meta.population) : null;
    });
    const valid = Object.values(raw).filter((v) => v != null);
    const min = Math.min(...valid), max = Math.max(...valid);
    const span = (max - min) || 1;
    const levels = {};
    indices.forEach((i) => { levels[i] = raw[i] == null ? 0 : (raw[i] - min) / span; });
    return levels;
  }

  const mode = {
    setup(ctx) {
      ctx.state = {};
      const all = ctx.data.playableIndices;
      ctx.map.setActiveFeatureIndices(all);
      const popMode = GN.progression.getEquippedThemeId() === 'population';

      if (popMode) {
        // The mountain range IS the visualization here — every country
        // fades to a dark canvas so map.js's shaded population peaks
        // (pseudo-3D, tallest where population is densest) read as the
        // subject instead of competing with per-country fill.
        ctx.map.paintClasses({
          'group-a': () => false, 'group-b': () => false, 'guessable': () => false,
          'eliminated': () => false, 'available': () => false,
          'pop-base': () => true,
          'cont-1': () => false, 'cont-2': () => false, 'cont-3': () => false, 'cont-4': () => false, 'cont-5': () => false, 'cont-other': () => false,
        });
        ctx.map.setLabels([], null);
        const levels = computePopLevels(ctx, all);
        ctx.map.setPopulationMountains(all, levels);
        ctx.hud.setTarget('Population heatmap — bigger, brighter glow means more people live there.');
        ctx.hud.setLegend('<span class="pop-legend">Fewer people <span class="pop-scale-bar"></span> More people</span>');
        ctx.hud.setHint('Hover any country for its name, capital, and population.');
      } else {
        ctx.map.setPopulationMountains([], null);
        const classMap = {
          'group-a': () => false, 'group-b': () => false, 'guessable': () => false,
          'eliminated': () => false, 'available': () => false, 'pop-base': () => false,
        };
        Object.values(CONTINENT_CLASS).concat(['cont-other']).forEach((cls) => {
          classMap[cls] = (i) => classFor(i, ctx) === cls;
        });
        ctx.map.paintClasses(classMap);

        const sorted = all.slice().sort((a, b) => ctx.data.areas[b] - ctx.data.areas[a]);
        ctx.map.setLabels(sorted.slice(0, LABEL_COUNT), (i) => ctx.data.names[i]);

        ctx.hud.setTarget('Explore the world — drag to rotate, scroll or pinch to zoom.');
        ctx.hud.setLegend(CONTINENT_ORDER.map((name, i) =>
          '<span><span class="swatch" style="background:var(--cont-' + (i + 1) + ')"></span>' + name + '</span>'
        ).join(''));
        ctx.hud.setHint('Hover any country for its name and capital.');
      }

      ctx.hud.setProgress(1);
      ctx.hud.setStats([]);
      ctx.hud.setPanel('');
    },
    teardown(ctx) {
      ctx.map.setLabels([], null);
      ctx.map.setPopulationMountains([], null);
      ctx.hud.hideTooltip();
      ctx.hud.setPanel('');
      ctx.hud.setLegend('');
    },
    onHover(ctx, idx, event) { ctx.hud.showTooltip(event, tooltipText(idx, ctx)); },
    onMove(ctx, event) { ctx.hud.moveTooltip(event); },
    onLeave(ctx) { ctx.hud.hideTooltip(); },
    onMapClick() {},
  };

  GN.modeShell.registerMode('atlas', mode);
})();
