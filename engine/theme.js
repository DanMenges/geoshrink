(function () {
  const GN = window.GN = window.GN || {};

  // Maps a purchasable background theme's palette (see
  // GN.progression.getBackgroundThemeCatalog) onto the actual CSS custom
  // properties it overrides.
  const PALETTE_PROP_MAP = {
    surface1: '--surface-1', pagePlane: '--page-plane', textPrimary: '--text-primary',
    textSecondary: '--text-secondary', textMuted: '--text-muted', border: '--border',
    ocean: '--ocean', graticule: '--graticule', shadow: '--shadow',
  };

  function getBackgroundEntry() {
    const pageThemeId = GN.progression && GN.progression.getPageTheme ? GN.progression.getPageTheme() : 'auto';
    const catalog = GN.progression && GN.progression.getBackgroundThemeCatalog ? GN.progression.getBackgroundThemeCatalog() : [];
    return { pageThemeId, entry: catalog.find((t) => t.id === pageThemeId) };
  }

  // Applies the player's equipped cosmetic color theme by overriding the
  // --group-a/--group-b custom properties at the document root — every
  // existing CSS rule already reads these via var(...), so no rule needs to
  // know themes exist. Re-applied on load and whenever the theme changes.
  function apply() {
    const theme = GN.progression.getEquippedTheme();
    const root = document.querySelector('.viz-root') || document.documentElement;
    const { pageThemeId, entry: bgEntry } = getBackgroundEntry();

    // data-theme attribute drives style.css's :root[data-theme=...] rules
    // (and is overridden by prefers-color-scheme when absent) — 'light'/
    // 'dark' are the only two literal values those rules look for. The
    // purchasable palettes (blue/green/red) aren't light/dark toggles, they
    // fully replace the page chrome below instead, so the attribute is left
    // cleared for them (falls back to whatever the OS prefers as the base,
    // which then gets overridden anyway).
    if (pageThemeId === 'light' || pageThemeId === 'dark') document.documentElement.setAttribute('data-theme', pageThemeId);
    else document.documentElement.removeAttribute('data-theme');

    // --group-a/--group-b are declared on .viz-root (not :root) — an
    // element-level rule always wins over an inherited value regardless of
    // specificity, so overriding on <html> would be silently ignored. Set
    // the inline override on .viz-root itself instead. A purchased
    // background palette is always dark-toned, so it forces the dark
    // variant here too regardless of OS preference — otherwise a light-OS
    // player equipping e.g. Futuristic Red would get light-mode gameplay
    // colors on a dark background, which reads badly.
    const osDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const explicit = document.documentElement.getAttribute('data-theme');
    const useDark = !!bgEntry || explicit === 'dark' || (explicit !== 'light' && osDark);
    root.style.setProperty('--group-a', useDark ? theme.groupA.dark : theme.groupA.light);
    root.style.setProperty('--group-b', useDark ? theme.groupB.dark : theme.groupB.light);

    root.classList.remove('map-style-flat', 'map-style-glow', 'map-style-scifi', 'map-style-dino', 'map-style-population');
    root.classList.add('map-style-' + (theme.style || 'flat'));

    // Some map color themes override the ocean/graticule backdrop so they
    // read as a deliberate palette rather than a themed map floating in the
    // default pale ocean. Removing the property (not just leaving it unset)
    // lets Classic and any theme without an override fall back cleanly to
    // the normal light/dark value. "Not in play" (eliminated) countries are
    // deliberately NEVER themed — they stay the plain neutral gray shared
    // with the legend swatch, regardless of equipped theme.
    const mapOverrides = { '--ocean': theme.ocean, '--graticule': theme.graticule };
    for (const prop in mapOverrides) {
      if (mapOverrides[prop]) root.style.setProperty(prop, mapOverrides[prop]); else root.style.removeProperty(prop);
    }

    // Purchased background palette applied LAST, so it wins over both the
    // light/dark base above AND a map color theme's own ocean/graticule
    // choice (e.g. Dinosaur's sandy ocean) — the equipped background is the
    // more deliberate, paid-for page-wide statement once it's on.
    for (const key in PALETTE_PROP_MAP) {
      const cssProp = PALETTE_PROP_MAP[key];
      if (bgEntry && bgEntry.palette && bgEntry.palette[key]) root.style.setProperty(cssProp, bgEntry.palette[key]);
      else root.style.removeProperty(cssProp);
    }
    if (bgEntry && bgEntry.palette) root.style.setProperty('color-scheme', 'dark');
    else root.style.removeProperty('color-scheme');
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
  }

  GN.theme = { apply };
})();
