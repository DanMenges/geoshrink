(function () {
  const GN = window.GN = window.GN || {};

  const overlay = document.getElementById('shop-overlay');
  const balanceEl = document.getElementById('shop-balance-amount');
  const themesEl = document.getElementById('shop-themes');
  const shieldEl = document.getElementById('shop-shield');

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

  function render() {
    balanceEl.textContent = GN.progression.getCoins();
    renderThemes();
    renderShield();
    refreshWalletDisplay();
    if (GN.home) GN.home.renderLevelBadge();
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
