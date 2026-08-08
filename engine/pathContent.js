(function () {
  const GN = window.GN = window.GN || {};

  // Deterministic clue/node generator for the Learning Path. Seeded from a
  // fixed constant (not per-player/per-date like modes/daily.js) so node #23
  // means the exact same thing to every player forever — path progress
  // (GN.progression.getPathFurthest) only makes sense if that holds.
  // Computed once, lazily, from GN.data — there's no build step on this
  // static site to precompute it, and with ~40 nodes it's cheap enough not
  // to need one.
  const SEED_STRING = 'geoshrink-path-v1';
  const NODE_COUNT = 40;
  const ANCHOR_COUNT = 8;      // nodes 0-7: single-fact "gimme" superlatives
  const SINGLE_COUNT = 17;     // nodes 8-24: one templated constraint
  // nodes 25-39 (the remainder): two intersecting constraints

  function hashSeed(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }
  // mulberry32 — small, fast, deterministic PRNG from a 32-bit seed.
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  function formatPopulation(n) {
    if (n >= 1000000) return (Math.round(n / 100000) / 10) + ' million';
    if (n >= 1000) return Math.round(n / 1000) + ',000';
    return String(n);
  }

  let cachedNodes = null;

  function buildNodes() {
    const data = GN.data;
    const pool = data.metaIndices.slice(); // every candidate has full metadata + a name
    const meta = (idx) => data.metaByIdx(idx);
    const rng = makeRng(hashSeed(SEED_STRING));

    const CONTINENTS = [...new Set(pool.map((i) => meta(i).continent))];
    const SUBREGIONS = [...new Set(pool.map((i) => meta(i).subregion))];
    const ORGS = [...new Set(pool.flatMap((i) => meta(i).orgs))];

    const used = new Set(); // target country indices already spent on an earlier node — keeps the path from repeating the same answer
    const nodes = [];

    function tryAccept(candidate) {
      // candidate: { text, matches: idx[] } — the ONE correctness rule every
      // template must satisfy: exactly one country answers the clue.
      if (!candidate || candidate.matches.length !== 1) return null;
      const targetIdx = candidate.matches[0];
      if (used.has(targetIdx)) return null;
      return { text: candidate.text, targetIdx };
    }

    // --- anchors: deterministic global superlatives, no RNG, skipped if tied ---
    function anchorCandidates() {
      const by = (fn) => pool.slice().sort((a, b) => fn(b) - fn(a));
      const uniqueExtreme = (sorted, label, fn) => {
        if (sorted.length < 2 || fn(sorted[0]) === fn(sorted[1])) return null; // tied for the extreme -> not a fair clue
        return { text: label, matches: [sorted[0]] };
      };
      const byPop = by((i) => meta(i).population);
      const byNeighbors = by((i) => data.neighbors[i].length);
      const byLat = by((i) => data.centroids[i][1]);
      const byArea = by((i) => data.areas[i]);
      return [
        uniqueExtreme(byPop, 'The world’s most populous country', (i) => meta(i).population),
        uniqueExtreme(byPop.slice().reverse(), 'The world’s least populous country', (i) => meta(i).population),
        uniqueExtreme(byArea, 'The largest country by land area', (i) => data.areas[i]),
        uniqueExtreme(byArea.slice().reverse(), 'The smallest country by land area', (i) => data.areas[i]),
        uniqueExtreme(byNeighbors, 'The country that borders the most other countries', (i) => data.neighbors[i].length),
        uniqueExtreme(byLat, 'The world’s northernmost country', (i) => data.centroids[i][1]),
        uniqueExtreme(byLat.slice().reverse(), 'The world’s southernmost country', (i) => data.centroids[i][1]),
      ].filter(Boolean);
    }

    // --- single-constraint templates (nodes 8-24) ---------------------------
    function tplSuperlativeInGroup(groupField, groupValue, statLabel, statFn, dir) {
      const group = pool.filter((i) => meta(i)[groupField] === groupValue);
      if (group.length < 2) return null;
      const sorted = group.slice().sort((a, b) => dir * (statFn(b) - statFn(a)));
      if (statFn(sorted[0]) === statFn(sorted[1])) return null; // tie, not a fair clue
      const groupWord = groupField === 'continent' ? 'continent' : 'region';
      return { text: 'The ' + statLabel + ' in the ' + groupValue + ' ' + groupWord, matches: [sorted[0]] };
    }
    function tplSoleOrgInGroup(groupField, groupValue, org) {
      const matches = pool.filter((i) => meta(i)[groupField] === groupValue && meta(i).orgs.includes(org));
      return { text: 'The only ' + org + ' member in the ' + groupValue + ' ' + (groupField === 'continent' ? 'continent' : 'region'), matches };
    }
    function tplOrgSuperlative(org, statLabel, statFn, dir) {
      const group = pool.filter((i) => meta(i).orgs.includes(org));
      if (group.length < 2) return null;
      const sorted = group.slice().sort((a, b) => dir * (statFn(b) - statFn(a)));
      if (statFn(sorted[0]) === statFn(sorted[1])) return null;
      return { text: 'The ' + statLabel + ' among ' + org + ' member countries', matches: [sorted[0]] };
    }
    function tplCapitalLookup() {
      const idx = pick(rng, pool.filter((i) => !used.has(i)));
      const m = meta(idx);
      return { text: 'The capital of this country is ' + m.capital, matches: pool.filter((i) => meta(i).capital === m.capital) };
    }

    function randomSingleClue() {
      const roll = rng();
      if (roll < 0.3) {
        // One draw picks BOTH the label and the sort direction together —
        // drawing them independently was a real bug: label and direction
        // could disagree (e.g. text says "least populous" but dir picks the
        // most populous), silently producing a wrong-but-"unique" answer.
        const wantMost = rng() < 0.5;
        return tplSuperlativeInGroup('continent', pick(rng, CONTINENTS), wantMost ? 'most populous country' : 'least populous country',
          (i) => meta(i).population, wantMost ? 1 : -1);
      }
      if (roll < 0.55) {
        return tplSoleOrgInGroup(rng() < 0.5 ? 'continent' : 'subregion', pick(rng, rng() < 0.5 ? CONTINENTS : SUBREGIONS), pick(rng, ORGS));
      }
      if (roll < 0.75) {
        const wantLargest = rng() < 0.5;
        return tplOrgSuperlative(pick(rng, ORGS), wantLargest ? 'largest population' : 'smallest population', (i) => meta(i).population, wantLargest ? 1 : -1);
      }
      return tplCapitalLookup();
    }

    // --- combined-constraint templates (nodes 25-39) ------------------------
    function tplOrgAndGeoIntersection() {
      const org = pick(rng, ORGS);
      const geoField = rng() < 0.5 ? 'continent' : 'subregion';
      const geoValue = pick(rng, geoField === 'continent' ? CONTINENTS : SUBREGIONS);
      const matches = pool.filter((i) => meta(i).orgs.includes(org) && meta(i)[geoField] === geoValue);
      return { text: 'The only ' + org + ' member in the ' + geoValue + ' ' + (geoField === 'continent' ? 'continent' : 'region'), matches };
    }
    function tplTwoOrgIntersection() {
      const orgA = pick(rng, ORGS), orgB = pick(rng, ORGS);
      if (orgA === orgB) return null;
      const matches = pool.filter((i) => meta(i).orgs.includes(orgA) && meta(i).orgs.includes(orgB));
      return { text: 'The only country that is a member of both ' + orgA + ' and ' + orgB, matches };
    }
    function tplSubregionSuperlativeAmongOrg() {
      const org = pick(rng, ORGS);
      const group = pool.filter((i) => meta(i).orgs.includes(org));
      if (group.length < 2) return null;
      const subregion = pick(rng, [...new Set(group.map((i) => meta(i).subregion))]);
      const inSub = group.filter((i) => meta(i).subregion === subregion);
      if (inSub.length < 2) return null;
      const sorted = inSub.slice().sort((a, b) => meta(b).population - meta(a).population);
      if (meta(sorted[0]).population === meta(sorted[1]).population) return null;
      return { text: 'The most populous ' + org + ' member in the ' + subregion + ' region', matches: [sorted[0]] };
    }
    function randomCombinedClue() {
      const roll = rng();
      if (roll < 0.45) return tplOrgAndGeoIntersection();
      if (roll < 0.75) return tplTwoOrgIntersection();
      return tplSubregionSuperlativeAmongOrg();
    }

    // --- assemble, retrying each slot until it lands a unique, unused answer
    function fillSlot(generator, maxAttempts) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const accepted = tryAccept(generator());
        if (accepted) return accepted;
      }
      return null;
    }

    anchorCandidates().slice(0, ANCHOR_COUNT).forEach((c) => {
      const accepted = tryAccept(c);
      if (accepted) { nodes.push(accepted); used.add(accepted.targetIdx); }
    });
    // Some anchor criteria tie in practice (e.g. two countries sharing the
    // exact same border count) and get skipped by uniqueExtreme() above, so
    // the real anchor count can land under the nominal ANCHOR_COUNT — the
    // tier-1 boundary tracks whatever actually landed, not the constant, so
    // a node never gets mislabeled tier 1 when it was really templated.
    const actualAnchorCount = nodes.length;

    while (nodes.length < actualAnchorCount + SINGLE_COUNT) {
      const accepted = fillSlot(randomSingleClue, 40) || fillSlot(tplCapitalLookup, 40);
      if (!accepted) break; // exhausted reasonable attempts -- stop rather than loop forever
      nodes.push(accepted); used.add(accepted.targetIdx);
    }

    while (nodes.length < NODE_COUNT) {
      const accepted = fillSlot(randomCombinedClue, 40) || fillSlot(randomSingleClue, 40) || fillSlot(tplCapitalLookup, 40);
      if (!accepted) break;
      nodes.push(accepted); used.add(accepted.targetIdx);
    }

    return nodes.map((n, i) => ({
      index: i,
      clueText: n.text,
      targetIdx: n.targetIdx,
      tier: i < actualAnchorCount ? 1 : (i < actualAnchorCount + SINGLE_COUNT ? 2 : 3),
    }));
  }

  function getNodes() {
    if (!cachedNodes) {
      if (!GN.data) return [];
      cachedNodes = buildNodes();
    }
    return cachedNodes;
  }

  GN.pathContent = { getNodes, formatPopulation };
})();
