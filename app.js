(function () {
  const WIDTH = 960, HEIGHT = 520, PAD = 24;

  const svg = d3.select('#map').attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  const gOcean = svg.append('rect').attr('class', 'ocean-rect')
    .attr('x', 0).attr('y', 0).attr('width', WIDTH).attr('height', HEIGHT).attr('fill', 'transparent');
  const gFrame = svg.append('g');
  const gGraticule = gFrame.append('path').attr('class', 'graticule');
  const gSphere = gFrame.append('path').attr('class', 'sphere-outline');
  const gCountries = svg.append('g').attr('class', 'countries');
  const graticuleData = d3.geoGraticule10();

  let geoms, features, names, areas, centroids, neighbors, playableIndices;
  let path, level, mistakes, targetIdx;
  let projection, pathGen, worldProjection;
  let inputLocked = false;
  let discoveryMode = false;

  const targetBanner = document.getElementById('target-banner');
  const kioskBanner = document.getElementById('kiosk-banner');
  const statRound = document.getElementById('stat-round');
  const statRemaining = document.getElementById('stat-remaining');
  const statMistakes = document.getElementById('stat-mistakes');
  const progressFill = document.getElementById('progress-fill');
  const winOverlay = document.getElementById('win-overlay');
  const winTitle = document.getElementById('win-title');
  const winSub = document.getElementById('win-sub');
  const tooltip = document.getElementById('tooltip');
  const boardEl = document.querySelector('.board');
  const toast = document.getElementById('toast');
  const vizRoot = document.querySelector('.viz-root');

  fetch('data/countries-110m.json')
    .then(r => r.json())
    .then(topology => {
      geoms = topology.objects.countries.geometries;
      features = topojson.feature(topology, topology.objects.countries).features;
      names = geoms.map(g => g.properties.name);
      areas = features.map(f => d3.geoArea(f));
      centroids = features.map(f => d3.geoCentroid(f));
      neighbors = topojson.neighbors(geoms);
      playableIndices = names.map((_, i) => i).filter(i => names[i] !== 'Antarctica');

      worldProjection = buildProjection(playableIndices.map(i => features[i]));
      projection = worldProjection;
      pathGen = d3.geoPath(projection);

      drawBaseMap();
      newGame(false);
    })
    .catch(err => {
      targetBanner.textContent = 'Failed to load map data: ' + err.message;
    });

  // --- projection helpers -------------------------------------------------

  function buildProjection(subsetFeatures) {
    return d3.geoEqualEarth().fitExtent(
      [[PAD, PAD], [WIDTH - PAD, HEIGHT - PAD]],
      { type: 'FeatureCollection', features: subsetFeatures }
    );
  }

  function setProjectionImmediate(newProjection) {
    projection = newProjection;
    pathGen = d3.geoPath(projection);
    gCountries.selectAll('path.country').attr('d', pathGen);
    gGraticule.attr('d', pathGen(graticuleData));
    gSphere.attr('d', pathGen({ type: 'Sphere' }));
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

  // --- drawing --------------------------------------------------------------

  function drawBaseMap() {
    gGraticule.attr('d', pathGen(graticuleData));
    gSphere.attr('d', pathGen({ type: 'Sphere' }));

    gCountries.selectAll('path.country')
      .data(features, (_, i) => i)
      .join('path')
      .attr('class', 'country')
      .attr('d', pathGen)
      .attr('data-idx', (_, i) => i)
      .on('mouseenter', function (event) { showTooltip(event, +this.getAttribute('data-idx')); })
      .on('mousemove', function (event) { moveTooltip(event); })
      .on('mouseleave', hideTooltip)
      .on('click', function () { onCountryClick(+this.getAttribute('data-idx')); });
  }

  function showTooltip(event, idx) {
    if (!discoveryMode) return;
    tooltip.textContent = names[idx];
    tooltip.classList.add('show');
    moveTooltip(event);
  }
  function moveTooltip(event) {
    const rect = boardEl.getBoundingClientRect();
    tooltip.style.left = (event.clientX - rect.left) + 'px';
    tooltip.style.top = (event.clientY - rect.top) + 'px';
  }
  function hideTooltip() { tooltip.classList.remove('show'); }

  // --- partitioning -----------------------------------------------------

  function partition(subset) {
    if (subset.length <= 1) return null;
    let best = -1, sa = subset[0], sb = subset[1];
    for (let i = 0; i < subset.length; i++) {
      for (let j = i + 1; j < subset.length; j++) {
        const dist = d3.geoDistance(centroids[subset[i]], centroids[subset[j]]);
        if (dist > best) { best = dist; sa = subset[i]; sb = subset[j]; }
      }
    }
    const subsetSet = new Set(subset);
    const groupOf = new Map();
    groupOf.set(sa, 'A');
    groupOf.set(sb, 'B');
    let areaA = areas[sa], areaB = areas[sb];
    const unassigned = new Set(subset.filter(i => i !== sa && i !== sb));

    function frontierCandidates(group) {
      const cands = new Set();
      for (const [idx, g] of groupOf) {
        if (g !== group) continue;
        for (const n of neighbors[idx]) {
          if (subsetSet.has(n) && !groupOf.has(n)) cands.add(n);
        }
      }
      return [...cands];
    }
    function centroidOf(group) {
      let lon = 0, lat = 0, n = 0;
      for (const [idx, g] of groupOf) {
        if (g === group) { lon += centroids[idx][0]; lat += centroids[idx][1]; n++; }
      }
      return [lon / n, lat / n];
    }

    while (unassigned.size > 0) {
      const growGroup = areaA <= areaB ? 'A' : 'B';
      let cands = frontierCandidates(growGroup);
      let pick;
      if (cands.length > 0) {
        cands.sort((a, b) => areas[a] - areas[b]);
        pick = cands[0];
      } else {
        const gc = centroidOf(growGroup);
        let bestD = Infinity;
        for (const idx of unassigned) {
          const dd = d3.geoDistance(gc, centroids[idx]);
          if (dd < bestD) { bestD = dd; pick = idx; }
        }
      }
      groupOf.set(pick, growGroup);
      if (growGroup === 'A') areaA += areas[pick]; else areaB += areas[pick];
      unassigned.delete(pick);
    }
    const groupA = [], groupB = [];
    for (const [idx, g] of groupOf) (g === 'A' ? groupA : groupB).push(idx);
    return { groupA, groupB };
  }

  function buildPath(target) {
    let subset = playableIndices.slice();
    const steps = [];
    while (subset.length > 1) {
      const { groupA, groupB } = partition(subset);
      const side = groupA.includes(target) ? 'A' : 'B';
      steps.push({ subset, groupA, groupB });
      subset = side === 'A' ? groupA : groupB;
    }
    return steps;
  }

  // --- game flow ----------------------------------------------------------

  function newGame(animate) {
    inputLocked = true;
    winOverlay.classList.remove('show');
    hideTooltip();
    mistakes = 0;
    statMistakes.textContent = '0';
    targetIdx = playableIndices[Math.floor(Math.random() * playableIndices.length)];
    path = buildPath(targetIdx);
    level = 0;
    targetBanner.innerHTML = 'Find: <b>' + names[targetIdx] + '</b>';
    kioskBanner.textContent = 'Find: ' + names[targetIdx];
    goToLevel(0, animate, () => { inputLocked = false; });
  }

  function goToLevel(lvl, animate, onDone) {
    const step = path[lvl];
    const newProj = buildProjection(step.subset.map(i => features[i]));
    const applyColors = () => {
      const inA = new Set(step.groupA), inB = new Set(step.groupB);
      gCountries.selectAll('path.country')
        .classed('group-a', (_, i) => inA.has(i))
        .classed('group-b', (_, i) => inB.has(i))
        .classed('eliminated', (_, i) => !inA.has(i) && !inB.has(i))
        .classed('flash-good', false)
        .classed('flash-bad', false);
      updateStats(lvl, step.subset.length);
      onDone && onDone();
    };
    if (animate) animateToProjection(newProj, applyColors);
    else { setProjectionImmediate(newProj); applyColors(); }
  }

  function updateStats(lvl, remaining) {
    const total = playableIndices.length;
    statRound.textContent = (lvl + 1) + ' / ~' + Math.ceil(Math.log2(total));
    statRemaining.textContent = remaining;
    const progress = remaining >= total ? 0 : 1 - Math.log(remaining) / Math.log(total);
    progressFill.style.width = Math.round(Math.max(0, Math.min(1, progress)) * 100) + '%';
  }

  function onCountryClick(idx) {
    if (winOverlay.classList.contains('show') || inputLocked) return;
    const step = path[level];
    if (!step) return; // between the winning click and the win overlay appearing
    const inA = step.groupA.includes(idx);
    const inB = step.groupB.includes(idx);
    if (!inA && !inB) return; // eliminated country, not selectable

    const clickedSide = inA ? 'A' : 'B';
    const targetSide = step.groupA.includes(targetIdx) ? 'A' : 'B';
    const clickedSet = clickedSide === 'A' ? step.groupA : step.groupB;
    const sel = gCountries.selectAll('path.country').filter((_, i) => clickedSet.includes(i));

    if (clickedSide === targetSide) {
      inputLocked = true;
      hideTooltip();
      sel.classed('flash-good', true);
      setTimeout(() => {
        level++;
        if (clickedSet.length === 1 || !path[level]) {
          finishGame(clickedSet);
        } else {
          goToLevel(level, true, () => { inputLocked = false; });
        }
      }, 260);
    } else {
      mistakes++;
      statMistakes.textContent = String(mistakes);
      sel.classed('flash-bad', true);
      boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake');
      setTimeout(() => sel.classed('flash-bad', false), 320);
    }
  }

  function finishGame(finalSet) {
    const feats = finalSet.map(i => features[i]);
    const newProj = buildProjection(feats);
    const finalIdxSet = new Set(finalSet);
    animateToProjection(newProj, () => {
      gCountries.selectAll('path.country')
        .classed('group-a', false)
        .classed('group-b', false)
        .classed('eliminated', (_, i) => !finalIdxSet.has(i))
        .classed('flash-good', (_, i) => finalIdxSet.has(i));
      statRound.textContent = String(level);
      statRemaining.textContent = '1';
      progressFill.style.width = '100%';
      winTitle.textContent = names[targetIdx] + '!';
      winSub.textContent = 'Found in ' + level + ' round' + (level === 1 ? '' : 's') +
        ' with ' + mistakes + ' mistake' + (mistakes === 1 ? '' : 's') + '.';
      winOverlay.classList.add('show');
    });
  }

  // --- toast ----------------------------------------------------------------

  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  // --- controls ---------------------------------------------------------

  document.getElementById('newgame').addEventListener('click', () => {
    if (!features) return;
    newGame(true);
    showToast('New game started');
  });
  document.getElementById('win-newgame').addEventListener('click', () => {
    if (!features) return;
    newGame(true);
  });

  const discoveryToggle = document.getElementById('discovery-toggle');
  discoveryToggle.addEventListener('change', () => {
    discoveryMode = discoveryToggle.checked;
    if (!discoveryMode) hideTooltip();
    showToast(discoveryMode ? 'Discovery mode on — hover shows names' : 'Discovery mode off');
  });

  const kioskBtn = document.getElementById('kiosk-btn');
  const kioskExitBtn = document.getElementById('kiosk-exit');
  kioskBtn.addEventListener('click', () => {
    vizRoot.classList.add('kiosk');
    if (vizRoot.requestFullscreen) vizRoot.requestFullscreen().catch(() => {});
  });
  function exitKiosk() {
    vizRoot.classList.remove('kiosk');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  kioskExitBtn.addEventListener('click', exitKiosk);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) vizRoot.classList.remove('kiosk');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') exitKiosk(); });

  // --- PWA install ------------------------------------------------------

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
