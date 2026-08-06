(function () {
  const GN = window.GN = window.GN || {};
  const ORGS = ['EU', 'NATO', 'G7', 'G20', 'ASEAN', 'AU', 'COMMONWEALTH', 'OPEC', 'BRICS', 'SCHENGEN', 'EUROZONE'];
  const ORG_LABELS = {
    EU: 'European Union', NATO: 'NATO', G7: 'G7', G20: 'G20', ASEAN: 'ASEAN',
    AU: 'African Union', COMMONWEALTH: 'Commonwealth', OPEC: 'OPEC', BRICS: 'BRICS',
    SCHENGEN: 'Schengen Area', EUROZONE: 'Eurozone',
  };

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pickRound(ctx) {
    const pool = ctx.state.pool;
    let org, members;
    for (let tries = 0; tries < 20; tries++) {
      org = ORGS[Math.floor(Math.random() * ORGS.length)];
      members = pool.filter((i) => (ctx.data.metaByIdx(i).orgs || []).includes(org));
      if (members.length >= 5) break;
    }
    if (members.length < 5) return null;
    const sample = shuffle(members.slice()).slice(0, 5);
    const nonMembers = pool.filter((i) => !(ctx.data.metaByIdx(i).orgs || []).includes(org));
    if (nonMembers.length === 0) return null;
    const impostor = nonMembers[Math.floor(Math.random() * nonMembers.length)];
    return { org, impostor, all: sample.concat([impostor]) };
  }

  function repaint(ctx) {
    const cand = new Set(ctx.state.all);
    ctx.map.paintClasses({
      'guessable': (i) => cand.has(i),
      'eliminated': (i) => !cand.has(i),
    });
    ctx.map.clearFlashClasses();
  }

  function nextRound(ctx) {
    const round = pickRound(ctx);
    if (!round) {
      ctx.hud.setTarget('Not enough data for that round — retrying…');
      ctx.scheduleTimeout(() => nextRound(ctx), 400);
      return;
    }
    ctx.state.inputLocked = false;
    ctx.state.org = round.org;
    ctx.state.impostor = round.impostor;
    ctx.state.all = round.all;
    ctx.hud.setTarget('Which of these does <b>NOT</b> belong to the <b>' + ORG_LABELS[round.org] + '</b>?');
    ctx.map.setActiveFeatureIndices(round.all);
    const proj = ctx.map.buildProjection(round.all.map((i) => ctx.data.features[i]));
    ctx.map.animateToProjection(proj, () => repaint(ctx));
  }

  function onMapClick(ctx, idx) {
    if (ctx.state.inputLocked) return;
    if (!ctx.state.all.includes(idx)) return;
    ctx.state.inputLocked = true;
    const correct = idx === ctx.state.impostor;
    ctx.map.flashCountries([ctx.state.impostor], 'flash-good');
    if (!correct) ctx.map.flashCountries([idx], 'flash-bad');
    GN.progression.applyOutcome(correct ? { type: 'correct', cost: 10 } : { type: 'wrong', cost: 50 });
    ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
    ctx.hud.updateStat('points', GN.progression.getScore() + ' / ' + GN.progression.MAX_SCORE);
    ctx.hud.updateStat('streak', String(GN.progression.getCurrentStreak()));
    // A short delay so the map's flash colors are visible before the
    // overlay covers it, then wait for the player's own "Next round" click
    // instead of auto-advancing — they choose when they're done reading.
    ctx.scheduleTimeout(() => {
      ctx.hud.showRoundResult({
        correct,
        title: correct ? 'Correct!' : 'Not quite',
        sub: ctx.data.names[ctx.state.impostor] + ' is the odd one out — the other five are all ' + ORG_LABELS[ctx.state.org] + ' members.',
        onNext: () => nextRound(ctx),
      });
    }, 550);
  }

  const mode = {
    title: 'Bloc Bingo',
    setup(ctx) {
      ctx.state = { org: null, impostor: null, all: [], inputLocked: false, pool: GN.progression.buildPool(ctx.data.metaIndices) };
      GN.progression.reset();
      ctx.hud.setStats([
        { id: 'points', value: GN.progression.MAX_SCORE + ' / ' + GN.progression.MAX_SCORE, label: 'Points', cls: 'stat-points' },
        { id: 'streak', value: String(GN.progression.getCurrentStreak()), label: 'Streak' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
      ]);
      ctx.hud.setLegend(
        '<span class="g"><span class="swatch"></span>Candidates</span>' +
        '<span class="elim"><span class="swatch"></span>Not in play</span>'
      );
      ctx.hud.setPanel('');
      ctx.hud.setHint('Six countries are highlighted — five share a bloc, one doesn’t. Click the odd one out.');
      nextRound(ctx);
    },
    teardown(ctx) { ctx.hud.setPanel(''); ctx.hud.setLegend(''); },
    onMapClick,
  };

  GN.modeShell.registerMode('blocs', mode);
})();
