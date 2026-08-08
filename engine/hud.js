(function () {
  const GN = window.GN = window.GN || {};

  const statsContainer = document.querySelector('.stats');
  const modeTitleLabel = document.getElementById('mode-title-label');
  const targetBanner = document.getElementById('target-banner');
  const progressFill = document.getElementById('progress-fill');
  const winOverlay = document.getElementById('win-overlay');
  const winTitle = document.getElementById('win-title');
  const winSub = document.getElementById('win-sub');
  const winBonus = document.getElementById('win-bonus');
  const roundResultOverlay = document.getElementById('round-result-overlay');
  const roundResultTitle = document.getElementById('round-result-title');
  const roundResultSub = document.getElementById('round-result-sub');
  const roundResultNextBtn = document.getElementById('round-result-next');
  const tooltip = document.getElementById('tooltip');
  const boardEl = document.querySelector('.board');
  const toast = document.getElementById('toast');
  const hint = document.getElementById('hint');
  const panelEl = document.getElementById('mode-panel');
  const legendEl = document.getElementById('mode-legend');
  const hudLevelNum = document.getElementById('hud-level-num');
  const hudLevelFill = document.getElementById('hud-level-fill');
  const hudLevelXp = document.getElementById('hud-level-xp');

  // Called from GN.progression.applyOutcome() itself (same pattern as the
  // shop's wallet-refresh hook) so the in-game level chip updates the moment
  // XP changes, from any mode, without every mode needing to remember to
  // call this — hud.js loads before progression.js, so GN.progression may
  // not exist yet on the very first paint; the guard just no-ops until the
  // first real update arrives.
  function refreshLevelChip() {
    if (!hudLevelNum || !GN.progression) return;
    const xp = GN.progression.getXp();
    const level = GN.progression.getLevel();
    const thisLevelXp = GN.progression.xpForLevel(level);
    const nextLevelXp = GN.progression.xpForLevel(level + 1);
    const span = Math.max(1, nextLevelXp - thisLevelXp);
    const into = xp - thisLevelXp;
    hudLevelNum.textContent = level;
    hudLevelFill.style.width = Math.round(100 * Math.max(0, Math.min(1, into / span))) + '%';
    if (hudLevelXp) hudLevelXp.textContent = into + ' / ' + span + ' XP';
  }

  function setStats(list) {
    statsContainer.innerHTML = '';
    for (const s of list) {
      const chip = document.createElement('div');
      chip.className = 'stat-chip' + (s.cls ? ' ' + s.cls : '');
      chip.innerHTML = '<span class="v" id="stat-' + s.id + '">' + s.value + '</span><span class="l">' + s.label + '</span>';
      statsContainer.appendChild(chip);
    }
  }
  function updateStat(id, value) {
    const el = document.getElementById('stat-' + id);
    if (el) el.textContent = value;
  }

  function setPanel(html) { panelEl.innerHTML = html; }
  function setLegend(html) { legendEl.innerHTML = html; }
  function setHint(text) { hint.textContent = text; }
  function setTarget(html) { targetBanner.innerHTML = html; }
  function setModeTitle(text) { modeTitleLabel.textContent = text || ''; }
  function setProgress(fraction) {
    progressFill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
  }

  function moveTooltip(event) {
    const rect = boardEl.getBoundingClientRect();
    tooltip.style.left = (event.clientX - rect.left) + 'px';
    tooltip.style.top = (event.clientY - rect.top) + 'px';
  }
  function showTooltip(event, text) {
    tooltip.textContent = text;
    tooltip.classList.add('show');
    moveTooltip(event);
  }
  function hideTooltip() { tooltip.classList.remove('show'); }

  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function showWin({ title, sub, failed }) {
    winTitle.textContent = title;
    winSub.textContent = sub;
    winOverlay.classList.toggle('failed', !!failed);
    let bonusText = '';
    if (!failed && GN.progression && GN.progression.applyWinBonus) {
      const result = GN.progression.applyWinBonus();
      if (result.bonus > 0) {
        const mistakes = GN.progression.getMistakes();
        bonusText = '+' + result.bonus + ' bonus coin' + (result.bonus === 1 ? '' : 's') +
          (mistakes === 0 ? ' for a flawless run!' : ' for finishing with ' + mistakes + ' mistake' + (mistakes === 1 ? '' : 's'));
      }
    }
    if (winBonus) {
      winBonus.textContent = bonusText;
      winBonus.style.display = bonusText ? '' : 'none';
    }
    winOverlay.classList.add('show');
  }
  function hideWin() { winOverlay.classList.remove('show'); }
  function isWinShown() { return winOverlay.classList.contains('show'); }

  // A lightweight, per-round sibling of showWin() — reveals the correct
  // answer front and center and waits for the player to press Next rather
  // than auto-advancing on a timer, so they can actually read and learn it
  // before moving on.
  function showRoundResult({ correct, title, sub, nextLabel, onNext }) {
    roundResultTitle.textContent = title;
    roundResultSub.textContent = sub;
    roundResultOverlay.classList.toggle('correct', !!correct);
    roundResultOverlay.classList.toggle('wrong', !correct);
    roundResultNextBtn.textContent = nextLabel || 'Next round';
    roundResultNextBtn.onclick = () => { hideRoundResult(); if (onNext) onNext(); };
    roundResultOverlay.classList.add('show');
  }
  function hideRoundResult() { roundResultOverlay.classList.remove('show'); }
  function isRoundResultShown() { return roundResultOverlay.classList.contains('show'); }

  function shakeBoard() {
    boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake');
  }

  GN.hud = {
    setStats, updateStat, setPanel, setLegend, setHint, setTarget, setModeTitle, setProgress,
    showTooltip, moveTooltip, hideTooltip, showToast, showWin, hideWin, isWinShown, shakeBoard,
    showRoundResult, hideRoundResult, isRoundResultShown, refreshLevelChip,
    winOverlay, boardEl,
  };
})();
