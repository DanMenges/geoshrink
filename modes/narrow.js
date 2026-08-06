(function () {
  const GN = window.GN = window.GN || {};

  const NARROW_CORRECT_COST = 10;
  const WRONG_COST = 50;
  const HINT_DEFAULT = 'Click the highlighted region you believe contains the target country.';
  const HINT_GUESS = 'Guess mode: click any highlighted country to name it directly.';

  const { buildPath } = GN.geoPartition;

  function wirePanel(ctx) {
    const guessBtn = document.getElementById('guess-btn');
    guessBtn.addEventListener('click', () => {
      if (!ctx.data.features || ctx.hud.isWinShown() || ctx.state.inputLocked) return;
      setGuessMode(ctx, !ctx.state.guessMode);
      paintLevel(ctx);
    });
    ctx.state.guessBtnEl = guessBtn;
  }

  function setGuessMode(ctx, on) {
    ctx.state.guessMode = on;
    ctx.state.guessBtnEl.classList.toggle('active', on);
    ctx.hud.setHint(on ? HINT_GUESS : HINT_DEFAULT);
  }

  function startNewRound(ctx) {
    const pool = ctx.state.pool;
    ctx.state.targetIdx = GN.progression.pickTarget(pool);
    ctx.state.path = buildPath(ctx.state.targetIdx, pool, ctx.data);
    ctx.state.level = 0;
    ctx.hud.setTarget('Find: <b>' + ctx.data.names[ctx.state.targetIdx] + '</b>');
    goToLevel(ctx, 0, false, () => { ctx.state.inputLocked = false; });
  }

  function paintLevel(ctx) {
    const step = ctx.state.path[ctx.state.level];
    const inA = new Set(step.groupA), inB = new Set(step.groupB);
    const inSubset = new Set(step.subset);
    const guessMode = ctx.state.guessMode;
    ctx.map.paintClasses({
      'group-a': (i) => !guessMode && inA.has(i),
      'group-b': (i) => !guessMode && inB.has(i),
      'guessable': (i) => guessMode && inSubset.has(i),
      'eliminated': (i) => !inSubset.has(i),
    });
    ctx.map.clearFlashClasses();
    updateStats(ctx, ctx.state.level, step.subset.length);
  }

  function goToLevel(ctx, lvl, animate, onDone) {
    const step = ctx.state.path[lvl];
    ctx.map.setActiveFeatureIndices(step.subset);
    const newProj = ctx.map.buildProjection(step.subset.map(i => ctx.data.features[i]));
    const apply = () => { paintLevel(ctx); onDone && onDone(); };
    if (animate) ctx.map.animateToProjection(newProj, apply);
    else { ctx.map.setProjectionImmediate(newProj); apply(); }
  }

  function updateStats(ctx, lvl, remaining) {
    const total = ctx.state.pool.length;
    ctx.hud.updateStat('round', (lvl + 1) + ' / ~' + Math.ceil(Math.log2(total)));
    ctx.hud.updateStat('remaining', remaining);
    ctx.hud.updateStat('points', GN.progression.getScore() + ' / ' + GN.progression.MAX_SCORE);
    const progress = remaining >= total ? 0 : 1 - Math.log(remaining) / Math.log(total);
    ctx.hud.setProgress(progress);
  }

  function onCountryClick(ctx, idx) {
    if (ctx.hud.isWinShown() || ctx.state.inputLocked) return;
    const step = ctx.state.path[ctx.state.level];
    if (!step) return;

    if (ctx.state.guessMode) { handleGuessClick(ctx, idx, step); return; }

    const inA = step.groupA.includes(idx);
    const inB = step.groupB.includes(idx);
    if (!inA && !inB) return;

    const clickedSide = inA ? 'A' : 'B';
    const targetSide = step.groupA.includes(ctx.state.targetIdx) ? 'A' : 'B';
    const clickedSet = clickedSide === 'A' ? step.groupA : step.groupB;

    if (clickedSide === targetSide) {
      ctx.state.inputLocked = true;
      ctx.map.flashCountries(clickedSet, 'flash-good');
      ctx.scheduleTimeout(() => {
        GN.progression.applyOutcome({ type: 'correct', cost: NARROW_CORRECT_COST });
        ctx.hud.updateStat('points', GN.progression.getScore() + ' / ' + GN.progression.MAX_SCORE);
        ctx.state.level++;
        if (clickedSet.length === 1 || !ctx.state.path[ctx.state.level]) {
          finishGame(ctx, clickedSet, false);
        } else {
          goToLevel(ctx, ctx.state.level, true, () => { ctx.state.inputLocked = false; });
        }
      }, 260);
    } else {
      const sel = ctx.map.flashCountries(clickedSet, 'flash-bad');
      GN.progression.applyOutcome({ type: 'wrong', cost: WRONG_COST });
      ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
      ctx.hud.updateStat('points', GN.progression.getScore() + ' / ' + GN.progression.MAX_SCORE);
      ctx.hud.shakeBoard();
      ctx.scheduleTimeout(() => sel.classed('flash-bad', false), 320);
    }
  }

  function handleGuessClick(ctx, idx, step) {
    if (!step.subset.includes(idx)) return;
    if (idx === ctx.state.targetIdx) {
      ctx.state.inputLocked = true;
      ctx.map.flashCountries([idx], 'flash-good');
      ctx.scheduleTimeout(() => finishGame(ctx, [idx], true), 260);
    } else {
      const sel = ctx.map.flashCountries([idx], 'flash-bad');
      GN.progression.applyOutcome({ type: 'wrong', cost: WRONG_COST });
      ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
      ctx.hud.updateStat('points', GN.progression.getScore() + ' / ' + GN.progression.MAX_SCORE);
      ctx.hud.shakeBoard();
      ctx.scheduleTimeout(() => {
        sel.classed('flash-bad', false);
        setGuessMode(ctx, false);
        paintLevel(ctx);
      }, 380);
    }
  }

  function finishGame(ctx, finalSet, isDirectGuess) {
    const feats = finalSet.map(i => ctx.data.features[i]);
    const newProj = ctx.map.buildProjection(feats);
    const finalIdxSet = new Set(finalSet);
    ctx.map.animateToProjection(newProj, () => {
      ctx.map.paintClasses({
        'group-a': () => false,
        'group-b': () => false,
        'guessable': () => false,
        'eliminated': (i) => !finalIdxSet.has(i),
      });
      ctx.map.flashCountries(finalSet, 'flash-good');
      const level = ctx.state.level || 1;
      const mistakes = GN.progression.getMistakes();
      const score = GN.progression.getScore();
      ctx.hud.updateStat('round', String(level));
      ctx.hud.updateStat('remaining', '1');
      ctx.hud.updateStat('points', score + ' / ' + GN.progression.MAX_SCORE);
      ctx.hud.setProgress(1);
      const mistakeTxt = mistakes ? ' (' + mistakes + ' mistake' + (mistakes === 1 ? '' : 's') + ')' : '';
      ctx.hud.showWin({
        title: ctx.data.names[ctx.state.targetIdx] + '!',
        sub: isDirectGuess
          ? 'Guessed directly for ' + score + ' / ' + GN.progression.MAX_SCORE + ' points' + mistakeTxt + '.'
          : 'Scored ' + score + ' / ' + GN.progression.MAX_SCORE + ' — found in ' + level + ' round' + (level === 1 ? '' : 's') + mistakeTxt + '.',
      });
    });
  }

  const mode = {
    title: 'Geo Shrink',
    setup(ctx) {
      const pool = GN.progression.buildPool(ctx.data.playableIndices);
      ctx.state = {
        path: null, level: 0, targetIdx: null, guessMode: false, inputLocked: true,
        pool,
      };
      GN.progression.reset();
      ctx.hud.setStats([
        { id: 'round', value: '–', label: 'Round' },
        { id: 'remaining', value: '–', label: 'Left' },
        { id: 'points', value: GN.progression.MAX_SCORE + ' / ' + GN.progression.MAX_SCORE, label: 'Points', cls: 'stat-points' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
      ]);
      ctx.hud.setLegend(
        '<span class="a"><span class="swatch"></span>Region A</span>' +
        '<span class="b"><span class="swatch"></span>Region B</span>' +
        '<span class="g"><span class="swatch"></span>Guessable</span>' +
        '<span class="elim"><span class="swatch"></span>Eliminated</span>'
      );
      ctx.hud.setPanel(
        '<button class="hud-btn" id="guess-btn" title="Guess the exact country directly, without narrowing">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg>' +
        'Guess directly</button>'
      );
      ctx.hud.setHint(HINT_DEFAULT);
      wirePanel(ctx);
      ctx.map.setActiveFeatureIndices(ctx.state.pool);
      startNewRound(ctx);
    },
    teardown(ctx) {
      ctx.hud.setPanel('');
      ctx.hud.setLegend('');
    },
    onMapClick(ctx, idx) { onCountryClick(ctx, idx); },
  };

  GN.modeShell.registerMode('narrow', mode);
})();
