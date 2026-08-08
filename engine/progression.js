(function () {
  const GN = window.GN = window.GN || {};

  // Medium/Hard are level-gated unlocks (Easy is always available) — a
  // simple two-threshold gate, not the old fully level-gated 4-tier system.
  // xpMult is deliberately exact multiples of Easy's 1x: Medium pays out
  // 50% more XP/coins, Hard pays out 100% more — both are shown directly on
  // the Home difficulty picker so the tradeoff is explicit up front.
  const DIFFICULTIES = [
    { id: 'easy', label: 'Easy', poolSize: 40, xpMult: 1, unlockLevel: 1 },
    { id: 'medium', label: 'Medium', poolSize: 100, xpMult: 1.5, unlockLevel: 5 },
    { id: 'hard', label: 'Hard', poolSize: null, xpMult: 2, unlockLevel: 10 }, // null = full world; obscurity bias applied at pick time instead of a hard cutoff
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

  // Per-country collectible earned by flawless (0-mistake) Geo Shrink
  // completions of that specific country: tier 0 (absent from the map)
  // through 3 (Passport, max — repeating it further is a no-op). Keyed by
  // ISO3, the same stable per-country identifier `iso3ByIdx`/country-meta.json
  // use everywhere else in the app.
  const PASSPORT_TIERS = [
    { id: 0, label: 'Undiscovered' },
    { id: 1, label: 'Tourist Visa' },
    { id: 2, label: 'Long-Stay Visa' },
    { id: 3, label: 'Passport' },
  ];
  const PASSPORT_MAX_TIER = PASSPORT_TIERS.length - 1;

  // Level-up rewards: coins on every level, plus a Repair Tool grant every
  // 10th — separate from the per-answer coin trickle, so leveling up itself
  // stays a meaningful, escalating reward across the "long horizon" of play.
  const LEVEL_UP_COIN_BASE = 20;
  const LEVEL_UP_COIN_STEP = 10;
  const REPAIR_TOOL_LEVEL_INTERVAL = 10;
  const REPAIR_TOOLS_PER_MILESTONE = 5;

  let score = 0;
  let mistakes = 0;

  // --- persistent progression (XP / level / selected tier / wallet) --------

  function loadProgress() {
    const data = GN.storage.load();
    if (!data.progress) {
      // Starting balance is generous on purpose — it lets a new player open
      // the shop and actually try a purchase right away instead of grinding
      // toward it blind.
      data.progress = { xp: 0, tier: 'easy', coins: 1000, shields: 0, ownedThemes: FREE_THEME_IDS.slice(), theme: 'classic', recentTargets: [], showFlags: true, passports: {}, repairTools: 0, expeditionRecent: [] };
    }
    if (data.progress.coins == null) data.progress.coins = 1000;
    if (data.progress.shields == null) data.progress.shields = 0;
    if (!data.progress.recentTargets) data.progress.recentTargets = [];
    if (data.progress.showFlags == null) data.progress.showFlags = true;
    if (!data.progress.ownedThemes) data.progress.ownedThemes = [];
    if (!data.progress.passports) data.progress.passports = {};
    if (data.progress.repairTools == null) data.progress.repairTools = 0;
    if (!data.progress.expeditionRecent) data.progress.expeditionRecent = [];
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
  function difficultyById(id) {
    return DIFFICULTIES.find((d) => d.id === id);
  }
  function isDifficultyUnlocked(id) {
    const diff = difficultyById(id);
    return !!diff && getLevel() >= (diff.unlockLevel || 1);
  }
  // If the stored preference is a difficulty the player hasn't reached the
  // level for yet (e.g. it was picked back when nothing was level-gated),
  // this reads as Easy rather than silently granting the locked tier — the
  // stored value itself is left untouched, so it just resumes automatically
  // once they actually reach the required level.
  function getSelectedDifficultyId() {
    const progress = loadProgress();
    const id = LEGACY_TIER_MAP[progress.tier] || progress.tier;
    const resolved = DIFFICULTIES.some((d) => d.id === id) ? id : 'easy';
    return isDifficultyUnlocked(resolved) ? resolved : 'easy';
  }
  function getSelectedDifficulty() {
    return DIFFICULTIES.find((d) => d.id === getSelectedDifficultyId()) || DIFFICULTIES[0];
  }
  function setSelectedDifficulty(id) {
    if (!DIFFICULTIES.some((d) => d.id === id)) return false;
    if (!isDifficultyUnlocked(id)) return false;
    const progress = loadProgress();
    progress.tier = id;
    saveProgress(progress);
    return true;
  }
  function addXp(amount) {
    const progress = loadProgress();
    const beforeLevel = levelForXp(progress.xp);
    progress.xp += amount;
    const afterLevel = levelForXp(progress.xp);
    // A loop, not just a check against afterLevel: a single XP grant can in
    // principle cross more than one level boundary at once (early levels are
    // cheap), and each crossed level should pay out its own reward rather
    // than only the final one landed on.
    let coinsAwarded = 0, repairToolsAwarded = 0;
    for (let lvl = beforeLevel + 1; lvl <= afterLevel; lvl++) {
      coinsAwarded += LEVEL_UP_COIN_BASE + LEVEL_UP_COIN_STEP * lvl;
      if (lvl % REPAIR_TOOL_LEVEL_INTERVAL === 0) repairToolsAwarded += REPAIR_TOOLS_PER_MILESTONE;
    }
    if (coinsAwarded > 0) progress.coins = (progress.coins || 0) + coinsAwarded;
    if (repairToolsAwarded > 0) progress.repairTools = (progress.repairTools || 0) + repairToolsAwarded;
    saveProgress(progress);
    return {
      xp: progress.xp, level: afterLevel, leveledUp: afterLevel > beforeLevel,
      coinsAwarded, repairToolsAwarded,
    };
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

  // --- repair tool (consumable — undoes a mistake mid-round) -----------------
  // Granted for free every REPAIR_TOOL_LEVEL_INTERVAL levels (see addXp), not
  // purchasable with coins. Decrements the live per-round `mistakes` counter
  // directly, so a repaired mistake is indistinguishable from one that never
  // happened to every consumer that reads getMistakes() — the HUD stat, the
  // win-screen text, and the flawless check recordFlawlessCompletion gates on.

  function getRepairToolCount() { return loadProgress().repairTools || 0; }
  function useRepairTool() {
    if (getRepairToolCount() <= 0 || mistakes <= 0) return false;
    const progress = loadProgress();
    progress.repairTools -= 1;
    saveProgress(progress);
    mistakes -= 1;
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

  // --- passport collection -------------------------------------------------
  // One entry per country, keyed by ISO3. Advanced only by
  // recordFlawlessCompletion (called from Geo Shrink on a 0-mistake finish),
  // never regresses on a non-flawless run — trying again just doesn't help,
  // it doesn't set you back.

  function iso3ForIdx(idx) {
    return GN.data && GN.data.iso3ByIdx ? GN.data.iso3ByIdx[idx] : null;
  }
  function getPassportTier(idx) {
    const iso3 = iso3ForIdx(idx);
    if (!iso3) return 0;
    return loadProgress().passports[iso3] || 0;
  }
  function getPassportTierByIso3(iso3) {
    return loadProgress().passports[iso3] || 0;
  }
  function recordFlawlessCompletion(idx) {
    const iso3 = iso3ForIdx(idx);
    if (!iso3) return { iso3: null, tier: 0, tierUp: false, tierLabel: '' };
    const progress = loadProgress();
    const before = progress.passports[iso3] || 0;
    if (before >= PASSPORT_MAX_TIER) {
      return { iso3, tier: before, tierUp: false, tierLabel: PASSPORT_TIERS[before].label };
    }
    const after = before + 1;
    progress.passports[iso3] = after;
    saveProgress(progress);
    return { iso3, tier: after, tierUp: true, tierLabel: PASSPORT_TIERS[after].label };
  }
  function getPassportCollectedCount() {
    const passports = loadProgress().passports;
    return Object.keys(passports).filter((k) => passports[k] > 0).length;
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

  // Expedition picks TWO endpoints (origin + destination) per round from a
  // graph-connectivity-constrained candidate set, not a single weighted
  // target — so it keeps its own small recency list rather than sharing
  // recentTargets above (mixing the two would tie Expedition's exclusion to
  // unrelated cross-mode single-target picks). Kept separate and simple:
  // pure recency exclusion, no difficulty/familiarity weighting.
  const EXPEDITION_RECENT_CAP = 16;
  function getExpeditionRecent() { return loadProgress().expeditionRecent || []; }
  function recordExpeditionEndpoints(a, b) {
    const progress = loadProgress();
    const seen = new Set();
    progress.expeditionRecent = [a, b, ...(progress.expeditionRecent || [])]
      .filter((i) => (seen.has(i) ? false : (seen.add(i), true)))
      .slice(0, EXPEDITION_RECENT_CAP);
    saveProgress(progress);
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

  // Shared by applyOutcome's per-answer XP and applyRoundXp's per-round XP
  // below — one place for "grant this much XP, refresh the HUD chip, and
  // toast a level-up with its rewards" so both paths stay in sync.
  function grantXp(amount) {
    const xpResult = addXp(amount);
    if (GN.hud && GN.hud.refreshLevelChip) GN.hud.refreshLevelChip();
    if (xpResult.leveledUp && GN.hud) {
      let msg = 'Level up! You’re now Level ' + xpResult.level + '.';
      const rewardParts = [];
      if (xpResult.coinsAwarded > 0) rewardParts.push('+' + xpResult.coinsAwarded + ' coins');
      if (xpResult.repairToolsAwarded > 0) rewardParts.push(xpResult.repairToolsAwarded + ' Repair Tools');
      if (rewardParts.length) msg += ' ' + rewardParts.join(' and ') + '!';
      GN.hud.showToast(msg);
    }
    return xpResult;
  }

  // --- round-end XP (Geo Shrink) --------------------------------------------
  // Geo Shrink awards XP once per round, proportional to that round's final
  // score, instead of a fixed per-answer amount — a "perfect" 1000-point
  // round (an instant level-0 direct guess) pays out 50 XP on Easy, scaling
  // with difficulty the same way everything else does (75 on Medium, 100 on
  // Hard). modes/narrow.js suppresses its own per-answer XP (outcome.xp: 0
  // on every applyOutcome call) and calls this once from finishGame instead.
  const ROUND_XP_RATE = 0.05;
  function applyRoundXp(points) {
    const xpGain = Math.round(points * ROUND_XP_RATE * getSelectedDifficulty().xpMult);
    return Object.assign({ xpGain }, grantXp(xpGain));
  }

  // outcome: {type: 'correct'|'wrong'|'partial', points, partialRatio, coins, xp}
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
    // A mode can pass an explicit xp (Geo Shrink passes 0 on every call —
    // see applyRoundXp above — so its XP is only ever granted once, at
    // round-end); otherwise the same fixed-per-answer default every other
    // mode still uses.
    let xpGain;
    if (outcome.xp != null) {
      xpGain = outcome.xp;
    } else {
      xpGain = 2; // small consolation XP even on a wrong answer, so play always progresses a little
      if (outcome.type === 'correct') xpGain = 15;
      else if (outcome.type === 'partial') xpGain = Math.round(8 * (outcome.partialRatio != null ? outcome.partialRatio : 0.5));
    }
    xpGain = Math.round(xpGain * tier.xpMult);
    const xpResult = grantXp(xpGain);

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
    DIFFICULTIES, THEMES, SHIELD_PRICE, PASSPORT_TIERS,
    reset, getScore, getMistakes, applyOutcome, applyRoundXp, getCurrentStreak, getBestStreak,
    winBonusForMistakes, applyWinBonus,
    getXp, getLevel, addXp, getSelectedDifficultyId, getSelectedDifficulty, setSelectedDifficulty,
    isDifficultyUnlocked,
    xpForLevel, buildPool, pickTarget, getExpeditionRecent, recordExpeditionEndpoints,
    getCoins, addCoins, spendCoins,
    getShieldCount, buyShield, consumeShield,
    getRepairToolCount, useRepairTool,
    getThemeCatalog, isThemeOwned, getEquippedThemeId, getEquippedTheme, buyTheme, equipTheme,
    getPassportTier, getPassportTierByIso3, recordFlawlessCompletion, getPassportCollectedCount,
    getShowFlags, setShowFlags,
  };
})();
