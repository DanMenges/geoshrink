(function () {
  const GN = window.GN = window.GN || {};
  const START_SUPPLIES = 4;
  const BASE_COINS = 100;
  const COMBO_STEP = 15; // extra coins per consecutive correct answer beyond the first
  const COMBO_CAP = 10; // combo bonus stops growing past this many in a row (still keeps the x-streak flavor, just bounded)

  // Difficulty (shared with the rest of the app via the Home-screen tier
  // picker) controls path length here rather than candidate-pool size, since
  // a "harder" expedition is a longer journey, not a bigger guessing pool.
  const LEGS_BY_DIFFICULTY = { easy: 4, medium: 12, hard: 25 };

  function largestComponent(neighbors, pool) {
    const poolSet = new Set(pool);
    const seen = new Set();
    let best = [];
    for (const start of pool) {
      if (seen.has(start)) continue;
      const comp = [start];
      seen.add(start);
      const queue = [start];
      let qi = 0;
      while (qi < queue.length) {
        const cur = queue[qi++];
        for (const n of neighbors[cur]) {
          if (poolSet.has(n) && !seen.has(n)) { seen.add(n); comp.push(n); queue.push(n); }
        }
      }
      if (comp.length > best.length) best = comp;
    }
    return best;
  }

  // BFS shortest paths between two random countries won't always land on
  // exactly the desired length (especially for the longer tiers — most
  // shortest paths in this graph are well under 20 hops), so this searches
  // many random start/end pairs and keeps whichever comes closest.
  //
  // Candidates are drawn from the component minus recently-used endpoints
  // (GN.progression.getExpeditionRecent) rather than the raw component —
  // plain Math.random() over the same fixed pool every round meant the same
  // handful of countries kept resurfacing as origin/destination across
  // consecutive rounds. Falls back to the full component if the exclusion
  // would leave too little to search from.
  function pickRoute(ctx, desiredLegs) {
    const component = ctx.state.component;
    const recent = new Set(GN.progression.getExpeditionRecent());
    let candidates = component.filter((i) => !recent.has(i));
    if (candidates.length < 2) candidates = component;

    let best = null, bestDiff = Infinity;
    for (let tries = 0; tries < 60; tries++) {
      const start = candidates[Math.floor(Math.random() * candidates.length)];
      let end = start;
      while (end === start) end = candidates[Math.floor(Math.random() * candidates.length)];
      const route = GN.graph.bfsShortestPath(ctx.data.neighbors, start, end);
      if (!route) continue;
      const diff = Math.abs((route.length - 1) - desiredLegs);
      if (diff < bestDiff) { bestDiff = diff; best = route; }
      if (diff === 0) break;
    }
    const route = best || [component[0]];
    GN.progression.recordExpeditionEndpoints(route[0], route[route.length - 1]);
    return route;
  }

  function repaintMap(ctx) {
    const doneSet = new Set(ctx.state.route.slice(0, ctx.state.pos));
    const inPlay = new Set(ctx.data.playableIndices);
    ctx.map.paintClasses({
      'exp-done': (i) => doneSet.has(i),
      'guessable': (i) => !doneSet.has(i) && inPlay.has(i),
      'eliminated': (i) => !inPlay.has(i),
    });
    ctx.map.clearFlashClasses();
  }

  function updateSupplyStat(ctx) {
    ctx.hud.updateStat('supplies', '❤'.repeat(ctx.state.supplies) + '♡'.repeat(START_SUPPLIES - ctx.state.supplies));
  }

  function presentObstacle(ctx) {
    const idx = ctx.state.route[ctx.state.pos];
    ctx.state.obstacleIdx = idx;
    ctx.hud.updateStat('leg', ctx.state.pos + ' / ' + (ctx.state.route.length - 1));
    ctx.hud.setTarget('Next stop — click: <b>' + ctx.data.names[idx] + '</b>');
    repaintMap(ctx);
  }

  function onMapClick(ctx, idx) {
    if (ctx.state.inputLocked) return;
    const inPlay = new Set(ctx.data.playableIndices);
    const doneSet = new Set(ctx.state.route.slice(0, ctx.state.pos));
    if (doneSet.has(idx) || !inPlay.has(idx)) return;
    resolve(ctx, idx === ctx.state.obstacleIdx, idx);
  }

  function resolve(ctx, correct, clickedIdx) {
    ctx.state.inputLocked = true;
    ctx.map.flashCountries([ctx.state.obstacleIdx], 'flash-good');
    if (!correct) ctx.map.flashCountries([clickedIdx], 'flash-bad');

    if (correct) {
      // points:0 — Expedition doesn't use the shared running-points display;
      // correct answers only ever add coins here. Still routed through
      // applyOutcome so XP, the cross-mode best-streak, and the persistent
      // coin wallet stay consistent with every other mode. The combo bonus
      // needs the streak AFTER this answer, which applyOutcome computes
      // internally — so it's projected here (current + 1) and handed in via
      // outcome.coins, rather than calling applyOutcome twice.
      const projectedStreak = GN.progression.getCurrentStreak() + 1;
      const comboBonus = Math.min(projectedStreak - 1, COMBO_CAP) * COMBO_STEP;
      const outcome = GN.progression.applyOutcome({ type: 'correct', points: 0, coins: BASE_COINS + comboBonus });
      const streak = outcome.currentStreak;
      const earned = outcome.coinsGain;
      ctx.state.coins += earned;
      ctx.hud.updateStat('coins', String(ctx.state.coins));
      ctx.hud.updateStat('streak', String(streak));
      ctx.hud.showToast(
        '+' + earned + (streak > 1 ? ' (streak ×' + streak + ')' : '') + ' — on to ' +
        (ctx.state.pos + 1 < ctx.state.route.length ? ctx.data.names[ctx.state.route[ctx.state.pos + 1]] : 'the destination') + '!'
      );
      ctx.scheduleTimeout(() => {
        ctx.state.pos++;
        if (ctx.state.pos >= ctx.state.route.length) {
          finish(ctx, true);
        } else {
          ctx.state.inputLocked = false;
          repaintMap(ctx);
          presentObstacle(ctx);
        }
      }, 600);
    } else {
      const outcome = GN.progression.applyOutcome({ type: 'wrong' });
      ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
      ctx.hud.updateStat('streak', String(outcome.currentStreak));
      ctx.state.supplies--;
      updateSupplyStat(ctx);
      ctx.hud.shakeBoard();
      ctx.hud.showToast('No coins this time — that was ' + ctx.data.names[ctx.state.obstacleIdx] + '. Lost a supply!');
      ctx.scheduleTimeout(() => {
        if (ctx.state.supplies <= 0) {
          finish(ctx, false);
        } else {
          ctx.state.inputLocked = false;
          repaintMap(ctx);
          presentObstacle(ctx);
        }
      }, 900);
    }
  }

  function finish(ctx, success) {
    const start = ctx.data.names[ctx.state.route[0]];
    const end = ctx.data.names[ctx.state.route[ctx.state.route.length - 1]];
    if (success) {
      ctx.map.paintClasses({
        'exp-done': (i) => ctx.state.route.includes(i),
        'eliminated': (i) => !ctx.data.playableIndices.includes(i) && !ctx.state.route.includes(i),
      });
      ctx.hud.showWin({
        title: 'Expedition complete!',
        sub: ctx.state.coins + ' coins — traveled from ' + start + ' to ' + end + ' (' + (ctx.state.route.length - 1) + ' legs) with ' + ctx.state.supplies + ' ' + (ctx.state.supplies === 1 ? 'supply' : 'supplies') + ' left.',
      });
    } else {
      ctx.hud.showWin({
        title: 'Out of supplies!',
        sub: ctx.state.coins + ' coins earned — your expedition from ' + start + ' toward ' + end + ' ran out of supplies at ' + ctx.data.names[ctx.state.obstacleIdx] + '. Try again?',
        failed: true,
      });
    }
  }

  const mode = {
    title: 'Expedition',
    setup(ctx) {
      const difficulty = GN.progression.getSelectedDifficulty();
      const desiredLegs = LEGS_BY_DIFFICULTY[difficulty.id] || LEGS_BY_DIFFICULTY.easy;
      ctx.state = {
        component: largestComponent(ctx.data.neighbors, ctx.data.playableIndices),
        route: null, pos: 1, supplies: START_SUPPLIES, inputLocked: false,
        obstacleIdx: null, coins: 0,
      };
      ctx.state.route = pickRoute(ctx, desiredLegs);
      GN.progression.reset();
      ctx.hud.setStats([
        { id: 'leg', value: '0 / ' + (ctx.state.route.length - 1), label: 'Leg' },
        { id: 'coins', value: '0', label: 'Coins', cls: 'stat-points' },
        { id: 'streak', value: '0', label: 'Streak' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
        { id: 'supplies', value: '', label: 'Supplies' },
      ]);
      updateSupplyStat(ctx);
      ctx.hud.setLegend(
        '<span class="known"><span class="swatch"></span>Traveled</span>' +
        '<span class="g"><span class="swatch"></span>Click to advance</span>' +
        '<span class="elim"><span class="swatch"></span>Not in play</span>'
      );
      ctx.hud.setPanel('');
      ctx.hud.setHint('Click the named country to press on and earn coins. A run of correct answers earns a streak bonus — a wrong one costs a supply, not coins.');
      ctx.map.setActiveFeatureIndices(ctx.data.playableIndices);
      repaintMap(ctx);
      presentObstacle(ctx);
    },
    teardown(ctx) { ctx.hud.setPanel(''); ctx.hud.setLegend(''); },
    onMapClick,
  };

  GN.modeShell.registerMode('expedition', mode);
})();
