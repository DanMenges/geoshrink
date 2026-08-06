(function () {
  const GN = window.GN = window.GN || {};

  function pickFlagTarget(ctx) {
    return GN.progression.pickTarget(ctx.state.pool);
  }

  function repaint(ctx) {
    const inPlay = new Set(ctx.state.pool);
    ctx.map.paintClasses({
      'guessable': (i) => inPlay.has(i),
      'eliminated': (i) => !inPlay.has(i),
    });
    ctx.map.clearFlashClasses();
  }

  function nextRound(ctx) {
    ctx.state.inputLocked = false;
    ctx.state.targetIdx = pickFlagTarget(ctx);
    const meta = ctx.data.metaByIdx(ctx.state.targetIdx);
    ctx.hud.setTarget(
      '<div class="find-with-flag">' +
      '<img class="find-flag-img" src="flags/' + meta.iso2 + '.svg" alt="Flag to identify">' +
      '<span>Which country does this flag belong to?</span>' +
      '</div>'
    );
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
    GN.progression.applyOutcome(correct ? { type: 'correct', points: 50 } : { type: 'wrong' });
    ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
    ctx.hud.updateStat('points', String(GN.progression.getScore()));
    ctx.hud.updateStat('streak', String(GN.progression.getCurrentStreak()));
    ctx.scheduleTimeout(() => {
      ctx.hud.showRoundResult({
        correct,
        title: correct ? 'Correct!' : 'Not quite',
        sub: 'That flag belongs to ' + ctx.data.names[ctx.state.targetIdx] + '.',
        onNext: () => nextRound(ctx),
      });
    }, 550);
  }

  const mode = {
    title: 'Flag Frenzy',
    setup(ctx) {
      ctx.state = { targetIdx: null, inputLocked: false, pool: GN.progression.buildPool(ctx.data.metaIndices) };
      GN.progression.reset();
      ctx.hud.setStats([
        { id: 'points', value: '0', label: 'Points', cls: 'stat-points' },
        { id: 'streak', value: String(GN.progression.getCurrentStreak()), label: 'Streak' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
      ]);
      ctx.hud.setLegend(
        '<span class="g"><span class="swatch"></span>Click to answer</span>' +
        '<span class="elim"><span class="swatch"></span>Not in play</span>'
      );
      ctx.hud.setHint('Click the country this flag belongs to.');
      nextRound(ctx);
    },
    teardown(ctx) { ctx.hud.setPanel(''); ctx.hud.setLegend(''); },
    onMapClick,
  };

  GN.modeShell.registerMode('flags', mode);
})();
