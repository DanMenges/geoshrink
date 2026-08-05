(function () {
  const GN = window.GN = window.GN || {};

  const statsContainer = document.querySelector('.stats');
  const targetBanner = document.getElementById('target-banner');
  const progressFill = document.getElementById('progress-fill');
  const winOverlay = document.getElementById('win-overlay');
  const winTitle = document.getElementById('win-title');
  const winSub = document.getElementById('win-sub');
  const winBonus = document.getElementById('win-bonus');
  const tooltip = document.getElementById('tooltip');
  const boardEl = document.querySelector('.board');
  const toast = document.getElementById('toast');
  const hint = document.getElementById('hint');
  const panelEl = document.getElementById('mode-panel');
  const legendEl = document.getElementById('mode-legend');

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
        bonusText = '+' + result.bonus + ' bonus coin' + (result.bonus === 1 ? '' : 's') +
          ' for finishing with ' + GN.progression.getScore() + ' points left';
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

  function shakeBoard() {
    boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake');
  }

  GN.hud = {
    setStats, updateStat, setPanel, setLegend, setHint, setTarget, setProgress,
    showTooltip, moveTooltip, hideTooltip, showToast, showWin, hideWin, isWinShown, shakeBoard,
    winOverlay, boardEl,
  };
})();
