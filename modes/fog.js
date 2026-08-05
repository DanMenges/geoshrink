(function () {
  const GN = window.GN = window.GN || {};
  const MODE_ID = 'fog';

  function loadState(ctx) {
    const saved = GN.storage.getModeState(MODE_ID);
    if (saved && Array.isArray(saved.revealed) && saved.revealed.length > 0) {
      return { revealed: new Set(saved.revealed.filter((i) => ctx.data.playableIndices.includes(i))) };
    }
    const withNeighbors = ctx.data.playableIndices.filter((i) => ctx.data.neighbors[i].length > 0);
    const pool = withNeighbors.length ? withNeighbors : ctx.data.playableIndices;
    const home = pool[Math.floor(Math.random() * pool.length)];
    return { revealed: new Set([home]) };
  }

  function persist(ctx) {
    GN.storage.setModeState(MODE_ID, { revealed: [...ctx.state.revealed] });
  }

  function centroidOfSet(centroids, set) {
    let lon = 0, lat = 0, n = 0;
    set.forEach((i) => { lon += centroids[i][0]; lat += centroids[i][1]; n++; });
    return [lon / n, lat / n];
  }

  function computeFrontier(ctx) {
    const { neighbors, playableIndices, centroids } = ctx.data;
    const revealed = ctx.state.revealed;
    const allowed = new Set(playableIndices);
    const frontier = new Set(GN.graph.frontierOf(neighbors, revealed, allowed));

    const remaining = playableIndices.filter((i) => !revealed.has(i) && !frontier.has(i));
    if (remaining.length === 0) return [...frontier];

    // The adjacency frontier only ever reaches the mainland's own connected
    // component — islands and other disconnected pockets (Fiji, Madagascar,
    // New Zealand...) would otherwise stay locked out until that whole
    // component (150+ countries) is finished. Instead, partition whatever's
    // still fully unreached into its own components and expose one "bridge"
    // doorway per component (nearest to what's already known) right away.
    const remainingSet = new Set(remaining);
    const seen = new Set();
    const rc = centroidOfSet(centroids, revealed.size ? revealed : new Set(playableIndices));
    for (const start of remaining) {
      if (seen.has(start)) continue;
      const comp = [start];
      seen.add(start);
      const queue = [start];
      let qi = 0;
      while (qi < queue.length) {
        const cur = queue[qi++];
        for (const n of neighbors[cur]) {
          if (remainingSet.has(n) && !seen.has(n)) { seen.add(n); comp.push(n); queue.push(n); }
        }
      }
      let best = comp[0], bestD = Infinity;
      comp.forEach((idx) => {
        const d = d3.geoDistance(rc, centroids[idx]);
        if (d < bestD) { bestD = d; best = idx; }
      });
      frontier.add(best);
    }
    return [...frontier];
  }

  function repaint(ctx) {
    const revealed = ctx.state.revealed;
    const frontierSet = new Set(ctx.state.frontier || []);
    ctx.map.paintClasses({
      'fog-known': (i) => revealed.has(i),
      'fog-frontier': (i) => frontierSet.has(i),
      'eliminated': (i) => !revealed.has(i) && !frontierSet.has(i),
    });
    ctx.map.clearFlashClasses();
    const total = ctx.data.playableIndices.length;
    ctx.hud.updateStat('revealed', revealed.size + ' / ' + total);
    ctx.hud.setProgress(revealed.size / total);
  }

  function nextRound(ctx) {
    ctx.state.frontier = computeFrontier(ctx);
    if (ctx.state.frontier.length === 0) {
      ctx.hud.setTarget('The whole known world is revealed!');
      ctx.hud.setHint('Every reachable country has been discovered.');
      repaint(ctx);
      return;
    }
    ctx.state.roundTarget = ctx.state.frontier[Math.floor(Math.random() * ctx.state.frontier.length)];
    ctx.hud.setTarget('Which highlighted country is: <b>' + ctx.data.names[ctx.state.roundTarget] + '</b>?');
    repaint(ctx);
  }

  function onMapClick(ctx, idx) {
    if (ctx.state.inputLocked) return;
    const frontierSet = new Set(ctx.state.frontier || []);
    if (!frontierSet.has(idx)) return;

    if (idx === ctx.state.roundTarget) {
      ctx.state.inputLocked = true;
      ctx.map.flashCountries([idx], 'flash-good');
      ctx.scheduleTimeout(() => {
        ctx.state.revealed.add(idx);
        persist(ctx);
        ctx.state.inputLocked = false;
        const total = ctx.data.playableIndices.length;
        if (ctx.state.revealed.size === total) {
          ctx.hud.showWin({ title: 'World fully revealed!', sub: 'You explored every country on Earth. Legendary.' });
        }
        nextRound(ctx);
      }, 400);
    } else {
      ctx.map.flashCountries([idx], 'flash-bad');
      ctx.hud.shakeBoard();
      ctx.scheduleTimeout(() => ctx.map.clearFlashClasses(), 320);
      // deliberately no penalty — exploration framing: wrong guesses just don't expand the map
    }
  }

  const mode = {
    setup(ctx) {
      ctx.state = loadState(ctx);
      ctx.state.inputLocked = false;
      ctx.hud.setStats([{ id: 'revealed', value: '–', label: 'Revealed' }]);
      ctx.hud.setLegend(
        '<span class="known"><span class="swatch"></span>Known</span>' +
        '<span class="frontier"><span class="swatch"></span>Frontier</span>' +
        '<span class="elim"><span class="swatch"></span>Unexplored</span>'
      );
      ctx.hud.setPanel('');
      ctx.hud.setHint('Wrong guesses cost nothing — just try again. Correct answers expand your known world, and it’s saved as you go.');
      ctx.map.setActiveFeatureIndices(ctx.data.playableIndices);
      nextRound(ctx);
    },
    teardown(ctx) {
      ctx.hud.setPanel('');
      ctx.hud.setLegend('');
    },
    onMapClick,
    onHover(ctx, idx, event) {
      if (ctx.state.revealed.has(idx)) ctx.hud.showTooltip(event, ctx.data.names[idx]);
    },
    onMove(ctx, event) { ctx.hud.moveTooltip(event); },
    onLeave(ctx) { ctx.hud.hideTooltip(); },
  };

  GN.modeShell.registerMode('fog', mode);
})();
