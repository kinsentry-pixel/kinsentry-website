// Redeem a one-time ticket created by the signed-in browser extension.
// The extension's long-lived bearer token is never exposed to this page.
(function () {
  const params = new URLSearchParams(location.hash.slice(1));
  const ticket = params.get('handoff');
  if (!ticket) return;

  const keepPricing = params.get('pricing') === '1';
  history.replaceState({}, '', location.pathname + location.search + (keepPricing ? '#pricing' : ''));
  if (keepPricing) document.getElementById('pricing')?.scrollIntoView();

  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.style.cssText = 'margin:16px auto 0;padding:12px 16px;max-width:620px;border:1px solid rgba(0,232,200,.35);border-radius:10px;background:#111a2b;color:#dce8f8;font-size:14px;text-align:center;';
  const header = document.querySelector('#pricing .pricing-header');
  if (header) header.appendChild(status);

  const buttons = [...document.querySelectorAll('#guardianCheckout, #familyCheckout')];
  const setReady = (ready) => buttons.forEach((button) => {
    button.setAttribute('aria-disabled', ready ? 'false' : 'true');
    button.style.pointerEvents = ready ? '' : 'none';
    button.style.opacity = ready ? '' : '0.6';
  });

  setReady(false);
  if (status) status.textContent = 'Connecting your signed-in account…';

  fetch('https://api.kinsentry.com/api/billing/handoff/redeem', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'handoff_unavailable');
    setReady(true);
    if (status) status.textContent = 'You’re signed in. Choose a plan to continue to secure checkout.';
  }).catch((error) => {
    setReady(true);
    if (!status) return;
    status.textContent = '';
    status.style.borderColor = 'rgba(255,92,92,.45)';
    const message = document.createElement('span');
    message.textContent = 'Could not reconnect your extension session. ';
    const login = document.createElement('a');
    login.href = '/signup?mode=login';
    login.textContent = 'Sign in to continue';
    login.style.cssText = 'color:#38bdf8;text-decoration:underline;font-weight:600;';
    status.append(message, login);
    console.warn('[KinSentry] Extension session handoff failed:', error.message);
  });
})();
