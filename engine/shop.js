(function () {
  const GN = window.GN = window.GN || {};

  const overlay = document.getElementById('shop-overlay');
  const balanceEl = document.getElementById('shop-balance-amount');
  const themesEl = document.getElementById('shop-themes');
  const bgThemesEl = document.getElementById('shop-bg-themes');
  const shieldEl = document.getElementById('shop-shield');
  const repairToolsEl = document.getElementById('shop-repair-tools');
  const xpPotionsEl = document.getElementById('shop-xp-potions');

  function refreshWalletDisplay() {
    const coins = GN.progression.getCoins();
    const a = document.getElementById('wallet-amount');
    const b = document.getElementById('home-wallet-amount');
    if (a) a.textContent = coins;
    if (b) b.textContent = coins;
  }

  function renderThemes() {
    const equipped = GN.progression.getEquippedThemeId();
    const coins = GN.progression.getCoins();
    const html = GN.progression.getThemeCatalog().map((t) => {
      const owned = GN.progression.isThemeOwned(t.id);
      const isEquipped = t.id === equipped;
      let action;
      if (isEquipped) action = '<span class="shop-equipped">Equipped</span>';
      else if (owned) action = '<button class="hud-btn shop-btn" data-equip="' + t.id + '">Equip</button>';
      else action = '<button class="hud-btn shop-btn" data-buy="' + t.id + '"' + (coins < t.price ? ' disabled' : '') + '>Buy — ' + t.price + '</button>';
      const swatchCls = 'theme-swatch' + (t.style && t.style !== 'flat' ? ' theme-swatch-' + t.style : '');
      return '<div class="theme-card' + (isEquipped ? ' equipped' : '') + '">' +
        '<span class="' + swatchCls + '">' +
        '<span style="background:' + t.groupA.light + ';color:' + t.groupA.light + '"></span>' +
        '<span style="background:' + t.groupB.light + ';color:' + t.groupB.light + '"></span>' +
        '</span>' +
        '<span class="theme-label">' + t.label + '</span>' +
        action +
        '</div>';
    }).join('');
    themesEl.innerHTML = html;
    themesEl.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-buy');
        if (GN.progression.buyTheme(id)) {
          GN.hud.showToast('Theme unlocked!');
          render();
        } else {
          GN.hud.showToast('Not enough coins.');
        }
      });
    });
    themesEl.querySelectorAll('[data-equip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        GN.progression.equipTheme(btn.getAttribute('data-equip'));
        GN.hud.showToast('Theme equipped!');
        renderThemes();
      });
    });
  }

  function renderBackgroundThemes() {
    const equipped = GN.progression.getPageTheme();
    const coins = GN.progression.getCoins();
    // Only the purchasable ones show up here — Auto/Light/Dark are free and
    // live on the Home footer picker instead, same split as this shop
    // having nothing for e.g. "Classic" map colors (already owned by default).
    const html = GN.progression.getBackgroundThemeCatalog().filter((t) => t.price > 0).map((t) => {
      const owned = GN.progression.isBackgroundThemeOwned(t.id);
      const isEquipped = t.id === equipped;
      let action;
      if (isEquipped) action = '<span class="shop-equipped">Equipped</span>';
      else if (owned) action = '<button class="hud-btn shop-btn" data-equip-bg="' + t.id + '">Equip</button>';
      else action = '<button class="hud-btn shop-btn" data-buy-bg="' + t.id + '"' + (coins < t.price ? ' disabled' : '') + '>Buy — ' + t.price + '</button>';
      return '<div class="theme-card' + (isEquipped ? ' equipped' : '') + '">' +
        '<span class="bg-theme-swatch" style="background:' + t.palette.pagePlane + '">' +
        '<span style="background:' + t.palette.surface1 + '"></span>' +
        '<span style="background:' + t.palette.ocean + '"></span>' +
        '</span>' +
        '<span class="theme-label">' + t.label + '</span>' +
        action +
        '</div>';
    }).join('');
    bgThemesEl.innerHTML = html;
    bgThemesEl.querySelectorAll('[data-buy-bg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-buy-bg');
        if (GN.progression.buyBackgroundTheme(id)) {
          GN.hud.showToast('Background theme unlocked!');
          render();
        } else {
          GN.hud.showToast('Not enough coins.');
        }
      });
    });
    bgThemesEl.querySelectorAll('[data-equip-bg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        GN.progression.setPageTheme(btn.getAttribute('data-equip-bg'));
        GN.theme.apply();
        GN.hud.showToast('Background equipped!');
        renderBackgroundThemes();
        if (GN.home) GN.home.renderBgPicker(); // keep the Home footer's picker in sync too
      });
    });
  }

  function renderShield() {
    const count = GN.progression.getShieldCount();
    const price = GN.progression.SHIELD_PRICE;
    const canAfford = GN.progression.getCoins() >= price;
    shieldEl.innerHTML =
      '<span class="shield-count">You have: <b>' + count + '</b></span>' +
      '<button class="hud-btn shop-btn" id="shop-buy-shield"' + (canAfford ? '' : ' disabled') + '>Buy — ' + price + '</button>';
    document.getElementById('shop-buy-shield').addEventListener('click', () => {
      if (GN.progression.buyShield()) {
        GN.hud.showToast('Streak Shield purchased!');
        render();
      } else {
        GN.hud.showToast('Not enough coins.');
      }
    });
  }

  function renderRepairTools() {
    const count = GN.progression.getRepairToolCount();
    const price = GN.progression.REPAIR_TOOL_PRICE;
    const canAfford = GN.progression.getCoins() >= price;
    repairToolsEl.innerHTML =
      '<span class="shield-count">You have: <b>' + count + '</b></span>' +
      '<button class="hud-btn shop-btn" id="shop-buy-repair"' + (canAfford ? '' : ' disabled') + '>Buy — ' + price + '</button>';
    document.getElementById('shop-buy-repair').addEventListener('click', () => {
      if (GN.progression.buyRepairTool()) {
        GN.hud.showToast('Repair Tool purchased!');
        render();
      } else {
        GN.hud.showToast('Not enough coins.');
      }
    });
  }

  function formatBoostDuration(ms) {
    const totalMin = Math.max(1, Math.ceil(ms / 60000));
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return h > 0 ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm';
  }

  function renderXpPotions() {
    const coins = GN.progression.getCoins();
    const active = GN.progression.isXpBoostActive();
    const statusHtml = active
      ? '<p class="shop-hint shop-boost-active">⚡ 2x XP active — ' + formatBoostDuration(GN.progression.getXpBoostRemainingMs()) + ' left</p>'
      : '<p class="shop-hint">No active boost.</p>';
    const buttons = GN.progression.XP_POTIONS.map((p) =>
      '<button class="hud-btn shop-btn" data-potion="' + p.id + '"' + (coins < p.price ? ' disabled' : '') + '>' + p.label + ' — ' + p.price + '</button>'
    ).join('');
    xpPotionsEl.innerHTML = statusHtml + '<div class="shop-potion-row">' + buttons + '</div>';
    xpPotionsEl.querySelectorAll('[data-potion]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (GN.progression.buyXpPotion(btn.getAttribute('data-potion'))) {
          GN.hud.showToast('XP Potion activated — 2x XP!');
          render();
        } else {
          GN.hud.showToast('Not enough coins.');
        }
      });
    });
  }

  function render() {
    balanceEl.textContent = GN.progression.getCoins();
    renderThemes();
    renderBackgroundThemes();
    renderShield();
    renderRepairTools();
    renderXpPotions();
    refreshWalletDisplay();
    if (GN.home) GN.home.renderLevelBadge();
    if (GN.home) GN.home.renderBgPicker();
  }

  function show() {
    render();
    overlay.classList.add('show');
  }
  function hide() {
    overlay.classList.remove('show');
  }

  document.getElementById('wallet-chip').addEventListener('click', show);
  document.getElementById('home-wallet-chip').addEventListener('click', show);
  document.getElementById('shop-close').addEventListener('click', hide);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });

  GN.shop = { show, hide, refreshWalletDisplay };
  refreshWalletDisplay();
})();
