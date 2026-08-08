(function () {
  const GN = window.GN = window.GN || {};

  GN.theme.apply();

  // Show the Home screen (and start the hero globe spinning) immediately —
  // it only needs GN.storage/GN.progression, not the map data, so there's no
  // reason to make players stare at a blank page while ~370KB loads. A
  // #hash direct-link still bypasses Home once data is ready, below.
  let directModeAtLoad = (location.hash || '').replace('#', '');
  if (directModeAtLoad === 'flags' && !GN.progression.getShowFlags()) {
    // A #flags direct link (old bookmark, saved home-screen shortcut, browser
    // history) bypasses GN.home.enterMode()'s showFlags guard entirely, since
    // it calls GN.modeShell.start() straight away below — enforce the same
    // rule here instead of silently honoring the link.
    directModeAtLoad = '';
    history.replaceState(null, '', location.pathname + location.search);
    GN.hud.showToast('Flags are turned off — enable "Show flags" on Home to play Raise the Flag.');
  } else if (directModeAtLoad && !GN.modeShell.hasMode(directModeAtLoad)) {
    // A link to a mode that's been removed since (e.g. an old #compass
    // bookmark) would otherwise throw inside modeShell.start() below —
    // fail gracefully back to Home instead.
    directModeAtLoad = '';
    history.replaceState(null, '', location.pathname + location.search);
    GN.hud.showToast("That game mode isn't available anymore.");
  }
  if (!directModeAtLoad) GN.home.show();

  Promise.all([
    fetch('data/countries-110m.json').then(r => r.json()),
    fetch('data/name-to-iso3.json').then(r => r.json()).catch(() => ({})),
    fetch('data/country-meta.json').then(r => r.json()).catch(() => ({ countries: {} })),
    fetch('data/countries-extra.json').then(r => r.json()).catch(() => ({ features: [] })),
  ])
    .then(([topology, nameToIso3, metaFile, extra]) => {
      const geoms = topology.objects.countries.geometries;
      const baseFeatures = topojson.feature(topology, topology.objects.countries).features;
      const baseNames = geoms.map(g => g.properties.name);

      // Natural Earth's 110m admin-0 set drops a couple dozen genuinely small
      // sovereign countries entirely (Vatican, San Marino, Monaco, Singapore,
      // Malta, Nauru, ...) -- too small to matter at world-map scale, but
      // real countries a "guess the country" game shouldn't be missing.
      // data/countries-extra.json is a small plain-GeoJSON supplement (not
      // topojson -- decoded once from countries-50m.json's arcs, which does
      // have them) appended after the base roster so every existing
      // index-based array below just extends naturally, no special-casing.
      const extraFeatures = extra.features || [];
      const extraNames = extraFeatures.map(f => f.properties.name);

      const features = baseFeatures.concat(extraFeatures);
      const names = baseNames.concat(extraNames);
      const areas = features.map(f => d3.geoArea(f));
      const centroids = features.map(f => d3.geoCentroid(f));
      const playableIndices = names.map((_, i) => i).filter(i => names[i] !== 'Antarctica');

      // topojson.neighbors() only understands real shared-arc topology, which
      // the plain-GeoJSON extras don't participate in -- they start with no
      // detected neighbors, then this short hardcoded list patches in the
      // handful that actually share a land border with an existing country
      // (everything else added here is an island with none).
      const neighbors = topojson.neighbors(geoms).concat(extraFeatures.map(() => []));
      const EXTRA_LAND_BORDERS = [
        ['Vatican City', 'Italy'], ['San Marino', 'Italy'],
        ['Monaco', 'France'],
        ['Andorra', 'France'], ['Andorra', 'Spain'],
        ['Liechtenstein', 'Switzerland'], ['Liechtenstein', 'Austria'],
      ];
      const idxByName = new Map(names.map((n, i) => [n, i]));
      EXTRA_LAND_BORDERS.forEach(([a, b]) => {
        const ia = idxByName.get(a), ib = idxByName.get(b);
        if (ia == null || ib == null) return;
        if (!neighbors[ia].includes(ib)) neighbors[ia].push(ib);
        if (!neighbors[ib].includes(ia)) neighbors[ib].push(ia);
      });

      const countries = metaFile.countries || {};
      const iso3ByIdx = names.map((n) => nameToIso3[n] || null);
      const metaByIdx = (idx) => {
        const iso3 = iso3ByIdx[idx];
        return iso3 ? countries[iso3] || null : null;
      };
      // indices that have full metadata (capital/population/orgs) — the pool
      // for modes that depend on it (Flag Frenzy, Capital Match, Bloc Bingo).
      const metaIndices = playableIndices.filter((i) => metaByIdx(i) && iso3ByIdx[i]);

      GN.data = {
        geoms, features, names, areas, centroids, neighbors, playableIndices,
        iso3ByIdx, meta: countries, metaByIdx, metaIndices,
      };
      GN.map.setBaseFeatures(features); // must happen before the first setProjectionImmediate

      if (topology.objects.land) {
        const landFeature = topojson.feature(topology, topology.objects.land);
        GN.heroGlobe.setLand(landFeature);
        if (GN.repairGlobe) GN.repairGlobe.setLand(landFeature);
        if (GN.mascot) GN.mascot.setLand(landFeature);
      }

      GN.map.onNeedHighRes(() => {
        fetch('data/countries-50m.json')
          .then(r => r.json())
          .then(topo50 => {
            const feats50 = topojson.feature(topo50, topo50.objects.countries).features;
            const byName = new Map(feats50.map(f => [f.properties.name, f]));
            const aligned = names.map((n, i) => byName.get(n) || features[i]);
            GN.map.setFiftyMFeatures(aligned);
          })
          .catch(() => {}); // silently keep the 110m tier if the fetch fails
      });

      const worldProjection = GN.map.buildProjection(playableIndices.map(i => features[i]));
      GN.map.setProjectionImmediate(worldProjection);

      GN.map.drawBaseMap(features, {
        onClick(idx) {
          const cur = GN.modeShell.current;
          if (cur && cur.def.onMapClick) cur.def.onMapClick(cur.ctx, idx);
        },
        onHover(idx, event) {
          const cur = GN.modeShell.current;
          if (cur && cur.def.onHover) cur.def.onHover(cur.ctx, idx, event);
        },
        onMove(event) {
          const cur = GN.modeShell.current;
          if (cur && cur.def.onMove) cur.def.onMove(cur.ctx, event);
        },
        onLeave() {
          const cur = GN.modeShell.current;
          if (cur && cur.def.onLeave) cur.def.onLeave(cur.ctx);
        },
      });

      // Rivers/lakes overlay -- fetched separately and lazily since it's not
      // needed for any critical-path rendering yet (display-only spike, see
      // engine/map.js's setWaterFeatures; modes/atlas.js is the only mode
      // that turns it on right now).
      Promise.all([
        fetch('data/rivers.json').then(r => r.json()).catch(() => ({ features: [] })),
        fetch('data/lakes.json').then(r => r.json()).catch(() => ({ features: [] })),
      ]).then(([riversFC, lakesFC]) => {
        GN.map.setWaterFeatures(riversFC.features || [], lakesFC.features || []);
      });

      // A #hash still jumps straight into a mode (handy for direct links/testing);
      // Home is already showing otherwise (see top of this file).
      if (directModeAtLoad) {
        GN.home.hide();
        GN.modeShell.start(directModeAtLoad, { data: GN.data });
      }
    })
    .catch(err => {
      GN.hud.setTarget('Failed to load map data: ' + err.message);
    });

  document.getElementById('newgame').addEventListener('click', () => {
    if (!GN.data) return;
    GN.modeShell.restartCurrent();
    GN.hud.showToast('New game started');
  });
  document.getElementById('win-newgame').addEventListener('click', () => {
    if (!GN.data) return;
    GN.modeShell.restartCurrent();
  });
  document.getElementById('home-btn').addEventListener('click', () => {
    if (!GN.data) return;
    GN.modeShell.stop();
    GN.home.show();
  });

  document.getElementById('reset-view-btn').addEventListener('click', () => {
    GN.map.resetRotation();
  });

  const fullscreenBtn = document.getElementById('fullscreen-btn');
  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const active = !!document.fullscreenElement;
    fullscreenBtn.classList.toggle('active', active);
    fullscreenBtn.title = active ? 'Exit fullscreen' : 'Fullscreen (wall / projector display)';
  });

  if ('serviceWorker' in navigator) {
    // Auto-reload once when a newer service worker takes control. Without
    // this, an already-open tab keeps running the JS/HTML it loaded with
    // even after a new SW has installed and activated in the background —
    // the classic "why isn't my update showing" trap (this app's own
    // history includes several rounds of exactly that). One programmatic
    // reload, guarded so it can only ever fire once per page load, fixes it
    // for good instead of relying on the player finding DevTools.
    let swRefreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swRefreshed) return;
      swRefreshed = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
