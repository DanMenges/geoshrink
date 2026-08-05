(function () {
  const GN = window.GN = window.GN || {};

  // A purely decorative, continuously-rotating orthographic globe — used on
  // the Home screen hero band and the initial loading state. Deliberately
  // separate from engine/map.js: this one is non-interactive, uses a
  // spherical (not flat) projection so it actually reads as a spinning 3D
  // globe, and renders the single merged land silhouette (not per-country
  // borders) since it only needs to look good, not be clickable.
  const svg = d3.select('#hero-globe');
  // Paint order matters here: the sphere is the solid-filled ocean
  // background, so it must be drawn (and thus DOM-appended) first, with the
  // graticule and land layered on top of it — not the other way around.
  const gSphere = svg.append('path').attr('class', 'hero-sphere-outline');
  const gGraticule = svg.append('path').attr('class', 'hero-graticule');
  const gLand = svg.append('path').attr('class', 'hero-land');
  const graticuleData = d3.geoGraticule10();

  let width = 0, height = 0, projection = null, pathGen = null;
  let land = null;
  let lambda = -20, phi = -18;
  let running = false;
  let rafId = null;
  let lastT = null;

  function resize() {
    const node = svg.node();
    if (!node) return;
    const rect = node.getBoundingClientRect();
    width = rect.width || 240;
    height = rect.height || 240;
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const r = Math.max(10, Math.min(width, height) / 2 - 2);
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
    lambda += dt * 0.012; // slow, ambient — one full spin roughly every ~30s
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

  window.addEventListener('resize', () => { if (running) resize(); });

  GN.heroGlobe = { start, stop, setLand, resize };
})();
