(function () {
  const GN = window.GN = window.GN || {};

  const TIER_LABEL = { 1: 'Warm-up', 2: 'Standard', 3: 'Challenge' };

  function nodeAt(index) {
    const nodes = GN.pathContent.getNodes();
    return nodes[index] || null;
  }

  function repaint(ctx) {
    const pool = new Set(ctx.data.metaIndices);
    ctx.map.paintClasses({
      'guessable': (i) => pool.has(i),
      'eliminated': (i) => !pool.has(i),
    });
    ctx.map.clearFlashClasses();
  }

  function loadNode(ctx) {
    const node = nodeAt(ctx.state.nodeIndex);
    ctx.map.setActiveFeatureIndices(ctx.data.metaIndices);
    repaint(ctx);
    if (!node) {
      // Reached the end of the generated path (v1 caps out around 40 nodes).
      ctx.state.node = null;
      ctx.hud.setTarget('You’ve reached the end of the Learning Path — more clues coming soon!');
      ctx.hud.setHint('');
      ctx.hud.setStats([]);
      return;
    }
    ctx.state.node = node;
    ctx.state.inputLocked = false;
    ctx.hud.setTarget(node.clueText);
    ctx.hud.setHint('Tap the country on the map that matches the clue.');
    ctx.hud.setStats([
      { id: 'node', value: '#' + (node.index + 1) + ' / ' + GN.pathContent.getNodes().length, label: 'Node' },
      { id: 'tier', value: TIER_LABEL[node.tier] || '', label: 'Difficulty' },
    ]);
    if (GN.mascot) GN.mascot.react('neutral', 1);
  }

  function onMapClick(ctx, idx) {
    if (ctx.state.inputLocked) return;
    const node = ctx.state.node;
    if (!node) return;
    if (!ctx.data.metaIndices.includes(idx)) return;

    if (idx === node.targetIdx) {
      ctx.state.inputLocked = true;
      ctx.map.flashCountries([idx], 'flash-good');
      GN.progression.applyOutcome({ type: 'correct', points: 30 + node.tier * 20 });
      GN.progression.setPathFurthest(node.index + 1);
      if (GN.mascot) GN.mascot.react('cheering', 1800);
      ctx.scheduleTimeout(() => {
        ctx.hud.showRoundResult({
          correct: true,
          title: 'Correct!',
          sub: ctx.data.names[idx] + ' — ' + node.clueText,
          nextLabel: 'Continue',
          onNext: () => {
            GN.modeShell.stop();
            if (GN.path) GN.path.showPathScreen();
          },
        });
      }, 550);
    } else {
      ctx.map.flashCountries([idx], 'flash-bad');
      ctx.hud.shakeBoard();
      if (GN.mascot) GN.mascot.react('concerned', 900);
      // Deliberately no penalty on a wrong guess — same exploration-friendly
      // philosophy as Fog of War (modes/fog.js): keep guessing, no cost.
      ctx.scheduleTimeout(() => ctx.map.clearFlashClasses(), 320);
    }
  }

  const mode = {
    title: 'Learning Path',
    setup(ctx) {
      ctx.state = { nodeIndex: ctx.nodeIndex || 0, node: null, inputLocked: false };
      GN.progression.reset();
      ctx.hud.setLegend('<span class="g"><span class="swatch"></span>Click to answer</span>');
      ctx.hud.setPanel('');
      loadNode(ctx);
    },
    teardown(ctx) {
      ctx.hud.setPanel('');
      ctx.hud.setLegend('');
    },
    onMapClick,
  };

  GN.modeShell.registerMode('path', mode);
})();
