(function () {
  const GN = window.GN = window.GN || {};
  const MAX_SCORE = 1000;

  const TIERS = [
    { id: 'explorer', label: 'Explorer', unlockLevel: 1, poolSize: 40, discoveryForced: false, xpMult: 1 },
    { id: 'traveler', label: 'Traveler', unlockLevel: 2, poolSize: 90, discoveryForced: false, xpMult: 1.5 },
    { id: 'navigator', label: 'Navigator', unlockLevel: 5, poolSize: null, discoveryForced: false, xpMult: 2 },
    { id: 'globetrotter', label: 'Globetrotter', unlockLevel: 10, poolSize: null, discoveryForced: false, xpMult: 3 },
  ];

  // Cosmetic map color themes. The three original color pairs (Classic,
  // Coral Reef, Neon Grid) are all free and owned by default — only
  // Dinosaur and Population are actually purchasable. `style` picks the
  // visual treatment layered on top of these colors by map.js/style.css.
  // `ocean`/`graticule`/`eliminatedFill`/`eliminatedStroke` are optional
  // per-theme overrides of those vars for a themed backdrop — without them,
  // "not in play" countries would stay the default pale gray even against a
  // themed dark ocean, which reads as mismatched.
  const THEMES = [
    { id: 'classic', label: 'Classic', price: 0, style: 'flat',
      groupA: { light: '#2a78d6', dark: '#3987e5' }, groupB: { light: '#eb6834', dark: '#d95926' } },
    { id: 'reef', label: 'Coral Reef', price: 0, style: 'glow',
      groupA: { light: '#eb6834', dark: '#d95926' }, groupB: { light: '#1baf7a', dark: '#199e70' } },
    { id: 'neongrid', label: 'Neon Grid', price: 0, style: 'scifi',
      groupA: { light: '#e87ba4', dark: '#d55181' }, groupB: { light: '#008300', dark: '#008300' },
      ocean: '#050a14', graticule: '#123a3a', eliminatedFill: '#12172a', eliminatedStroke: '#2a2f52' },
    { id: 'dino', label: 'Dinosaur', price: 150, style: 'dino',
      groupA: { light: '#eda100', dark: '#c98500' }, groupB: { light: '#e34948', dark: '#e66767' },
      ocean: '#e7dbb8', graticule: '#a98f5c', eliminatedFill: '#d9c9a0', eliminatedStroke: '#a98f5c' },
    { id: 'population', label: 'Population', price: 300, style: 'population',
      groupA: { light: '#2a78d6', dark: '#3987e5' }, groupB: { light: '#eda100', dark: '#c98500' },
      ocean: '#080b18', graticule: '#2a2f52', eliminatedFill: '#1a2036', eliminatedStroke: '#2a2f52' },
  ];
  const FREE_THEME_IDS = THEMES.filter((t) => t.price === 0).map((t) => t.id);

  const SHIELD_PRICE = 120;

  let score = MAX_SCORE;
  let mistakes = 0;

  // --- persistent progression (XP / level / selected tier / wallet) --------

  function loadProgress() {
    const data = GN.storage.load();
    if (!data.progress) {
      // Starting balance is generous on purpose — it lets a new player open
      // the shop and actually try a purchase right away instead of grinding
      // toward it blind.
      data.progress = { xp: 0, tier: 'explorer', coins: 1000, shields: 0, ownedThemes: FREE_THEME_IDS.slice(), theme: 'classic' };
    }
    if (data.progress.coins == null) data.progress.coins = 1000;
    if (data.progress.shields == null) data.progress.shields = 0;
    if (!data.progress.ownedThemes) data.progress.ownedThemes = [];
    // Free themes are granted unconditionally, including retroactively to
    // existing saves — nothing with price 0 should ever need "buying".
    FREE_THEME_IDS.forEach((id) => {
      if (!data.progress.ownedThemes.includes(id)) data.progress.ownedThemes.push(id);
    });
    if (!data.progress.theme) data.progress.theme = 'classic';
    return data.progress;
  }
  function saveProgress(progress) {
    const data = GN.storage.load();
    data.progress = progress;
    GN.storage.save(data);
  }

  // Cumulative XP required to REACH `level` (triangular growth curve).
  function xpForLevel(level) {
    return Math.floor((100 * (level - 1) * level) / 2);
  }
  function levelForXp(xp) {
    let level = 1;
    while (xpForLevel(level + 1) <= xp) level++;
    return level;
  }

  function getXp() { return loadProgress().xp; }
  function getLevel() { return levelForXp(getXp()); }
  function unlockedTiers() {
    const level = getLevel();
    return TIERS.filter((t) => t.unlockLevel <= level);
  }
  function getSelectedTierId() {
    const progress = loadProgress();
    const unlockedIds = unlockedTiers().map((t) => t.id);
    return unlockedIds.includes(progress.tier) ? progress.tier : 'explorer';
  }
  function getSelectedTier() {
    return TIERS.find((t) => t.id === getSelectedTierId()) || TIERS[0];
  }
  function setSelectedTier(tierId) {
    const unlockedIds = unlockedTiers().map((t) => t.id);
    if (!unlockedIds.includes(tierId)) return false;
    const progress = loadProgress();
    progress.tier = tierId;
    saveProgress(progress);
    return true;
  }
  function addXp(amount) {
    const progress = loadProgress();
    const beforeLevel = levelForXp(progress.xp);
    progress.xp += amount;
    saveProgress(progress);
    const afterLevel = levelForXp(progress.xp);
    return { xp: progress.xp, level: afterLevel, leveledUp: afterLevel > beforeLevel };
  }

  // --- coin wallet -----------------------------------------------------------

  function getCoins() { return loadProgress().coins || 0; }
  function addCoins(amount) {
    if (!amount) return getCoins();
    const progress = loadProgress();
    progress.coins = (progress.coins || 0) + amount;
    saveProgress(progress);
    return progress.coins;
  }
  function spendCoins(amount) {
    const progress = loadProgress();
    if ((progress.coins || 0) < amount) return false;
    progress.coins -= amount;
    saveProgress(progress);
    return true;
  }

  // --- streak shield (consumable power-up) -----------------------------------

  function getShieldCount() { return loadProgress().shields || 0; }
  function buyShield() {
    if (!spendCoins(SHIELD_PRICE)) return false;
    const progress = loadProgress();
    progress.shields = (progress.shields || 0) + 1;
    saveProgress(progress);
    return true;
  }
  function consumeShield() {
    const progress = loadProgress();
    if ((progress.shields || 0) <= 0) return false;
    progress.shields -= 1;
    saveProgress(progress);
    return true;
  }

  // --- cosmetic themes ---------------------------------------------------

  function getThemeCatalog() { return THEMES; }
  function isThemeOwned(id) { return loadProgress().ownedThemes.includes(id); }
  function getEquippedThemeId() { return loadProgress().theme; }
  function getEquippedTheme() { return THEMES.find((t) => t.id === getEquippedThemeId()) || THEMES[0]; }
  function buyTheme(id) {
    const theme = THEMES.find((t) => t.id === id);
    if (!theme || isThemeOwned(id)) return false;
    if (!spendCoins(theme.price)) return false;
    const progress = loadProgress();
    progress.ownedThemes.push(id);
    saveProgress(progress);
    return true;
  }
  function equipTheme(id) {
    if (!isThemeOwned(id)) return false;
    const progress = loadProgress();
    progress.theme = id;
    saveProgress(progress);
    if (GN.theme) GN.theme.apply();
    return true;
  }

  // "Well-known" proxy for lower tiers: the most populous countries in the
  // full pool. Modes for which this doesn't make sense (Fog of War's
  // persistent world, Expedition's contiguous-route requirement) deliberately
  // don't call this and stay full-world at every tier.
  function scopePool(fullPool) {
    const tier = getSelectedTier();
    if (!tier.poolSize || fullPool.length <= tier.poolSize) return fullPool;
    if (!GN.data || !GN.data.metaByIdx) return fullPool;
    const withPop = fullPool.map((i) => {
      const meta = GN.data.metaByIdx(i);
      return { i, pop: (meta && meta.population) || 0 };
    });
    withPop.sort((a, b) => b.pop - a.pop);
    return withPop.slice(0, tier.poolSize).map((x) => x.i);
  }

  // --- per-round session state ----------------------------------------------

  let currentStreak = 0;

  function reset() {
    score = MAX_SCORE;
    mistakes = 0;
    currentStreak = 0;
  }
  function getScore() { return score; }
  function getMistakes() { return mistakes; }
  function getCurrentStreak() { return currentStreak; }
  function getBestStreak() { return loadProgress().bestStreak || 0; }

  // --- win bonus --------------------------------------------------------
  // A completion reward on top of per-answer coins, scaled by how much of
  // the 1000-point pool survived to the end — a near-perfect round pays out
  // far more than a scraped-by one. Called once per win from GN.hud.showWin,
  // not per-mode, so every mode's win screen gets it for free.
  function winBonusForScore(s) {
    if (s >= MAX_SCORE) return 20;
    if (s >= 950) return 10;
    if (s >= 900) return 5;
    if (s >= 800) return 3;
    if (s >= 500) return 2;
    return 1;
  }
  function applyWinBonus() {
    const bonus = Math.round(winBonusForScore(score) * getSelectedTier().xpMult);
    const coins = addCoins(bonus);
    if (GN.shop) GN.shop.refreshWalletDisplay();
    return { bonus, coins };
  }

  // outcome: {type: 'correct'|'wrong'|'partial', cost, partialRatio, coins}
  function applyOutcome(outcome) {
    const cost = outcome.cost != null ? outcome.cost : (outcome.type === 'correct' ? 10 : 50);
    let shieldUsed = false;
    if (outcome.type === 'wrong') {
      mistakes++;
      score = Math.max(0, score - cost);
      if (currentStreak > 0 && consumeShield()) {
        shieldUsed = true;
        if (GN.hud) GN.hud.showToast('Streak Shield used — your streak is safe!');
        // streak is deliberately NOT reset here
      } else {
        currentStreak = 0;
      }
    } else if (outcome.type === 'correct' || outcome.type === 'partial') {
      score = Math.max(0, score - cost);
      if (outcome.type === 'correct') {
        currentStreak++;
        const progress = loadProgress();
        if (currentStreak > (progress.bestStreak || 0)) {
          progress.bestStreak = currentStreak;
          saveProgress(progress);
        }
      } else {
        currentStreak = 0;
      }
    }

    const tier = getSelectedTier();
    let xpGain = 2; // small consolation XP even on a wrong answer, so play always progresses a little
    if (outcome.type === 'correct') xpGain = 15;
    else if (outcome.type === 'partial') xpGain = Math.round(8 * (outcome.partialRatio != null ? outcome.partialRatio : 0.5));
    xpGain = Math.round(xpGain * tier.xpMult);
    const xpResult = addXp(xpGain);
    if (xpResult.leveledUp && GN.hud) {
      GN.hud.showToast('Level up! You’re now Level ' + xpResult.level + '.');
    }

    // Coins: a mode can pass an explicit amount (Expedition's combo formula);
    // otherwise a small default so every mode's correct answers feed the
    // same wallet. Wrong answers never earn coins.
    let coinsGain = 0;
    if (outcome.coins != null) {
      coinsGain = outcome.coins;
    } else if (outcome.type === 'correct') {
      coinsGain = 10;
    } else if (outcome.type === 'partial') {
      coinsGain = Math.round(5 * (outcome.partialRatio != null ? outcome.partialRatio : 0.5));
    }
    coinsGain = Math.round(coinsGain * tier.xpMult);
    const coinsTotal = addCoins(coinsGain);
    if (GN.shop) GN.shop.refreshWalletDisplay();

    return Object.assign({ score, mistakes, xpGain, currentStreak, coinsGain, coins: coinsTotal, shieldUsed }, xpResult);
  }

  GN.progression = {
    MAX_SCORE, TIERS, THEMES, SHIELD_PRICE,
    reset, getScore, getMistakes, applyOutcome, getCurrentStreak, getBestStreak,
    winBonusForScore, applyWinBonus,
    getXp, getLevel, unlockedTiers, getSelectedTierId, getSelectedTier, setSelectedTier,
    xpForLevel, scopePool,
    getCoins, addCoins, spendCoins,
    getShieldCount, buyShield, consumeShield,
    getThemeCatalog, isThemeOwned, getEquippedThemeId, getEquippedTheme, buyTheme, equipTheme,
  };
})();
