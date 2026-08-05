(function () {
  const GN = window.GN = window.GN || {};

  // Recursive area-balanced geometric partitioning: splits `subset` into two
  // roughly-equal-area, contiguous-ish groups by repeatedly growing the
  // smaller group with its nearest unassigned frontier neighbor (falling back
  // to nearest-by-centroid when the frontier is empty, e.g. an island).
  // Pure function of (subset, data) — no randomness — so any two callers
  // with the same inputs get byte-identical output. That determinism is load
  // -bearing: modes/daily.js relies on it for "same puzzle for everyone," and
  // multiplayer relies on it so every client can independently recompute the
  // same step sequence from just (target, pool) without ever syncing the
  // geometry itself over the network.
  function partition(subset, data) {
    const { areas, centroids, neighbors } = data;
    if (subset.length <= 1) return null;
    let best = -1, sa = subset[0], sb = subset[1];
    for (let i = 0; i < subset.length; i++) {
      for (let j = i + 1; j < subset.length; j++) {
        const dist = d3.geoDistance(centroids[subset[i]], centroids[subset[j]]);
        if (dist > best) { best = dist; sa = subset[i]; sb = subset[j]; }
      }
    }
    const subsetSet = new Set(subset);
    const groupOf = new Map();
    groupOf.set(sa, 'A');
    groupOf.set(sb, 'B');
    let areaA = areas[sa], areaB = areas[sb];
    const unassigned = new Set(subset.filter((i) => i !== sa && i !== sb));

    function frontierCandidates(group) {
      const cands = new Set();
      for (const [idx, g] of groupOf) {
        if (g !== group) continue;
        for (const n of neighbors[idx]) {
          if (subsetSet.has(n) && !groupOf.has(n)) cands.add(n);
        }
      }
      return [...cands];
    }
    function centroidOf(group) {
      let lon = 0, lat = 0, n = 0;
      for (const [idx, g] of groupOf) {
        if (g === group) { lon += centroids[idx][0]; lat += centroids[idx][1]; n++; }
      }
      return [lon / n, lat / n];
    }

    while (unassigned.size > 0) {
      const growGroup = areaA <= areaB ? 'A' : 'B';
      let cands = frontierCandidates(growGroup);
      let pick;
      if (cands.length > 0) {
        cands.sort((a, b) => areas[a] - areas[b]);
        pick = cands[0];
      } else {
        const gc = centroidOf(growGroup);
        let bestD = Infinity;
        for (const idx of unassigned) {
          const dd = d3.geoDistance(gc, centroids[idx]);
          if (dd < bestD) { bestD = dd; pick = idx; }
        }
      }
      groupOf.set(pick, growGroup);
      if (growGroup === 'A') areaA += areas[pick]; else areaB += areas[pick];
      unassigned.delete(pick);
    }
    const groupA = [], groupB = [];
    for (const [idx, g] of groupOf) (g === 'A' ? groupA : groupB).push(idx);
    return { groupA, groupB };
  }

  // Repeatedly partitions down to the target, recording each step's
  // subset/groupA/groupB. Deterministic given (target, pool, data).
  function buildPath(target, pool, data) {
    let subset = pool.slice();
    const steps = [];
    while (subset.length > 1) {
      const { groupA, groupB } = partition(subset, data);
      const side = groupA.includes(target) ? 'A' : 'B';
      steps.push({ subset, groupA, groupB });
      subset = side === 'A' ? groupA : groupB;
    }
    return steps;
  }

  GN.geoPartition = { partition, buildPath };
})();
