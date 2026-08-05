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

  const CHROME_BUFFER = 16;
  const FALLBACK_PAD = 150;

  function measureChromePad() {
    const topEl = document.querySelector('.hud-stack');
    const bottomEl = document.querySelector('.hud-bottom');
    let topPad = Math.max(PAD, FALLBACK_PAD);
    let bottomPad = Math.max(PAD, FALLBACK_PAD);
    if (topEl) {
      const r = topEl.getBoundingClientRect();
      if (r.height > 0) topPad = Math.max(PAD, Math.min(HEIGHT * 0.6, r.bottom + CHROME_BUFFER));
    }
    if (bottomEl) {
      const r = bottomEl.getBoundingClientRect();
      if (r.height > 0) bottomPad = Math.max(PAD, Math.min(HEIGHT * 0.6, HEIGHT - r.top + CHROME_BUFFER));
    }
    return { topPad, bottomPad };
  }

  function buildProjection(subsetFeatures) {
    // Reserve extra room top/bottom so small subsets (e.g. a tiny country paired
    // against a huge one) can't render directly underneath the HUD chrome
    // (mission banner up top, legend/actions bar at the bottom). Measured live
    // from the actual DOM rather than a flat guessed constant — a fixed 150px
    // is right for desktop's compact one-row top bar but wastes a third of a
    // phone's screen height, since the same 150px chrome height doesn't scale
    // down just because the viewport got shorter/narrower.
    const { topPad, bottomPad } = measureChromePad();
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
    const fitBounds = d3.geoPath(proj).bounds(featureCollection);
    const usedH = fitBounds[1][1] - fitBounds[0][1];
    const boxH = box.bottom - box.top;
    if (usedH > 0 && usedH < boxH) {
      const fillFactor = Math.min(boxH / usedH, 1.65);
      if (fillFactor > 1.02) {
        const [tx, ty] = proj.translate();
        proj.scale(proj.scale() * fillFactor)
          .translate([fillFactor * tx + (1 - fillFactor) * cx, fillFactor * ty + (1 - fillFactor) * cy]);
      }
    }

    if (zoomFactor !== 1) {
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
    setLabels,
    get projection() { return projection; },
    get pathGen() { return pathGen; },
    get activeTier() { return activeTier; },
  };
})();
