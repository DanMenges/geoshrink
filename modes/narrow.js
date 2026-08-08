(function () {
  const GN = window.GN = window.GN || {};

  const NARROW_CORRECT_POINTS = 50;
  // A blind guess before narrowing at all (level 0) is worth the full 1000 —
  // the riskiest, most impressive play. Each round already spent narrowing
  // chips 100 off that ceiling, since the guess got easier with every
  // elimination along the way.
  const DIRECT_GUESS_BASE = 1000;
  const DIRECT_GUESS_STEP = 100;
  const HINT_DEFAULT = 'Click the highlighted region you believe contains the target country.';
  const HINT_GUESS = 'Guess mode: click any highlighted country to name it directly.';
  const HINT_ENDGAME_3 = 'Down to the final three — pick the one you think is correct.';
  const HINT_ENDGAME_2 = 'Down to the final two — pick the one you think is correct.';
  const STANDARD_LEGEND =
    '<span class="a"><span class="swatch"></span>Region A</span>' +
    '<span class="b"><span class="swatch"></span>Region B</span>' +
    '<span class="g"><span class="swatch"></span>Guessable</span>' +
    '<span class="elim"><span class="swatch"></span>Eliminated</span>';
  // A binary split's "grouped" choice hides which specific country in the
  // larger group might be right — fine mid-search, but flat at the very end
  // where the player likely already knows several of the remaining
  // countries by name. Once exactly 3 (then 2) remain, skip the grouped
  // split and let them pick a specific country directly, each in its own
  // color. Reuses the existing group-a/group-b/guessable palette (already
  // colorblind-validated together) rather than inventing new colors.
  const ENDGAME_PAINT_CLASSES = ['group-a', 'group-b', 'guessable'];
  const ENDGAME_LEGEND_CLASSES = ['a', 'b', 'g'];

  const { buildPath } = GN.geoPartition;

  function wirePanel(ctx) {
    const guessBtn = document.getElementById('guess-btn');
    guessBtn.addEventListener('click', () => {
      if (!ctx.data.features || ctx.hud.isWinShown() || ctx.state.inputLocked || ctx.state.endgame) return;
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
    ctx.state.endgame = null;
    ctx.hud.setTarget('Find: <b>' + ctx.data.names[ctx.state.targetIdx] + '</b>');
    goToLevel(ctx, 0, false, () => { ctx.state.inputLocked = false; });
  }

  function paintLevel(ctx) {
    const step = ctx.state.path[ctx.state.level];
    if (!ctx.state.guessMode && step.subset.length === 3) {
      enterEndgame(ctx, step.subset);
      return;
    }
    ctx.hud.setLegend(STANDARD_LEGEND);
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
    ctx.hud.updateStat('points', String(GN.progression.getScore()));
    const progress = remaining >= total ? 0 : 1 - Math.log(remaining) / Math.log(total);
    ctx.hud.setProgress(progress);
    // Colors get a little more vivid as the search narrows — see the
    // --narrow-progress comment in style.css.
    ctx.map.svg.style('--narrow-progress', progress);
  }

  // --- endgame: final 3 (then 2) individually, each its own color ---------

  function enterEndgame(ctx, subset) {
    ctx.state.endgame = { candidates: subset.slice() };
    paintEndgame(ctx);
  }

  function paintEndgame(ctx) {
    const candidates = ctx.state.endgame.candidates;
    const colorOf = new Map(candidates.map((idx, i) => [idx, ENDGAME_PAINT_CLASSES[i]]));
    ctx.map.paintClasses({
      'group-a': (i) => colorOf.get(i) === 'group-a',
      'group-b': (i) => colorOf.get(i) === 'group-b',
      'guessable': (i) => colorOf.get(i) === 'guessable',
      'eliminated': (i) => !colorOf.has(i),
    });
    ctx.map.clearFlashClasses();
    ctx.hud.setLegend(
      candidates.map((_, i) =>
        '<span class="' + ENDGAME_LEGEND_CLASSES[i] + '"><span class="swatch"></span>Candidate ' + (i + 1) + '</span>'
      ).join('')
    );
    ctx.hud.setHint(candidates.length === 3 ? HINT_ENDGAME_3 : HINT_ENDGAME_2);
    updateStats(ctx, ctx.state.level, candidates.length);
  }

  function handleEndgameClick(ctx, idx) {
    const candidates = ctx.state.endgame.candidates;
    if (!candidates.includes(idx)) return;
    ctx.state.inputLocked = true;
    if (idx === ctx.state.targetIdx) {
      ctx.map.flashCountries([idx], 'flash-good');
      ctx.scheduleTimeout(() => {
        GN.progression.applyOutcome({ type: 'correct', points: NARROW_CORRECT_POINTS, xp: 0 });
        ctx.state.level++;
        finishGame(ctx, [idx], false);
      }, 260);
    } else {
      const sel = ctx.map.flashCountries([idx], 'flash-bad');
      GN.progression.applyOutcome({ type: 'wrong', xp: 0 });
      ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
      GN.repairGlobe.setCracks(GN.progression.getMistakes());
      ctx.hud.updateStat('points', String(GN.progression.getScore()));
      ctx.hud.shakeBoard();
      ctx.scheduleTimeout(() => {
        sel.classed('flash-bad', false);
        const remaining = candidates.filter((c) => c !== idx);
        if (remaining.length === 1) {
          // Only one possibility left by elimination — resolve automatically,
          // same as the ordinary binary path already does at subset===1.
          ctx.state.level++;
          finishGame(ctx, remaining, false);
        } else {
          ctx.state.endgame.candidates = remaining;
          ctx.state.inputLocked = false;
          paintEndgame(ctx);
        }
      }, 380);
    }
  }

  function onCountryClick(ctx, idx) {
    if (ctx.hud.isWinShown() || ctx.state.inputLocked) return;
    if (ctx.state.endgame) { handleEndgameClick(ctx, idx); return; }
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
        GN.progression.applyOutcome({ type: 'correct', points: NARROW_CORRECT_POINTS, xp: 0 });
        ctx.hud.updateStat('points', String(GN.progression.getScore()));
        ctx.state.level++;
        if (clickedSet.length === 1 || !ctx.state.path[ctx.state.level]) {
          finishGame(ctx, clickedSet, false);
        } else {
          goToLevel(ctx, ctx.state.level, true, () => { ctx.state.inputLocked = false; });
        }
      }, 260);
    } else {
      const sel = ctx.map.flashCountries(clickedSet, 'flash-bad');
      GN.progression.applyOutcome({ type: 'wrong', xp: 0 });
      ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
      GN.repairGlobe.setCracks(GN.progression.getMistakes());
      ctx.hud.updateStat('points', String(GN.progression.getScore()));
      ctx.hud.shakeBoard();
      ctx.scheduleTimeout(() => sel.classed('flash-bad', false), 320);
    }
  }

  function handleGuessClick(ctx, idx, step) {
    if (!step.subset.includes(idx)) return;
    if (idx === ctx.state.targetIdx) {
      ctx.state.inputLocked = true;
      ctx.map.flashCountries([idx], 'flash-good');
      ctx.scheduleTimeout(() => {
        const points = Math.max(0, DIRECT_GUESS_BASE - DIRECT_GUESS_STEP * ctx.state.level);
        GN.progression.applyOutcome({ type: 'correct', points, xp: 0 });
        finishGame(ctx, [idx], true);
      }, 260);
    } else {
      const sel = ctx.map.flashCountries([idx], 'flash-bad');
      GN.progression.applyOutcome({ type: 'wrong', xp: 0 });
      ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
      GN.repairGlobe.setCracks(GN.progression.getMistakes());
      ctx.hud.updateStat('points', String(GN.progression.getScore()));
      ctx.hud.shakeBoard();
      ctx.scheduleTimeout(() => {
        sel.classed('flash-bad', false);
        setGuessMode(ctx, false);
        paintLevel(ctx);
      }, 380);
    }
  }

  // How long the stamp celebration gets to play before the win overlay
  // (which dims most of the map) covers it — long enough to actually read
  // as a moment, short enough not to feel like a delay before the reward.
  const CELEBRATION_HOLD_MS = 700;

  function finishGame(ctx, finalSet, isDirectGuess) {
    const finalIdxSet = new Set(finalSet);
    ctx.state.endgame = null;
    // Pulls back OUT to the round's original wide framing (the same view it
    // started with, before any narrowing) rather than staying at whatever
    // tight crop the last narrowing step happened to leave, or zooming
    // further in on the winner — gives the player a "farther distance" look
    // at the result in its broader context. The celebration only plays once
    // that settles, so the stamp lands accurately on the (now smaller,
    // farther-away) highlighted country instead of chasing a moving view.
    ctx.map.setActiveFeatureIndices(ctx.state.pool);
    const wideProj = ctx.map.buildProjection(ctx.state.pool.map((i) => ctx.data.features[i]));
    ctx.map.animateToProjection(wideProj, () => {
      ctx.map.paintClasses({
        'group-a': () => false,
        'group-b': () => false,
        'guessable': () => false,
        'eliminated': (i) => !finalIdxSet.has(i),
      });
      ctx.map.flashCountries(finalSet, 'flash-good');
      celebrateStamp(ctx, ctx.state.targetIdx);

      const level = ctx.state.level || 1;
      const mistakes = GN.progression.getMistakes();
      const score = GN.progression.getScore();
      // Geo Shrink grants XP once per round, proportional to the round's
      // final score, instead of the fixed per-answer amount every other
      // mode uses (see GN.progression.applyRoundXp) — a perfect 1000-point
      // round pays 50/75/100 XP on Easy/Medium/Hard.
      const xpResult = GN.progression.applyRoundXp(score);
      ctx.hud.updateStat('round', String(level));
      ctx.hud.updateStat('remaining', '1');
      ctx.hud.updateStat('points', String(score));
      ctx.hud.setProgress(1);
      const mistakeTxt = mistakes ? ' (' + mistakes + ' mistake' + (mistakes === 1 ? '' : 's') + ')' : '';
      // A flawless run (repaired mistakes count as never having happened —
      // see GN.progression.useRepairTool) advances this country's passport
      // collection: Tourist Visa -> Long-Stay Visa -> Passport over three
      // separate flawless completions of the SAME country.
      let visaTxt = '';
      if (mistakes === 0) {
        const result = GN.progression.recordFlawlessCompletion(ctx.state.targetIdx);
        if (result.tierUp) {
          visaTxt = ' Earned a ' + result.tierLabel + ' for ' + ctx.data.names[ctx.state.targetIdx] + '!';
        }
      }
      ctx.scheduleTimeout(() => {
        ctx.hud.showWin({
          title: ctx.data.names[ctx.state.targetIdx] + '!',
          sub: (isDirectGuess
            ? 'Guessed directly for ' + score + ' points' + mistakeTxt + '.'
            : 'Scored ' + score + ' points — found in ' + level + ' round' + (level === 1 ? '' : 's') + mistakeTxt + '.') +
            ' +' + xpResult.xpGain + ' XP.' + visaTxt,
        });
      }, CELEBRATION_HOLD_MS);
    });
  }

  // --- celebration: an "official stamp" seal, landing right on the map ----
  // Fits the passport/visa theme already established by the Collections
  // system — a small, tasteful mark rather than a screen-covering effect.
  const STAMP_INNER_SVG =
    '<circle class="cs-ring-a" r="18"></circle>' +
    '<circle class="cs-ring-b" r="13"></circle>' +
    '<path class="cs-check" d="M-6.5,0 L-1.5,5.5 L7.5,-7"></path>';

  function celebrateStamp(ctx, idx) {
    const proj = ctx.map.projection;
    const centroid = ctx.data.centroids && ctx.data.centroids[idx];
    if (!proj || !centroid) return;
    const pt = proj(centroid);
    if (!pt) return; // e.g. the far side of the globe after a rotation — nothing to anchor to, skip quietly
    const g = ctx.map.svg.append('g')
      .attr('class', 'celebration-stamp')
      .attr('transform', 'translate(' + pt[0] + ',' + pt[1] + ')');
    g.append('circle').attr('class', 'cs-pulse').attr('r', 4);
    g.append('g').attr('class', 'cs-mark').html(STAMP_INNER_SVG);
    ctx.scheduleTimeout(() => g.remove(), 1500);
  }

  // --- repair-tool globe widget --------------------------------------------
  // Geo Shrink only (see engine/repairGlobe.js) — a flawless run here is the
  // only thing a Repair Tool actually helps preserve.

  const repairWidgetEl = document.getElementById('globe-repair-widget');
  const repairToolsCountEl = document.getElementById('grw-tools-count');

  function showRepairWidget() {
    if (repairWidgetEl) repairWidgetEl.classList.add('show');
    GN.repairGlobe.start();
    GN.repairGlobe.reset();
    refreshRepairToolReadout();
  }
  function hideRepairWidget() {
    GN.repairGlobe.stop();
    if (repairWidgetEl) repairWidgetEl.classList.remove('show');
  }
  function refreshRepairToolReadout() {
    if (repairToolsCountEl) repairToolsCountEl.textContent = String(GN.progression.getRepairToolCount());
  }
  // Wired exactly once at module load (not per-setup — #grw-repair-btn is a
  // static element in index.html, not regenerated via ctx.hud.setPanel() like
  // the guess-mode toggle, so re-binding on every "New Game" would stack
  // duplicate listeners). Reads the live mode context at click time instead,
  // same pattern app.js's own onClick/onHover dispatch already uses.
  const repairBtnEl = document.getElementById('grw-repair-btn');
  if (repairBtnEl) {
    repairBtnEl.addEventListener('click', () => {
      const cur = GN.modeShell.current;
      if (!cur || cur.id !== 'narrow') return;
      const ctx = cur.ctx;
      if (ctx.hud.isWinShown() || ctx.state.inputLocked) return;
      if (GN.progression.useRepairTool()) {
        GN.repairGlobe.repairOne();
        ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
        refreshRepairToolReadout();
      } else if (GN.progression.getRepairToolCount() <= 0) {
        GN.hud.showToast('No Repair Tools left — earn more by leveling up!');
      } else {
        GN.hud.showToast('Nothing to repair right now.');
      }
    });
  }

  const mode = {
    title: 'Geo Shrink',
    setup(ctx) {
      const pool = GN.progression.buildPool(ctx.data.playableIndices);
      ctx.state = {
        path: null, level: 0, targetIdx: null, guessMode: false, inputLocked: true,
        endgame: null, pool,
      };
      GN.progression.reset();
      ctx.hud.setStats([
        { id: 'round', value: '–', label: 'Round' },
        { id: 'remaining', value: '–', label: 'Left' },
        { id: 'points', value: '0', label: 'Points', cls: 'stat-points' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
      ]);
      ctx.hud.setLegend(STANDARD_LEGEND);
      ctx.hud.setPanel(
        '<button class="hud-btn" id="guess-btn" title="Guess the exact country directly, without narrowing">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg>' +
        'Guess directly</button>'
      );
      ctx.hud.setHint(HINT_DEFAULT);
      wirePanel(ctx);
      ctx.map.setActiveFeatureIndices(ctx.state.pool);
      showRepairWidget();
      startNewRound(ctx);
    },
    teardown(ctx) {
      ctx.hud.setPanel('');
      ctx.hud.setLegend('');
      // --narrow-progress lives on the shared #map SVG, not anything
      // narrow.js-scoped — leaving it behind would tint group-a/group-b in
      // whichever mode is entered next.
      ctx.map.svg.style('--narrow-progress', null);
      hideRepairWidget();
    },
    onMapClick(ctx, idx) { onCountryClick(ctx, idx); },
  };

  GN.modeShell.registerMode('narrow', mode);
})();
