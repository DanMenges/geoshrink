(function () {
  const GN = window.GN = window.GN || {};

  const ICONS = {
    // world with a split line — narrowing the globe in two
    narrow: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M4.5 8h15M4.5 16h15"/>',
    // expanding rings — revealing territory outward from a point
    fog: '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="5.5"/><path d="M19.5 12a7.5 7.5 0 0 0-2-5.1" stroke-linecap="round"/>',
    // two adjacent regions sharing an edge
    neighbor: '<path d="M4 6h7v12H4z"/><path d="M11 6h9v12h-9z"/><path d="M11 6v12" stroke-width="2.4"/>',
    // two bars of different height, being compared
    size: '<path d="M6 20V10M12 20V4M18 20v7"/><path d="M4 20h16" stroke-linecap="round"/>',
    // a flag on a pole
    flags: '<path d="M6 21V4"/><path d="M6 5h12l-3 3.5L18 12H6"/>',
    // a capitol-style building
    capitals: '<path d="M4 20h16"/><path d="M5 20V10M9 20V10M12 20V10M15 20V10M19 20V10"/><path d="M3 10 12 4l9 6"/>',
    // compass rose
    compass: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5 14 12l-2 5.5L10 12z"/>',
    // three linked circles — a bloc/alliance
    blocs: '<circle cx="8" cy="9" r="3.4"/><circle cx="16" cy="9" r="3.4"/><circle cx="12" cy="16" r="3.4"/>',
    // dashed route with a pin at the end
    expedition: '<circle cx="5" cy="6" r="1.6" fill="currentColor" stroke="none"/><path d="M6.5 7 17 17" stroke-dasharray="2.5 2.8" stroke-linecap="round"/><path d="M19 20a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2Z"/><path d="M19 20v0"/>',
  };
  function svgIcon(name) {
    return '<svg class="mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  const MODE_CARDS = [
    { id: 'narrow', title: 'Narrow Down', desc: 'The world splits in two each round — narrow down to the target country, or gamble on a direct guess.' },
    { id: 'fog', title: 'Fog of War', desc: 'Explore outward from a home country. Wrong guesses cost nothing, and your progress is saved as you go.' },
    { id: 'neighbor', title: 'Neighbor Match', desc: 'Click every country that shares a border with the reference country.' },
    { id: 'size', title: 'Size Showdown', desc: 'Quick head-to-head guesses: which country has the bigger land area?' },
    { id: 'flags', title: 'Flag Frenzy', desc: 'Identify the country from its flag.' },
    { id: 'capitals', title: 'Capital Match', desc: 'Match the capital city to its country.' },
    { id: 'compass', title: 'Compass Quiz', desc: 'Is it north, south, east, or west of the reference country?' },
    { id: 'blocs', title: 'Bloc Bingo', desc: 'Six countries, one doesn’t belong — spot the odd one out of the alliance.' },
    { id: 'expedition', title: 'Expedition', desc: 'Travel a random border-by-border path from an origin to a destination — click each named country to press on and collect points.' },
  ];

  const homeScreen = document.getElementById('home-screen');
  const boardEl = document.querySelector('.board');

  function renderLevelBadge() {
    const xp = GN.progression.getXp();
    const level = GN.progression.getLevel();
    const thisLevelXp = GN.progression.xpForLevel(level);
    const nextLevelXp = GN.progression.xpForLevel(level + 1);
    const span = Math.max(1, nextLevelXp - thisLevelXp);
    const into = xp - thisLevelXp;
    document.getElementById('home-level').textContent = level;
    document.getElementById('home-xp-fill').style.width = Math.round(100 * Math.max(0, Math.min(1, into / span))) + '%';
    document.getElementById('home-xp-label').textContent = into + ' / ' + span + ' XP to level ' + (level + 1);
    document.getElementById('home-best-streak').textContent = 'Best streak: ' + GN.progression.getBestStreak();
  }

  function renderTierPicker() {
    const selected = GN.progression.getSelectedTierId();
    const level = GN.progression.getLevel();
    const html = GN.progression.TIERS.map((t) => {
      const unlocked = t.unlockLevel <= level;
      const cls = 'tier-chip' + (t.id === selected && unlocked ? ' active' : '') + (unlocked ? '' : ' locked');
      const lockIcon = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
      return '<button class="' + cls + '" data-tier="' + t.id + '"' + (unlocked ? '' : ' disabled') + '>' +
        t.label + (unlocked ? '' : ' <span class="tier-lock">' + lockIcon + ' Lv.' + t.unlockLevel + '</span>') +
        '</button>';
    }).join('');
    document.getElementById('tier-picker').innerHTML = html;
    document.querySelectorAll('.tier-chip:not(.locked)').forEach((btn) => {
      btn.addEventListener('click', () => {
        GN.progression.setSelectedTier(btn.getAttribute('data-tier'));
        renderTierPicker();
      });
    });
  }

  function renderModeGrid() {
    const html = MODE_CARDS.map((m, i) =>
      '<button class="mode-card" data-mode="' + m.id + '" style="animation-delay:' + (i * 35) + 'ms">' +
      svgIcon(m.id) +
      '<span class="mode-title">' + m.title + '</span>' +
      '<span class="mode-desc">' + m.desc + '</span>' +
      '</button>'
    ).join('');
    document.getElementById('mode-grid').innerHTML = html;
    document.querySelectorAll('.mode-card').forEach((btn) => {
      btn.addEventListener('click', () => enterMode(btn.getAttribute('data-mode')));
    });
  }

  function todayUTCString() {
    const d = new Date();
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  function renderDailyCallout() {
    const btn = document.getElementById('daily-callout');
    const record = GN.storage.getModeState('daily');
    const playedToday = record && record.date === todayUTCString();
    const icon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8 3v3.5M16 3v3.5"/></svg>';
    btn.innerHTML = icon +
      '<span class="daily-callout-text">' +
      '<span class="daily-callout-title">' + (playedToday ? 'Daily Challenge — see today’s result' : 'Daily Challenge') + '</span>' +
      '<span class="daily-callout-sub">' + (playedToday ? record.shareText.split('\n')[2] : 'Same puzzle for everyone, once a day.') + '</span>' +
      '</span>';
  }

  function show() {
    renderLevelBadge();
    renderTierPicker();
    renderDailyCallout();
    renderModeGrid();
    homeScreen.classList.add('show');
    boardEl.classList.add('hidden');
    GN.heroGlobe.start();
  }
  function hide() {
    homeScreen.classList.remove('show');
    boardEl.classList.remove('hidden');
    GN.heroGlobe.stop();
  }

  function enterMode(modeId) {
    if (!GN.data) {
      GN.hud.showToast('Still loading the map — one moment…');
      return;
    }
    hide();
    GN.modeShell.start(modeId, { data: GN.data });
  }

  document.getElementById('daily-callout').addEventListener('click', () => enterMode('daily'));
  document.getElementById('atlas-callout').addEventListener('click', () => enterMode('atlas'));

  document.getElementById('reset-progress-btn').addEventListener('click', () => {
    if (!window.confirm('Reset all progress (level, XP, and Fog of War exploration)? This cannot be undone.')) return;
    GN.storage.reset();
    renderLevelBadge();
    renderTierPicker();
    renderDailyCallout();
  });

  GN.home = { show, hide, enterMode, renderLevelBadge };
})();
