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
    GN.hud.showToast('Flags are turned off — enable "Show flags" on Home to play Flag Frenzy.');
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
  ])
    .then(([topology, nameToIso3, metaFile]) => {
      const geoms = topology.objects.countries.geometries;
      const features = topojson.feature(topology, topology.objects.countries).features;
      const names = geoms.map(g => g.properties.name);
      const areas = features.map(f => d3.geoArea(f));
      const centroids = features.map(f => d3.geoCentroid(f));
      const neighbors = topojson.neighbors(geoms);
      const playableIndices = names.map((_, i) => i).filter(i => names[i] !== 'Antarctica');

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
        GN.heroGlobe.setLand(topojson.feature(topology, topology.objects.land));
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
