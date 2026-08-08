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
    if (meta && meta.capital) return ctx.data.names[idx] + ' — ' + meta.capital;
    return ctx.data.names[idx];
  }

  function wireWaterToggle(ctx) {
    ctx.hud.setPanel('<button class="hud-btn" id="atlas-water-toggle">Hide rivers & lakes</button>');
    document.getElementById('atlas-water-toggle').addEventListener('click', () => {
      ctx.state.showWater = !ctx.state.showWater;
      GN.map.setWaterVisible(ctx.state.showWater);
      document.getElementById('atlas-water-toggle').textContent = ctx.state.showWater ? 'Hide rivers & lakes' : 'Show rivers & lakes';
    });
  }

  const mode = {
    title: 'World Atlas',
    setup(ctx) {
      ctx.state = { showWater: true };
      GN.map.setWaterVisible(true);
      const all = ctx.data.playableIndices;
      ctx.map.setActiveFeatureIndices(all);

      // Always the same clean continent view, regardless of equipped theme
      // — Atlas is a stable reference view, not a per-theme showcase. The
      // active theme still shows through ambiently (ocean/graticule tint,
      // Dinosaur's watermark illustrations), just not via bespoke per-mode
      // rendering.
      const classMap = {};
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

      ctx.hud.setProgress(1);
      ctx.hud.setStats([]);
      wireWaterToggle(ctx);
    },
    teardown(ctx) {
      ctx.map.setLabels([], null);
      ctx.hud.hideTooltip();
      ctx.hud.setPanel('');
      ctx.hud.setLegend('');
      GN.map.setWaterVisible(false);
    },
    onHover(ctx, idx, event) { ctx.hud.showTooltip(event, tooltipText(idx, ctx)); },
    onMove(ctx, event) { ctx.hud.moveTooltip(event); },
    onLeave(ctx) { ctx.hud.hideTooltip(); },
    onMapClick() {},
  };

  GN.modeShell.registerMode('atlas', mode);
})();
