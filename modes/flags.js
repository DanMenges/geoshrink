(function () {
  const GN = window.GN = window.GN || {};

  function pickTarget(ctx) {
    const pool = ctx.state.pool;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function repaint(ctx) {
    const inPlay = new Set(ctx.state.pool);
    ctx.map.paintClasses({
      'available': (i) => inPlay.has(i),
      'eliminated': (i) => !inPlay.has(i),
    });
    ctx.map.clearFlashClasses();
  }

  function nextRound(ctx) {
    ctx.state.inputLocked = false;
    ctx.state.targetIdx = pickTarget(ctx);
    const meta = ctx.data.metaByIdx(ctx.state.targetIdx);
    ctx.hud.setPanel('<img class="flag-img" src="flags/' + meta.iso2 + '.svg" alt="Flag to identify">');
    ctx.hud.setTarget('Which country does this flag belong to?');
    ctx.map.setActiveFeatureIndices(ctx.state.pool);
    repaint(ctx);
  }

  function onMapClick(ctx, idx) {
    if (ctx.state.inputLocked) return;
    if (!ctx.state.pool.includes(idx)) return;
    ctx.state.inputLocked = true;
    const correct = idx === ctx.state.targetIdx;
    ctx.map.flashCountries([ctx.state.targetIdx], 'flash-good');
    if (!correct) ctx.map.flashCountries([idx], 'flash-bad');
    GN.progression.applyOutcome(correct ? { type: 'correct', cost: 10 } : { type: 'wrong', cost: 50 });
    ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
    ctx.hud.updateStat('points', GN.progression.getScore() + ' / ' + GN.progression.MAX_SCORE);
    ctx.hud.updateStat('streak', String(GN.progression.getCurrentStreak()));
    ctx.hud.showToast((correct ? 'Correct! ' : '') + 'That flag belongs to ' + ctx.data.names[ctx.state.targetIdx] + '.');
    ctx.scheduleTimeout(() => nextRound(ctx), 1400);
  }

  const mode = {
    setup(ctx) {
      ctx.state = { targetIdx: null, inputLocked: false, pool: GN.progression.scopePool(ctx.data.metaIndices) };
      GN.progression.reset();
      ctx.hud.setStats([
        { id: 'points', value: GN.progression.MAX_SCORE + ' / ' + GN.progression.MAX_SCORE, label: 'Points', cls: 'stat-points' },
        { id: 'streak', value: String(GN.progression.getCurrentStreak()), label: 'Streak' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
      ]);
      ctx.hud.setLegend('<span class="elim"><span class="swatch"></span>Not in play</span>');
      ctx.hud.setHint('Click the country this flag belongs to.');
      nextRound(ctx);
    },
    teardown(ctx) { ctx.hud.setPanel(''); ctx.hud.setLegend(''); },
    onMapClick,
  };

  GN.modeShell.registerMode('flags', mode);
})();
