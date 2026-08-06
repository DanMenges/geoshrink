(function () {
  const GN = window.GN = window.GN || {};
  const DIRS = ['North', 'South', 'East', 'West'];

  function bearing(from, to) {
    const dLon = to[0] - from[0];
    const dLat = to[1] - from[1];
    if (Math.abs(dLat) > Math.abs(dLon)) return dLat > 0 ? 'North' : 'South';
    return dLon > 0 ? 'East' : 'West';
  }

  function pickRound(ctx) {
    const pool = ctx.state.pool;
    const ref = GN.progression.pickTarget(pool);
    let target = ref;
    while (target === ref && pool.length > 1) target = GN.progression.pickTarget(pool);
    return { ref, target };
  }

  function renderChoices(ctx) {
    const html = DIRS.map((d) => '<button class="hud-btn choice-btn" data-dir="' + d + '">' + d + '</button>').join('');
    ctx.hud.setPanel(html);
    DIRS.forEach((d) => {
      document.querySelector('.choice-btn[data-dir="' + d + '"]').addEventListener('click', () => onChoice(ctx, d));
    });
  }

  function nextRound(ctx) {
    ctx.state.inputLocked = false;
    const { ref, target } = pickRound(ctx);
    ctx.state.ref = ref;
    ctx.state.target = target;
    ctx.state.answer = bearing(ctx.data.centroids[ref], ctx.data.centroids[target]);
    ctx.hud.setTarget('Is <b>' + ctx.data.names[target] + '</b> north, south, east, or west of <b>' + ctx.data.names[ref] + '</b>?');
    renderChoices(ctx);
    ctx.map.setActiveFeatureIndices([ref, target]);
    const proj = ctx.map.buildProjection([ctx.data.features[ref], ctx.data.features[target]]);
    const inPlay = new Set(ctx.state.pool);
    ctx.map.animateToProjection(proj, () => {
      ctx.map.paintClasses({
        'group-a': (i) => i === ref,
        'group-b': (i) => i === target,
        'available': (i) => i !== ref && i !== target && inPlay.has(i),
        'eliminated': (i) => !inPlay.has(i),
      });
      ctx.map.clearFlashClasses();
    });
  }

  function onChoice(ctx, dir) {
    if (ctx.state.inputLocked) return;
    ctx.state.inputLocked = true;
    const correct = dir === ctx.state.answer;
    document.querySelectorAll('.choice-btn').forEach((btn) => {
      const d = btn.getAttribute('data-dir');
      if (d === ctx.state.answer) btn.classList.add('choice-correct');
      else if (d === dir) btn.classList.add('choice-wrong');
      btn.disabled = true;
    });
    GN.progression.applyOutcome(correct ? { type: 'correct', cost: 10 } : { type: 'wrong', cost: 50 });
    ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
    ctx.hud.updateStat('points', GN.progression.getScore() + ' / ' + GN.progression.MAX_SCORE);
    ctx.hud.updateStat('streak', String(GN.progression.getCurrentStreak()));
    ctx.scheduleTimeout(() => nextRound(ctx), 1300);
  }

  const mode = {
    title: 'Compass Quiz',
    setup(ctx) {
      ctx.state = { ref: null, target: null, answer: null, inputLocked: false, pool: GN.progression.buildPool(ctx.data.playableIndices) };
      GN.progression.reset();
      ctx.hud.setStats([
        { id: 'points', value: GN.progression.MAX_SCORE + ' / ' + GN.progression.MAX_SCORE, label: 'Points', cls: 'stat-points' },
        { id: 'streak', value: String(GN.progression.getCurrentStreak()), label: 'Streak' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
      ]);
      ctx.hud.setLegend(
        '<span class="a"><span class="swatch"></span>Reference</span>' +
        '<span class="b"><span class="swatch"></span>Target</span>' +
        '<span class="avail"><span class="swatch"></span>Other countries</span>'
      );
      ctx.hud.setHint('Pick the compass direction of the target relative to the reference country — use the buttons below, the map isn’t clickable here.');
      nextRound(ctx);
    },
    teardown(ctx) { ctx.hud.setPanel(''); ctx.hud.setLegend(''); },
    onMapClick() {},
  };

  GN.modeShell.registerMode('compass', mode);
})();
