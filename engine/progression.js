(function () {
  const GN = window.GN = window.GN || {};

  // Difficulty is a freely-chosen preference, not an XP-gated unlock (the
  // old 4-tier system conflated the two). Reward scaling (xpMult) carries
  // over from that system — Hard still pays out more XP/coins — but nothing
  // is locked by player level anymore.
  const DIFFICULTIES = [
    { id: 'easy', label: 'Easy', poolSize: 40, xpMult: 1 },
    { id: 'medium', label: 'Medium', poolSize: 100, xpMult: 1.5 },
    { id: 'hard', label: 'Hard', poolSize: null, xpMult: 2.2 }, // null = full world; obscurity bias applied at pick time instead of a hard cutoff
  ];
  // Existing saves may have `progress.tier` set to an old tier id — map
  // those forward rather than silently resetting anyone to Easy.
  const LEGACY_TIER_MAP = { explorer: 'easy', traveler: 'medium', navigator: 'hard', globetrotter: 'hard' };

  // Cosmetic map color themes. The three original color pairs (Classic,
  // Coral Reef, Neon Grid) are all free and owned by default — only
  // Dinosaur and Population are actually purchasable. `style` picks the
  // visual treatment layered on top of these colors by map.js/style.css.
  // `ocean`/`graticule` are optional per-theme overrides of those vars for
  // a themed backdrop. "Not in play" (eliminated) countries deliberately
  // stay the plain default gray for every theme — it's a neutral, fixed
  // meaning shared with the legend swatch, not something a cosmetic theme
  // should recolor.
  const THEMES = [
    { id: 'classic', label: 'Classic', price: 0, style: 'flat',
      groupA: { light: '#2a78d6', dark: '#3987e5' }, groupB: { light: '#eb6834', dark: '#d95926' } },
    { id: 'reef', label: 'Coral Reef', price: 0, style: 'glow',
      groupA: { light: '#eb6834', dark: '#d95926' }, groupB: { light: '#1baf7a', dark: '#199e70' } },
    { id: 'neongrid', label: 'Neon Grid', price: 0, style: 'scifi',
      groupA: { light: '#e87ba4', dark: '#d55181' }, groupB: { light: '#008300', dark: '#008300' },
      ocean: '#050a14', graticule: '#123a3a' },
    { id: 'dino', label: 'Dinosaur', price: 150, style: 'dino',
      groupA: { light: '#eda100', dark: '#c98500' }, groupB: { light: '#e34948', dark: '#e66767' },
      ocean: '#e7dbb8', graticule: '#a98f5c' },
    { id: 'population', label: 'Population', price: 300, style: 'population',
      groupA: { light: '#2a78d6', dark: '#3987e5' }, groupB: { light: '#eda100', dark: '#c98500' },
      ocean: '#080b18', graticule: '#2a2f52' },
  ];
  const FREE_THEME_IDS = THEMES.filter((t) => t.price === 0).map((t) => t.id);

  const SHIELD_PRICE = 120;

  let score = 0;
  let mistakes = 0;

  // --- persistent progression (XP / level / selected tier / wallet) --------

  function loadProgress() {
    const data = GN.storage.load();
    if (!data.progress) {
      // Starting balance is generous on purpose — it lets a new player open
      // the shop and actually try a purchase right away instead of grinding
      // toward it blind.
      data.progress = { xp: 0, tier: 'easy', coins: 1000, shields: 0, ownedThemes: FREE_THEME_IDS.slice(), theme: 'classic', recentTargets: [], showFlags: true };
    }
    if (data.progress.coins == null) data.progress.coins = 1000;
    if (data.progress.shields == null) data.progress.shields = 0;
    if (!data.progress.recentTargets) data.progress.recentTargets = [];
    if (data.progress.showFlags == null) data.progress.showFlags = true;
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
  function getSelectedDifficultyId() {
    const progress = loadProgress();
    const id = LEGACY_TIER_MAP[progress.tier] || progress.tier;
    return DIFFICULTIES.some((d) => d.id === id) ? id : 'easy';
  }
  function getSelectedDifficulty() {
    return DIFFICULTIES.find((d) => d.id === getSelectedDifficultyId()) || DIFFICULTIES[0];
  }
  function setSelectedDifficulty(id) {
    if (!DIFFICULTIES.some((d) => d.id === id)) return false;
    const progress = loadProgress();
    progress.tier = id;
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

  // --- settings ---------------------------------------------------------

  function getShowFlags() { return loadProgress().showFlags !== false; }
  function setShowFlags(on) {
    const progress = loadProgress();
    progress.showFlags = !!on;
    saveProgress(progress);
  }

  // --- sampling: difficulty-weighted pool + target selection ---------------
  // "Familiarity" is rank-based, not raw population magnitude — population
  // spans several orders of magnitude, so a magnitude-based blend lets it
  // dominate completely and also biases Easy toward the exact same
  // billion-person countries every game. Rank-based normalization flattens
  // that automatically. orgs.length is a minor tiebreaker only (UN/EU/G20/
  // etc. membership counts are a weak, noisy notability signal on their own).
  let familiarityCache = null;
  function buildFamiliarityCache() {
    if (!GN.data || !GN.data.metaByIdx || !GN.data.playableIndices) return null;
    const withPop = GN.data.playableIndices.map((i) => {
      const meta = GN.data.metaByIdx(i);
      return { i, pop: (meta && meta.population) || 0, orgs: (meta && meta.orgs && meta.orgs.length) || 0 };
    });
    withPop.sort((a, b) => a.pop - b.pop); // ascending: rank 0 = least populous
    const n = withPop.length;
    const cache = new Map();
    withPop.forEach((entry, rank) => {
      const popRankScore = n > 1 ? rank / (n - 1) : 1; // 0..1, 1 = most populous
      const orgsScore = Math.min(entry.orgs, 3) / 3;
      cache.set(entry.i, 0.8 * popRankScore + 0.2 * orgsScore);
    });
    return cache;
  }
  function familiarity(idx) {
    if (!familiarityCache) familiarityCache = buildFamiliarityCache();
    if (!familiarityCache) return 0.5; // data not loaded yet — neutral fallback
    return familiarityCache.has(idx) ? familiarityCache.get(idx) : 0.5;
  }
  function weightForDifficulty(diffId, idx) {
    const f = familiarity(idx);
    if (diffId === 'easy') return Math.pow(f, 3) + 0.001; // strong bias to famous, tiny floor so nothing is ever impossible
    if (diffId === 'hard') return Math.pow(1 - f, 3) + 0.001; // strong bias to obscure
    return 0.3 + 0.4 * f; // medium: mild bias, keeps the whole world plausible
  }
  // Roulette-wheel-and-splice weighted sampling without replacement.
  // O(n*k) — plenty fast for pools capped at ~174 countries.
  function weightedSampleWithoutReplacement(items, weightFn, k) {
    const pool = items.map((item) => ({ item, w: Math.max(weightFn(item), 1e-6) }));
    const result = [];
    const take = Math.min(k, pool.length);
    for (let n = 0; n < take; n++) {
      const total = pool.reduce((s, p) => s + p.w, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < pool.length - 1; idx++) { r -= pool[idx].w; if (r <= 0) break; }
      result.push(pool[idx].item);
      pool.splice(idx, 1);
    }
    return result;
  }

  function difficultyById(id) {
    return DIFFICULTIES.find((d) => d.id === id);
  }

  // Builds a FRESH candidate pool for a new game session — replaces the old
  // scopePool()'s fixed deterministic top-N-by-population slice, which
  // returned the exact same set every single game. Modes for which pool
  // scoping doesn't make sense (Fog of War's persistent world, Expedition's
  // contiguous-route requirement) deliberately don't call this.
  // `difficultyIdOverride` lets a caller pick a specific difficulty instead
  // of the local player's persisted selection — multiplayer rooms have their
  // own chosen difficulty, generated by whichever client is host, and that
  // shouldn't depend on the host's personal single-player setting.
  function buildPool(fullPool, difficultyIdOverride) {
    const diff = (difficultyIdOverride && difficultyById(difficultyIdOverride)) || getSelectedDifficulty();
    if (!diff.poolSize || fullPool.length <= diff.poolSize) return fullPool;
    return weightedSampleWithoutReplacement(fullPool, (idx) => weightForDifficulty(diff.id, idx), diff.poolSize);
  }

  // Picks one target from a pool, excluding recently-seen targets (a
  // persisted, capped, cross-mode history) so consecutive rounds don't repeat
  // the same countries — replaces every mode's own raw
  // `pool[Math.floor(Math.random() * pool.length)]`.
  function pickTarget(pool, difficultyIdOverride) {
    if (!pool.length) return undefined;
    const diff = (difficultyIdOverride && difficultyById(difficultyIdOverride)) || getSelectedDifficulty();
    const progress = loadProgress();
    const cap = Math.max(1, Math.min(20, Math.floor(pool.length / 2)));
    const recent = new Set(progress.recentTargets || []);
    let candidates = pool.filter((i) => !recent.has(i));
    if (!candidates.length) candidates = pool; // never starve if history excludes everything
    const [picked] = weightedSampleWithoutReplacement(candidates, (idx) => weightForDifficulty(diff.id, idx), 1);
    progress.recentTargets = [picked, ...(progress.recentTargets || [])].slice(0, cap);
    saveProgress(progress);
    return picked;
  }

  // --- per-round session state ----------------------------------------------

  let currentStreak = 0;

  function reset() {
    score = 0;
    mistakes = 0;
    currentStreak = 0;
  }
  function getScore() { return score; }
  function getMistakes() { return mistakes; }
  function getCurrentStreak() { return currentStreak; }
  function getBestStreak() { return loadProgress().bestStreak || 0; }

  // --- win bonus --------------------------------------------------------
  // A completion reward on top of per-answer coins. Keyed to mistake count
  // rather than the final score, since score is now an open-ended running
  // total earned (not drawn down from a fixed pool) and its achievable range
  // is different per mode — mistakes are the one signal every mode already
  // tracks the same way, and "how clean was this run" is the thing actually
  // worth rewarding here. Called once per win from GN.hud.showWin, not
  // per-mode, so every mode's win screen gets it for free.
  function winBonusForMistakes(m) {
    if (m === 0) return 20;
    if (m === 1) return 10;
    if (m === 2) return 5;
    if (m <= 4) return 3;
    if (m <= 8) return 2;
    return 1;
  }
  function applyWinBonus() {
    const bonus = Math.round(winBonusForMistakes(mistakes) * getSelectedDifficulty().xpMult);
    const coins = addCoins(bonus);
    if (GN.shop) GN.shop.refreshWalletDisplay();
    return { bonus, coins };
  }

  // outcome: {type: 'correct'|'wrong'|'partial', points, partialRatio, coins}
  // Points are always EARNED, never spent — a wrong answer simply pays out
  // nothing rather than deducting from a shrinking pool. Psychologically,
  // "the number only ever goes up" reads as encouraging in a way a
  // draw-down-from-1000 meter doesn't, especially for a learning game where
  // getting something wrong is a normal, low-stakes part of the process.
  function applyOutcome(outcome) {
    const points = outcome.points != null ? outcome.points : (outcome.type === 'correct' ? 50 : 0);
    let shieldUsed = false;
    if (outcome.type === 'wrong') {
      mistakes++;
      if (currentStreak > 0 && consumeShield()) {
        shieldUsed = true;
        if (GN.hud) GN.hud.showToast('Streak Shield used — your streak is safe!');
        // streak is deliberately NOT reset here
      } else {
        currentStreak = 0;
      }
    } else if (outcome.type === 'correct' || outcome.type === 'partial') {
      score += points;
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

    const tier = getSelectedDifficulty();
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
    DIFFICULTIES, THEMES, SHIELD_PRICE,
    reset, getScore, getMistakes, applyOutcome, getCurrentStreak, getBestStreak,
    winBonusForMistakes, applyWinBonus,
    getXp, getLevel, getSelectedDifficultyId, getSelectedDifficulty, setSelectedDifficulty,
    xpForLevel, buildPool, pickTarget,
    getCoins, addCoins, spendCoins,
    getShieldCount, buyShield, consumeShield,
    getThemeCatalog, isThemeOwned, getEquippedThemeId, getEquippedTheme, buyTheme, equipTheme,
    getShowFlags, setShowFlags,
  };
})();
