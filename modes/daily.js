(function () {
  const GN = window.GN = window.GN || {};
  const EPOCH_MS = Date.UTC(2026, 7, 4); // Daily #1 = 2026-08-04 (UTC)

  function todayUTCString() {
    const d = new Date();
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function dailyNumber() {
    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.floor((todayUTC - EPOCH_MS) / 86400000) + 1;
  }
  function seedFromDate(dateStr) {
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
    return hash;
  }

  // Same partitioning algorithm as modes/narrow.js, kept self-contained here
  // (deterministic given target+pool, which is exactly what a shared daily
  // puzzle needs — every player gets an identical sequence of splits).
  function partition(subset, data) {
    const { areas, centroids, neighbors } = data;
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
    groupOf.set(sa, 'A'); groupOf.set(sb, 'B');
    let areaA = areas[sa], areaB = areas[sb];
    const unassigned = new Set(subset.filter((i) => i !== sa && i !== sb));
    function frontierCandidates(group) {
      const cands = new Set();
      for (const [idx, g] of groupOf) {
        if (g !== group) continue;
        for (const n of neighbors[idx]) if (subsetSet.has(n) && !groupOf.has(n)) cands.add(n);
      }
      return [...cands];
    }
    function centroidOf(group) {
      let lon = 0, lat = 0, n = 0;
      for (const [idx, g] of groupOf) if (g === group) { lon += centroids[idx][0]; lat += centroids[idx][1]; n++; }
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
        for (const idx of unassigned) { const dd = d3.geoDistance(gc, centroids[idx]); if (dd < bestD) { bestD = dd; pick = idx; } }
      }
      groupOf.set(pick, growGroup);
      if (growGroup === 'A') areaA += areas[pick]; else areaB += areas[pick];
      unassigned.delete(pick);
    }
    const groupA = [], groupB = [];
    for (const [idx, g] of groupOf) (g === 'A' ? groupA : groupB).push(idx);
    return { groupA, groupB };
  }
  function buildPath(target, pool, data) {
    let subset = pool.slice();
    const steps = [];
    while (subset.length > 1) {
      const { groupA, groupB } = partition(subset, data);
      const side = groupA.includes(target) ? 'A' : 'B';
      steps.push({ subset, groupA, groupB });
      subset = side === 'A' ? groupA : groupB;
    }
    return steps;
  }

  function buildShareText(state) {
    const squares = state.history.map((clean) => (clean ? '🟦' : '🟥')).join('');
    return 'GeoShrink Daily #' + state.dayNum + '\n' + squares + '\n' +
      state.score + '/1000 pts · ' + state.history.length + ' rounds · ' + state.mistakes + ' mistake' + (state.mistakes === 1 ? '' : 's');
  }

  function wireCopyButton(ctx, shareText) {
    ctx.hud.setPanel('<button class="hud-btn" id="daily-copy">Copy result</button>');
    document.getElementById('daily-copy').addEventListener('click', () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareText).then(
          () => ctx.hud.showToast('Result copied!'),
          () => ctx.hud.showToast(shareText)
        );
      } else {
        ctx.hud.showToast(shareText);
      }
    });
  }

  function showPastResult(ctx, record) {
    ctx.map.paintClasses({ 'group-a': () => false, 'group-b': () => false, 'guessable': () => false, 'eliminated': () => true });
    ctx.hud.setStats([{ id: 'day', value: '#' + record.dayNum, label: 'Daily' }]);
    ctx.hud.setLegend('');
    ctx.hud.setHint('One attempt per day — come back tomorrow for a new puzzle.');
    ctx.hud.setTarget('Already played Daily #' + record.dayNum);
    wireCopyButton(ctx, record.shareText);
    ctx.hud.showWin({ title: record.targetName + '!', sub: record.shareText.replace(/\n/g, '  ·  ') });
  }

  function paintLevel(ctx) {
    const step = ctx.state.path[ctx.state.level];
    const inA = new Set(step.groupA), inB = new Set(step.groupB);
    const inSubset = new Set(step.subset);
    ctx.map.paintClasses({
      'group-a': (i) => inA.has(i),
      'group-b': (i) => inB.has(i),
      'eliminated': (i) => !inSubset.has(i),
    });
    ctx.map.clearFlashClasses();
    ctx.hud.updateStat('round', String(ctx.state.level + 1));
    ctx.hud.updateStat('left', String(step.subset.length));
    const total = ctx.state.pool.length;
    ctx.hud.setProgress(step.subset.length >= total ? 0 : 1 - Math.log(step.subset.length) / Math.log(total));
  }

  function goToLevel(ctx, lvl, animate, onDone) {
    const step = ctx.state.path[lvl];
    ctx.map.setActiveFeatureIndices(step.subset);
    const newProj = ctx.map.buildProjection(step.subset.map((i) => ctx.data.features[i]));
    const apply = () => { paintLevel(ctx); onDone && onDone(); };
    if (animate) ctx.map.animateToProjection(newProj, apply);
    else { ctx.map.setProjectionImmediate(newProj); apply(); }
  }

  function finish(ctx, finalSet) {
    const feats = finalSet.map((i) => ctx.data.features[i]);
    const newProj = ctx.map.buildProjection(feats);
    ctx.map.animateToProjection(newProj, () => {
      const finalIdxSet = new Set(finalSet);
      ctx.map.paintClasses({ 'group-a': () => false, 'group-b': () => false, 'eliminated': (i) => !finalIdxSet.has(i) });
      ctx.map.flashCountries(finalSet, 'flash-good');
      const record = {
        dayNum: ctx.state.dayNum, date: ctx.state.date, targetName: ctx.data.names[ctx.state.targetIdx],
        score: GN.progression.getScore(), mistakes: GN.progression.getMistakes(), history: ctx.state.history,
      };
      record.shareText = buildShareText(record);
      GN.storage.setModeState('daily', record);
      wireCopyButton(ctx, record.shareText);
      ctx.hud.showWin({
        title: record.targetName + '!',
        sub: record.score + '/1000 pts · ' + record.history.length + ' rounds · ' + record.mistakes + ' mistake' + (record.mistakes === 1 ? '' : 's'),
      });
    });
  }

  function onMapClick(ctx, idx) {
    if (ctx.hud.isWinShown() || ctx.state.inputLocked) return;
    const step = ctx.state.path[ctx.state.level];
    if (!step) return;
    const inA = step.groupA.includes(idx), inB = step.groupB.includes(idx);
    if (!inA && !inB) return;
    const clickedSide = inA ? 'A' : 'B';
    const targetSide = step.groupA.includes(ctx.state.targetIdx) ? 'A' : 'B';
    const clickedSet = clickedSide === 'A' ? step.groupA : step.groupB;

    if (clickedSide === targetSide) {
      ctx.state.inputLocked = true;
      ctx.map.flashCountries(clickedSet, 'flash-good');
      ctx.scheduleTimeout(() => {
        GN.progression.applyOutcome({ type: 'correct', cost: 10 });
        ctx.state.history.push(!ctx.state.roundHadMistake);
        ctx.state.roundHadMistake = false;
        ctx.state.level++;
        if (clickedSet.length === 1 || !ctx.state.path[ctx.state.level]) {
          finish(ctx, clickedSet);
        } else {
          goToLevel(ctx, ctx.state.level, true, () => { ctx.state.inputLocked = false; });
        }
      }, 260);
    } else {
      const sel = ctx.map.flashCountries(clickedSet, 'flash-bad');
      GN.progression.applyOutcome({ type: 'wrong', cost: 50 });
      ctx.state.roundHadMistake = true;
      ctx.hud.shakeBoard();
      ctx.scheduleTimeout(() => sel.classed('flash-bad', false), 320);
    }
  }

  const mode = {
    setup(ctx) {
      const date = todayUTCString();
      const dayNum = dailyNumber();
      const existing = GN.storage.getModeState('daily');
      ctx.state = { date, dayNum, inputLocked: true, history: [], roundHadMistake: false };

      ctx.hud.setStats([
        { id: 'day', value: '#' + dayNum, label: 'Daily' },
        { id: 'round', value: '–', label: 'Round' },
        { id: 'left', value: '–', label: 'Left' },
      ]);
      ctx.hud.setLegend(
        '<span class="a"><span class="swatch"></span>Region A</span>' +
        '<span class="b"><span class="swatch"></span>Region B</span>' +
        '<span class="elim"><span class="swatch"></span>Eliminated</span>'
      );

      if (existing && existing.date === date) {
        showPastResult(ctx, existing);
        return;
      }

      GN.progression.reset();
      ctx.state.pool = ctx.data.playableIndices; // always full-world — same puzzle for everyone, tier-independent
      ctx.state.targetIdx = ctx.state.pool[seedFromDate(date) % ctx.state.pool.length];
      ctx.state.path = buildPath(ctx.state.targetIdx, ctx.state.pool, ctx.data);
      ctx.state.level = 0;
      ctx.hud.setPanel('');
      ctx.hud.setTarget('Daily #' + dayNum + ' — Find: <b>' + ctx.data.names[ctx.state.targetIdx] + '</b>');
      ctx.hud.setHint('Same puzzle for everyone today. One attempt — make it count!');
      goToLevel(ctx, 0, false, () => { ctx.state.inputLocked = false; });
    },
    teardown(ctx) { ctx.hud.setPanel(''); ctx.hud.setLegend(''); },
    onMapClick,
  };

  GN.modeShell.registerMode('daily', mode);
})();
