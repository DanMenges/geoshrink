(function () {
  const GN = window.GN = window.GN || {};

  function pickPair(ctx) {
    const pool = ctx.state.pool;
    let a = pool[Math.floor(Math.random() * pool.length)];
    let b = a;
    while (b === a) b = pool[Math.floor(Math.random() * pool.length)];
    return [a, b];
  }

  function repaint(ctx) {
    const [a, b] = ctx.state.pair;
    const inPlay = new Set(ctx.state.pool);
    ctx.map.paintClasses({
      'group-a': (i) => i === a,
      'group-b': (i) => i === b,
      'available': (i) => i !== a && i !== b && inPlay.has(i),
      'eliminated': (i) => !inPlay.has(i),
    });
    ctx.map.clearFlashClasses();
  }

  function nextRound(ctx) {
    ctx.state.inputLocked = false;
    ctx.state.pair = pickPair(ctx);
    const [a, b] = ctx.state.pair;
    ctx.hud.setTarget('Which is <b>larger</b>: <b>' + ctx.data.names[a] + '</b> or <b>' + ctx.data.names[b] + '</b>?');
    ctx.map.setActiveFeatureIndices([a, b]);
    const proj = ctx.map.buildProjection([ctx.data.features[a], ctx.data.features[b]]);
    ctx.map.animateToProjection(proj, () => repaint(ctx));
  }

  function onMapClick(ctx, idx) {
    if (ctx.state.inputLocked) return;
    const [a, b] = ctx.state.pair;
    if (idx !== a && idx !== b) return;
    ctx.state.inputLocked = true;
    const larger = ctx.data.areas[a] >= ctx.data.areas[b] ? a : b;
    const correct = idx === larger;
    ctx.map.flashCountries([larger], 'flash-good');
    if (!correct) ctx.map.flashCountries([idx], 'flash-bad');
    GN.progression.applyOutcome(correct ? { type: 'correct', cost: 10 } : { type: 'wrong', cost: 50 });
    ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
    ctx.hud.updateStat('points', GN.progression.getScore() + ' / ' + GN.progression.MAX_SCORE);
    ctx.hud.updateStat('streak', String(GN.progression.getCurrentStreak()));
    ctx.state.rounds = (ctx.state.rounds || 0) + 1;
    ctx.hud.updateStat('rounds', String(ctx.state.rounds));
    ctx.hud.showToast(correct ? 'Correct!' : ctx.data.names[larger] + ' is larger.');
    ctx.scheduleTimeout(() => nextRound(ctx), 1300);
  }

  const mode = {
    setup(ctx) {
      ctx.state = { pair: null, inputLocked: false, rounds: 0, pool: GN.progression.scopePool(ctx.data.playableIndices) };
      GN.progression.reset();
      ctx.hud.setStats([
        { id: 'rounds', value: '0', label: 'Rounds' },
        { id: 'points', value: GN.progression.MAX_SCORE + ' / ' + GN.progression.MAX_SCORE, label: 'Points', cls: 'stat-points' },
        { id: 'streak', value: String(GN.progression.getCurrentStreak()), label: 'Streak' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
      ]);
      ctx.hud.setLegend(
        '<span class="a"><span class="swatch"></span>Option A</span>' +
        '<span class="b"><span class="swatch"></span>Option B</span>'
      );
      ctx.hud.setPanel('');
      ctx.hud.setHint('Click the country you think has the larger land area.');
      nextRound(ctx);
    },
    teardown(ctx) { ctx.hud.setPanel(''); ctx.hud.setLegend(''); },
    onMapClick,
  };

  GN.modeShell.registerMode('size', mode);
})();
