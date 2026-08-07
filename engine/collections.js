(function () {
  const GN = window.GN = window.GN || {};

  const screenEl = document.getElementById('collections-screen');
  const gridEl = document.getElementById('collections-grid');
  const progressEl = document.getElementById('collections-progress');
  const calloutSubEl = document.getElementById('collections-callout-sub');

  // Simple hand-drawn line icons matching the app's existing icon style —
  // three tiers stacking up in visual weight (a thin partial stamp, a
  // completed stamp, then a full passport booklet), plus tier 0 (no icon —
  // the flag itself renders dim/desaturated instead, see .coll-card.tier-0).
  const TIER_ICONS = {
    1: '<svg class="coll-tier-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="7" width="14" height="10" rx="1.5"/><path d="M8 7v10" stroke-dasharray="2 2"/></svg>',
    2: '<svg class="coll-tier-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="7" width="14" height="10" rx="1.5"/><path d="M8.5 12.5l2 2 4.5-5" stroke-linecap="round"/></svg>',
    3: '<svg class="coll-tier-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="1.5"/><circle cx="12" cy="10" r="2.4"/><path d="M9 16.5c.5-1.6 1.6-2.3 3-2.3s2.5.7 3 2.3" stroke-linecap="round"/></svg>',
  };

  function renderPassports() {
    if (!GN.data || !gridEl) return;
    const indices = GN.data.metaIndices.slice().sort((a, b) => GN.data.names[a].localeCompare(GN.data.names[b]));
    const collected = GN.progression.getPassportCollectedCount();
    if (progressEl) progressEl.textContent = collected + ' / ' + indices.length + ' passports collected';
    gridEl.innerHTML = indices.map((idx) => {
      const meta = GN.data.metaByIdx(idx);
      const iso2 = meta && meta.iso2;
      const tier = GN.progression.getPassportTier(idx);
      const tierInfo = GN.progression.PASSPORT_TIERS[tier];
      return '<div class="coll-card tier-' + tier + '">' +
        (iso2 ? '<img class="coll-flag" src="flags/' + iso2 + '.svg" alt="" loading="lazy">' : '<span class="coll-flag coll-flag-none"></span>') +
        '<span class="coll-tier-badge">' + (TIER_ICONS[tier] || '') + '</span>' +
        '<span class="coll-name">' + GN.data.names[idx] + '</span>' +
        '<span class="coll-tier-label">' + tierInfo.label + '</span>' +
        '</div>';
    }).join('');
  }

  function renderTab(tab) {
    if (tab === 'passports') renderPassports();
    // Future subcollections plug in here as additional tabs/branches.
  }

  document.querySelectorAll('#collections-tab-row .collections-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#collections-tab-row .collections-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderTab(btn.getAttribute('data-tab'));
    });
  });

  function showCollectionsScreen() {
    renderTab('passports');
    if (screenEl) screenEl.classList.add('show');
  }
  function hideCollectionsScreen() {
    if (screenEl) screenEl.classList.remove('show');
  }

  // Kept live the same way the Home Daily Challenge callout already is —
  // called on module load for first paint, and again by GN.home.show()
  // every time the player returns to Home (see engine/home.js).
  function refreshCallout() {
    if (!GN.data || !calloutSubEl) return;
    const collected = GN.progression.getPassportCollectedCount();
    calloutSubEl.textContent = collected > 0
      ? collected + ' / ' + GN.data.metaIndices.length + ' passports collected'
      : 'Passports earned from flawless Geo Shrink runs.';
  }

  document.getElementById('collections-callout').addEventListener('click', () => {
    if (!GN.data) { GN.hud.showToast('Still loading the map — one moment…'); return; }
    GN.home.hideToOtherScreen();
    showCollectionsScreen();
  });
  document.getElementById('collections-back-btn').addEventListener('click', () => {
    hideCollectionsScreen();
    GN.home.show();
  });

  GN.collections = { showCollectionsScreen, hideCollectionsScreen, refreshCallout };
})();
