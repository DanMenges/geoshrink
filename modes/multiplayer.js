(function () {
  const GN = window.GN = window.GN || {};

  const STEP_MS = 30000;
  // Not submitting anything costs exactly as much as an honest wrong guess —
  // deliberately not a cheaper "safe" option. A separate, lighter timeout
  // cost would let a player passively coast through a step for less than
  // engaging and guessing wrong does, which undermines the whole point of a
  // timed battle: every step, you're better off actually playing.
  const TIMEOUT_COST = 250;
  const CORRECT_STEP_COST = 50;
  const WRONG_STEP_COST = 250;
  // How long players get to review a round's results before the next one
  // starts automatically — same idea as STEP_MS's timeout, just for the
  // between-rounds pause instead of a single narrowing step.
  const ROUND_SUMMARY_MS = 30000;

  const mpScreen = document.getElementById('multiplayer-screen');
  const mpInner = document.getElementById('mp-inner');
  const boardEl = document.querySelector('.board');
  const scoreboardEl = document.getElementById('mp-scoreboard');
  const summaryPanel = document.getElementById('mp-round-summary-panel');

  // Module-level (not per-mode-instance) so lobby state survives the
  // lobby -> live-match -> results transitions cleanly, per the plan's
  // "third top-level screen, live match reuses modeShell just for its
  // setup/onMapClick/teardown shape" design.
  const mp = {
    roomCode: null, room: null, isHost: false, myName: '',
    matchCtx: null, path: null, lastRound: -1, lastStep: -1,
    guessMode: false, mySubmitted: false, resolving: false,
    countdownTimer: null, hostTimer: null,
    lastSummaryRound: -1, readySubmitted: false, summaryTargetName: '',
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // --- screen chrome ---------------------------------------------------

  function showMultiplayerScreen() {
    mpScreen.classList.add('show');
  }
  function hideMultiplayerScreen() {
    mpScreen.classList.remove('show');
  }
  function enterMatchView() {
    hideMultiplayerScreen();
    boardEl.classList.remove('hidden');
    GN.modeShell.start('multiplayer', { data: GN.data });
  }
  function leaveMatchView() {
    if (mp.matchCtx) GN.modeShell.stop();
    boardEl.classList.add('hidden');
    showMultiplayerScreen();
  }

  // --- lobby / menu views -----------------------------------------------

  function showMenu() {
    mpInner.innerHTML =
      '<div class="mp-menu">' +
      '<button class="hud-btn mp-big-btn" id="mp-create-btn">Create a room</button>' +
      '<button class="hud-btn mp-big-btn" id="mp-join-btn">Join a room</button>' +
      '</div>';
    document.getElementById('mp-create-btn').addEventListener('click', showCreateForm);
    document.getElementById('mp-join-btn').addEventListener('click', showJoinForm);
  }

  function showCreateForm() {
    mpInner.innerHTML =
      '<div class="mp-form">' +
      '<label>Your name<input type="text" id="mp-name-input" maxlength="20" placeholder="Player name"></label>' +
      '<label>Difficulty<select id="mp-difficulty-select">' +
      '<option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option>' +
      '</select></label>' +
      '<div class="mp-form-actions">' +
      '<button class="hud-btn" id="mp-form-back">Back</button>' +
      '<button class="hud-btn" id="mp-create-confirm">Create room</button>' +
      '</div></div>';
    document.getElementById('mp-form-back').addEventListener('click', showMenu);
    document.getElementById('mp-create-confirm').addEventListener('click', () => {
      if (!GN.multiplayer.available()) { GN.hud.showToast("Multiplayer isn't set up on this deployment."); return; }
      const name = (document.getElementById('mp-name-input').value || 'Player').trim().slice(0, 20) || 'Player';
      const difficulty = document.getElementById('mp-difficulty-select').value;
      GN.multiplayer.createRoom(difficulty, name).then((code) => {
        mp.roomCode = code; mp.isHost = true; mp.myName = name;
        GN.multiplayer.subscribeRoom(code, onRoomSnapshot);
      }).catch((err) => GN.hud.showToast('Could not create room: ' + err.message));
    });
  }

  function showJoinForm() {
    mpInner.innerHTML =
      '<div class="mp-form">' +
      '<label>Your name<input type="text" id="mp-name-input" maxlength="20" placeholder="Player name"></label>' +
      '<label>Room code<input type="text" id="mp-code-input" maxlength="6" placeholder="ABC123"></label>' +
      '<div class="mp-form-actions">' +
      '<button class="hud-btn" id="mp-form-back">Back</button>' +
      '<button class="hud-btn" id="mp-join-confirm">Join room</button>' +
      '</div></div>';
    document.getElementById('mp-form-back').addEventListener('click', showMenu);
    document.getElementById('mp-join-confirm').addEventListener('click', () => {
      if (!GN.multiplayer.available()) { GN.hud.showToast("Multiplayer isn't set up on this deployment."); return; }
      const name = (document.getElementById('mp-name-input').value || 'Player').trim().slice(0, 20) || 'Player';
      const code = (document.getElementById('mp-code-input').value || '').trim().toUpperCase();
      if (!code) { GN.hud.showToast('Enter a room code.'); return; }
      GN.multiplayer.joinRoom(code, name).then(() => {
        mp.roomCode = code; mp.isHost = false; mp.myName = name;
        GN.multiplayer.subscribeRoom(code, onRoomSnapshot);
      }).catch((err) => GN.hud.showToast('Could not join: ' + err.message));
    });
  }

  function renderLobby() {
    const room = mp.room;
    const players = Object.values(room.players || {});
    const rows = players.map((p) => '<div class="mp-lobby-player">' + escapeHtml(p.name) + (p.connected === false ? ' (left)' : '') + '</div>').join('');
    const canStart = mp.isHost && players.filter((p) => p.connected !== false).length >= 2;
    mpInner.innerHTML =
      '<div class="mp-lobby">' +
      '<div class="mp-room-code">Room code: <b>' + mp.roomCode + '</b></div>' +
      '<p class="shop-hint">Difficulty: ' + room.difficulty + ' — share the code above so friends can join.</p>' +
      '<div class="mp-lobby-players">' + rows + '</div>' +
      (mp.isHost
        ? '<button class="hud-btn" id="mp-start-btn"' + (canStart ? '' : ' disabled') + '>Start match' + (canStart ? '' : ' (need 2+ players)') + '</button>'
        : '<p class="shop-hint">Waiting for the host to start…</p>') +
      '<button class="hud-btn" id="mp-leave-btn">Leave room</button>' +
      '</div>';
    const startBtn = document.getElementById('mp-start-btn');
    if (startBtn) startBtn.addEventListener('click', startMatch);
    document.getElementById('mp-leave-btn').addEventListener('click', leaveRoom);
  }

  const ROUND_BUDGET = 5000;

  function freshRoundScores(players) {
    const out = {};
    Object.keys(players || {}).forEach((uid) => { out[uid] = ROUND_BUDGET; });
    return out;
  }

  function startMatch() {
    const pool = GN.progression.buildPool(GN.data.playableIndices, mp.room.difficulty);
    const target = GN.progression.pickTarget(pool, mp.room.difficulty);
    GN.multiplayer.updateRoom(mp.roomCode, {
      status: 'active',
      currentRound: 1,
      currentStep: 0,
      stepDeadline: Date.now() + STEP_MS,
      hostHeartbeatAt: Date.now(),
      currentRoundScores: freshRoundScores(mp.room.players),
      ['rounds.1']: { pool, target },
    }).catch((err) => GN.hud.showToast('Could not start match: ' + err.message));
  }

  function leaveRoom() {
    if (mp.roomCode) GN.multiplayer.setConnected(mp.roomCode, false);
    GN.multiplayer.unsubscribeRoom();
    clearInterval(mp.hostTimer);
    clearInterval(mp.countdownTimer);
    if (mp.matchCtx) { GN.modeShell.stop(); boardEl.classList.add('hidden'); }
    hideRoundSummaryOverlay();
    Object.assign(mp, { roomCode: null, room: null, isHost: false, matchCtx: null, lastRound: -1, lastStep: -1, lastSummaryRound: -1, readySubmitted: false });
    showMenu();
  }

  function renderResults(room) {
    // Ranked by the medal table first (gold count, then silver, then
    // bronze — an Olympic-style medal table, per spec), score only as the
    // final tiebreak. Tiebreak on uid last: Firestore doesn't guarantee
    // map-field key order is preserved identically across clients, so two
    // players' browsers could otherwise render a tied match with a
    // different "winner" each.
    const tally = computeMedalTally(room, room.currentRound);
    const rows = Object.keys(room.players || {}).map((uid) => ({
      uid, name: room.players[uid].name, score: (room.scores && room.scores[uid]) || 0,
      tally: tally[uid] || { gold: 0, silver: 0, bronze: 0 },
    })).sort((a, b) =>
      (b.tally.gold - a.tally.gold) ||
      (b.tally.silver - a.tally.silver) ||
      (b.tally.bronze - a.tally.bronze) ||
      (b.score - a.score) ||
      a.uid.localeCompare(b.uid)
    );
    mpInner.innerHTML =
      '<div class="mp-results"><h2>Match results</h2>' +
      rows.map((r, i) => '<div class="mp-result-row' + (i === 0 ? ' winner' : '') + '">' +
        '<span class="mp-result-rank">' + (i === 0 ? '🏆' : '#' + (i + 1)) + '</span>' +
        '<span class="mp-result-name">' + escapeHtml(r.name) + '</span>' +
        '<span class="mp-result-medals">' + medalTallyHtml(r.tally) + '</span>' +
        '<span class="mp-result-score">' + r.score + '</span></div>').join('') +
      '<button class="hud-btn" id="mp-results-done">Back to menu</button></div>';
    document.getElementById('mp-results-done').addEventListener('click', () => {
      GN.multiplayer.unsubscribeRoom();
      Object.assign(mp, { roomCode: null, room: null, isHost: false, matchCtx: null, lastRound: -1, lastStep: -1, lastSummaryRound: -1, readySubmitted: false });
      showMenu();
    });
  }

  // --- live match (registered as a modeShell mode) -----------------------

  function paintCurrentStep(ctx, room) {
    const step = mp.path[room.currentStep];
    if (!step) return;
    const inA = new Set(step.groupA), inB = new Set(step.groupB), inSubset = new Set(step.subset);
    const newProj = ctx.map.buildProjection(step.subset.map((i) => ctx.data.features[i]));
    ctx.map.setActiveFeatureIndices(step.subset);
    ctx.map.setProjectionImmediate(newProj);
    ctx.map.paintClasses({
      'group-a': (i) => !mp.guessMode && inA.has(i),
      'group-b': (i) => !mp.guessMode && inB.has(i),
      'guessable': (i) => mp.guessMode && inSubset.has(i),
      'eliminated': (i) => !inSubset.has(i),
    });
    ctx.map.clearFlashClasses();
    const roundData = room.rounds && room.rounds[room.currentRound];
    const targetName = roundData ? ctx.data.names[roundData.target] : '';
    ctx.hud.setTarget('Find: <b>' + targetName + '</b>');
  }

  function startCountdown(room) {
    clearInterval(mp.countdownTimer);
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((room.stepDeadline - Date.now()) / 1000));
      const el = document.getElementById('mp-timer');
      if (el) el.textContent = remaining + 's';
    };
    tick();
    mp.countdownTimer = setInterval(tick, 250);
  }

  // Running total shown live during a match: completed-rounds sum
  // (room.scores) plus the in-progress round's live remaining budget
  // (room.currentRoundScores) — so players can track overall standing
  // while a round is still being played, not just at round boundaries.
  function liveScore(room, uid) {
    const completed = (room.scores && room.scores[uid]) || 0;
    const inProgress = (room.currentRoundScores && room.currentRoundScores[uid]) || 0;
    return completed + inProgress;
  }

  function renderScoreboard(room) {
    if (!room || room.status !== 'active') { scoreboardEl.innerHTML = ''; return; }
    const myUid = GN.multiplayer.getUid();
    // Ranked highest-first, with a uid tiebreak — Firestore doesn't guarantee
    // player map key order is identical across clients, so sorting by score
    // alone could still show ties in a different order on each device.
    const ranked = Object.keys(room.players || {})
      .map((uid) => ({ uid, score: liveScore(room, uid) }))
      .sort((a, b) => b.score - a.score || a.uid.localeCompare(b.uid));
    const rows = ranked.map(({ uid, score }) => {
      const p = room.players[uid];
      const submitted = !!(room.submissions && room.submissions[uid]);
      return '<div class="mp-player-row' + (uid === myUid ? ' me' : '') + '">' +
        '<span class="mp-player-name">' + escapeHtml(p.name) + '</span>' +
        '<span class="mp-player-score">' + score + '</span>' +
        '<span class="mp-player-status' + (submitted ? ' submitted' : '') + '">' + (submitted ? '✓' : '…') + '</span>' +
        '</div>';
    }).join('');
    const stepLabel = 'Round ' + room.currentRound + ' / 5 — Step ' + (room.currentStep + 1) + (mp.path ? ' / ' + mp.path.length : '');
    scoreboardEl.innerHTML =
      '<div class="mp-scoreboard-head"><span>' + stepLabel + '</span><span id="mp-timer">30s</span></div>' + rows;
  }

  function renderMatchState(ctx, room) {
    if (room.currentRound !== mp.lastRound) {
      mp.lastRound = room.currentRound;
      mp.lastStep = -1;
      const roundData = room.rounds && room.rounds[room.currentRound];
      if (roundData) mp.path = GN.geoPartition.buildPath(roundData.target, roundData.pool, ctx.data);
    }
    if (room.currentStep !== mp.lastStep && mp.path) {
      mp.lastStep = room.currentStep;
      mp.mySubmitted = false;
      paintCurrentStep(ctx, room);
      startCountdown(room);
    }
    renderScoreboard(room);
  }

  // --- medals -------------------------------------------------------------
  // Purely derived from room.roundScores (already written by maybeResolveStep
  // for every completed round) rather than a separately-tracked Firestore
  // field — recomputing is cheap and guarantees the tally can never drift
  // out of sync with the score history it's built from.

  const MEDAL_ICON = { gold: '🥇', silver: '🥈', bronze: '🥉' };
  const MEDAL_TIERS = ['gold', 'silver', 'bronze'];

  // Standard "competition ranking": ties share a medal and the next distinct
  // score skips ahead by however many tied for it (two golds -> no silver,
  // next distinct score is bronze) — the same convention as an Olympic table.
  function computeRoundMedals(scoreByUid, uids) {
    const ranked = uids.slice().sort((a, b) => (scoreByUid[b] - scoreByUid[a]) || a.localeCompare(b));
    const medalByUid = {};
    let tier = 0;
    ranked.forEach((uid, i) => {
      if (i > 0 && scoreByUid[uid] !== scoreByUid[ranked[i - 1]]) tier = i;
      if (tier < 3) medalByUid[uid] = MEDAL_TIERS[tier];
    });
    return medalByUid;
  }

  function computeMedalTally(room, throughRound) {
    const uids = Object.keys(room.players || {});
    const tally = {};
    uids.forEach((uid) => { tally[uid] = { gold: 0, silver: 0, bronze: 0 }; });
    for (let r = 1; r <= throughRound; r++) {
      const scoreByUid = {};
      uids.forEach((uid) => {
        const v = room.roundScores && room.roundScores[uid] && room.roundScores[uid][r];
        if (v != null) scoreByUid[uid] = v;
      });
      const participants = Object.keys(scoreByUid);
      if (!participants.length) continue;
      const medalByUid = computeRoundMedals(scoreByUid, participants);
      Object.keys(medalByUid).forEach((uid) => { tally[uid][medalByUid[uid]]++; });
    }
    return tally;
  }

  function medalTallyHtml(tally) {
    if (!tally) return '';
    return MEDAL_TIERS.filter((t) => tally[t] > 0)
      .map((t) => '<span class="mp-medal-count mp-medal-' + t + '">' + MEDAL_ICON[t] + '×' + tally[t] + '</span>')
      .join('');
  }

  // --- between-rounds intermission ----------------------------------------
  // A round ending doesn't roll straight into the next one — players get a
  // beat to actually look at what happened, with an escape hatch (everyone
  // hits Next Round) so a fast group isn't stuck waiting out the full timer.
  // Deliberately a docked sidebar panel, not a full-board overlay: players
  // asked to still be able to observe/zoom the map during the intermission.

  function hideRoundSummaryOverlay() {
    summaryPanel.classList.remove('show');
  }

  function startSummaryCountdown(room) {
    clearInterval(mp.countdownTimer);
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((room.roundSummaryDeadline - Date.now()) / 1000));
      const el = document.getElementById('mp-round-summary-timer');
      if (el) el.textContent = remaining + 's';
    };
    tick();
    mp.countdownTimer = setInterval(tick, 250);
  }

  // Zooms onto just the round's target country and flashes it green so
  // observers can clearly see which country it actually was, even though
  // the last narrowing step usually left 2 candidates on screen.
  // A very slight pull-back from a tight single-country fit, anchored on the
  // country's own on-screen position (via its rendered path centroid, not
  // its geographic one — accurate regardless of shape) so it doesn't jump
  // around when the scale changes. Deliberately restrained compared to Geo
  // Shrink's full zoom-out to its round's whole pool: this reveal sits next
  // to a small sidebar panel, not a full-screen win moment, so it should
  // stay proportionally modest — just enough breathing room to see the
  // country in a little geographic context.
  const REVEAL_ZOOM_OUT_FACTOR = 0.7;
  function revealRoundTarget(ctx, room) {
    const roundData = room.rounds && room.rounds[room.currentRound];
    if (!roundData || !ctx) return '';
    const target = roundData.target;
    const feat = ctx.data.features[target];
    if (!feat) return ctx.data.names[target] || '';
    const tightProj = ctx.map.buildProjection([feat]);
    const [anchorX, anchorY] = d3.geoPath(tightProj).centroid(feat);
    const [tx, ty] = tightProj.translate();
    tightProj.scale(tightProj.scale() * REVEAL_ZOOM_OUT_FACTOR).translate([
      REVEAL_ZOOM_OUT_FACTOR * tx + (1 - REVEAL_ZOOM_OUT_FACTOR) * anchorX,
      REVEAL_ZOOM_OUT_FACTOR * ty + (1 - REVEAL_ZOOM_OUT_FACTOR) * anchorY,
    ]);
    ctx.map.animateToProjection(tightProj, () => {
      ctx.map.paintClasses({
        'group-a': () => false,
        'group-b': () => false,
        'guessable': () => false,
        'eliminated': (i) => i !== target,
      });
      ctx.map.flashCountries([target], 'flash-good');
    });
    return ctx.data.names[target] || '';
  }

  function renderRoundSummary(room) {
    if (room.currentRound !== mp.lastSummaryRound) {
      mp.lastSummaryRound = room.currentRound;
      mp.readySubmitted = false;
      startSummaryCountdown(room);
      mp.summaryTargetName = revealRoundTarget(mp.matchCtx, room);
    }
    const myUid = GN.multiplayer.getUid();
    const roundScores = room.roundScores || {};
    const ready = room.readyForNext || {};
    const uids = Object.keys(room.players || {});
    const thisRoundScores = {};
    uids.forEach((uid) => { thisRoundScores[uid] = (roundScores[uid] && roundScores[uid][room.currentRound]) || 0; });
    const roundMedals = computeRoundMedals(thisRoundScores, uids);
    const tally = computeMedalTally(room, room.currentRound);

    // Ranked by running total, same uid tiebreak as everywhere else this
    // matters — Firestore doesn't guarantee player map key order matches
    // across clients.
    const rows = uids.map((uid) => ({
      uid,
      name: room.players[uid].name,
      roundScore: thisRoundScores[uid],
      total: (room.scores && room.scores[uid]) || 0,
      isReady: !!ready[uid],
      medal: roundMedals[uid] || null,
      tally: tally[uid],
    })).sort((a, b) => b.total - a.total || a.uid.localeCompare(b.uid));

    document.getElementById('mp-round-summary-title').textContent = 'Round ' + room.currentRound + ' complete!';
    const targetEl = document.getElementById('mp-round-summary-target');
    if (targetEl) targetEl.innerHTML = mp.summaryTargetName ? 'It was <b>' + escapeHtml(mp.summaryTargetName) + '</b>' : '';

    document.getElementById('mp-round-summary-list').innerHTML = rows.map((r) =>
      '<div class="mp-summary-row' + (r.uid === myUid ? ' me' : '') + '">' +
      '<div class="mp-summary-row-top">' +
      '<span class="mp-summary-medal">' + (r.medal ? MEDAL_ICON[r.medal] : '') + '</span>' +
      '<span class="mp-summary-name">' + escapeHtml(r.name) + '</span>' +
      '<span class="mp-summary-ready' + (r.isReady ? ' ready' : '') + '">' + (r.isReady ? '✓' : '…') + '</span>' +
      '</div>' +
      '<div class="mp-summary-row-bottom">' +
      '<span class="mp-summary-round-score">' + r.roundScore + ' this round</span>' +
      '<span class="mp-summary-total">' + r.total + ' total</span>' +
      '</div>' +
      '<div class="mp-summary-tally">' + medalTallyHtml(r.tally) + '</div>' +
      '</div>'
    ).join('');

    const btn = document.getElementById('mp-round-summary-ready-btn');
    btn.disabled = mp.readySubmitted;
    btn.textContent = mp.readySubmitted ? 'Waiting for others…' : 'Next Round';

    summaryPanel.classList.add('show');
  }

  function markReadyForNext() {
    if (mp.readySubmitted || !mp.room || mp.room.status !== 'round-summary') return;
    mp.readySubmitted = true;
    const uid = GN.multiplayer.getUid();
    GN.multiplayer.updateRoom(mp.roomCode, { ['readyForNext.' + uid]: true })
      .catch((err) => GN.hud.showToast('Error: ' + err.message));
    renderRoundSummary(mp.room); // immediate own-checkmark feedback, don't wait for the round-trip snapshot
  }

  function submitChoice(choice) {
    if (mp.mySubmitted) return;
    mp.mySubmitted = true;
    GN.multiplayer.submitPick(mp.roomCode, choice);
    if (mp.matchCtx) mp.matchCtx.hud.showToast('Locked in — waiting for other players…');
    renderScoreboard(mp.room);
  }

  function onMapClick(ctx, idx) {
    if (mp.mySubmitted || !mp.path) return;
    const step = mp.path[mp.room.currentStep];
    if (!step) return;
    if (mp.guessMode) {
      if (!step.subset.includes(idx)) return;
      submitChoice({ guess: idx });
    } else {
      const inA = step.groupA.includes(idx), inB = step.groupB.includes(idx);
      if (!inA && !inB) return;
      submitChoice(inA ? 'A' : 'B');
    }
  }

  const mode = {
    title: 'Multiplayer',
    setup(ctx) {
      mp.matchCtx = ctx;
      mp.lastRound = -1;
      mp.lastStep = -1;
      mp.lastSummaryRound = -1;
      mp.guessMode = false;
      mp.mySubmitted = false;
      mp.readySubmitted = false;
      ctx.hud.setStats([]);
      ctx.hud.setLegend(
        '<span class="a"><span class="swatch"></span>Region A</span>' +
        '<span class="b"><span class="swatch"></span>Region B</span>' +
        '<span class="elim"><span class="swatch"></span>Not in play</span>'
      );
      ctx.hud.setHint('Click a region to narrow, or switch to Guess mode to name the country directly. 30 seconds per step.');
      ctx.hud.setPanel(
        '<label class="switch-label" id="mp-guess-label">' +
        '<span class="switch"><input type="checkbox" id="mp-guess-toggle"><span class="switch-track"><span class="switch-thumb"></span></span></span>' +
        'Guess directly</label>'
      );
      document.getElementById('mp-guess-toggle').addEventListener('change', (e) => {
        mp.guessMode = e.target.checked;
        if (mp.room) paintCurrentStep(ctx, mp.room);
      });
      if (mp.room) renderMatchState(ctx, mp.room);
      if (mp.isHost) {
        mp.hostTimer = setInterval(() => {
          maybeResolveStep(mp.room);
          maybeResolveRoundSummary(mp.room);
        }, 1000);
      }
    },
    teardown() {
      clearInterval(mp.hostTimer);
      clearInterval(mp.countdownTimer);
      if (mp.matchCtx) {
        mp.matchCtx.hud.setPanel('');
        mp.matchCtx.hud.setLegend('');
      }
      scoreboardEl.innerHTML = '';
      hideRoundSummaryOverlay();
      mp.matchCtx = null;
    },
    onMapClick,
  };
  GN.modeShell.registerMode('multiplayer', mode);

  // --- host-authority step resolution -------------------------------------

  function maybeResolveStep(room) {
    if (!room || room.status !== 'active' || !mp.isHost || mp.resolving) return;
    const roundData = room.rounds && room.rounds[room.currentRound];
    if (!roundData) return;
    const path = (mp.path && mp.lastRound === room.currentRound) ? mp.path : GN.geoPartition.buildPath(roundData.target, roundData.pool, GN.data);
    const step = path[room.currentStep];
    if (!step) return;

    const players = room.players || {};
    const connectedUids = Object.keys(players).filter((uid) => players[uid].connected !== false);
    const submissions = room.submissions || {};
    const allSubmitted = connectedUids.length > 0 && connectedUids.every((uid) => submissions[uid]);
    const deadlinePassed = Date.now() >= (room.stepDeadline || 0);
    if (!allSubmitted && !deadlinePassed) return;

    mp.resolving = true;
    const targetSide = step.groupA.includes(roundData.target) ? 'A' : 'B';
    const nextStep = room.currentStep + 1;
    const roundOver = nextStep >= path.length;
    // Each round runs its own 5000-point budget (per the spec: "Each player
    // starts a round with 5,000 points"). currentRoundScores is that live,
    // in-round budget; it folds into the cumulative room.scores total only
    // when the round ends — room.scores is never itself decremented, or a
    // Math.max(0, ...) per-step floor would silently swallow every
    // deduction once a player's *cumulative* total neared zero.
    const roundScoresLive = Object.assign({}, room.currentRoundScores);
    Object.keys(players).forEach((uid) => {
      const sub = submissions[uid];
      let cost = TIMEOUT_COST;
      if (sub) {
        if (sub.choice && typeof sub.choice === 'object' && sub.choice.guess != null) {
          cost = sub.choice.guess === roundData.target ? 0 : WRONG_STEP_COST;
        } else if (sub.choice === 'A' || sub.choice === 'B') {
          const correct = sub.choice === targetSide;
          // A correct pick on the round's final narrowing step costs
          // nothing — same as a correct direct guess above — since that
          // pick IS what identified the target, not just a step along the
          // way. Only applies when it's actually correct; a wrong pick or
          // a timeout on the final step still costs as usual.
          cost = correct ? (roundOver ? 0 : CORRECT_STEP_COST) : WRONG_STEP_COST;
        }
      }
      roundScoresLive[uid] = Math.max(0, (roundScoresLive[uid] != null ? roundScoresLive[uid] : ROUND_BUDGET) - cost);
    });

    const updates = { currentRoundScores: roundScoresLive, submissions: {}, hostHeartbeatAt: Date.now() };
    if (!roundOver) {
      updates.currentStep = nextStep;
      updates.stepDeadline = Date.now() + STEP_MS;
    } else {
      const scores = Object.assign({}, room.scores);
      const roundScores = Object.assign({}, room.roundScores);
      Object.keys(roundScoresLive).forEach((uid) => {
        scores[uid] = (scores[uid] || 0) + roundScoresLive[uid];
        roundScores[uid] = Object.assign({}, roundScores[uid], { [room.currentRound]: roundScoresLive[uid] });
      });
      updates.scores = scores;
      updates.roundScores = roundScores;
      const nextRound = room.currentRound + 1;
      if (nextRound > 5) {
        updates.status = 'finished';
        updates.currentRoundScores = {};
      } else {
        // Pause for review instead of rolling straight into the next round —
        // maybeResolveRoundSummary() below generates it once everyone's
        // ready or the intermission timer runs out. room.currentRound is
        // deliberately NOT advanced yet, so the summary screen (and its
        // roundScores[uid][currentRound] lookup) still refers to the round
        // that just ended.
        updates.status = 'round-summary';
        updates.roundSummaryDeadline = Date.now() + ROUND_SUMMARY_MS;
        updates.readyForNext = {};
      }
    }
    GN.multiplayer.updateRoom(mp.roomCode, updates)
      .catch((err) => GN.hud.showToast('Multiplayer sync error: ' + err.message))
      .finally(() => { mp.resolving = false; });
  }

  function maybeResolveRoundSummary(room) {
    if (!room || room.status !== 'round-summary' || !mp.isHost || mp.resolving) return;
    const players = room.players || {};
    const connectedUids = Object.keys(players).filter((uid) => players[uid].connected !== false);
    const ready = room.readyForNext || {};
    const allReady = connectedUids.length > 0 && connectedUids.every((uid) => ready[uid]);
    const deadlinePassed = Date.now() >= (room.roundSummaryDeadline || 0);
    if (!allReady && !deadlinePassed) return;

    mp.resolving = true;
    const nextRound = room.currentRound + 1;
    const pool = GN.progression.buildPool(GN.data.playableIndices, room.difficulty);
    const target = GN.progression.pickTarget(pool, room.difficulty);
    GN.multiplayer.updateRoom(mp.roomCode, {
      status: 'active',
      currentRound: nextRound,
      currentStep: 0,
      stepDeadline: Date.now() + STEP_MS,
      hostHeartbeatAt: Date.now(),
      currentRoundScores: freshRoundScores(players),
      readyForNext: {},
      ['rounds.' + nextRound]: { pool, target },
    })
      .catch((err) => GN.hud.showToast('Multiplayer sync error: ' + err.message))
      .finally(() => { mp.resolving = false; });
  }

  // --- central room-state dispatcher --------------------------------------

  function onRoomSnapshot(room) {
    if (!room) {
      GN.hud.showToast('That room no longer exists.');
      leaveRoom();
      return;
    }
    mp.room = room;
    if (room.status === 'lobby') {
      renderLobby();
    } else if (room.status === 'active') {
      if (!mp.matchCtx) {
        enterMatchView();
      } else {
        hideRoundSummaryOverlay(); // in case we just rolled over from round-summary
        renderMatchState(mp.matchCtx, room);
      }
      if (mp.isHost) maybeResolveStep(room);
    } else if (room.status === 'round-summary') {
      if (!mp.matchCtx) enterMatchView(); // defensive: shouldn't normally happen mid-match
      renderRoundSummary(room);
      if (mp.isHost) maybeResolveRoundSummary(room);
    } else if (room.status === 'finished') {
      if (mp.matchCtx) leaveMatchView();
      renderResults(room);
    }
  }

  document.getElementById('mp-round-summary-ready-btn').addEventListener('click', markReadyForNext);

  document.getElementById('multiplayer-callout').addEventListener('click', () => {
    if (!GN.data) { GN.hud.showToast('Still loading the map — one moment…'); return; }
    GN.home.hideToOtherScreen();
    showMultiplayerScreen();
    showMenu();
  });
  document.getElementById('mp-back-btn').addEventListener('click', () => {
    leaveRoom();
    hideMultiplayerScreen();
    GN.home.show();
  });
})();
