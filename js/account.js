// KinSentry — Personal Dashboard (account.html) client logic
//
// Backed by /api/account/* endpoints, gated by the session cookie set on
// .kinsentry.com. If the cookie is missing or invalid, redirects to login.

(function () {
  const API = 'https://api.kinsentry.com';
  const EXT_ID = 'ecohlgdpgikbddaabjmmhmchcamnbhba';

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const loadingEl  = document.getElementById('loading-state');
  const viewEl     = document.getElementById('account-view');
  const restoreEl  = document.getElementById('restore-banner');

  // ── State ────────────────────────────────────────────────────────────────
  let CURRENT_USER = null;

  // ── Boot ─────────────────────────────────────────────────────────────────
  init().catch(err => {
    console.error('Account init failed:', err);
    showLoadingError();
  });

  async function init() {
    // Show restore banner if the URL says we just got restored
    const params = new URLSearchParams(location.search);
    if (params.get('ks_restored') === '1' || params.get('restored') === '1') {
      restoreEl.classList.remove('hidden');
      // Clean the URL so refresh doesn't keep showing it
      history.replaceState({}, '', location.pathname + (location.hash || ''));
    }

    // Fetch the user
    const res = await fetch(`${API}/api/account/me`, { credentials: 'include' });
    if (res.status === 401) {
      // Not signed in — bounce to login
      location.replace('/signup.html?mode=login&next=' + encodeURIComponent('/account.html'));
      return;
    }
    if (!res.ok) throw new Error('http_' + res.status);

    const data = await res.json();
    CURRENT_USER = data.user;

    // Reveal the page
    loadingEl.style.display = 'none';
    viewEl.style.display    = 'block';

    populateProfile();
    populateSubscription();
    populateSecurity();
    populateDelete();
    wireTabs();
    wireSignOut();

    // Detect extension presence on this device + render the banner.
    // Fire-and-forget so the rest of the page renders immediately.
    renderExtensionBanner();

    // Open the requested tab if hash present
    const initialTab = (location.hash || '').replace('#', '');
    if (initialTab && ['profile','subscription','security','delete'].includes(initialTab)) {
      activateTab(initialTab);
    }
  }

  function showLoadingError() {
    loadingEl.innerHTML =
      '<div class="alert error" style="display:inline-block;text-align:left;max-width:480px;">' +
        'Something went wrong loading your account. Please refresh the page. If the problem persists, ' +
        '<a href="/support.html" style="color:inherit;font-weight:500;text-decoration:underline;">contact support</a>.' +
      '</div>';
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────
  function wireTabs() {
    document.querySelectorAll('.sidebar a[data-tab]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        activateTab(a.dataset.tab);
      });
    });
  }
  function activateTab(name) {
    document.querySelectorAll('.sidebar a[data-tab]').forEach(a =>
      a.classList.toggle('active', a.dataset.tab === name)
    );
    document.querySelectorAll('.panel').forEach(p =>
      p.classList.toggle('active', p.id === 'panel-' + name)
    );
    history.replaceState({}, '', location.pathname + '#' + name);
  }

  // ── PROFILE ──────────────────────────────────────────────────────────────
  function populateProfile() {
    const u = CURRENT_USER;
    document.getElementById('account-greeting').textContent =
      `Welcome${u.name ? ', ' + u.name : ''}.`;

    document.getElementById('info-email').textContent = u.email;
    document.getElementById('info-auth').textContent =
      u.authProvider === 'google' ? 'Google' : 'Email & password';
    document.getElementById('info-created').textContent =
      u.createdAt ? formatDate(u.createdAt) : '—';

    document.getElementById('name-input').value = u.name || '';

    document.getElementById('save-name-btn').addEventListener('click', saveName);
  }

  async function saveName() {
    const name = document.getElementById('name-input').value.trim();
    const btn  = document.getElementById('save-name-btn');
    const alertEl = document.getElementById('profile-alert');

    if (!name) {
      showAlert(alertEl, 'error', 'Name cannot be empty.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';
    hideAlert(alertEl);

    try {
      const res = await fetch(`${API}/api/account/me`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert(alertEl, 'error', friendlyError(data.error));
        return;
      }
      CURRENT_USER.name = data.name || name;
      document.getElementById('account-greeting').textContent =
        `Welcome${CURRENT_USER.name ? ', ' + CURRENT_USER.name : ''}.`;
      toast('Saved', 'success');
    } catch (err) {
      showAlert(alertEl, 'error', 'Network error. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save changes';
    }
  }

  // ── SUBSCRIPTION ─────────────────────────────────────────────────────────
  function populateSubscription() {
    const u = CURRENT_USER;
    const pill = document.getElementById('tier-pill');
    const tierLabels = {
      free:       'Free',
      free_trial: 'Trial · Guardian',
      guardian:   'Guardian',
      family:     'Family'
    };
    pill.className = 'tier-badge ' + (u.tier || 'free');
    pill.textContent = tierLabels[u.tier] || u.tier || 'Free';

    if (u.tier === 'free_trial' && u.trialExpiry) {
      document.getElementById('trial-row').style.display = 'flex';
      document.getElementById('trial-expiry').textContent = formatDate(u.trialExpiry);
    }

    const cta = document.getElementById('subscription-cta');
    if (u.tier === 'free' || u.tier === 'free_trial') {
      cta.innerHTML = `
        <p style="font-size:13px;color:var(--text-2);margin-bottom:12px;">
          Upgrade to Guardian or Family for unlimited blocking, scam-popup protection, and ad-free experience.
        </p>
        <a class="btn primary" href="/#pricing">View plans</a>
      `;
    } else {
      cta.innerHTML = `
        <p style="font-size:13px;color:var(--text-2);">
          You're on the <strong>${tierLabels[u.tier]}</strong> plan. To change or cancel your plan,
          <a href="/support.html" style="color:var(--blue);">contact support</a>.
        </p>
      `;
    }
  }

  // ── SECURITY ─────────────────────────────────────────────────────────────
  function populateSecurity() {
    const u = CURRENT_USER;
    if (!u.hasPassword) {
      document.getElementById('security-google-notice').classList.remove('hidden');
      document.getElementById('security-form-wrap').style.display = 'none';
      return;
    }
    document.getElementById('change-pw-btn').addEventListener('click', changePassword);
  }

  async function changePassword() {
    const cur  = document.getElementById('cur-pw').value;
    const nw1  = document.getElementById('new-pw').value;
    const nw2  = document.getElementById('new-pw2').value;
    const btn  = document.getElementById('change-pw-btn');
    const alertEl = document.getElementById('security-alert');
    hideAlert(alertEl);

    if (!cur || !nw1 || !nw2) {
      showAlert(alertEl, 'error', 'Please fill in all fields.');
      return;
    }
    if (nw1.length < 8) {
      showAlert(alertEl, 'error', 'New password must be at least 8 characters.');
      return;
    }
    if (nw1 !== nw2) {
      showAlert(alertEl, 'error', 'New passwords do not match.');
      return;
    }
    if (cur === nw1) {
      showAlert(alertEl, 'error', 'New password must be different from the current one.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Updating…';

    try {
      const res = await fetch(`${API}/api/account/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: nw1 })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert(alertEl, 'error', friendlyError(data.error));
        return;
      }
      showAlert(alertEl, 'success', 'Password updated successfully.');
      document.getElementById('cur-pw').value = '';
      document.getElementById('new-pw').value = '';
      document.getElementById('new-pw2').value = '';
      toast('Password updated', 'success');
    } catch (err) {
      showAlert(alertEl, 'error', 'Network error. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update password';
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  function populateDelete() {
    const confirmInput = document.getElementById('confirm-email');
    const deleteBtn    = document.getElementById('delete-account-btn');
    confirmInput.placeholder = CURRENT_USER.email;

    // The field ships with `readonly` so the browser won't autofill it with the
    // signed-in user's email (which would defeat the type-to-confirm safeguard).
    // Lift readonly the moment the user interacts, and clear anything the
    // browser may have injected before that.
    const enableTyping = () => {
      if (confirmInput.hasAttribute('readonly')) {
        confirmInput.value = '';
        confirmInput.removeAttribute('readonly');
      }
    };
    confirmInput.addEventListener('focus', enableTyping);
    confirmInput.addEventListener('pointerdown', enableTyping);

    confirmInput.addEventListener('input', () => {
      const match = confirmInput.value.trim().toLowerCase() === CURRENT_USER.email.toLowerCase();
      deleteBtn.disabled = !match;
    });
    deleteBtn.addEventListener('click', deleteAccount);
  }

  async function deleteAccount() {
    const confirmEmail = document.getElementById('confirm-email').value.trim();
    const btn  = document.getElementById('delete-account-btn');
    const alertEl = document.getElementById('delete-alert');
    hideAlert(alertEl);

    if (confirmEmail.toLowerCase() !== CURRENT_USER.email.toLowerCase()) {
      showAlert(alertEl, 'error', 'Email does not match.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Deleting…';

    try {
      const res = await fetch(`${API}/api/account/delete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAlert(alertEl, 'error', friendlyError(data.error));
        btn.disabled = false;
        btn.textContent = 'Delete my account';
        return;
      }
      // Redirect to deleted page
      location.replace('/account-deleted.html');
    } catch (err) {
      showAlert(alertEl, 'error', 'Network error. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Delete my account';
    }
  }

  // ── Sign out + open dashboard ────────────────────────────────────────────
  function wireSignOut() {
    document.getElementById('sign-out-link').addEventListener('click', async e => {
      e.preventDefault();
      try {
        await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });
      } catch (_) {}
      // Clear client-side cached identity so signup.html doesn't show the
      // "already signed in" success card on its next load.
      try {
        localStorage.removeItem('ks_user');
      } catch (_) {}
      location.replace('/signup.html?mode=login');
    });
  }
  function openExtensionDashboard() {
    const url = `chrome-extension://${EXT_ID}/dashboard/dashboard.html`;
    window.open(url, '_blank');
  }

  // ── Extension detection + banner ─────────────────────────────────────────
  // Probe for the extension by loading its packaged icon. Works only on
  // Chromium-based browsers where the extension is installed.
  function detectExtension() {
    return new Promise(resolve => {
      const img = new Image();
      let done = false;
      const finish = (val) => { if (!done) { done = true; resolve(val); } };
      img.onload  = () => finish(true);
      img.onerror = () => finish(false);
      img.src = `chrome-extension://${EXT_ID}/icons/icon-16.png?_=${Date.now()}`;
      setTimeout(() => finish(false), 1500);
    });
  }

  async function renderExtensionBanner() {
    const banner    = document.getElementById('ext-banner');
    const titleEl   = document.getElementById('ext-banner-title');
    const subEl     = document.getElementById('ext-banner-sub');
    const actionsEl = document.getElementById('ext-banner-actions');
    if (!banner) return;

    banner.classList.remove('hidden');

    const tier = CURRENT_USER?.tier;

    // Family-tier admins manage their household from family.html and never
    // install the extension on this device — so skip extension detection
    // entirely and show a link to the Family dashboard instead.
    if (tier === 'family') {
      banner.classList.remove('install');
      banner.classList.add('active');
      titleEl.textContent = 'Manage your family\u2019s protection.';
      subEl.textContent   =
        'Add member devices, generate invite codes, and review activity ' +
        'from your Family dashboard. No extension is needed on this device.';
      actionsEl.innerHTML = '';
      const familyLink = document.createElement('a');
      familyLink.className   = 'btn primary';
      familyLink.href        = '/family.html';
      familyLink.textContent = 'View & control your family settings';
      actionsEl.appendChild(familyLink);
      return;
    }

    const installed   = await detectExtension();
    const monitorTier = (tier === 'guardian');

    if (installed) {
      banner.classList.remove('install');
      banner.classList.add('active');
      titleEl.textContent = 'Your extension is active on this device.';
      subEl.textContent   = monitorTier
        ? 'Open the dashboard to see your protection status and any activity on linked devices.'
        : 'Open the dashboard to see your protection status.';
      actionsEl.innerHTML = '';
      const openBtn = document.createElement('button');
      openBtn.className   = 'btn primary';
      openBtn.textContent = 'Open dashboard';
      openBtn.addEventListener('click', openExtensionDashboard);
      actionsEl.appendChild(openBtn);
    } else {
      banner.classList.remove('active');
      banner.classList.add('install');
      titleEl.textContent = 'Install KinSentry on this device.';
      subEl.textContent   = monitorTier
        ? 'The extension is required to open your dashboard, including monitoring linked family devices from here.'
        : 'The extension protects you from scam pages and remote-support sites, and is required to open your dashboard.';
      actionsEl.innerHTML = '';
      const installLink = document.createElement('a');
      installLink.className   = 'btn primary';
      installLink.target      = '_blank';
      installLink.rel         = 'noopener';
      installLink.href        = 'https://chromewebstore.google.com/detail/' + EXT_ID;
      installLink.textContent = 'Add to Chrome — Free';
      actionsEl.appendChild(installLink);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function formatDate(s) {
    try {
      const d = new Date(s);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return s; }
  }
  function showAlert(el, kind, msg) {
    el.className = 'alert ' + kind;
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function hideAlert(el) {
    el.classList.add('hidden');
  }
  function toast(msg, kind) {
    const stack = document.getElementById('toast-stack');
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || 'info');
    t.textContent = msg;
    stack.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity 0.2s';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 220);
    }, 3000);
  }
  function friendlyError(code) {
    const map = {
      not_authenticated:         'Your session has expired. Please sign in again.',
      name_required:             'Name cannot be empty.',
      name_too_long:             'Name is too long.',
      missing_fields:            'Please fill in all fields.',
      fields_required:           'Please fill in all fields.',
      password_too_short:        'New password must be at least 8 characters.',
      new_password_too_short:    'New password must be at least 8 characters.',
      incorrect_current_password:'Current password is incorrect.',
      current_password_incorrect:'Current password is incorrect.',
      same_as_old:               'New password must be different from the current one.',
      new_password_same_as_old:  'New password must be different from the current one.',
      google_only_account:       'This account uses Google sign-in. Use the password reset flow to set one.',
      google_account_no_password:'This account uses Google sign-in. Use the password reset flow to set one.',
      email_confirmation_mismatch:'Email does not match.',
      db_error:                  'Something went wrong. Please try again.',
    };
    return map[code] || 'Something went wrong. Please try again.';
  }
})();
