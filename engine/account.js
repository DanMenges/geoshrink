(function () {
  const GN = window.GN = window.GN || {};

  // Sole owner of the Firebase app/Auth session — engine/multiplayer.js reads
  // identity through this module instead of managing its own, so there's
  // exactly one signed-in session app-wide (a second firebase.initializeApp()
  // call throws, and two independent auth flows would just fight each other).
  //
  // Every visitor gets a stable anonymous UID from the moment the app loads,
  // whether or not Multiplayer or Account are ever touched — progress is
  // still plain localStorage today (cloud sync is a later step), but an
  // anonymous session already existing is what makes "sign in" later a
  // *linking* operation (same UID, same data) rather than a fresh identity
  // that would leave guest progress stranded.

  let auth, initialized = false, authResolved = false;
  let currentUser = null;
  let firstResolve = null;
  const changeListeners = [];

  function available() {
    return !!(window.firebase && window.GN_FIREBASE_CONFIG);
  }

  function init() {
    if (initialized || !available()) return;
    initialized = true;
    if (!(firebase.apps && firebase.apps.length)) firebase.initializeApp(window.GN_FIREBASE_CONFIG);
    auth = firebase.auth();
    let resolveFirst;
    firstResolve = new Promise((resolve) => { resolveFirst = resolve; });
    auth.onAuthStateChanged((user) => {
      currentUser = user;
      if (!authResolved) { authResolved = true; resolveFirst(user); }
      changeListeners.forEach((cb) => { try { cb(user); } catch (e) { console.error(e); } });
    });
  }

  let anonInFlight = null;
  function ensureAnonymous() {
    init();
    if (!available()) return Promise.reject(new Error('Firebase is not configured on this deployment.'));
    return firstResolve.then(() => {
      if (currentUser) return currentUser;
      if (!anonInFlight) {
        anonInFlight = auth.signInAnonymously()
          .then((cred) => cred.user)
          .finally(() => { anonInFlight = null; });
      }
      return anonInFlight;
    });
  }

  function getUser() { return currentUser; }
  function getUid() { return currentUser ? currentUser.uid : null; }
  function isAnonymous() { return !currentUser || currentUser.isAnonymous; }
  function getDisplayLabel() {
    if (!currentUser || currentUser.isAnonymous) return 'Guest';
    return currentUser.email || currentUser.displayName || 'Signed in';
  }
  function onChange(cb) { changeListeners.push(cb); }

  const ERROR_MESSAGES = {
    'auth/email-already-in-use': 'That email already has an account — try signing in instead.',
    'auth/invalid-email': 'That doesn’t look like a valid email address.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/credential-already-in-use': 'That Google account is already linked to a different GeoShrink account.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/network-request-failed': 'Network error — check your connection and try again.',
    'auth/requires-recent-login': 'Please sign in again to continue.',
    'auth/operation-not-allowed': 'That sign-in method isn’t available right now — try another option, or keep playing as a guest.',
  };
  function friendlyError(err) {
    return (err && ERROR_MESSAGES[err.code]) || (err && err.message) || 'Something went wrong — please try again.';
  }

  // Redirect, not popup: an installed standalone PWA (this app's primary
  // target — see manifest.json's display:"standalone") handles OAuth popups
  // inconsistently across mobile browsers/OSes, while signInWithRedirect
  // (a full navigation to the provider and back) works uniformly everywhere.
  function signInWithGoogle() {
    init();
    const provider = new firebase.auth.GoogleAuthProvider();
    return ensureAnonymous().then((user) => (
      user.isAnonymous ? user.linkWithRedirect(provider) : auth.signInWithRedirect(provider)
    ));
  }

  // Call once at load — resolves the user if this load is the "back" half of
  // a signInWithGoogle() redirect, or null on any normal page load.
  function completeRedirectIfAny() {
    init();
    if (!available()) return Promise.resolve(null);
    return auth.getRedirectResult().then((result) => (result && result.user) || null);
  }

  // Links the anonymous session to a new email/password credential — same
  // UID, so whatever's already associated with this device carries over
  // (today: nothing server-side yet, but this is the seam future cloud sync
  // hangs off). Signing into a DIFFERENT, pre-existing account further down
  // is a genuine identity switch, not a merge — the UI is explicit about that.
  function registerWithEmail(email, password) {
    init();
    const credential = firebase.auth.EmailAuthProvider.credential(email, password);
    return ensureAnonymous().then((user) => {
      if (user.isAnonymous) return user.linkWithCredential(credential);
      return Promise.reject(new Error('Already signed in.'));
    });
  }
  function signInWithEmail(email, password) {
    init();
    return auth.signInWithEmailAndPassword(email, password);
  }
  function sendPasswordReset(email) {
    init();
    return auth.sendPasswordResetEmail(email);
  }
  function signOut() {
    init();
    return auth.signOut().then(() => ensureAnonymous());
  }

  function providerIds(user) {
    return (user.providerData || []).map((p) => p.providerId);
  }

  const PENDING_DELETE_KEY = 'gn_pending_account_delete';

  // Deleting a Firebase account requires a *recent* sign-in — if the session
  // is more than a few minutes old, delete() itself fails with
  // auth/requires-recent-login rather than actually deleting anything.
  // Password accounts can re-prove themselves inline (no navigation);
  // Google-linked accounts have to re-auth via the same redirect dance as
  // signing in, so the delete intent is stashed in sessionStorage and
  // finished automatically once the page comes back (see the bootstrap code
  // near the bottom of this file).
  function deleteAccount(password) {
    init();
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return Promise.reject(new Error('Not signed in.'));
    return user.delete().catch((err) => {
      if (err.code !== 'auth/requires-recent-login') throw err;
      const providers = providerIds(user);
      if (password && providers.includes('password')) {
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
        return user.reauthenticateWithCredential(credential).then(() => user.delete());
      }
      if (providers.includes('google.com')) {
        sessionStorage.setItem(PENDING_DELETE_KEY, '1');
        return user.reauthenticateWithRedirect(new firebase.auth.GoogleAuthProvider());
      }
      throw err;
    });
  }

  // --- account overlay UI --------------------------------------------------

  const overlay = document.getElementById('account-overlay');
  const cardEl = document.getElementById('account-card');
  const chipEl = document.getElementById('home-account-chip');
  const chipLabel = document.getElementById('home-account-label');

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function closeIcon() {
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18 18 6M6 6l12 12"/></svg>';
  }

  function renderGuestView() {
    cardEl.innerHTML =
      '<div class="shop-header"><h2>Account</h2>' +
      '<button class="hud-btn icon-only" id="account-close">' + closeIcon() + '</button></div>' +
      '<div class="shop-section">' +
      '<p class="shop-hint">You’re playing as a guest — your progress is saved on this device. Sign in any time to keep it if you switch devices, and to subscribe. Guest play always keeps working if you’d rather skip this.</p>' +
      '<button class="hud-btn account-provider-btn" id="account-google-btn">Continue with Google</button>' +
      '<button class="hud-btn account-email-toggle-btn" id="account-email-toggle">Use email instead</button>' +
      '<div class="mp-form" id="account-email-form" style="display:none;margin-top:10px;">' +
      '<label>Email<input type="email" id="account-email-input" autocomplete="email"></label>' +
      '<label>Password<input type="password" id="account-password-input" autocomplete="current-password"></label>' +
      '<div class="mp-form-actions">' +
      '<button class="hud-btn" id="account-signin-btn">Sign in</button>' +
      '<button class="hud-btn" id="account-signup-btn">Create account</button>' +
      '</div>' +
      '<button class="hud-btn account-email-toggle-btn" id="account-forgot-btn" style="margin-top:4px;">Forgot password?</button>' +
      '</div>' +
      '</div>';

    document.getElementById('account-close').addEventListener('click', hide);
    document.getElementById('account-google-btn').addEventListener('click', () => {
      signInWithGoogle().catch((err) => GN.hud.showToast(friendlyError(err)));
    });
    document.getElementById('account-email-toggle').addEventListener('click', () => {
      const form = document.getElementById('account-email-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('account-signin-btn').addEventListener('click', () => {
      const email = document.getElementById('account-email-input').value.trim();
      const password = document.getElementById('account-password-input').value;
      if (!email || !password) { GN.hud.showToast('Enter an email and password.'); return; }
      signInWithEmail(email, password).then(() => {
        GN.hud.showToast('Signed in!');
        hide();
      }).catch((err) => GN.hud.showToast(friendlyError(err)));
    });
    document.getElementById('account-signup-btn').addEventListener('click', () => {
      const email = document.getElementById('account-email-input').value.trim();
      const password = document.getElementById('account-password-input').value;
      if (!email || !password) { GN.hud.showToast('Enter an email and password.'); return; }
      registerWithEmail(email, password).then(() => {
        GN.hud.showToast('Account created — your progress is saved!');
        hide();
      }).catch((err) => GN.hud.showToast(friendlyError(err)));
    });
    document.getElementById('account-forgot-btn').addEventListener('click', () => {
      const email = document.getElementById('account-email-input').value.trim();
      if (!email) { GN.hud.showToast('Enter your email above first.'); return; }
      sendPasswordReset(email).then(() => {
        GN.hud.showToast('Password reset email sent.');
      }).catch((err) => GN.hud.showToast(friendlyError(err)));
    });
  }

  function renderSignedInView() {
    cardEl.innerHTML =
      '<div class="shop-header"><h2>Account</h2>' +
      '<button class="hud-btn icon-only" id="account-close">' + closeIcon() + '</button></div>' +
      '<div class="shop-section">' +
      '<p class="shop-hint">Signed in as <b>' + escapeHtml(getDisplayLabel()) + '</b>. Your progress is tied to this account.</p>' +
      '<button class="hud-btn" id="account-signout-btn">Sign out</button>' +
      '</div>' +
      '<div class="shop-section">' +
      '<h3>Danger zone</h3>' +
      '<p class="shop-hint">Permanently deletes your sign-in and this account. This can’t be undone.</p>' +
      '<button class="hud-btn account-danger-btn" id="account-delete-btn">Delete account</button>' +
      '<div id="account-delete-confirm"></div>' +
      '</div>';
    document.getElementById('account-close').addEventListener('click', hide);
    document.getElementById('account-signout-btn').addEventListener('click', () => {
      signOut().then(() => {
        GN.hud.showToast('Signed out.');
        render();
      }).catch((err) => GN.hud.showToast(friendlyError(err)));
    });
    document.getElementById('account-delete-btn').addEventListener('click', renderDeleteConfirm);
  }

  function renderDeleteConfirm() {
    const user = getUser();
    const hasPassword = providerIds(user).includes('password');
    const box = document.getElementById('account-delete-confirm');
    box.style.marginTop = '10px';
    box.innerHTML =
      '<p class="shop-hint" style="color:var(--critical)">This permanently deletes your account and sign-in. This can’t be undone.</p>' +
      (hasPassword
        ? '<div class="mp-form"><label>Confirm your password<input type="password" id="account-delete-password" autocomplete="current-password"></label></div>'
        : '<p class="shop-hint">You may be asked to sign in again with Google to confirm.</p>') +
      '<div class="mp-form-actions">' +
      '<button class="hud-btn" id="account-delete-cancel">Cancel</button>' +
      '<button class="hud-btn account-danger-btn" id="account-delete-confirm-btn">Yes, delete my account</button>' +
      '</div>';
    document.getElementById('account-delete-cancel').addEventListener('click', () => { box.innerHTML = ''; });
    document.getElementById('account-delete-confirm-btn').addEventListener('click', () => {
      const pwField = document.getElementById('account-delete-password');
      const password = pwField ? pwField.value : null;
      deleteAccount(password).then(() => {
        // If a Google reauth redirect was needed, the page has already
        // navigated away by now and this .then() never gets to run — the
        // deletion completes and the toast fires from the bootstrap code
        // below once the page comes back instead.
        GN.hud.showToast('Account deleted.');
        render();
      }).catch((err) => GN.hud.showToast(friendlyError(err)));
    });
  }

  function refreshChip() {
    if (!chipLabel) return;
    chipLabel.textContent = isAnonymous() ? 'Guest' : getDisplayLabel().split('@')[0];
  }
  function render() {
    if (isAnonymous()) renderGuestView(); else renderSignedInView();
    refreshChip();
  }
  function show() { render(); overlay.classList.add('show'); }
  function hide() { overlay.classList.remove('show'); }

  if (available() && chipEl) {
    chipEl.addEventListener('click', show);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });
    onChange(() => {
      refreshChip();
      if (overlay.classList.contains('show')) render();
    });
    ensureAnonymous().catch((err) => console.error('Anonymous sign-in failed:', err));
    completeRedirectIfAny().then((user) => {
      if (user && sessionStorage.getItem(PENDING_DELETE_KEY) === '1') {
        // The redirect that just returned was a re-auth for account deletion,
        // not a normal sign-in — finish the delete now that Firebase
        // considers the session fresh again.
        sessionStorage.removeItem(PENDING_DELETE_KEY);
        return user.delete().then(() => GN.hud.showToast('Account deleted.'));
      }
    }).catch((err) => console.error('Redirect sign-in failed:', err));
  } else if (chipEl) {
    chipEl.style.display = 'none';
  }

  GN.account = {
    available, ensureAnonymous, getUser, getUid, isAnonymous, getDisplayLabel, onChange,
    signInWithGoogle, registerWithEmail, signInWithEmail, sendPasswordReset, signOut, deleteAccount,
  };
})();
