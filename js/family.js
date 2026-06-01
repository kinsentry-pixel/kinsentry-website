// KinSentry — Family admin dashboard (family.html) client logic
//
// Gated by the session cookie set on .kinsentry.com. Only Family-tier admins
// belong here; anyone else is bounced to /account.html. Member devices have no
// user accounts and never reach this page — they activate via invite code in
// the extension.
//
// Backend: /api/account/me (identity) + /api/household/* (this commit's data).

(function () {
  const API = 'https://api.kinsentry.com';

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const loadingEl = document.getElementById('loading-state');
  const viewEl    = document.getElementById('family-view');

  // ── State ────────────────────────────────────────────────────────────────
  let CURRENT_USER = null;
  let HOUSEHOLD    = null;   // { id, adminEmail, memberSeatLimit, memberCount }
  let MEMBERS      = [];     // [{ id, deviceId, deviceName, lastSeen, isOnline, blocksToday, alertsToday }]
  let INVITES      = [];     // [{ id, code, label, createdAt, expiresAt }]

  // ── Boot ─────────────────────────────────────────────────────────────────
  init().catch(err => {
    console.error('Family init failed:', err);
    showLoadingError();
  });

  async function init() {
    // 1. Identity check
    const meRes = await fetch(`${API}/api/account/me`, { credentials: 'include' });
    if (meRes.status === 401) {
      location.replace('/signup.html?mode=login&next=' + encodeURIComponent('/family.html'));
      return;
    }
    if (!meRes.ok) throw new Error('http_' + meRes.status);

    const meData = await meRes.json();
    CURRENT_USER = meData.user;

    // 2. Gate: only Family-tier admins belong here
    if (CURRENT_USER.tier !== 'family') {
      location.replace('/account.html');
      return;
    }

    // 3. Ensure the household exists (idempotent — creates on first visit)
    const ensureRes = await fetch(`${API}/api/household/ensure`, { credentials: 'include' });
    if (!ensureRes.ok) throw new Error('ensure_failed_' + ensureRes.status);

    // 4. Reveal the page, then load household data
    loadingEl.style.display = 'none';
    viewEl.style.display    = 'block';

    wireStaticControls();
    await loadHousehold();
  }

  function showLoadingError() {
    loadingEl.innerHTML =
      '<div class="alert error" style="display:inline-block;text-align:left;max-width:480px;">' +
        'Something went wrong loading your family dashboard. Please refresh the page. ' +
        'If the problem persists, ' +
        '<a href="/support.html" style="color:inherit;font-weight:500;text-decoration:underline;">contact support</a>.' +
      '</div>';
  }

  // ── Static controls (wired once) ─────────────────────────────────────────
  function wireStaticControls() {
    document.getElementById('refresh-link').addEventListener('click', e => {
      e.preventDefault();
      loadHousehold();
    });
    document.getElementById('generate-btn').addEventListener('click', generateCode);
    document.getElementById('code-copy-btn').addEventListener('click', copyGeneratedCode);

    // Family Alerts controls
    document.getElementById('save-alerts-btn').addEventListener('click', saveAlerts);
    ['toggle-sms', 'toggle-digest'].forEach(id => {
      document.getElementById(id).addEventListener('click', () => {
        const sw = document.getElementById(id);
        const on = !sw.classList.contains('on');
        sw.classList.toggle('on', on);
        sw.setAttribute('aria-checked', String(on));
        if (id === 'toggle-sms') refreshSmsToggleState();
      });
    });
    // Typing a phone number enables/disables the SMS toggle
    document.getElementById('alert-phone').addEventListener('input', refreshSmsToggleState);
  }

  // ── Load + render household ──────────────────────────────────────────────
  async function loadHousehold() {
    setSectionLoading(true);
    hideAlert(document.getElementById('household-alert'));

    try {
      const res = await fetch(`${API}/api/household/me`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showAlert(document.getElementById('household-alert'), 'error',
          friendlyError(data.error));
        return;
      }

      HOUSEHOLD = data.household;
      MEMBERS   = data.members || [];
      INVITES   = data.outstandingInvites || [];

      renderSummary();
      renderDevices();
      renderAlerts();
      renderInvites();
      renderGenerateState();
    } catch (err) {
      showAlert(document.getElementById('household-alert'), 'error',
        'Network error. Please try again.');
    } finally {
      setSectionLoading(false);
    }
  }

  function setSectionLoading(on) {
    document.getElementById('devices-loading').style.display = on ? 'block' : 'none';
    document.getElementById('codes-loading').style.display   = on ? 'block' : 'none';
    if (on) {
      document.getElementById('device-list').style.display = 'none';
    }
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  function renderSummary() {
    const limit  = HOUSEHOLD ? HOUSEHOLD.memberSeatLimit : 3;
    const used   = MEMBERS.length;
    const codes  = INVITES.length;

    document.getElementById('seats-used').textContent =
      `${used} of ${limit} device${limit === 1 ? '' : 's'}`;
    document.getElementById('outstanding-count').textContent =
      codes === 0 ? 'None' : `${codes} code${codes === 1 ? '' : 's'}`;
  }

  // ── FAMILY ALERTS ────────────────────────────────────────────────────────
  function renderAlerts() {
    const a = (HOUSEHOLD && HOUSEHOLD.alerts) || {};

    document.getElementById('alert-email').value = a.alertEmail || '';
    document.getElementById('alert-phone').value = a.alertPhone || '';

    const countrySel = document.getElementById('alert-phone-country');
    if (a.alertPhoneCountry) {
      const match = [...countrySel.options].some(o => o.value === a.alertPhoneCountry);
      countrySel.value = match ? a.alertPhoneCountry : '+1';
    }

    setSwitch('toggle-sms',    a.smsEnabled === true);
    setSwitch('toggle-digest', a.digestEnabled !== false); // default on

    refreshSmsToggleState();
  }

  function setSwitch(id, on) {
    const sw = document.getElementById(id);
    sw.classList.toggle('on', !!on);
    sw.setAttribute('aria-checked', String(!!on));
  }

  // The SMS toggle can only be ON when a phone number is present.
  function refreshSmsToggleState() {
    const hasPhone = document.getElementById('alert-phone').value.trim().length > 0;
    const sms = document.getElementById('toggle-sms');
    sms.disabled = !hasPhone;
    if (!hasPhone && sms.classList.contains('on')) {
      sms.classList.remove('on');
      sms.setAttribute('aria-checked', 'false');
    }
  }

  async function saveAlerts() {
    const btn     = document.getElementById('save-alerts-btn');
    const alertEl = document.getElementById('alerts-alert');
    hideAlert(alertEl);

    const payload = {
      alertEmail:        document.getElementById('alert-email').value.trim(),
      alertPhone:        document.getElementById('alert-phone').value.trim(),
      alertPhoneCountry: document.getElementById('alert-phone-country').value,
      smsEnabled:        document.getElementById('toggle-sms').classList.contains('on'),
      digestEnabled:     document.getElementById('toggle-digest').classList.contains('on'),
    };

    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const res = await fetch(`${API}/api/household/settings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showAlert(alertEl, 'error', friendlyError(data.error, data.message));
        return;
      }

      // Keep local state in sync with the server's normalized response
      if (HOUSEHOLD) HOUSEHOLD.alerts = data.alerts;
      toast('Alert settings saved', 'success');
    } catch (err) {
      showAlert(alertEl, 'error', 'Network error. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save alert settings';
    }
  }

  // ── MEMBER DEVICES ───────────────────────────────────────────────────────
  function renderDevices() {
    const listEl = document.getElementById('device-list');
    listEl.style.display = 'block';
    listEl.innerHTML = '';

    if (MEMBERS.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent =
        'No member devices yet. Generate an invite code below, then enter it in the ' +
        'KinSentry extension on the new device.';
      listEl.appendChild(empty);
      return;
    }

    MEMBERS.forEach(d => listEl.appendChild(buildDeviceCard(d)));
  }

  function buildDeviceCard(d) {
    const card = document.createElement('div');
    card.className = 'device-card';

    // Status dot
    const dot = document.createElement('span');
    dot.className = 'device-status-dot' + (d.isOnline ? ' online' : '');
    card.appendChild(dot);

    // Main info
    const main = document.createElement('div');
    main.className = 'device-main';

    const nameEl = document.createElement('div');
    nameEl.className = 'device-name';
    nameEl.textContent = d.deviceName || 'Unnamed device';
    main.appendChild(nameEl);

    const metaEl = document.createElement('div');
    metaEl.className = 'device-meta';
    metaEl.textContent = (d.isOnline ? 'Online' : 'Offline')
      + ' · last seen ' + formatRelative(d.lastSeen);
    main.appendChild(metaEl);

    card.appendChild(main);

    // Stats — collapsed card shows the all-time total only.
    const stats = document.createElement('div');
    stats.className = 'device-stats';
    stats.innerHTML =
      `<div><strong>${d.totalThreats || 0}</strong>Total threats caught · all time</div>`;
    card.appendChild(stats);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'device-actions';

    const statsBtn = document.createElement('button');
    statsBtn.className = 'btn small';
    statsBtn.textContent = 'View all Stats';
    statsBtn.addEventListener('click', () => toggleStatsPanel(card, d, statsBtn));
    actions.appendChild(statsBtn);

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'btn small';
    settingsBtn.textContent = 'Settings';
    settingsBtn.addEventListener('click', () => toggleSettingsPanel(card, d, settingsBtn));
    actions.appendChild(settingsBtn);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn small';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => openRename(card, d));
    actions.appendChild(renameBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn small';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => confirmRemove(removeBtn, d));
    actions.appendChild(removeBtn);

    card.appendChild(actions);
    return card;
  }

  // ── Per-device protection settings (inline panel) ────────────────────────
  const PROTECTION_TOGGLES = [
    { key: 'remoteBlock', title: 'Block remote desktop sites',
      desc: 'Automatically block sites like TeamViewer, AnyDesk, UltraViewer.' },
    { key: 'scamPage',    title: 'Block scam pages',
      desc: 'Show a warning overlay on fake virus-alert and tech-support scam pages.' },
    { key: 'phishingEmail', title: 'Detect phishing emails',
      desc: 'Show a warning banner on suspicious scam emails in Gmail, Outlook, Yahoo and AOL.' },
    { key: 'voice',       title: 'Voice warning',
      desc: 'Play an audio alert when a scam site is blocked.' },
    { key: 'notif',       title: 'Browser notifications',
      desc: 'Show a Chrome notification when a scam number is detected nearby.' },
  ];

  // ── Per-device all-time stats (inline panel) ─────────────────────────────
  const STAT_CARDS = [
    { key: 'totalThreats',    label: 'Total threats caught' },
    { key: 'remoteAllTime',   label: 'Remote Site Blocked' },
    { key: 'scampageAllTime', label: 'Scam page/Popup Blocked' },
    { key: 'phishingAllTime', label: 'Phishing/Scam Email Detected' },
    { key: 'adAllTime',       label: 'Fake/Scam Ads detected' },
  ];

  function toggleStatsPanel(card, device, btn) {
    const existing = card.querySelector('.device-stats-panel');
    if (existing) { existing.remove(); btn.classList.remove('primary'); return; }
    // Close the settings panel if open, so only one panel shows at a time.
    const openSettings = card.querySelector('.device-settings-panel');
    if (openSettings) {
      openSettings.remove();
      const sBtn = card.querySelector('.device-actions .btn.primary');
      if (sBtn) sBtn.classList.remove('primary');
    }
    btn.classList.add('primary');

    const panel = document.createElement('div');
    panel.className = 'device-stats-panel';

    STAT_CARDS.forEach(c => {
      const cell = document.createElement('div');
      cell.className = 'device-stat-cell' + (c.key === 'totalThreats' ? ' highlight' : '');
      cell.innerHTML =
        `<div class="device-stat-value"></div>` +
        `<div class="device-stat-label"></div>`;
      cell.querySelector('.device-stat-value').textContent = device[c.key] || 0;
      cell.querySelector('.device-stat-label').textContent = c.label;
      panel.appendChild(cell);
    });

    const note = document.createElement('div');
    note.className = 'settings-note';
    note.textContent = 'All-time totals since this device was activated.';
    panel.appendChild(note);

    card.appendChild(panel);
  }

  function toggleSettingsPanel(card, device, btn) {
    const existing = card.querySelector('.device-settings-panel');
    if (existing) { existing.remove(); btn.classList.remove('primary'); return; }
    // Close the stats panel if open.
    const openStats = card.querySelector('.device-stats-panel');
    if (openStats) {
      openStats.remove();
      const stBtn = Array.from(card.querySelectorAll('.device-actions .btn')).find(b => b.textContent === 'View all Stats');
      if (stBtn) stBtn.classList.remove('primary');
    }
    btn.classList.add('primary');

    const panel = document.createElement('div');
    panel.className = 'device-settings-panel';

    PROTECTION_TOGGLES.forEach(t => {
      const row = document.createElement('div');
      row.className = 'settings-row';

      const text = document.createElement('div');
      text.className = 'settings-row-text';
      text.innerHTML =
        `<div class="settings-row-title"></div>` +
        `<div class="settings-row-desc"></div>`;
      text.querySelector('.settings-row-title').textContent = t.title;
      text.querySelector('.settings-row-desc').textContent  = t.desc;
      row.appendChild(text);

      const sw = document.createElement('button');
      sw.className = 'switch' + (device.settings[t.key] ? ' on' : '');
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', String(!!device.settings[t.key]));
      sw.setAttribute('aria-label', t.title);
      sw.addEventListener('click', () => flipDeviceToggle(sw, device, t.key));
      row.appendChild(sw);

      panel.appendChild(row);
    });

    const note = document.createElement('div');
    note.className = 'settings-note';
    note.textContent = 'Changes apply on the device within an hour.';
    panel.appendChild(note);

    card.appendChild(panel);
  }

  async function flipDeviceToggle(sw, device, key) {
    if (sw.classList.contains('busy')) return;
    const next = !sw.classList.contains('on');

    // Optimistic UI
    sw.classList.toggle('on', next);
    sw.setAttribute('aria-checked', String(next));
    sw.classList.add('busy');

    try {
      const res = await fetch(`${API}/api/household/devices/${device.id}/settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { [key]: next } })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Revert
        sw.classList.toggle('on', !next);
        sw.setAttribute('aria-checked', String(!next));
        toast(friendlyError(data.error), 'error');
        return;
      }

      // Sync local state from the server's normalized response
      device.settings = data.settings;
      const m = MEMBERS.find(x => x.id === device.id);
      if (m) m.settings = data.settings;

      toast('Setting saved', 'success');
    } catch (err) {
      sw.classList.toggle('on', !next);
      sw.setAttribute('aria-checked', String(!next));
      toast('Network error. Please try again.', 'error');
    } finally {
      sw.classList.remove('busy');
    }
  }

  // ── Rename (inline) ──────────────────────────────────────────────────────
  function openRename(card, device) {
    // Avoid stacking multiple rename rows
    if (card.querySelector('.device-rename-row')) return;

    const row = document.createElement('div');
    row.className = 'device-rename-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 100;
    input.value = device.deviceName || '';
    input.placeholder = 'Device name';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn primary small';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn small';
    cancelBtn.textContent = 'Cancel';

    cancelBtn.addEventListener('click', () => row.remove());
    saveBtn.addEventListener('click', async () => {
      const newName = input.value.trim();
      if (!newName) {
        toast('Name cannot be empty', 'error');
        return;
      }
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const res = await fetch(`${API}/api/household/devices/${device.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceName: newName })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(friendlyError(data.error), 'error');
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
          saveBtn.textContent = 'Save';
          return;
        }
        toast('Device renamed', 'success');
        await loadHousehold();
      } catch (err) {
        toast('Network error. Please try again.', 'error');
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });

    row.appendChild(input);
    row.appendChild(saveBtn);
    row.appendChild(cancelBtn);
    card.appendChild(row);
    input.focus();
    input.select();
  }

  // ── Remove device (inline confirm) ───────────────────────────────────────
  function confirmRemove(btn, device) {
    // Already in confirm mode? Second click confirms.
    if (btn.dataset.confirming === '1') return;

    const original = btn.textContent;
    const actions  = btn.parentElement;

    btn.dataset.confirming = '1';
    btn.className = 'btn danger small';
    btn.textContent = 'Confirm?';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn small';
    cancelBtn.textContent = 'Cancel';
    actions.appendChild(cancelBtn);

    let settled = false;
    const reset = () => {
      if (settled) return;
      settled = true;
      btn.dataset.confirming = '';
      btn.className = 'btn small';
      btn.textContent = original;
      cancelBtn.remove();
    };

    cancelBtn.addEventListener('click', reset);

    btn.addEventListener('click', async function onConfirm() {
      btn.removeEventListener('click', onConfirm);
      btn.disabled = true;
      cancelBtn.disabled = true;
      btn.textContent = 'Removing…';
      try {
        const res = await fetch(`${API}/api/household/remove-device`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: device.deviceId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(friendlyError(data.error), 'error');
          settled = true; // prevent stale reset
          btn.disabled = false;
          await loadHousehold();
          return;
        }
        toast('Device removed', 'success');
        await loadHousehold();
      } catch (err) {
        toast('Network error. Please try again.', 'error');
        btn.disabled = false;
        cancelBtn.disabled = false;
        btn.textContent = 'Confirm?';
      }
    }, { once: true });
  }

  // ── INVITE CODES ─────────────────────────────────────────────────────────
  function renderInvites() {
    const listEl = document.getElementById('codes-list');
    listEl.innerHTML = '';

    if (INVITES.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No outstanding codes.';
      listEl.appendChild(empty);
      return;
    }

    INVITES.forEach(c => listEl.appendChild(buildCodeChip(c)));
  }

  function buildCodeChip(code) {
    const chip = document.createElement('div');
    chip.className = 'code-chip';

    const codeEl = document.createElement('span');
    codeEl.className = 'code-chip-code';
    codeEl.textContent = code.code;
    chip.appendChild(codeEl);

    const main = document.createElement('div');
    main.className = 'code-chip-main';

    const labelEl = document.createElement('div');
    labelEl.className = 'code-chip-label';
    labelEl.textContent = code.label || 'No label';
    main.appendChild(labelEl);

    const expiryEl = document.createElement('div');
    expiryEl.className = 'code-chip-expiry';
    expiryEl.textContent = 'Expires ' + formatRelative(code.expiresAt);
    main.appendChild(expiryEl);

    chip.appendChild(main);

    const revokeBtn = document.createElement('button');
    revokeBtn.className = 'btn small';
    revokeBtn.textContent = 'Revoke';
    revokeBtn.addEventListener('click', () => confirmRevoke(revokeBtn, code));
    chip.appendChild(revokeBtn);

    return chip;
  }

  // ── Revoke code (inline confirm) ─────────────────────────────────────────
  function confirmRevoke(btn, code) {
    if (btn.dataset.confirming === '1') return;

    const original = btn.textContent;
    const chip     = btn.parentElement;

    btn.dataset.confirming = '1';
    btn.className = 'btn danger small';
    btn.textContent = 'Confirm?';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn small';
    cancelBtn.textContent = 'Cancel';
    chip.appendChild(cancelBtn);

    let settled = false;
    const reset = () => {
      if (settled) return;
      settled = true;
      btn.dataset.confirming = '';
      btn.className = 'btn small';
      btn.textContent = original;
      cancelBtn.remove();
    };
    cancelBtn.addEventListener('click', reset);

    btn.addEventListener('click', async function onConfirm() {
      btn.removeEventListener('click', onConfirm);
      btn.disabled = true;
      cancelBtn.disabled = true;
      btn.textContent = 'Revoking…';
      try {
        const res = await fetch(`${API}/api/household/invites/${code.id}`, {
          method: 'DELETE',
          credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(friendlyError(data.error), 'error');
          settled = true;
          await loadHousehold();
          return;
        }
        toast('Code revoked', 'success');
        await loadHousehold();
      } catch (err) {
        toast('Network error. Please try again.', 'error');
        btn.disabled = false;
        cancelBtn.disabled = false;
        btn.textContent = 'Confirm?';
      }
    }, { once: true });
  }

  // ── Generate code ────────────────────────────────────────────────────────
  function renderGenerateState() {
    const btn  = document.getElementById('generate-btn');
    const help = document.getElementById('generate-help');
    const limit = HOUSEHOLD ? HOUSEHOLD.memberSeatLimit : 3;
    const used  = MEMBERS.length + INVITES.length;

    if (used >= limit) {
      btn.disabled = true;
      help.textContent =
        `You've reached your limit of ${limit} device${limit === 1 ? '' : 's'} ` +
        `(active devices plus outstanding codes). Remove a device or revoke a code to generate a new one.`;
    } else {
      btn.disabled = false;
      const remaining = limit - used;
      help.textContent =
        `${remaining} slot${remaining === 1 ? '' : 's'} remaining.`;
    }
  }

  async function generateCode() {
    const btn     = document.getElementById('generate-btn');
    const labelEl = document.getElementById('invite-label');
    const alertEl = document.getElementById('invite-alert');
    hideAlert(alertEl);

    const label = labelEl.value.trim();

    // Label is required — it becomes the device name on redemption.
    if (!label) {
      showAlert(alertEl, 'error', 'Please enter a device label before generating a code.');
      labelEl.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Generating…';

    try {
      const res = await fetch(`${API}/api/household/invites`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showAlert(alertEl, 'error', friendlyError(data.error));
        return;
      }

      // Show the freshly generated code
      showGeneratedCode(data);
      labelEl.value = '';
      toast('Invite code generated', 'success');

      // Refresh the outstanding list + seat math
      await loadHousehold();
    } catch (err) {
      showAlert(alertEl, 'error', 'Network error. Please try again.');
    } finally {
      btn.textContent = 'Generate invite code';
      // renderGenerateState() (called by loadHousehold) sets disabled correctly
    }
  }

  function showGeneratedCode(data) {
    const box     = document.getElementById('code-result');
    const valueEl = document.getElementById('code-result-value');
    const expEl   = document.getElementById('code-result-expiry');
    const lblEl   = document.getElementById('code-result-label');

    valueEl.textContent = data.code;
    lblEl.textContent   = data.label
      ? `New invite code · ${data.label}`
      : 'New invite code';
    expEl.textContent   = 'Expires ' + formatRelative(data.expiresAt);
    box.classList.remove('hidden');
  }

  async function copyGeneratedCode() {
    const code = document.getElementById('code-result-value').textContent;
    const btn  = document.getElementById('code-copy-btn');
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    } catch (err) {
      toast('Could not copy — please copy it manually', 'error');
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function formatRelative(s) {
    if (!s) return 'unknown';
    const then = new Date(s).getTime();
    if (isNaN(then)) return 'unknown';
    const diff = then - Date.now();
    const abs  = Math.abs(diff);
    const future = diff > 0;

    const min  = 60 * 1000;
    const hour = 60 * min;
    const day  = 24 * hour;

    let text;
    if (abs < min)       text = 'just now';
    else if (abs < hour) text = Math.round(abs / min)  + ' min';
    else if (abs < day)  text = Math.round(abs / hour) + ' hr';
    else                 text = Math.round(abs / day)  + ' day';

    if (text === 'just now') return text;
    if (future) return 'in ' + text;
    return text + ' ago';
  }

  function showAlert(el, kind, msg) {
    if (!el) return;
    el.className = 'alert ' + kind;
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function hideAlert(el) {
    if (el) el.classList.add('hidden');
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
  function friendlyError(code, fallback) {
    const map = {
      not_authenticated:        'Your session has expired. Please sign in again.',
      family_tier_required:     'This action requires an active Family plan.',
      household_not_initialised:'Your household isn\u2019t set up yet. Please refresh the page.',
      no_household:             'Your household isn\u2019t set up yet. Please refresh the page.',
      seat_limit_reached:       'You\u2019ve reached your device limit. Remove a device or revoke a pending code first.',
      not_found:                'That item no longer exists. The list has been refreshed.',
      already_redeemed:         'That code was already used, so it can\u2019t be revoked. Remove the device instead.',
      deviceId_required:        'Something went wrong. Please try again.',
      invalid_email:            'Please enter a valid alert email address.',
      phone_required:           'Add an alert phone number before enabling SMS alerts.',
      server_error:             'Something went wrong. Please try again.',
    };
    return map[code] || fallback || 'Something went wrong. Please try again.';
  }
})();
