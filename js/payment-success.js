(() => {
  const API = 'https://api.kinsentry.com';
  const accountUrl = '/account#subscription';
  const sessionId = new URLSearchParams(location.search).get('session_id');
  const spinner = document.getElementById('spinner');
  const successIcon = document.getElementById('success-icon');
  const title = document.getElementById('title');
  const message = document.getElementById('message');
  const planMessage = document.getElementById('plan-message');
  const countdown = document.getElementById('countdown');
  const accountLink = document.getElementById('account-link');
  const planNames = {
    guardian_monthly: 'Guardian',
    guardian_annual: 'Guardian',
    family_monthly: 'Family',
    family_annual: 'Family'
  };

  function showProblem(text) {
    spinner.hidden = true;
    title.textContent = 'We’re checking your payment';
    message.textContent = text;
    accountLink.hidden = false;
  }

  async function verifyPayment() {
    if (!sessionId) {
      showProblem('We couldn’t find the Stripe payment reference. If you completed payment, check your KinSentry account or contact support.');
      return;
    }

    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const response = await fetch(`${API}/api/billing/checkout-session?session_id=${encodeURIComponent(sessionId)}`, {
          credentials: 'include',
          cache: 'no-store'
        });
        const result = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 404 || response.status === 400) {
          showProblem('We couldn’t verify this payment for the signed-in account. Open your account to check your plan, or contact support.');
          return;
        }
        if (response.ok && result.paid) {
          showSuccess(result.plan);
          return;
        }
      } catch (_) {
        // Retry transient network/API failures while Stripe confirmation settles.
      }
      await new Promise(resolve => setTimeout(resolve, 1200));
    }

    showProblem('Stripe hasn’t confirmed the payment yet. Your account will show the plan once confirmation completes.');
  }

  function showSuccess(planKey) {
    spinner.hidden = true;
    successIcon.hidden = false;
    title.textContent = 'Your payment was successful!';
    message.textContent = 'Thank you for your payment!';
    const planName = planNames[planKey];
    planMessage.textContent = planName
      ? `Your payment for KinSentry’s ${planName} subscription has been received.`
      : 'Your payment for your KinSentry subscription has been received.';
    planMessage.hidden = false;
    countdown.hidden = false;
    accountLink.hidden = false;
    history.replaceState({}, '', '/payment-success.html');

    let seconds = 5;
    countdown.textContent = `Taking you to your account in ${seconds} seconds…`;
    const timer = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(timer);
        location.replace(accountUrl);
        return;
      }
      countdown.textContent = `Taking you to your account in ${seconds} seconds…`;
    }, 1000);
  }

  accountLink.addEventListener('click', event => {
    event.preventDefault();
    location.replace(accountUrl);
  });

  verifyPayment();
})();
