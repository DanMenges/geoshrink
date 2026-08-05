(function () {
  const GN = window.GN = window.GN || {};

  // Applies the player's equipped cosmetic color theme by overriding the
  // --group-a/--group-b custom properties at the document root — every
  // existing CSS rule already reads these via var(...), so no rule needs to
  // know themes exist. Re-applied on load and whenever the theme changes.
  function apply() {
    const theme = GN.progression.getEquippedTheme();
    // --group-a/--group-b are declared on .viz-root (not :root) — an
    // element-level rule always wins over an inherited value regardless of
    // specificity, so overriding on <html> would be silently ignored. Set
    // the inline override on .viz-root itself instead.
    const root = document.querySelector('.viz-root') || document.documentElement;
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const explicit = document.documentElement.getAttribute('data-theme');
    const useDark = explicit === 'dark' || (explicit !== 'light' && dark);
    root.style.setProperty('--group-a', useDark ? theme.groupA.dark : theme.groupA.light);
    root.style.setProperty('--group-b', useDark ? theme.groupB.dark : theme.groupB.light);

    root.classList.remove('map-style-flat', 'map-style-glow', 'map-style-scifi', 'map-style-dino', 'map-style-population');
    root.classList.add('map-style-' + (theme.style || 'flat'));

    // Themed tiers override the backdrop + "not in play" colors so they read
    // as a deliberate palette rather than a themed map floating in the
    // default pale ocean/gray. Removing the property (not just leaving it
    // unset) lets Classic and any theme without an override fall back
    // cleanly to the normal light/dark value.
    const overrides = { '--ocean': theme.ocean, '--graticule': theme.graticule, '--eliminated-fill': theme.eliminatedFill, '--eliminated-stroke': theme.eliminatedStroke };
    for (const prop in overrides) {
      if (overrides[prop]) root.style.setProperty(prop, overrides[prop]); else root.style.removeProperty(prop);
    }
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
  }

  GN.theme = { apply };
})();
