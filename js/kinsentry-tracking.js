// KinSentry — first-touch traffic attribution (website side)
// Captures where a visitor first came from, stores it locally, and reports it
// once to the backend (POST /api/track → traffic_sources). Best-effort: never
// blocks rendering, never throws into the page.

(function () {
  const API_BASE    = 'https://api.kinsentry.com';
  const VISITOR_KEY = 'ks_visitor_id';        // stable random id per browser
  const STORE_KEY   = 'ks_attribution';       // first-touch payload (persisted)
  const SENT_KEY    = 'ks_attribution_sent';  // guard: report only once

  function uuid() {
    try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch (_) {}
    return 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getVisitorId() {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) { id = uuid(); localStorage.setItem(VISITOR_KEY, id); }
    return id;
  }

  // First-touch: capture attribution only the first time we ever see this
  // visitor. Later visits (even with new UTMs) keep the original source.
  function getOrSetFirstTouch() {
    const existing = localStorage.getItem(STORE_KEY);
    if (existing) { try { return JSON.parse(existing); } catch (_) {} }

    const p = new URLSearchParams(location.search);

    // Referrer only counts if it's genuinely off-site.
    let referrer = '';
    try {
      if (document.referrer && new URL(document.referrer).host !== location.host) {
        referrer = document.referrer;
      }
    } catch (_) {}

    const attribution = {
      utmSource:   p.get('utm_source')   || '',
      utmMedium:   p.get('utm_medium')   || '',
      utmCampaign: p.get('utm_campaign') || '',
      referrer,
      landingPath: (location.pathname + location.search).slice(0, 300),
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(attribution));
    return attribution;
  }

  async function reportOnce(visitorId, a) {
    if (localStorage.getItem(SENT_KEY)) return;
    try {
      await fetch(`${API_BASE}/api/track`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ visitorId, ...a }),
        keepalive: true, // survive the navigation to the store/signup
      });
      localStorage.setItem(SENT_KEY, '1');
    } catch (_) { /* best-effort */ }
  }

  const visitorId   = getVisitorId();
  const attribution = getOrSetFirstTouch();
  reportOnce(visitorId, attribution);

  // Exposed so the signup flow can tag the extension sign-in message.
  window.KinSentryAttribution = {
    visitorId,
    get: () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; } },
    // Compact one-word channel label, e.g. "google", "newsletter", "reddit.com", "direct".
    sourceLabel() {
      const a = this.get();
      if (a.utmSource) return a.utmSource;
      if (a.referrer) { try { return new URL(a.referrer).host.replace(/^www\./, ''); } catch (_) {} }
      return 'direct';
    },
  };
})();
