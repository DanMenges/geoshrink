(function () {
  const GN = window.GN = window.GN || {};

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pickRound(ctx) {
    const pool = ctx.state.pool;
    const targetIdx = GN.progression.pickTarget(pool);
    const choices = new Set([targetIdx]);
    while (choices.size < 4 && choices.size < pool.length) {
      choices.add(pool[Math.floor(Math.random() * pool.length)]);
    }
    return { targetIdx, choices: shuffle([...choices]) };
  }

  function renderChoices(ctx) {
    const html = ctx.state.choices
      .map((idx) => '<button class="hud-btn choice-btn" data-idx="' + idx + '">' + ctx.data.names[idx] + '</button>')
      .join('');
    ctx.hud.setPanel(html);
    ctx.state.choices.forEach((idx) => {
      document.querySelector('.choice-btn[data-idx="' + idx + '"]').addEventListener('click', () => onChoice(ctx, idx));
    });
  }

  function nextRound(ctx) {
    ctx.state.inputLocked = false;
    const round = pickRound(ctx);
    ctx.state.targetIdx = round.targetIdx;
    ctx.state.choices = round.choices;
    const meta = ctx.data.metaByIdx(round.targetIdx);
    ctx.hud.setTarget('Which country’s capital is: <b>' + (meta.capital || '—') + '</b>?');
    renderChoices(ctx);
    const inPlay = new Set(ctx.state.pool);
    ctx.map.setActiveFeatureIndices(ctx.state.pool);
    ctx.map.paintClasses({ 'available': (i) => inPlay.has(i), 'eliminated': (i) => !inPlay.has(i) });
    ctx.map.clearFlashClasses();
  }

  function onChoice(ctx, idx) {
    if (ctx.state.inputLocked) return;
    ctx.state.inputLocked = true;
    const correct = idx === ctx.state.targetIdx;
    document.querySelectorAll('.choice-btn').forEach((btn) => {
      const bIdx = +btn.getAttribute('data-idx');
      if (bIdx === ctx.state.targetIdx) btn.classList.add('choice-correct');
      else if (bIdx === idx) btn.classList.add('choice-wrong');
      btn.disabled = true;
    });
    ctx.map.flashCountries([ctx.state.targetIdx], 'flash-good');
    GN.progression.applyOutcome(correct ? { type: 'correct', cost: 10 } : { type: 'wrong', cost: 50 });
    ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
    ctx.hud.updateStat('points', GN.progression.getScore() + ' / ' + GN.progression.MAX_SCORE);
    ctx.hud.updateStat('streak', String(GN.progression.getCurrentStreak()));
    ctx.scheduleTimeout(() => nextRound(ctx), 1300);
  }

  const mode = {
    setup(ctx) {
      ctx.state = { targetIdx: null, choices: [], inputLocked: false, pool: GN.progression.buildPool(ctx.data.metaIndices) };
      GN.progression.reset();
      ctx.hud.setStats([
        { id: 'points', value: GN.progression.MAX_SCORE + ' / ' + GN.progression.MAX_SCORE, label: 'Points', cls: 'stat-points' },
        { id: 'streak', value: String(GN.progression.getCurrentStreak()), label: 'Streak' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
      ]);
      ctx.hud.setLegend('<span class="elim"><span class="swatch"></span>Not in play</span>');
      ctx.hud.setHint('Pick the country whose capital is shown above.');
      nextRound(ctx);
    },
    teardown(ctx) { ctx.hud.setPanel(''); ctx.hud.setLegend(''); },
    onMapClick() {},
  };

  GN.modeShell.registerMode('capitals', mode);
})();
