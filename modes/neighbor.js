(function () {
  const GN = window.GN = window.GN || {};

  function pickNeighborTarget(ctx) {
    const withNeighbors = ctx.state.pool.filter((i) => ctx.data.neighbors[i].length > 0);
    const pool = withNeighbors.length ? withNeighbors : ctx.state.pool;
    return GN.progression.pickTarget(pool);
  }

  function repaint(ctx) {
    const targetIdx = ctx.state.targetIdx;
    const inPlay = new Set(ctx.state.pool);
    ctx.map.paintClasses({
      'group-a': (i) => i === targetIdx,
      'group-b': (i) => i !== targetIdx && ctx.selection.has(i),
      'guessable': (i) => i !== targetIdx && !ctx.selection.has(i) && inPlay.has(i),
      'eliminated': (i) => !inPlay.has(i),
    });
    ctx.map.clearFlashClasses();
  }

  function nextRound(ctx) {
    ctx.selection.clear();
    ctx.state.inputLocked = false;
    ctx.state.targetIdx = pickNeighborTarget(ctx);
    ctx.state.trueNeighbors = new Set(
      ctx.data.neighbors[ctx.state.targetIdx].filter((n) => ctx.state.pool.includes(n))
    );
    ctx.hud.setTarget('Neighbors of: <b>' + ctx.data.names[ctx.state.targetIdx] + '</b>');
    ctx.hud.updateStat('selected', '0 / ' + ctx.state.trueNeighbors.size);
    repaint(ctx);
  }

  function onMapClick(ctx, idx) {
    if (ctx.state.inputLocked) return;
    if (idx === ctx.state.targetIdx) return;
    if (!ctx.state.pool.includes(idx)) return;
    ctx.selection.toggle(idx);
    ctx.hud.updateStat('selected', ctx.selection.size + ' / ' + ctx.state.trueNeighbors.size);
    repaint(ctx);
  }

  function submit(ctx) {
    if (ctx.state.inputLocked) return;
    ctx.state.inputLocked = true;
    const trueSet = ctx.state.trueNeighbors;
    const picked = new Set(ctx.selection.values());
    let correct = 0, falsePos = 0;
    picked.forEach((i) => { if (trueSet.has(i)) correct++; else falsePos++; });
    const falseNeg = trueSet.size - correct;
    const denom = correct + falsePos + falseNeg;
    const ratio = denom === 0 ? 1 : correct / denom;

    trueSet.forEach((i) => ctx.map.flashCountries([i], picked.has(i) ? 'flash-good' : 'flash-bad'));
    picked.forEach((i) => { if (!trueSet.has(i)) ctx.map.flashCountries([i], 'flash-bad'); });

    let outcome;
    if (ratio >= 0.999) outcome = { type: 'correct', cost: 10 };
    else if (ratio <= 0.001) outcome = { type: 'wrong', cost: 50 };
    else outcome = { type: 'partial', cost: Math.round(10 + (1 - ratio) * 40) };
    GN.progression.applyOutcome(outcome);

    ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
    ctx.hud.updateStat('points', GN.progression.getScore() + ' / ' + GN.progression.MAX_SCORE);
    ctx.hud.showToast(
      ratio >= 0.999 ? 'Perfect! All neighbors found.' :
      ratio <= 0.001 ? 'No matches — on to the next one.' :
      'Found ' + correct + ' of ' + trueSet.size + ' (' + falsePos + ' wrong pick' + (falsePos === 1 ? '' : 's') + ').'
    );
    ctx.scheduleTimeout(() => nextRound(ctx), 1400);
  }

  const mode = {
    title: 'Neighbor Match',
    setup(ctx) {
      ctx.state = { targetIdx: null, trueNeighbors: null, inputLocked: false, pool: GN.progression.buildPool(ctx.data.playableIndices) };
      GN.progression.reset();
      ctx.hud.setStats([
        { id: 'selected', value: '0', label: 'Selected' },
        { id: 'points', value: GN.progression.MAX_SCORE + ' / ' + GN.progression.MAX_SCORE, label: 'Points', cls: 'stat-points' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
      ]);
      ctx.hud.setLegend(
        '<span class="a"><span class="swatch"></span>Reference country</span>' +
        '<span class="b"><span class="swatch"></span>Your picks</span>' +
        '<span class="g"><span class="swatch"></span>Click to select</span>' +
        '<span class="elim"><span class="swatch"></span>Not in play</span>'
      );
      ctx.hud.setPanel(
        '<button class="hud-btn" id="neighbor-submit">Submit answer</button>' +
        '<button class="hud-btn" id="neighbor-skip">Skip</button>'
      );
      ctx.hud.setHint('Click every country that shares a land border with the reference country, then Submit.');
      document.getElementById('neighbor-submit').addEventListener('click', () => submit(ctx));
      document.getElementById('neighbor-skip').addEventListener('click', () => nextRound(ctx));
      ctx.map.setActiveFeatureIndices(ctx.state.pool);
      nextRound(ctx);
    },
    teardown(ctx) {
      ctx.hud.setPanel('');
      ctx.hud.setLegend('');
    },
    onMapClick,
  };

  GN.modeShell.registerMode('neighbor', mode);
})();
