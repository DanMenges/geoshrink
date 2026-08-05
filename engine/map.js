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
  // Vertical light-to-dark gradient for the Dinosaur theme's body-mass
  // stroke (objectBoundingBox coordinates, so it auto-adapts top-to-bottom
  // per creature without per-species tuning) — a rounded-torso illusion.
  const dinoBodyGrad = defs.append('linearGradient').attr('id', 'dino-body-grad').attr('x1', '0%').attr('y1', '0%').attr('x2', '0%').attr('y2', '100%');
  dinoBodyGrad.append('stop').attr('offset', '0%').attr('stop-color', '#6b4a2c');
  dinoBodyGrad.append('stop').attr('offset', '100%').attr('stop-color', '#1c130a');

  const gFrame = svg.append('g');
  const gGraticule = gFrame.append('path').attr('class', 'graticule');
  const gSphere = gFrame.append('path').attr('class', 'sphere-outline');
  const gCountries = svg.append('g').attr('class', 'countries');
  const gDino = svg.append('g').attr('class', 'dino-illustrations');
  const gLabels = svg.append('g').attr('class', 'country-labels');
  const graticuleData = d3.geoGraticule10();

  // --- Dinosaur theme: five continent-appropriate species, placed at the
  // real region each is famously associated with (fossil sites, not a
  // vague "somewhere on the continent" guess). Multiply-blended low-opacity
  // watermark with pointer-events:none, so it never affects click targets.
  // Shapes are simple flat silhouettes built from a handful of primitives —
  // built once here, repositioned every redraw via updateDinoPositions().
  const DINO_SPECIES = [
    { id: 'trex', label: 'T. rex', lon: -106, lat: 46, scale: 1.4 },              // Montana/Alberta badlands
    { id: 'spino', label: 'Spinosaurus', lon: 12, lat: 20, scale: 1.4 },          // Sahara (Egypt/Morocco)
    { id: 'raptor', label: 'Velociraptor', lon: 103, lat: 44, scale: 1.15 },      // Gobi Desert, Mongolia
    { id: 'iguanodon', label: 'Iguanodon', lon: 4, lat: 51, scale: 1.25 },        // Bernissart, Belgium
    { id: 'muttaburrasaurus', label: 'Muttaburrasaurus', lon: 145, lat: -23, scale: 1.25 }, // Muttaburra, Queensland
  ];
  // Skeleton/fossil style — a curved spine + angular skull reads as
  // unmistakably "dinosaur" from just a few strokes, is far more forgiving
  // to hand-draw recognizably than a solid anatomical silhouette, and fits
  // the fossil-hunt theme better than a flat blob would. `cls: 'dino-bone'`
  // shapes are thick rounded strokes (spine/legs), 'dino-thin' are fine
  // stroke details (teeth/claw/spikes/sail), 'dino-eye' a small filled dot,
  // 'dino-skull' the one filled mass per creature. 'dino-body' is a soft
  // gradient-shaded wide stroke traced along the SAME spine curve — a cheap
  // way to suggest a rounded 3D torso without risking the shapeless-blob
  // problem a separate filled silhouette caused earlier (see git history).
  // 'dino-leg1'/'dino-leg2' additionally mark the two legs so CSS can swing
  // them in a walk cycle for a bit of life/motion.
  const DINO_SHAPES = {
    trex: [
      { tag: 'path', cls: 'dino-body', d: 'M -115,20 Q -55,-20 -15,-12 Q 12,-6 22,-30 Q 32,-44 55,-48' },
      { tag: 'path', cls: 'dino-bone', d: 'M -115,20 Q -55,-20 -15,-12 Q 12,-6 22,-30 Q 32,-44 55,-48' },
      { tag: 'path', cls: 'dino-skull', d: 'M 55,-52 L 100,-36 L 60,-22 Z' },
      { tag: 'circle', cls: 'dino-eye', cx: 68, cy: -40, r: 4 },
      { tag: 'path', cls: 'dino-thin', d: 'M 62,-25 L 66,-20 L 70,-25 L 74,-20 L 78,-25 L 82,-20 L 86,-25' },
      { tag: 'path', cls: 'dino-thin', d: 'M 26,-30 L 40,-22' },
      { tag: 'path', cls: 'dino-bone dino-leg1', d: 'M -70,-2 L -80,46' },
      { tag: 'path', cls: 'dino-bone dino-leg2', d: 'M -45,-8 L -50,46' },
    ],
    spino: [
      { tag: 'path', cls: 'dino-body', d: 'M -118,22 Q -60,-14 -20,-10 Q 5,-6 20,-20 Q 40,-34 78,-30' },
      { tag: 'path', cls: 'dino-bone', d: 'M -118,22 Q -60,-14 -20,-10 Q 5,-6 20,-20 Q 40,-34 78,-30' },
      { tag: 'path', cls: 'dino-skull', d: 'M 78,-34 L 128,-24 L 82,-14 Z' },
      { tag: 'circle', cls: 'dino-eye', cx: 90, cy: -26, r: 3.5 },
      { tag: 'path', cls: 'dino-thin', d: 'M -30,-8 L -28,-45' },
      { tag: 'path', cls: 'dino-thin', d: 'M -15,-10 L -12,-58' },
      { tag: 'path', cls: 'dino-thin', d: 'M 0,-10 L 4,-65' },
      { tag: 'path', cls: 'dino-thin', d: 'M 15,-16 L 20,-58' },
      { tag: 'path', cls: 'dino-bone dino-leg1', d: 'M -60,0 L -66,46' },
      { tag: 'path', cls: 'dino-bone dino-leg2', d: 'M -25,-4 L -20,46' },
    ],
    raptor: [
      { tag: 'path', cls: 'dino-body', d: 'M -95,15 Q -50,-14 -18,-8 Q 0,-4 8,-20 Q 16,-30 36,-32' },
      { tag: 'path', cls: 'dino-bone', d: 'M -95,15 Q -50,-14 -18,-8 Q 0,-4 8,-20 Q 16,-30 36,-32' },
      { tag: 'path', cls: 'dino-skull', d: 'M 36,-34 L 62,-26 L 38,-18 Z' },
      { tag: 'circle', cls: 'dino-eye', cx: 44, cy: -27, r: 2.6 },
      { tag: 'path', cls: 'dino-thin', d: 'M 40,-22 L 43,-18 L 46,-22 L 49,-18 L 52,-22' },
      { tag: 'path', cls: 'dino-bone dino-leg1', d: 'M -30,-4 L -34,32' },
      { tag: 'path', cls: 'dino-bone dino-leg2', d: 'M -10,-8 L -6,10 L -16,18' },
      { tag: 'path', cls: 'dino-thin', d: 'M -16,18 Q -24,22 -18,28' },
    ],
    iguanodon: [
      { tag: 'path', cls: 'dino-body', d: 'M -105,20 Q -50,-18 -10,-14 Q 15,-10 26,-26 Q 36,-38 62,-38' },
      { tag: 'path', cls: 'dino-bone', d: 'M -105,20 Q -50,-18 -10,-14 Q 15,-10 26,-26 Q 36,-38 62,-38' },
      { tag: 'path', cls: 'dino-skull', d: 'M 62,-40 L 100,-30 L 66,-20 Z' },
      { tag: 'circle', cls: 'dino-eye', cx: 75, cy: -30, r: 3.5 },
      { tag: 'path', cls: 'dino-thin', d: 'M 20,-8 L 26,-22' },
      { tag: 'path', cls: 'dino-bone dino-leg1', d: 'M -55,-4 L -60,44' },
      { tag: 'path', cls: 'dino-bone dino-leg2', d: 'M -20,-8 L -18,44' },
    ],
    muttaburrasaurus: [
      { tag: 'path', cls: 'dino-body', d: 'M -100,20 Q -48,-16 -8,-12 Q 14,-8 24,-24 Q 34,-36 58,-36' },
      { tag: 'path', cls: 'dino-bone', d: 'M -100,20 Q -48,-16 -8,-12 Q 14,-8 24,-24 Q 34,-36 58,-36' },
      { tag: 'path', cls: 'dino-skull', d: 'M 58,-38 L 92,-28 L 62,-18 Z' },
      { tag: 'circle', cls: 'dino-skull', cx: 68, cy: -42, r: 7 },
      { tag: 'circle', cls: 'dino-eye', cx: 70, cy: -28, r: 3.5 },
      { tag: 'path', cls: 'dino-bone dino-leg1', d: 'M -50,-2 L -55,42' },
      { tag: 'path', cls: 'dino-bone dino-leg2', d: 'M -18,-6 L -16,42' },
    ],
  };
  gDino.selectAll('g.dino-figure')
    .data(DINO_SPECIES, (d) => d.id)
    .join('g')
    .attr('class', (d) => 'dino-figure dino-' + d.id)
    .each(function (d) {
      const g = d3.select(this);
      (DINO_SHAPES[d.id] || []).forEach((shape) => {
        let el;
        if (shape.tag === 'ellipse') {
          el = g.append('ellipse').attr('cx', shape.cx).attr('cy', shape.cy).attr('rx', shape.rx).attr('ry', shape.ry);
          if (shape.rotate) el.attr('transform', `rotate(${shape.rotate} ${shape.cx} ${shape.cy})`);
        } else if (shape.tag === 'circle') {
          el = g.append('circle').attr('cx', shape.cx).attr('cy', shape.cy).attr('r', shape.r);
        } else {
          el = g.append('path').attr('d', shape.d);
        }
        if (shape.cls) el.attr('class', shape.cls);
      });
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
  const TIER_ZOOM_THRESHOLD = 20;
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
    if (count <= TIER_ZOOM_THRESHOLD) {
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
  const MIN_ZOOM = 0.6, MAX_ZOOM = 12;

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

  function buildProjection(subsetFeatures) {
    // Reserve extra room top/bottom so small subsets (e.g. a tiny country paired
    // against a huge one) can't render directly underneath the fixed HUD chrome
    // (mission banner up top, legend/actions bar at the bottom).
    const topPad = Math.max(PAD, 150);
    const bottomPad = Math.max(PAD, 150);
    const proj = d3.geoEqualEarth()
      .rotate([rotation[0], rotation[1], 0])
      .fitExtent(
        [[PAD, topPad], [WIDTH - PAD, HEIGHT - bottomPad]],
        { type: 'FeatureCollection', features: subsetFeatures }
      );
    if (zoomFactor !== 1) {
      const cx = WIDTH / 2, cy = (topPad + (HEIGHT - bottomPad)) / 2;
      const [tx, ty] = proj.translate();
      proj.scale(proj.scale() * zoomFactor)
        .translate([zoomFactor * tx + (1 - zoomFactor) * cx, zoomFactor * ty + (1 - zoomFactor) * cy]);
    }
    return proj;
  }

  function redrawWithCurrentProjection() {
    pathGen = d3.geoPath(projection);
    updateActiveTier();
    gCountries.selectAll('path.country').attr('d', (_, i) => pathGen(getFeature(i)));
    gGraticule.attr('d', pathGen(graticuleData));
    gSphere.attr('d', pathGen({ type: 'Sphere' }));
    updateDinoPositions();
    renderLabels();
    renderPopulationMountains();
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

    let pending = 2;
    const done = () => { if (--pending === 0) { setProjectionImmediate(newProjection); onDone && onDone(); } };

    gCountries.transition().duration(700).ease(d3.easeCubicInOut)
      .attr('transform', matrix)
      .on('end', () => { gCountries.attr('transform', null); done(); });
    gFrame.transition().duration(700).ease(d3.easeCubicInOut)
      .attr('transform', matrix)
      .on('end', () => { gFrame.attr('transform', null); done(); });
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

  function drawBaseMap(features110, handlers) {
    setBaseFeatures(features110);
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
  }

  function paintClasses(classMap) {
    const sel = gCountries.selectAll('path.country');
    for (const cls in classMap) {
      sel.classed(cls, (_, i) => classMap[cls](i));
    }
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

  // --- population terrain (World Atlas, Population theme only) -------------
  // A real continuous height field: every country contributes a 2D Gaussian
  // centered on its projected centroid (its "mean"), weighted and widened
  // by population, summed across a grid — actual kernel-density-style
  // terrain, not discrete per-country shapes. Rendered to a coarse offscreen
  // canvas, then hillshaded (a simulated light source against the local
  // surface slope, standard Lambertian terrain-relief shading) and scaled
  // up with smoothing onto the visible canvas for a soft, continuous 3D
  // relief look. A separate CSS-animated sheen overlay (map.js never
  // touches it) adds a slow light sweep without needing to recompute
  // anything.
  const terrainCanvas = document.getElementById('pop-terrain-canvas');
  const terrainSheen = document.getElementById('pop-terrain-sheen');
  const GRID_W = 160, GRID_H = 90;
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = GRID_W;
  gridCanvas.height = GRID_H;
  const gridCtx = gridCanvas.getContext('2d');
  const TERRAIN_LUT = (() => {
    const stops = [[74, 96, 138], [255, 209, 102], [255, 140, 66], [230, 57, 70]];
    const lut = new Array(256);
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * (stops.length - 1);
      const idx = Math.min(stops.length - 2, Math.floor(t));
      const localT = t - idx;
      const a = stops[idx], b = stops[idx + 1];
      lut[i] = [a[0] + (b[0] - a[0]) * localT, a[1] + (b[1] - a[1]) * localT, a[2] + (b[2] - a[2]) * localT];
    }
    return lut;
  })();

  let terrainIndices = [];
  let terrainLevels = null;
  let terrainActive = false;
  function setPopulationMountains(indices, levels) {
    terrainIndices = indices || [];
    terrainLevels = levels || null;
    terrainActive = terrainIndices.length > 0;
    terrainCanvas.classList.toggle('show', terrainActive);
    terrainSheen.classList.toggle('show', terrainActive);
    if (!terrainActive) {
      const octx = terrainCanvas.getContext('2d');
      octx.clearRect(0, 0, terrainCanvas.width, terrainCanvas.height);
      return;
    }
    renderPopulationMountains();
  }
  function renderPopulationMountains() {
    if (!terrainActive || !pathGen) return;
    const pts = [];
    terrainIndices.forEach((i) => {
      const feature = getFeature(i);
      const c = feature && pathGen.centroid(feature);
      if (!c || !isFinite(c[0]) || !isFinite(c[1])) return;
      const level = terrainLevels && terrainLevels[i] != null ? terrainLevels[i] : 0;
      pts.push({ x: c[0], y: c[1], level: Math.max(0, Math.min(1, level)) });
    });
    if (!pts.length) return;

    const sx = GRID_W / WIDTH, sy = GRID_H / HEIGHT;
    const SIGMA_MIN = 2.2, SIGMA_MAX = 6.5; // grid cells — country's "spread", not a fixed dot size
    const height = new Float32Array(GRID_W * GRID_H);
    // MAX-blend, not sum: summing ~170 overlapping Gaussians makes any
    // crowded region (Europe, the Sahel) saturate into one undifferentiated
    // blob, since density there comes from many *neighbors* overlapping,
    // not from any single country's population. Taking the max keeps each
    // country's own peak legible — real adjacent peaks merge into a ridge
    // (as real terrain does) instead of the whole region flattening into a
    // single dome.
    pts.forEach((p) => {
      const gx = p.x * sx, gy = p.y * sy;
      const sigma = SIGMA_MIN + (SIGMA_MAX - SIGMA_MIN) * p.level;
      const weight = 0.05 + Math.pow(p.level, 1.15) * 0.95;
      const radius = Math.ceil(sigma * 3);
      const x0 = Math.max(0, Math.floor(gx - radius)), x1 = Math.min(GRID_W - 1, Math.ceil(gx + radius));
      const y0 = Math.max(0, Math.floor(gy - radius)), y1 = Math.min(GRID_H - 1, Math.ceil(gy + radius));
      const twoSigma2 = 2 * sigma * sigma;
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy - gy;
        const rowBase = yy * GRID_W;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - gx;
          const v = weight * Math.exp(-(dx * dx + dy * dy) / twoSigma2);
          if (v > height[rowBase + xx]) height[rowBase + xx] = v;
        }
      }
    });

    let maxH = 0;
    for (let k = 0; k < height.length; k++) if (height[k] > maxH) maxH = height[k];
    if (maxH <= 0) maxH = 1;

    const img = gridCtx.createImageData(GRID_W, GRID_H);
    const data = img.data;
    const lx = -0.62, ly = -0.5, lz = 0.6; // light from upper-left, already ~unit length
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const idx = y * GRID_W + x;
        const h = height[idx] / maxH;
        const hL = height[y * GRID_W + Math.max(0, x - 1)] / maxH;
        const hR = height[y * GRID_W + Math.min(GRID_W - 1, x + 1)] / maxH;
        const hU = height[Math.max(0, y - 1) * GRID_W + x] / maxH;
        const hD = height[Math.min(GRID_H - 1, y + 1) * GRID_W + x] / maxH;
        const nx = -(hR - hL) * 22, ny = -(hD - hU) * 22, nz = 1;
        const nl = Math.hypot(nx, ny, nz);
        const shade = Math.max(0, (nx / nl) * lx + (ny / nl) * ly + (nz / nl) * lz);
        const light = 0.4 + 0.6 * shade;

        const c = TERRAIN_LUT[Math.max(0, Math.min(255, Math.round(h * 255)))];
        const px = idx * 4;
        data[px] = Math.min(255, c[0] * light);
        data[px + 1] = Math.min(255, c[1] * light);
        data[px + 2] = Math.min(255, c[2] * light);
        data[px + 3] = Math.round(255 * Math.min(1, h * 3.2));
      }
    }
    gridCtx.putImageData(img, 0, 0);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pxW = Math.round(WIDTH * dpr), pxH = Math.round(HEIGHT * dpr);
    if (terrainCanvas.width !== pxW || terrainCanvas.height !== pxH) {
      terrainCanvas.width = pxW;
      terrainCanvas.height = pxH;
    }
    const outCtx = terrainCanvas.getContext('2d');
    outCtx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in outCtx) outCtx.imageSmoothingQuality = 'high';
    outCtx.clearRect(0, 0, terrainCanvas.width, terrainCanvas.height);
    outCtx.drawImage(gridCanvas, 0, 0, GRID_W, GRID_H, 0, 0, terrainCanvas.width, terrainCanvas.height);
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
    if (activePointers.size < 2) pinchState = null;
    if (dragState && event.pointerId === dragState.pointerId) {
      if (dragState.moved) {
        suppressNextClick = true;
        // Self-clearing: on some browsers/input types a drag-release doesn't
        // synthesize a 'click' at all, which would otherwise leave this flag
        // stuck true forever and silently swallow the *next* unrelated click.
        setTimeout(() => { suppressNextClick = false; }, 350);
      }
      dragState = null;
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
    setLabels, setPopulationMountains,
    get projection() { return projection; },
    get pathGen() { return pathGen; },
    get activeTier() { return activeTier; },
  };
})();
