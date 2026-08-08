(function () {
  const GN = window.GN = window.GN || {};

  // Geo Shrink-style binary narrowing (GN.geoPartition), applied to the
  // water layer instead of countries. Rivers/lakes have no border-adjacency
  // graph, so buildPartitionData() below always hands partition() an empty
  // neighbors list for every candidate -- it falls through to its
  // nearest-centroid-by-distance fallback, which degrades gracefully into a
  // pure geographic bisection. One type per round (never rivers+lakes mixed
  // in the same split), chosen fresh each round.

  // Roughly what fraction of the full, curated list is in play this round --
  // mirrors GN.progression.DIFFICULTIES' poolSize idea, just scaled to
  // water's much smaller totals (90 rivers / 39 lakes vs. ~200 countries).
  const POOL_FRACTION = { easy: 0.3, medium: 0.65, hard: 1 };
  const MIN_POOL = 6;

  // Same roulette-wheel weighted sample used by progression.js's own
  // buildPool/pickTarget, duplicated rather than shared since it needs a
  // different "familiarity" signal here (rivers/lakes have no population to
  // key off) -- see prominenceScores below.
  function weightedSampleWithoutReplacement(items, weightFn, k) {
    const pool = items.map((item) => ({ item, w: Math.max(weightFn(item), 1e-6) }));
    const result = [];
    const take = Math.min(k, pool.length);
    for (let n = 0; n < take; n++) {
      const total = pool.reduce((s, p) => s + p.w, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < pool.length - 1; idx++) { r -= pool[idx].w; if (r <= 0) break; }
      result.push(pool[idx].item);
      pool.splice(idx, 1);
    }
    return result;
  }
  function weightForDifficulty(diffId, f) {
    if (diffId === 'easy') return Math.pow(f, 3) + 0.001; // strong bias to well-known
    if (diffId === 'hard') return Math.pow(1 - f, 3) + 0.001; // strong bias to obscure
    return 0.3 + 0.4 * f;
  }
  function listFor(type) { return type === 'river' ? GN.map.getWaterRivers() : GN.map.getWaterLakes(); }

  // Prominence, normalized 0..1 (1 = most prominent): rivers use Natural
  // Earth's own scalerank (lower number = more major); lakes use computed
  // area, both already carried on each feature's properties.
  function prominenceScores(type) {
    const list = listFor(type);
    const raw = list.map((f, i) => ({
      i, v: type === 'river' ? -(f.properties.scalerank == null ? 6 : f.properties.scalerank) : (f.properties.area || 0),
    }));
    raw.sort((a, b) => a.v - b.v);
    const n = raw.length;
    const scores = new Array(n);
    raw.forEach((entry, rank) => { scores[entry.i] = n > 1 ? rank / (n - 1) : 1; });
    return scores;
  }

  function buildRoundPool(type) {
    const list = listFor(type);
    const diffId = GN.progression.getSelectedDifficultyId();
    const size = Math.max(MIN_POOL, Math.round(list.length * (POOL_FRACTION[diffId] || 1)));
    if (size >= list.length) return list.map((_, i) => i);
    const scores = prominenceScores(type);
    const allIdx = list.map((_, i) => i);
    return weightedSampleWithoutReplacement(allIdx, (i) => weightForDifficulty(diffId, scores[i]), size);
  }

  function pickTarget(type, poolIdx) {
    const diffId = GN.progression.getSelectedDifficultyId();
    const scores = prominenceScores(type);
    const recent = new Set(GN.progression.getWaterRecent());
    let candidates = poolIdx.filter((i) => !recent.has(type + ':' + i));
    if (!candidates.length) candidates = poolIdx; // never starve if history excludes everything
    const [picked] = weightedSampleWithoutReplacement(candidates, (i) => weightForDifficulty(diffId, scores[i]), 1);
    GN.progression.recordWaterTarget(type + ':' + picked);
    return picked;
  }

  // Equal weight per candidate (not real area) since "keep regions visually
  // balanced by land area" doesn't mean anything for points/lines -- this
  // balances the split by count instead.
  function buildPartitionData(type, poolIdx) {
    const list = listFor(type);
    const centroids = [], areas = [], neighbors = [];
    poolIdx.forEach((i) => {
      centroids[i] = d3.geoCentroid(list[i]);
      areas[i] = 1;
      neighbors[i] = [];
    });
    return { centroids, areas, neighbors };
  }

  function featuresFor(type, idxList) {
    const list = listFor(type);
    return idxList.map((i) => list[i]);
  }

  function paintLevel(ctx) {
    const step = ctx.state.path[ctx.state.level];
    const inA = new Set(step.groupA), inB = new Set(step.groupB);
    GN.map.paintWaterClasses(ctx.state.type, {
      'water-a': (i) => inA.has(i),
      'water-b': (i) => inB.has(i),
    });
    ctx.hud.updateStat('round', String(ctx.state.level + 1));
    ctx.hud.updateStat('left', String(step.subset.length));
    const total = ctx.state.poolIdx.length;
    ctx.hud.setProgress(step.subset.length >= total ? 0 : 1 - Math.log(step.subset.length) / Math.log(total));
  }

  function goToLevel(ctx, lvl, animate, onDone) {
    const step = ctx.state.path[lvl];
    const feats = featuresFor(ctx.state.type, step.subset);
    const newProj = ctx.map.buildProjection(feats);
    const apply = () => { paintLevel(ctx); onDone && onDone(); };
    if (animate) ctx.map.animateToProjection(newProj, apply);
    else { ctx.map.setProjectionImmediate(newProj); apply(); }
  }

  function startRound(ctx) {
    const type = Math.random() < 0.5 ? 'river' : 'lake';
    const poolIdx = buildRoundPool(type);
    const targetIdx = pickTarget(type, poolIdx);
    const list = listFor(type);

    ctx.state.type = type;
    ctx.state.poolIdx = poolIdx;
    ctx.state.targetIdx = targetIdx;
    ctx.state.targetName = list[targetIdx].properties.name;
    ctx.state.level = 0;
    ctx.state.inputLocked = true;
    ctx.state.path = GN.geoPartition.buildPath(targetIdx, poolIdx, buildPartitionData(type, poolIdx));

    GN.map.setWaterTypeFilter(type);
    ctx.hud.setTarget('Find the ' + type + ': <b>' + ctx.state.targetName + '</b>');
    goToLevel(ctx, 0, false, () => { ctx.state.inputLocked = false; });
  }

  function finish(ctx, finalSet) {
    const feats = featuresFor(ctx.state.type, finalSet);
    const newProj = ctx.map.buildProjection(feats);
    ctx.map.animateToProjection(newProj, () => {
      GN.map.paintWaterClasses(ctx.state.type, { 'water-a': () => false, 'water-b': (i) => finalSet.includes(i) });
      // Reward scales with how many narrowing steps this round actually
      // took (a full Hard-pool river narrow is a lot more work than a
      // 3-step lake round on Easy) -- explicit xp/coins rather than
      // applyOutcome's flat per-click default, which was tuned for
      // single-click modes, not a multi-step narrowing sequence.
      const steps = ctx.state.path.length;
      const result = GN.progression.applyOutcome({
        type: 'correct',
        points: 30 + steps * 15,
        xp: Math.round(10 + steps * 4),
        coins: Math.round(3 + steps * 1.5),
      });
      ctx.hud.updateStat('points', String(GN.progression.getScore()));
      ctx.hud.updateStat('streak', String(GN.progression.getCurrentStreak()));
      ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
      // Same "pause, don't auto-advance" pattern as every other multi-round
      // mode (Capital Match, Bloc Bingo, ...) -- the overlay doesn't block
      // the map underneath (see .overlay-card in style.css), so the player
      // can still pan/zoom to look at the answer before moving on.
      ctx.hud.showRoundResult({
        correct: true,
        title: ctx.state.targetName + '!',
        sub: '+' + result.xpGain + ' XP, +' + result.coinsGain + ' coin' + (result.coinsGain === 1 ? '' : 's') + ' — take a look before continuing.',
        nextLabel: 'Next round',
        onNext: () => startRound(ctx),
      });
    });
  }

  function onWaterClick(ctx, type, idx) {
    if (ctx.state.inputLocked || type !== ctx.state.type) return;
    const step = ctx.state.path[ctx.state.level];
    if (!step) return;
    const inA = step.groupA.includes(idx), inB = step.groupB.includes(idx);
    if (!inA && !inB) return;
    const clickedSide = inA ? 'A' : 'B';
    const targetSide = step.groupA.includes(ctx.state.targetIdx) ? 'A' : 'B';
    const clickedSet = clickedSide === 'A' ? step.groupA : step.groupB;

    if (clickedSide === targetSide) {
      ctx.state.inputLocked = true;
      ctx.scheduleTimeout(() => {
        ctx.state.level++;
        if (clickedSet.length === 1 || !ctx.state.path[ctx.state.level]) {
          finish(ctx, clickedSet);
        } else {
          goToLevel(ctx, ctx.state.level, true, () => { ctx.state.inputLocked = false; });
        }
      }, 260);
    } else {
      // No lock, no shrink -- deliberately no penalty beyond the mistake
      // count, same exploration-friendly philosophy the mode it replaced had.
      GN.progression.applyOutcome({ type: 'wrong' });
      ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
      ctx.hud.shakeBoard();
    }
  }

  const mode = {
    title: 'Water Wisdom',
    setup(ctx) {
      ctx.state = {};
      GN.progression.reset();
      ctx.map.setActiveFeatureIndices(ctx.data.playableIndices);
      ctx.map.paintClasses({ eliminated: () => true }); // countries: neutral backdrop only
      GN.map.setWaterVisible(true);
      GN.map.setWaterInteractive(true, {
        onWaterClick: (type, idx) => onWaterClick(ctx, type, idx),
      });
      ctx.hud.setStats([
        { id: 'round', value: '–', label: 'Round' },
        { id: 'left', value: '–', label: 'Left' },
        { id: 'points', value: '0', label: 'Points', cls: 'stat-points' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
      ]);
      ctx.hud.setLegend(
        '<span class="a"><span class="swatch" style="background:#2fb344"></span>Group A</span>' +
        '<span class="b"><span class="swatch" style="background:#e03131"></span>Group B</span>' +
        '<span class="elim"><span class="swatch" style="background:#2f7fd6"></span>Not this round</span>'
      );
      ctx.hud.setPanel('');
      ctx.hud.setHint('The rivers and lakes split in two each round — narrow down to the target.');
      startRound(ctx);
    },
    teardown(ctx) {
      GN.map.setWaterInteractive(false);
      GN.map.setWaterVisible(false);
      GN.map.setWaterTypeFilter(null);
      ctx.hud.setPanel('');
      ctx.hud.setLegend('');
    },
    onMapClick() {}, // countries are just a dimmed backdrop in this mode
  };

  GN.modeShell.registerMode('water', mode);
})();
