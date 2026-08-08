(function () {
  const GN = window.GN = window.GN || {};

  // Screen controller for the Learning Path node picker — mirrors
  // engine/collections.js's screen structure (topbar/back-button, a
  // refreshable Home callout, show/hide toggling a full-screen overlay)
  // exactly. modes/path.js is the separate mode that actually solves one
  // node once you tap into it from here.
  const screenEl = document.getElementById('path-screen');
  const boardEl = document.querySelector('.board');
  const columnEl = document.getElementById('path-column');
  const calloutSubEl = document.getElementById('path-callout-sub');
  const progressLabelEl = document.getElementById('path-progress-label');

  const TIER_LABEL = { 1: 'Warm-up', 2: 'Standard', 3: 'Challenge' };

  const DONE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19.5 7"/></svg>';
  const LOCK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  function renderColumn() {
    if (!GN.data || !columnEl) return;
    const nodes = GN.pathContent.getNodes();
    const furthest = GN.progression.getPathFurthest();
    if (progressLabelEl) progressLabelEl.textContent = furthest + ' / ' + nodes.length + ' clues solved';

    columnEl.innerHTML = nodes.map((n, i) => {
      const state = i < furthest ? 'done' : (i === furthest ? 'current' : 'locked');
      const side = i % 2 === 0 ? 'left' : 'right';
      const inner = state === 'done' ? DONE_SVG : (state === 'locked' ? LOCK_SVG : String(i + 1));
      return '<div class="path-node-row side-' + side + '">' +
        '<button class="path-node ' + state + '" data-node="' + i + '"' + (state === 'locked' ? ' disabled' : '') + ' title="' + (TIER_LABEL[n.tier] || '') + '">' +
        inner +
        '</button>' +
        '</div>';
    }).join('');

    columnEl.querySelectorAll('.path-node:not(.locked)').forEach((btn) => {
      btn.addEventListener('click', () => startNode(parseInt(btn.getAttribute('data-node'), 10)));
    });
    const currentEl = columnEl.querySelector('.path-node.current');
    if (currentEl) currentEl.scrollIntoView({ block: 'center' });
  }

  function startNode(index) {
    hidePathScreen();
    // hidePathScreen() only hides #path-screen itself — the .board (map)
    // is still carrying the 'hidden' class left over from GN.home.show(),
    // same as every other GN.home.enterMode() call has to clear via
    // GN.home.hide() before a mode can actually be seen.
    GN.home.hide();
    GN.modeShell.start('path', { data: GN.data, nodeIndex: index });
  }

  function showPathScreen() {
    renderColumn();
    if (screenEl) screenEl.classList.add('show');
    // Coming back here from modes/path.js's "Continue" (not just from Home)
    // leaves the board unhidden — re-hide it the same way GN.home.show()
    // does, without touching the actual Home screen underneath.
    if (boardEl) boardEl.classList.add('hidden');
    if (GN.mascot) GN.mascot.start();
  }
  function hidePathScreen() {
    if (screenEl) screenEl.classList.remove('show');
    if (GN.mascot) GN.mascot.stop();
  }

  // Kept live the same way the Collections callout already is — called on
  // GN.home.show() every time the player returns to Home (see engine/home.js).
  function refreshCallout() {
    if (!GN.data || !calloutSubEl) return;
    const furthest = GN.progression.getPathFurthest();
    const total = GN.pathContent.getNodes().length;
    calloutSubEl.textContent = furthest > 0
      ? furthest + ' / ' + total + ' clues solved'
      : 'A winding trail of country clues, one step at a time.';
  }

  document.getElementById('path-callout').addEventListener('click', () => {
    if (!GN.data) { GN.hud.showToast('Still loading the map — one moment…'); return; }
    GN.home.hideToOtherScreen();
    showPathScreen();
  });
  document.getElementById('path-back-btn').addEventListener('click', () => {
    hidePathScreen();
    GN.home.show();
  });

  GN.path = { showPathScreen, hidePathScreen, refreshCallout };
})();
