(function () {
  const GN = window.GN = window.GN || {};

  // The Learning Path's comic-Earth companion. Mirrors engine/heroGlobe.js's
  // rotating d3.geoOrthographic technique (own SVG target, own start()/stop()
  // — duplicated rather than shared, the same call already made for
  // engine/repairGlobe.js, keeping each small globe module independent) plus
  // a simple swappable-expression face. Lightweight SVG/CSS by design, not a
  // rigged character — see the plan for why.
  const svg = d3.select('#mascot-globe');
  const widgetEl = document.getElementById('mascot-widget');
  const gSphere = svg.append('path').attr('class', 'mascot-sphere-outline');
  const gGraticule = svg.append('path').attr('class', 'mascot-graticule');
  const gLand = svg.append('path').attr('class', 'mascot-land');
  // The face is a FIXED screen-space overlay, not geo-projected — it must
  // NOT rotate away as the globe spins underneath it the way a real
  // drawn-on land feature would; it's drawn last so it stays on top.
  const gFace = svg.append('g').attr('class', 'mascot-face');
  const eyeL = gFace.append('circle').attr('class', 'mascot-eye');
  const eyeR = gFace.append('circle').attr('class', 'mascot-eye');
  const mouth = gFace.append('path').attr('class', 'mascot-mouth');
  const graticuleData = d3.geoGraticule10();

  // All authored at a common radius (40) and rescaled to fit whatever size
  // the widget actually renders at (see positionFace) — so the face stays
  // proportional regardless of where it's placed in the layout.
  const MOUTHS = {
    neutral: 'M -9,3 Q 0,8 9,3',
    happy: 'M -10,2 Q 0,13 10,2',
    cheering: 'M -12,-1 Q 0,17 12,-1 Q 0,9 -12,-1 Z',
    concerned: 'M -9,9 Q 0,2 9,9',
    surprised: 'M -5,5 A 5,6 0 1 0 5,5 A 5,6 0 1 0 -5,5 Z',
  };

  let width = 0, height = 0, projection = null, pathGen = null, radius = 40;
  let land = null;
  let lambda = 15, phi = -10;
  let running = false;
  let rafId = null;
  let lastT = null;
  let blinkTimer = null;
  let reactTimer = null;
  let bounceTimer = null;
  let currentExpression = 'neutral';
  const BOUNCE_MS = 500; // must match the .mascot-bounce keyframe duration in style.css

  function resize() {
    const node = svg.node();
    if (!node) return;
    const rect = node.getBoundingClientRect();
    width = rect.width || 140;
    height = rect.height || 140;
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    radius = Math.max(10, Math.min(width, height) / 2 - 2);
    projection = d3.geoOrthographic().scale(radius).translate([width / 2, height / 2]).rotate([lambda, phi]);
    pathGen = d3.geoPath(projection);
    positionFace();
    render();
  }

  function positionFace() {
    const cx = width / 2, cy = height / 2;
    const s = radius / 40; // face geometry authored at radius 40, rescaled to fit
    gFace.attr('transform', 'translate(' + cx + ',' + (cy - radius * 0.08) + ') scale(' + s + ')');
    eyeL.attr('cx', -12).attr('cy', -8).attr('r', 4.2);
    eyeR.attr('cx', 12).attr('cy', -8).attr('r', 4.2);
    mouth.attr('d', MOUTHS[currentExpression]);
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
    lambda += dt * 0.01; // slow ambient spin, secondary to the face
    if (projection) projection.rotate([lambda, phi]);
    render();
    rafId = requestAnimationFrame(tick);
  }

  function setExpression(kind, skipBounce) {
    currentExpression = MOUTHS[kind] ? kind : 'neutral';
    mouth.attr('d', MOUTHS[currentExpression]);
    if (!skipBounce && widgetEl) {
      clearTimeout(bounceTimer);
      widgetEl.classList.remove('mascot-bounce');
      void widgetEl.offsetWidth; // restart the animation even if it's already mid-bounce
      widgetEl.classList.add('mascot-bounce');
      // The bounce class overrides the idle bob animation while present (a
      // more specific selector wins, it doesn't layer) — remove it once the
      // one-shot bounce finishes so the idle bob can resume.
      bounceTimer = setTimeout(() => widgetEl.classList.remove('mascot-bounce'), BOUNCE_MS);
    }
  }

  // Public reaction hook: swap expression, auto-return to neutral after ms.
  function react(kind, ms) {
    clearTimeout(reactTimer);
    setExpression(kind);
    reactTimer = setTimeout(() => setExpression('neutral', true), ms || 1400);
  }

  function scheduleBlink() {
    blinkTimer = setTimeout(() => {
      eyeL.classed('mascot-blink', true);
      eyeR.classed('mascot-blink', true);
      setTimeout(() => { eyeL.classed('mascot-blink', false); eyeR.classed('mascot-blink', false); }, 140);
      scheduleBlink();
    }, 2200 + Math.random() * 2600);
  }

  function start() {
    if (running || !svg.node()) return;
    running = true;
    lastT = null;
    resize();
    rafId = requestAnimationFrame(tick);
    scheduleBlink();
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    clearTimeout(blinkTimer);
    clearTimeout(reactTimer);
    clearTimeout(bounceTimer);
  }
  function setLand(landFeature) {
    land = landFeature;
    render();
  }

  window.addEventListener('resize', () => { if (running) resize(); });

  GN.mascot = { start, stop, setLand, react };
})();
