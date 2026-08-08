(function () {
  const GN = window.GN = window.GN || {};

  // Direct-guess mechanic on the rivers/lakes overlay (engine/map.js) --
  // same "no narrowing, whole board clickable" shape as modes/path.js,
  // since GN.geoPartition's border-adjacency narrowing has no meaning for
  // line geometry. Countries are dimmed to a neutral backdrop; the water
  // layer itself is the thing being played on.
  function buildPool() {
    const rivers = GN.map.getWaterRivers().map((f, i) => ({ type: 'river', idx: i, name: f.properties.name }));
    const lakes = GN.map.getWaterLakes().map((f, i) => ({ type: 'lake', idx: i, name: f.properties.name }));
    return rivers.concat(lakes);
  }

  function nextRound(ctx) {
    ctx.state.inputLocked = false;
    ctx.state.target = ctx.state.pool[Math.floor(Math.random() * ctx.state.pool.length)];
    const kind = ctx.state.target.type === 'river' ? 'river' : 'lake';
    ctx.hud.setTarget('Click the ' + kind + ': <b>' + ctx.state.target.name + '</b>');
  }

  function onWaterClick(ctx, type, idx) {
    if (ctx.state.inputLocked) return;
    const target = ctx.state.target;
    const correct = type === target.type && idx === target.idx;
    ctx.state.inputLocked = true;
    GN.progression.applyOutcome(correct ? { type: 'correct', points: 50 } : { type: 'wrong' });
    ctx.hud.updateStat('mistakes', String(GN.progression.getMistakes()));
    ctx.hud.updateStat('points', String(GN.progression.getScore()));
    ctx.hud.updateStat('streak', String(GN.progression.getCurrentStreak()));
    ctx.hud.showToast(correct ? 'Correct!' : (target.name + ' was the answer.'));
    ctx.scheduleTimeout(() => nextRound(ctx), correct ? 650 : 950);
  }

  const mode = {
    title: 'Water Wisdom',
    setup(ctx) {
      ctx.state = { pool: buildPool(), inputLocked: true, target: null };
      GN.progression.reset();
      ctx.map.setActiveFeatureIndices(ctx.data.playableIndices);
      // Countries become a neutral backdrop -- the water layer is what's in play.
      ctx.map.paintClasses({ eliminated: () => true });
      GN.map.setWaterVisible(true);
      GN.map.setWaterInteractive(true, {
        onWaterClick: (type, idx) => onWaterClick(ctx, type, idx),
        onWaterHover: (type, idx, event) => {
          const list = type === 'river' ? GN.map.getWaterRivers() : GN.map.getWaterLakes();
          const feat = list[idx];
          ctx.hud.showTooltip(event, feat ? feat.properties.name : '');
        },
        onWaterLeave: () => ctx.hud.hideTooltip(),
      });
      ctx.hud.setStats([
        { id: 'points', value: '0', label: 'Points', cls: 'stat-points' },
        { id: 'streak', value: String(GN.progression.getCurrentStreak()), label: 'Streak' },
        { id: 'mistakes', value: '0', label: 'Mistakes' },
      ]);
      ctx.hud.setLegend('<span class="g"><span class="swatch"></span>Rivers & lakes</span>');
      ctx.hud.setPanel('');
      ctx.hud.setHint('Click the highlighted river or lake that matches the clue above.');
      nextRound(ctx);
    },
    teardown(ctx) {
      GN.map.setWaterInteractive(false);
      GN.map.setWaterVisible(false);
      ctx.hud.setPanel('');
      ctx.hud.setLegend('');
      ctx.hud.hideTooltip();
    },
    onMapClick() {}, // countries are just a dimmed backdrop in this mode
  };

  GN.modeShell.registerMode('water', mode);
})();
