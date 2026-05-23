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

    // Stats
    const stats = document.createElement('div');
    stats.className = 'device-stats';
    stats.innerHTML =
      `<div><strong>${d.blocksToday || 0}</strong>blocks today</div>` +
      `<div><strong>${d.alertsToday || 0}</strong>alerts today</div>`;
    card.appendChild(stats);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'device-actions';

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
  function friendlyError(code) {
    const map = {
      not_authenticated:        'Your session has expired. Please sign in again.',
      family_tier_required:     'This action requires an active Family plan.',
      household_not_initialised:'Your household isn\u2019t set up yet. Please refresh the page.',
      no_household:             'Your household isn\u2019t set up yet. Please refresh the page.',
      seat_limit_reached:       'You\u2019ve reached your device limit. Remove a device or revoke a pending code first.',
      not_found:                'That item no longer exists. The list has been refreshed.',
      already_redeemed:         'That code was already used, so it can\u2019t be revoked. Remove the device instead.',
      deviceId_required:        'Something went wrong. Please try again.',
      server_error:             'Something went wrong. Please try again.',
    };
    return map[code] || 'Something went wrong. Please try again.';
  }
})();
