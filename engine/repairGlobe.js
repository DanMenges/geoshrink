(function () {
  const GN = window.GN = window.GN || {};

  // A small, peripheral "damage meter" for Geo Shrink: a rotating globe (same
  // d3.geoOrthographic technique as engine/heroGlobe.js's Home-screen hero
  // globe, deliberately re-implemented here rather than shared — heroGlobe.js
  // is tightly coupled to its own DOM id and the Home screen's lifecycle, and
  // the shared rendering logic is small enough that duplicating it keeps both
  // modules simple and independent) that cracks a little more with every
  // mistake, repaired crack-by-crack by spending Repair Tools.
  const svg = d3.select('#grw-globe');
  const gSphere = svg.append('path').attr('class', 'grw-sphere');
  const gGraticule = svg.append('path').attr('class', 'grw-graticule');
  const gLand = svg.append('path').attr('class', 'grw-land');
  const gCracks = svg.append('g').attr('class', 'grw-cracks');
  const graticuleData = d3.geoGraticule10();

  // Hand-authored jagged crack lines, all emanating from a shared "impact
  // point" near center out toward the rim in five different directions —
  // each successive mistake reveals one more, like a windshield spreading a
  // crack pattern outward. Order matters (this IS the reveal order).
  const CRACK_PATHS = [
    'M36,36 L42,28 L39,22 L46,14 L43,8',
    'M36,36 L46,34 L52,38 L60,32 L66,36',
    'M36,36 L44,44 L40,50 L48,56 L44,64',
    'M36,36 L28,42 L32,50 L24,54 L20,62',
    'M36,36 L26,32 L20,36 L12,30 L6,34',
  ];
  const SHATTER_THRESHOLD = CRACK_PATHS.length; // beyond this, add a general "heavily damaged" tint instead of more lines

  let width = 0, height = 0, projection = null, pathGen = null;
  let land = null;
  let lambda = 30, phi = -12;
  let running = false;
  let rafId = null;
  let lastT = null;
  let crackCount = 0;

  function resize() {
    const node = svg.node();
    if (!node) return;
    const rect = node.getBoundingClientRect();
    width = rect.width || 72;
    height = rect.height || 72;
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const r = Math.max(6, Math.min(width, height) / 2 - 2);
    projection = d3.geoOrthographic().scale(r).translate([width / 2, height / 2]).rotate([lambda, phi]);
    pathGen = d3.geoPath(projection);
    render();
  }

  function render() {
    if (!pathGen) return;
    gSphere.attr('d', pathGen({ type: 'Sphere' }));
    gGraticule.attr('d', pathGen(graticuleData));
    if (land) gLand.attr('d', pathGen(land));
  }

  function tick(t) {
    if (!running) return;
    if (lastT == null) lastT = t;
    const dt = t - lastT;
    lastT = t;
    lambda += dt * 0.02; // a bit livelier than the Home hero globe — it's a tiny widget, needs to read as "alive" at a glance
    if (projection) projection.rotate([lambda, phi]);
    render();
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (running || !svg.node()) return;
    running = true;
    lastT = null;
    resize();
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }
  function setLand(landFeature) {
    land = landFeature;
    render();
  }

  // --- crack state ----------------------------------------------------------

  function triggerImpactShake() {
    const widget = document.getElementById('globe-repair-widget');
    if (!widget) return;
    widget.classList.remove('grw-impact');
    void widget.offsetWidth; // restart the animation even if it's already mid-shake
    widget.classList.add('grw-impact');
  }

  function addCrackEl(i) {
    const d = CRACK_PATHS[i];
    if (!d) return; // beyond the hand-authored set — SHATTER_THRESHOLD handles that visually instead
    const el = gCracks.append('path').attr('class', 'grw-crack').attr('d', d).node();
    const len = el.getTotalLength();
    el.style.strokeDasharray = len;
    el.style.strokeDashoffset = len;
    // Snap-in: force layout, then transition dashoffset to 0 — the crack
    // visibly "shoots" outward from the impact point rather than just appearing.
    void el.getBoundingClientRect();
    el.style.transition = 'stroke-dashoffset 260ms cubic-bezier(.2,.9,.3,1.4)';
    requestAnimationFrame(() => { el.style.strokeDashoffset = '0'; });
  }

  function removeCrackEl(i) {
    const nodes = gCracks.selectAll('path.grw-crack').nodes();
    const el = nodes[i];
    if (!el) return;
    // Mend: shrink back down the way it grew, then drop the element.
    const len = el.getTotalLength();
    el.style.transition = 'stroke-dashoffset 300ms ease-in, opacity 300ms ease-in';
    el.style.strokeDashoffset = len;
    el.style.opacity = '0';
    setTimeout(() => { el.remove(); }, 320);
  }

  function refreshBadgeAndShatter() {
    const badge = document.getElementById('grw-cracks-badge');
    if (badge) {
      badge.textContent = String(crackCount);
      badge.classList.toggle('show', crackCount > 0);
    }
    const wrap = document.getElementById('globe-repair-widget');
    if (wrap) wrap.classList.toggle('grw-shattered', crackCount > SHATTER_THRESHOLD);
  }

  // Idempotent — always pass the current TOTAL mistake count (not a delta).
  // Adds/removes crack elements to match, so it's safe to call redundantly.
  function setCracks(n) {
    const next = Math.max(0, n);
    while (crackCount < next) { addCrackEl(crackCount); crackCount++; if (crackCount <= SHATTER_THRESHOLD) triggerImpactShake(); }
    while (crackCount > next) { crackCount--; removeCrackEl(crackCount); }
    refreshBadgeAndShatter();
  }

  // Repairs exactly one crack (the most recently added), animated. Returns
  // the new crack count.
  function repairOne() {
    if (crackCount <= 0) return 0;
    crackCount--;
    removeCrackEl(crackCount);
    refreshBadgeAndShatter();
    return crackCount;
  }

  function reset() {
    gCracks.selectAll('path.grw-crack').remove();
    crackCount = 0;
    refreshBadgeAndShatter();
  }

  window.addEventListener('resize', () => { if (running) resize(); });

  GN.repairGlobe = { start, stop, setLand, setCracks, repairOne, reset };
})();
