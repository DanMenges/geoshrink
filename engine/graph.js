(function () {
  const GN = window.GN = window.GN || {};

  function bfsShortestPath(neighbors, start, end) {
    if (start === end) return [start];
    const visited = new Set([start]);
    const prev = new Map();
    const queue = [start];
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      for (const n of neighbors[cur]) {
        if (visited.has(n)) continue;
        visited.add(n);
        prev.set(n, cur);
        if (n === end) {
          const path = [end];
          let c = end;
          while (c !== start) { c = prev.get(c); path.push(c); }
          return path.reverse();
        }
        queue.push(n);
      }
    }
    return null; // unreachable via land borders alone (e.g. an island with no shared arcs)
  }

  function frontierOf(neighbors, revealedSet, allowedSet) {
    const frontier = new Set();
    revealedSet.forEach((idx) => {
      neighbors[idx].forEach((n) => {
        if (!revealedSet.has(n) && (!allowedSet || allowedSet.has(n))) frontier.add(n);
      });
    });
    return [...frontier];
  }

  GN.graph = { bfsShortestPath, frontierOf };
})();
