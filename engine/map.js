(function () {
  const GN = window.GN = window.GN || {};

  let WIDTH = window.innerWidth || 960;
  let HEIGHT = window.innerHeight || 540;
  let PAD = Math.round(Math.min(WIDTH, HEIGHT) * 0.05);

  const svg = d3.select('#map').attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);

  // Theme fill gradients. Stops reference the same --group-a/--group-b
  // custom properties every flat fill uses, so a single pair of defs
  // automatically retargets whenever GN.theme.apply() swaps those
  // variables — no per-theme gradient elements needed.
  const defs = svg.append('defs');
  const gradA = defs.append('linearGradient').attr('id', 'grad-group-a').attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%');
  gradA.append('stop').attr('offset', '0%').attr('style', 'stop-color: var(--group-a)');
  gradA.append('stop').attr('offset', '100%').attr('style', 'stop-color: color-mix(in srgb, var(--group-a) 55%, white)');
  const gradB = defs.append('linearGradient').attr('id', 'grad-group-b').attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%');
  gradB.append('stop').attr('offset', '0%').attr('style', 'stop-color: var(--group-b)');
  gradB.append('stop').attr('offset', '100%').attr('style', 'stop-color: color-mix(in srgb, var(--group-b) 55%, white)');

  const gFrame = svg.append('g');
  const gGraticule = gFrame.append('path').attr('class', 'graticule');
  const gSphere = gFrame.append('path').attr('class', 'sphere-outline');
  const gCountries = svg.append('g').attr('class', 'countries');
  // Nested inside gCountries (not a sibling) so it inherits the same
  // transform gCountries gets during animateToProjection's transition,
  // instead of visually lagging behind for the ~700ms it runs.
  const gHitAssist = gCountries.append('g').attr('class', 'hit-assist');
  // Rivers/lakes overlay -- display-only for now (see setWaterFeatures/
  // setWaterVisible below), the rendering half of a future "Water Wisdom"
  // mode. Hidden by default; Atlas mode turns it on for its own free-roam
  // view and off again on teardown.
  const gWater = svg.append('g').attr('class', 'water-layer hidden');
  const gDino = svg.append('g').attr('class', 'dino-illustrations');
  const gLabels = svg.append('g').attr('class', 'country-labels');
  const graticuleData = d3.geoGraticule10();

  // --- Dinosaur theme: five continent-appropriate species, placed at the
  // real region each is famously associated with (actual fossil sites).
  // Real paleoart silhouettes (PhyloPic, CC0/public domain — see
  // web/dino/CREDITS.md), not hand-drawn shapes: fetched once (cached
  // offline by the service worker like any other asset), normalized to a
  // common size regardless of each source SVG's native scale, then
  // repositioned every redraw via updateDinoPositions(). pointer-events:none
  // throughout, so they never affect click targets.
  const DINO_SPECIES = [
    { id: 'trex', file: 'dino/trex.svg', lon: -106, lat: 46, scale: 0.62 },              // Montana/Alberta badlands
    { id: 'spino', file: 'dino/spinosaurus.svg', lon: 12, lat: 20, scale: 0.62 },         // Sahara (Egypt/Morocco)
    { id: 'raptor', file: 'dino/velociraptor.svg', lon: 103, lat: 44, scale: 0.55 },      // Gobi Desert, Mongolia
    { id: 'iguanodon', file: 'dino/iguanodon.svg', lon: 4, lat: 51, scale: 0.55 },        // Bernissart, Belgium
    { id: 'australovenator', file: 'dino/australovenator.svg', lon: 145, lat: -23, scale: 0.58 }, // Winton, Queensland
  ];
  const DINO_TARGET_W = 150; // normalized silhouette width, before the per-species `scale` above

  const dinoGroups = gDino.selectAll('g.dino-figure')
    .data(DINO_SPECIES, (d) => d.id)
    .join('g')
    .attr('class', (d) => 'dino-figure dino-' + d.id);
  dinoGroups.each(function (d) {
    const g = d3.select(this);
    fetch(d.file).then((r) => r.text()).then((svgText) => {
      const vb = svgText.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      const path = svgText.match(/<path\s+d="([^"]+)"/);
      const innerG = svgText.match(/<g\s+([^>]*)>/s);
      if (!vb || !path) return;
      const vbW = parseFloat(vb[1]), vbH = parseFloat(vb[2]);
      const f = DINO_TARGET_W / vbW;
      const scaledW = vbW * f, scaledH = vbH * f;
      const innerTransform = (innerG && innerG[1].match(/transform="([^"]*)"/) || [])[1] || '';
      // Nesting: outer position (JS, per-redraw) -> walk-cycle wrapper (CSS
      // animation) -> normalize-to-common-size -> the source SVG's own
      // internal transform, unchanged, so its path data still maps correctly.
      const walkWrap = g.append('g').attr('class', 'dino-walk');
      const norm = walkWrap.append('g').attr('transform', `translate(${-scaledW / 2},${-scaledH}) scale(${f})`);
      norm.append('g').attr('transform', innerTransform)
        .append('path').attr('class', 'dino-silhouette').attr('d', path[1]);
    }).catch(() => {});
  });
  function updateDinoPositions() {
    if (!projection) return;
    gDino.selectAll('g.dino-figure').each(function (d) {
      const p = projection([d.lon, d.lat]);
      const el = d3.select(this);
      el.style('display', p ? '' : 'none');
      if (p) this.setAttribute('transform', `translate(${p[0]},${p[1]}) scale(${d.scale || 1})`);
    });
  }

  let projection, pathGen;
  let baseCount = 0; // number of countries (110m tier length), for binding/index range
  let activeFeatureIndices = [];

  // --- resolution tiers ---------------------------------------------------
  // 110m loads eagerly (small, fast first paint); 50m is fetched lazily the
  // first time the active subset is small enough that its extra detail would
  // actually be visible, then cached and reused for the rest of the session.
  // Two independent triggers, either one is enough: a game mode narrowing
  // its own subset down (e.g. Narrow Down's shrinking candidates), OR the
  // player manually zooming in via scroll/pinch/drag-zoom regardless of how
  // many countries the current mode considers "in play" — modes like World
  // Atlas, Fog of War, or Expedition keep the whole ~176-country pool active
  // the entire time, so without this second trigger a player zooming deep
  // into one country there would be stuck looking at 110m's coarse, blocky
  // coastline vertices no matter how far in they zoomed.
  const TIER_ZOOM_THRESHOLD = 20;
  const TIER_MANUAL_ZOOM_THRESHOLD = 2.5;
  const featuresByTier = { '110m': null, '50m': null };
  let activeTier = '110m';
  let highResRequested = false;
  let needHighResCallback = null;

  function setBaseFeatures(features110) {
    featuresByTier['110m'] = features110;
    baseCount = features110.length;
  }
  function setFiftyMFeatures(features50Aligned) {
    featuresByTier['50m'] = features50Aligned;
    if (projection) redrawWithCurrentProjection(); // upgrade in place if already zoomed in
  }
  function onNeedHighRes(cb) { needHighResCallback = cb; }

  function getFeature(idx) {
    const tier = featuresByTier[activeTier] || featuresByTier['110m'];
    return tier && tier[idx];
  }

  function updateActiveTier() {
    const count = activeFeatureIndices.length || baseCount;
    const wantsHighRes = count <= TIER_ZOOM_THRESHOLD || zoomFactor >= TIER_MANUAL_ZOOM_THRESHOLD;
    if (wantsHighRes) {
      if (featuresByTier['50m']) {
        activeTier = '50m';
      } else {
        activeTier = '110m';
        if (!highResRequested) {
          highResRequested = true;
          needHighResCallback && needHighResCallback();
        }
      }
    } else {
      activeTier = '110m';
    }
  }

  // --- rotation + zoom ---------------------------------------------------
  // [lambda, phi] in degrees (which meridian/parallel is centered) and a
  // scale multiplier on top of the natural auto-fit — both persist across
  // rounds/modes so a player who repositions the view to reach a far-off or
  // tiny country doesn't get reset back to default on the next click.
  let rotation = [0, 0];
  let zoomFactor = 1;
  // MAX_ZOOM raised from 12 -> 40: lets a player actually zoom in and see
  // small-but-real-sized countries (Luxembourg, Malta, Singapore, ...) up
  // close. It alone can't make Vatican City-scale enclaves clickable --
  // they're several more orders of magnitude smaller than that helps with
  // -- see updateHitAssist() in this file for the fix that actually covers
  // those.
  const MIN_ZOOM = 0.6, MAX_ZOOM = 40;

  function normalizeRotation(lambda, phi) {
    const wrapped = ((lambda % 360) + 540) % 360 - 180;
    const clampedPhi = Math.max(-75, Math.min(75, phi));
    return [wrapped, clampedPhi];
  }
  function currentSubsetFeatures() {
    const base = featuresByTier['110m'];
    if (!base) return null;
    const idxs = activeFeatureIndices.length ? activeFeatureIndices : base.map((_, i) => i);
    return idxs.map((i) => base[i]);
  }
  function setRotation(lambda, phi) {
    rotation = normalizeRotation(lambda, phi);
    const feats = currentSubsetFeatures();
    if (feats) setProjectionImmediate(buildProjection(feats));
  }
  function getRotation() { return rotation.slice(); }
  function getZoom() { return zoomFactor; }
  function resetRotation() {
    rotation = [0, 0];
    zoomFactor = 1;
    const feats = currentSubsetFeatures();
    if (feats) setProjectionImmediate(buildProjection(feats));
  }

  // Zoom to an absolute factor, keeping the given SCREEN point (viewBox
  // coordinates) fixed in place — the standard "zoom toward cursor/pinch
  // midpoint" behavior. Mutates the live projection directly for a smooth,
  // immediate visual update; buildProjection() picks up the new zoomFactor
  // for any future rebuild (new round, rotation, resize) so it stays in sync.
  function setZoomAtPoint(targetZoom, screenX, screenY) {
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));
    if (newZoom === zoomFactor || !projection) { zoomFactor = newZoom; return; }
    const actualFactor = newZoom / zoomFactor;
    zoomFactor = newZoom;
    const [tx, ty] = projection.translate();
    const newTx = actualFactor * tx + (1 - actualFactor) * screenX;
    const newTy = actualFactor * ty + (1 - actualFactor) * screenY;
    projection.scale(projection.scale() * actualFactor).translate([newTx, newTy]);
    redrawWithCurrentProjection();
  }

  // --- projection -----------------------------------------------------------

  const CHROME_BUFFER = 16;
  const FALLBACK_PAD = 150;

  // buildProjection() runs on every animation frame while dragging/pinching
  // (see setRotation, called from the rAF loop below) — up to ~60x/sec. Both
  // measuring the HUD chrome's real size and the portrait-fill geometry pass
  // below are too expensive to redo that often (getBoundingClientRect forces
  // a synchronous layout flush; the fill pass is a second full geometry scan
  // on top of fitExtent's own). Neither actually needs to be live mid-frame:
  // chrome size only changes on resize/content changes, and freezing the
  // fill amount for the ~16ms of one gesture is visually imperceptible. Both
  // are cached and only recomputed when it's actually safe/cheap to do so.
  let cachedTopPad = null, cachedBottomPad = null;
  function refreshChromePad() {
    const topEl = document.querySelector('.hud-stack');
    const bottomEl = document.querySelector('.hud-bottom');
    if (topEl) {
      const r = topEl.getBoundingClientRect();
      if (r.height > 0) cachedTopPad = Math.max(PAD, Math.min(HEIGHT * 0.6, r.bottom + CHROME_BUFFER));
    }
    if (bottomEl) {
      const r = bottomEl.getBoundingClientRect();
      if (r.height > 0) cachedBottomPad = Math.max(PAD, Math.min(HEIGHT * 0.6, HEIGHT - r.top + CHROME_BUFFER));
    }
  }
  function getChromePad() {
    if (cachedTopPad == null || cachedBottomPad == null) refreshChromePad();
    return {
      topPad: cachedTopPad != null ? cachedTopPad : Math.max(PAD, FALLBACK_PAD),
      bottomPad: cachedBottomPad != null ? cachedBottomPad : Math.max(PAD, FALLBACK_PAD),
    };
  }
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => refreshChromePad());
    const topEl = document.querySelector('.hud-stack');
    const bottomEl = document.querySelector('.hud-bottom');
    if (topEl) ro.observe(topEl);
    if (bottomEl) ro.observe(bottomEl);
  }

  let cachedFillFactor = 1;

  function buildProjection(subsetFeatures) {
    // Reserve extra room top/bottom so small subsets (e.g. a tiny country paired
    // against a huge one) can't render directly underneath the HUD chrome
    // (mission banner up top, legend/actions bar at the bottom).
    const { topPad, bottomPad } = getChromePad();
    const box = { left: PAD, top: topPad, right: WIDTH - PAD, bottom: HEIGHT - bottomPad };
    const featureCollection = { type: 'FeatureCollection', features: subsetFeatures };
    const proj = d3.geoEqualEarth()
      .rotate([rotation[0], rotation[1], 0])
      .fitExtent([[box.left, box.top], [box.right, box.bottom]], featureCollection);
    const cx = WIDTH / 2, cy = (box.top + box.bottom) / 2;

    // A "contain" fit of a ~2:1 world map into a tall, narrow portrait box is
    // width-bound, leaving most of the box's height empty (this is the map
    // looking tiny, stranded in a sea of empty ocean color, on a phone). Once
    // the natural fit is known, measure how much of the box's height it
    // actually used and zoom in just enough to fill more of it — capped, so
    // extreme aspect ratios don't crop away too much of the world by default;
    // rotating the globe still reaches whatever falls outside the viewport.
    // Skipped mid-gesture (see cachedFillFactor above) and refreshed once
    // more, precisely, right after the gesture ends (see endPointer below).
    const interacting = (dragState && dragState.moved) || !!pinchState;
    let fillFactor = cachedFillFactor;
    if (!interacting) {
      const fitBounds = d3.geoPath(proj).bounds(featureCollection);
      const usedH = fitBounds[1][1] - fitBounds[0][1];
      const boxH = box.bottom - box.top;
      fillFactor = (usedH > 0 && usedH < boxH) ? Math.min(boxH / usedH, 1.65) : 1;
      cachedFillFactor = fillFactor;
    }
    if (fillFactor > 1.02) {
      const [tx, ty] = proj.translate();
      proj.scale(proj.scale() * fillFactor)
        .translate([fillFactor * tx + (1 - fillFactor) * cx, fillFactor * ty + (1 - fillFactor) * cy]);
    }

    if (zoomFactor !== 1) {
      const [tx, ty] = proj.translate();
      proj.scale(proj.scale() * zoomFactor)
        .translate([zoomFactor * tx + (1 - zoomFactor) * cx, zoomFactor * ty + (1 - zoomFactor) * cy]);
    }
    return proj;
  }

  // --- water overlay (rivers/lakes) -- Water Wisdom's playing field --------
  let waterRivers = [], waterLakes = [];
  let waterInteractive = false;
  let waterHandlers = null;
  // Class is set only on ENTER (like gCountries' own paths) so a redraw
  // (drag/zoom/pan, which reruns this on every frame) only ever touches the
  // `d` attribute -- otherwise paintWaterClasses' water-a/water-b groups
  // would get wiped the instant the player so much as rotated the globe.
  function redrawWater() {
    if (!pathGen) return;
    gWater.selectAll('path.river')
      .data(waterRivers)
      .join((enter) => enter.append('path').attr('class', 'river'))
      .attr('d', pathGen);

    gWater.selectAll('path.lake')
      .data(waterLakes)
      .join((enter) => enter.append('path').attr('class', 'lake'))
      .attr('d', pathGen)
      .style('pointer-events', waterInteractive ? 'all' : 'none')
      .style('cursor', waterInteractive ? 'pointer' : 'default')
      .on('click', waterInteractive ? function (event, d) {
        waterHandlers && waterHandlers.onWaterClick && waterHandlers.onWaterClick('lake', waterLakes.indexOf(d));
      } : null)
      .on('mouseenter', waterInteractive ? function (event, d) {
        waterHandlers && waterHandlers.onWaterHover && waterHandlers.onWaterHover('lake', waterLakes.indexOf(d), event);
      } : null)
      .on('mouseleave', waterInteractive ? function () {
        waterHandlers && waterHandlers.onWaterLeave && waterHandlers.onWaterLeave();
      } : null);

    // Rivers are thin lines -- a real click almost never lands exactly on a
    // 1px stroke, so a separate invisible, much-wider "hit stroke" (only
    // added to the DOM at all while interactive) does the actual clicking;
    // the thin visible .river path stays purely cosmetic.
    gWater.selectAll('path.river-hit')
      .data(waterInteractive ? waterRivers : [])
      .join((enter) => enter.append('path').attr('class', 'river-hit'))
      .attr('d', pathGen)
      .on('click', function (event, d) {
        waterHandlers && waterHandlers.onWaterClick && waterHandlers.onWaterClick('river', waterRivers.indexOf(d));
      })
      .on('mouseenter', function (event, d) {
        waterHandlers && waterHandlers.onWaterHover && waterHandlers.onWaterHover('river', waterRivers.indexOf(d), event);
      })
      .on('mouseleave', function () {
        waterHandlers && waterHandlers.onWaterLeave && waterHandlers.onWaterLeave();
      });
  }

  // Mirrors paintClasses() for the water layer: a fixed set of managed
  // classes, always fully cleared/reset per call so state never leaks
  // between rounds. `type` scopes the call to just rivers or just lakes
  // (Water Wisdom only ever narrows one at a time) -- the other layer is
  // left as-is, which is why modes/water.js also calls setWaterTypeFilter
  // to hide it entirely rather than leaving it in a stale colored state.
  const WATER_PAINT_CLASSES = ['water-a', 'water-b'];
  function paintWaterClasses(type, classMap) {
    const sel = type === 'river' ? gWater.selectAll('path.river') : gWater.selectAll('path.lake');
    WATER_PAINT_CLASSES.forEach((cls) => {
      const fn = Object.prototype.hasOwnProperty.call(classMap, cls) ? classMap[cls] : () => false;
      sel.classed(cls, (d, i) => fn(i));
    });
  }
  // Water Wisdom is one-type-per-round -- the inactive type (and rivers'
  // click-catching hit-strokes) is fully hidden rather than just dimmed, so
  // it's unambiguous which layer is actually in play.
  function setWaterTypeFilter(type) {
    gWater.classed('rivers-only', type === 'river');
    gWater.classed('lakes-only', type === 'lake');
  }
  function setWaterInteractive(on, handlers) {
    waterInteractive = on;
    waterHandlers = handlers || null;
    redrawWater();
  }
  function setWaterFeatures(rivers, lakes) {
    waterRivers = rivers || [];
    waterLakes = lakes || [];
    redrawWater();
  }
  function setWaterVisible(on) { gWater.classed('hidden', !on); }

  function redrawWithCurrentProjection() {
    pathGen = d3.geoPath(projection);
    updateActiveTier();
    gCountries.selectAll('path.country').attr('d', (_, i) => pathGen(getFeature(i)));
    gGraticule.attr('d', pathGen(graticuleData));
    gSphere.attr('d', pathGen({ type: 'Sphere' }));
    updateDinoPositions();
    renderLabels();
    updateHitAssist();
    redrawWater();
  }

  function setProjectionImmediate(newProjection) {
    projection = newProjection;
    redrawWithCurrentProjection();
  }

  function animateToProjection(newProjection, onDone) {
    const s = newProjection.scale() / projection.scale();
    const [tx0, ty0] = projection.translate();
    const [tx1, ty1] = newProjection.translate();
    const tx = tx1 - s * tx0, ty = ty1 - s * ty0;
    const matrix = `matrix(${s},0,0,${s},${tx},${ty})`;

    let pending = 3;
    const done = () => { if (--pending === 0) { setProjectionImmediate(newProjection); onDone && onDone(); } };

    gCountries.transition().duration(700).ease(d3.easeCubicInOut)
      .attr('transform', matrix)
      .on('end', () => { gCountries.attr('transform', null); done(); });
    gFrame.transition().duration(700).ease(d3.easeCubicInOut)
      .attr('transform', matrix)
      .on('end', () => { gFrame.attr('transform', null); done(); });
    gWater.transition().duration(700).ease(d3.easeCubicInOut)
      .attr('transform', matrix)
      .on('end', () => { gWater.attr('transform', null); done(); });
  }

  // Log-scaled, 0-1 normalized population per country (index-aligned with
  // the 110m tier) — computed once at draw time and stamped onto each path
  // as a --pop custom property, so the Population theme's CSS (and Atlas
  // mode's choropleth view) can read it anywhere without re-deriving it.
  // Countries without metadata fall back to the 0.5 midpoint rather than
  // being left unset, so they still render a reasonable in-between shade.
  function computePopLevels(features110) {
    if (!GN.data || !GN.data.metaByIdx) return null;
    const raw = features110.map((_, i) => {
      const meta = GN.data.metaByIdx(i);
      return meta && meta.population ? Math.log10(meta.population) : null;
    });
    const valid = raw.filter((v) => v != null);
    if (!valid.length) return null;
    const min = Math.min(...valid), max = Math.max(...valid);
    const span = (max - min) || 1;
    return raw.map((v) => (v == null ? 0.5 : (v - min) / span));
  }

  // A handful of countries (Vatican City, San Marino, Monaco, ...) render
  // at a fraction of a screen pixel even at the whole-world view -- smaller
  // than any human can click precisely, at any reasonable zoom level (the
  // *area* ratio between France and Vatican City is on the order of
  // 100,000:1). Rather than chase that with zoom range alone, every feature
  // whose on-screen bounding box is below HIT_ASSIST_MAX_PX gets an
  // invisible, generously-sized circle centered on it that forwards clicks
  // the same way its real path would -- recomputed on every redraw so it
  // tracks rotation/zoom, and it naturally stops applying once a country is
  // zoomed in past the threshold and can be clicked directly.
  const HIT_ASSIST_MAX_PX = 16;
  const HIT_ASSIST_RADIUS = 7;
  let mapHandlers = null;

  function updateHitAssist() {
    if (!pathGen || !mapHandlers) return;
    const tier = featuresByTier[activeTier] || featuresByTier['110m'];
    if (!tier) return;
    const tiny = [];
    for (let i = 0; i < tier.length; i++) {
      const feat = tier[i];
      if (!feat) continue;
      const b = pathGen.bounds(feat);
      const w = b[1][0] - b[0][0], h = b[1][1] - b[0][1];
      if (!isFinite(w) || !isFinite(h)) continue;
      if (w < HIT_ASSIST_MAX_PX && h < HIT_ASSIST_MAX_PX) {
        tiny.push({ i, cx: (b[0][0] + b[1][0]) / 2, cy: (b[0][1] + b[1][1]) / 2 });
      }
    }
    gHitAssist.selectAll('circle.hit-assist-dot')
      .data(tiny, (d) => d.i)
      .join('circle')
      .attr('class', 'hit-assist-dot')
      .attr('data-idx', (d) => d.i)
      .attr('cx', (d) => d.cx)
      .attr('cy', (d) => d.cy)
      .attr('r', HIT_ASSIST_RADIUS)
      .on('mouseenter', function (event) { mapHandlers.onHover && mapHandlers.onHover(+this.getAttribute('data-idx'), event); })
      .on('mousemove', function (event) { mapHandlers.onMove && mapHandlers.onMove(event); })
      .on('mouseleave', function () { mapHandlers.onLeave && mapHandlers.onLeave(); })
      .on('click', function () {
        if (suppressNextClick) { suppressNextClick = false; return; }
        mapHandlers.onClick && mapHandlers.onClick(+this.getAttribute('data-idx'));
      });
  }

  function drawBaseMap(features110, handlers) {
    setBaseFeatures(features110);
    mapHandlers = handlers;
    const popLevels = computePopLevels(features110);
    gCountries.selectAll('path.country')
      .data(features110, (_, i) => i)
      .join('path')
      .attr('class', 'country')
      .attr('d', (_, i) => pathGen(getFeature(i)))
      .attr('data-idx', (_, i) => i)
      .style('--pop', (_, i) => (popLevels ? popLevels[i] : 0.5))
      .on('mouseenter', function (event) { handlers.onHover && handlers.onHover(+this.getAttribute('data-idx'), event); })
      .on('mousemove', function (event) { handlers.onMove && handlers.onMove(event); })
      .on('mouseleave', function () { handlers.onLeave && handlers.onLeave(); })
      .on('click', function () {
        if (suppressNextClick) { suppressNextClick = false; return; }
        handlers.onClick && handlers.onClick(+this.getAttribute('data-idx'));
      });
    updateHitAssist();
  }

  // Every class any mode ever paints onto a country. A call to paintClasses()
  // only ever mentions the handful of classes ITS mode cares about — without
  // this, switching modes (e.g. Narrow Down -> Flag Frenzy) left whatever
  // classes the previous mode set (group-a/group-b/guessable/cont-N/...)
  // stuck on countries the new mode never touches, which could visually win
  // out over the new mode's own classes depending on CSS cascade order (a
  // real bug: countries showing up blue/orange/violet in modes that never
  // asked for that color). paintClasses() below always clears every class in
  // this list that the current call doesn't explicitly set, so each call is
  // a complete, exclusive description of the map's state, not an overlay.
  const PAINT_CLASSES = [
    'group-a', 'group-b', 'guessable', 'eliminated', 'available',
    'cont-1', 'cont-2', 'cont-3', 'cont-4', 'cont-5', 'cont-other',
    'fog-known', 'fog-frontier', 'exp-done',
  ];
  function paintClasses(classMap) {
    const sel = gCountries.selectAll('path.country');
    PAINT_CLASSES.forEach((cls) => {
      const fn = Object.prototype.hasOwnProperty.call(classMap, cls) ? classMap[cls] : () => false;
      sel.classed(cls, (_, i) => fn(i));
    });
  }

  function clearFlashClasses() {
    gCountries.selectAll('path.country').classed('flash-good', false).classed('flash-bad', false);
  }

  function flashCountries(indices, cls) {
    const idxSet = new Set(indices);
    return gCountries.selectAll('path.country').filter((_, i) => idxSet.has(i)).classed(cls, true);
  }

  function setActiveFeatureIndices(indices) { activeFeatureIndices = indices; }

  // --- persistent name labels (used by the free-roam Atlas mode) -----------
  // Opt-in per mode (empty by default so every other mode pays nothing here);
  // positions are recomputed alongside paths on every redraw so they track
  // rotation/zoom/resize like everything else.
  let labelIndices = [];
  let labelTextFn = null;
  function setLabels(indices, textFn) {
    labelIndices = indices || [];
    labelTextFn = textFn || null;
    renderLabels();
  }
  function renderLabels() {
    if (!labelIndices.length || !pathGen) { gLabels.selectAll('text').remove(); return; }
    const items = labelIndices.map((i) => {
      const feature = getFeature(i);
      const c = feature && pathGen.centroid(feature);
      const valid = !!(c && isFinite(c[0]) && isFinite(c[1]));
      return { i, x: valid ? c[0] : null, y: valid ? c[1] : null, text: labelTextFn ? labelTextFn(i) : '', valid };
    });
    // labelIndices arrives priority-ordered (caller sorts biggest-first);
    // greedily drop a label if its approximate box collides with one already
    // kept, so crowded regions (the Balkans, Central America) don't render
    // as unreadable overlapping text. A cheap char-count width estimate
    // avoids a getBBox() layout read per label on every animation frame.
    const CHAR_W = 5.6, HEIGHT = 11, MARGIN = 2;
    const placed = [];
    items.forEach((d) => {
      if (!d.valid) { d.show = false; return; }
      const w = d.text.length * CHAR_W;
      const box = { x0: d.x - w / 2 - MARGIN, x1: d.x + w / 2 + MARGIN, y0: d.y - HEIGHT / 2 - MARGIN, y1: d.y + HEIGHT / 2 + MARGIN };
      const collides = placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
      d.show = !collides;
      if (d.show) placed.push(box);
    });
    gLabels.selectAll('text.country-label')
      .data(items, (d) => d.i)
      .join('text')
      .attr('class', 'country-label')
      .text((d) => d.text)
      .each(function (d) {
        this.style.display = d.show ? '' : 'none';
        if (d.valid) { this.setAttribute('x', d.x); this.setAttribute('y', d.y); }
      });
  }

  let resizeTimer;
  function scheduleResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(handleResize, 150); }
  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);

  function handleResize() {
    WIDTH = window.innerWidth || WIDTH;
    HEIGHT = window.innerHeight || HEIGHT;
    PAD = Math.round(Math.min(WIDTH, HEIGHT) * 0.05);
    svg.attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
    refreshChromePad();
    const feats = currentSubsetFeatures();
    if (feats) setProjectionImmediate(buildProjection(feats));
  }

  // --- pointer gestures: drag-to-rotate, wheel-zoom, pinch-to-zoom ----------
  // One finger/mouse drag rotates the globe; two fingers pinch to zoom; the
  // scroll wheel (or trackpad pinch, which browsers report as wheel+ctrlKey)
  // zooms toward the cursor. A small movement threshold distinguishes a
  // rotate-drag from a tap/click, and updates are coalesced to one per
  // animation frame to stay smooth even with the full 241-feature 50m tier.
  const DRAG_CLICK_THRESHOLD = 8; // px — generous enough to tolerate ordinary click/tap jitter
  const DRAG_SENSITIVITY = 0.28; // degrees per px
  let suppressNextClick = false;
  let dragState = null;
  let pinchState = null;
  const activePointers = new Map(); // pointerId -> {x, y}, viewBox coords

  let rafPending = false;
  let pendingRotation = null;
  function scheduleRotationUpdate(lambda, phi) {
    pendingRotation = [lambda, phi];
    scheduleFrame();
  }
  let pendingZoom = null;
  function scheduleZoomUpdate(targetZoom, x, y) {
    pendingZoom = [targetZoom, x, y];
    scheduleFrame();
  }
  function scheduleFrame() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (pendingRotation) { setRotation(pendingRotation[0], pendingRotation[1]); pendingRotation = null; }
      if (pendingZoom) { setZoomAtPoint(pendingZoom[0], pendingZoom[1], pendingZoom[2]); pendingZoom = null; }
    });
  }

  const svgEl = svg.node();
  svgEl.style.touchAction = 'none'; // this element handles its own rotate/zoom gestures

  function toViewBoxPoint(clientX, clientY) {
    const rect = svgEl.getBoundingClientRect();
    return [(clientX - rect.left) * (WIDTH / rect.width), (clientY - rect.top) * (HEIGHT / rect.height)];
  }
  function pointerDistance() {
    const pts = [...activePointers.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
  function pointerMidpoint() {
    const pts = [...activePointers.values()];
    return [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2];
  }

  svgEl.addEventListener('pointerdown', (event) => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 1) {
      dragState = { startX: event.clientX, startY: event.clientY, startRotation: rotation.slice(), moved: false, pointerId: event.pointerId };
      // Deliberately NOT capturing the pointer here. Capturing on every plain
      // click (before we know it's a drag) redirects the browser's click
      // targeting to this element instead of the country path underneath,
      // silently breaking every click. Capture only once a drag is confirmed.
    } else if (activePointers.size === 2) {
      dragState = null; // a second finger means "pinch," not "rotate" — abandon any single-drag
      try { svgEl.setPointerCapture(event.pointerId); } catch (e) { /* non-fatal; pinch tracking still works via activePointers */ }
      pinchState = { startDist: pointerDistance(), startZoom: zoomFactor };
    }
  });
  svgEl.addEventListener('pointermove', (event) => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size >= 2 && pinchState) {
      const dist = pointerDistance();
      const [mx, my] = pointerMidpoint();
      const [vx, vy] = toViewBoxPoint(mx, my);
      const target = pinchState.startZoom * (dist / Math.max(1, pinchState.startDist));
      scheduleZoomUpdate(target, vx, vy);
      return;
    }
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) > DRAG_CLICK_THRESHOLD) {
      dragState.moved = true;
      try { svgEl.setPointerCapture(event.pointerId); } catch (e) { /* non-fatal; drag tracking still works via dragState */ }
    }
    if (dragState.moved) {
      scheduleRotationUpdate(
        dragState.startRotation[0] + dx * DRAG_SENSITIVITY,
        dragState.startRotation[1] - dy * DRAG_SENSITIVITY
      );
    }
  });
  function endPointer(event) {
    activePointers.delete(event.pointerId);
    const wasPinching = !!pinchState;
    if (activePointers.size < 2) pinchState = null;
    let wasDragging = false;
    if (dragState && event.pointerId === dragState.pointerId) {
      if (dragState.moved) {
        wasDragging = true;
        suppressNextClick = true;
        // Self-clearing: on some browsers/input types a drag-release doesn't
        // synthesize a 'click' at all, which would otherwise leave this flag
        // stuck true forever and silently swallow the *next* unrelated click.
        setTimeout(() => { suppressNextClick = false; }, 350);
      }
      dragState = null;
    }
    if (wasDragging || wasPinching) {
      // One precise, non-cached frame now that the gesture has actually
      // ended (dragState/pinchState are cleared above), so the resting view
      // gets an accurate portrait-fill amount rather than whatever was
      // frozen for the last in-flight drag frame.
      const feats = currentSubsetFeatures();
      if (feats) setProjectionImmediate(buildProjection(feats));
    }
  }
  svgEl.addEventListener('pointerup', endPointer);
  svgEl.addEventListener('pointercancel', endPointer);

  svgEl.addEventListener('wheel', (event) => {
    event.preventDefault();
    const [vx, vy] = toViewBoxPoint(event.clientX, event.clientY);
    const dy = Math.max(-100, Math.min(100, event.deltaY));
    const factor = Math.exp(-dy * 0.0018);
    scheduleZoomUpdate(zoomFactor * factor, vx, vy);
  }, { passive: false });

  GN.map = {
    svg, gCountries,
    buildProjection, setProjectionImmediate, animateToProjection,
    drawBaseMap, paintClasses, clearFlashClasses, flashCountries,
    setActiveFeatureIndices, setFiftyMFeatures, onNeedHighRes, setBaseFeatures,
    setRotation, getRotation, getZoom, resetRotation,
    setLabels, setWaterFeatures, setWaterVisible, setWaterInteractive,
    paintWaterClasses, setWaterTypeFilter,
    getWaterRivers: () => waterRivers, getWaterLakes: () => waterLakes,
    get projection() { return projection; },
    get pathGen() { return pathGen; },
    get activeTier() { return activeTier; },
  };
})();
