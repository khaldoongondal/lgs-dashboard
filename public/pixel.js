/**
 * LGS landing-page pixel.
 *
 * Captures fbclid + UTMs + ThumbmarkJS fingerprint + device signals and POSTs
 * funnel events (PageView, CTAClick, OptIn, Booking) to /api/events.
 *
 * Drop into every funnel page just before </body>:
 *
 *   <script>
 *     window.LGS_SERVER_URL = 'https://YOUR_DASHBOARD.vercel.app';
 *     // Optional override; default is auto-detected from URL path:
 *     window.LGS_PAGE_SLUG  = 'vsl';   // 'vsl' | 'optin' | 'booking' | 'thankyou'
 *   </script>
 *   <script src="https://YOUR_DASHBOARD.vercel.app/pixel.js" defer></script>
 *
 * Manual conversion-event helpers (call from your own buttons/forms):
 *   window.lgsTrackCTA()
 *   window.lgsTrackOptin()
 *   window.lgsTrackBooking()
 *
 * Auto-wiring — add these attributes anywhere in your HTML and the pixel
 * fires the matching event automatically:
 *   <button data-lgs-cta>...</button>
 *   <form data-lgs-optin-form>...</form>
 *   <div data-lgs-booking-confirm>...</div>
 *
 * After load, window._lgsLastEventId + window._lgsFingerprint are set so
 * the Meta browser pixel can dedupe via eventID and GHL hidden form fields
 * can read the fingerprint.
 */
(function () {
  'use strict';

  var CONFIG = {
    SERVER_URL:         (typeof window !== 'undefined' && window.LGS_SERVER_URL) || '',
    PAGE_SLUG_OVERRIDE: (typeof window !== 'undefined' && window.LGS_PAGE_SLUG) || null,
    FBCLID_COOKIE_DAYS: 90,
    UTM_COOKIE_DAYS:    30,
    THUMBMARK_URL:      'https://cdn.jsdelivr.net/npm/@thumbmarkjs/thumbmarkjs@0.20.5/dist/thumbmark.umd.js',
    THUMBMARK_TIMEOUT:  2500,
  };

  // ── Page-slug detection ────────────────────────────────────────────────────
  // Auto-classify the page into one of the 4 funnel steps based on URL path.
  // Tweak the patterns to match your site's URL structure, or set the
  // window.LGS_PAGE_SLUG override on each page.
  function detectPageSlug() {
    if (CONFIG.PAGE_SLUG_OVERRIDE) return CONFIG.PAGE_SLUG_OVERRIDE;
    var path = (window.location.pathname || '').toLowerCase();
    if (/(thank|confirm|booked|success)/.test(path))   return 'thankyou';
    if (/(book|calendar|schedule)/.test(path))         return 'booking';
    if (/(optin|opt-in|signup|sign-up|form)/.test(path)) return 'optin';
    if (/(lp|vsl|landing|home)/.test(path))            return 'vsl';
    if (path === '/' || path === '')                   return 'vsl';
    return 'other';
  }

  // ── UUID v4 ────────────────────────────────────────────────────────────────
  function uuidv4() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // ── Cookies ────────────────────────────────────────────────────────────────
  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setCookie(name, value, days) {
    var exp = '';
    if (days) { var d = new Date(); d.setTime(d.getTime() + days * 86400000); exp = '; expires=' + d.toUTCString(); }
    document.cookie = name + '=' + encodeURIComponent(value) + exp + '; path=/; SameSite=Lax';
  }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function captureFbclid() {
    var fbclid = getParam('fbclid');
    if (fbclid) {
      setCookie('_lgs_fbclid', fbclid, CONFIG.FBCLID_COOKIE_DAYS);
      setCookie('_lgs_fbclid_ts', String(Date.now()), CONFIG.FBCLID_COOKIE_DAYS);
    }
    return getCookie('_lgs_fbclid');
  }

  function buildFbc(fbclid) {
    if (!fbclid) return null;
    var ts = getCookie('_lgs_fbclid_ts') || Date.now();
    return 'fb.1.' + ts + '.' + fbclid;
  }

  function captureUtms() {
    var keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
    var out = {};
    keys.forEach(function (k) {
      var v = getParam(k);
      if (v) { out[k] = v; setCookie('_lgs_' + k, v, CONFIG.UTM_COOKIE_DAYS); }
      else { var c = getCookie('_lgs_' + k); if (c) out[k] = c; }
    });
    return out;
  }

  function screenRes() {
    try {
      if (!window.screen) return null;
      return window.screen.width + 'x' + window.screen.height;
    } catch (_) { return null; }
  }

  // ── ThumbmarkJS dynamic loader ─────────────────────────────────────────────
  function loadThumbmark() {
    return new Promise(function (resolve) {
      if (window.ThumbmarkJS && window.ThumbmarkJS.getFingerprint) return resolve(window.ThumbmarkJS);
      if (window.Thumbmark   && window.Thumbmark.getFingerprint)   return resolve(window.Thumbmark);

      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; resolve(null); } }, CONFIG.THUMBMARK_TIMEOUT);

      var s = document.createElement('script');
      s.src   = CONFIG.THUMBMARK_URL;
      s.async = true;
      s.onload  = function () {
        if (done) return;
        done = true; clearTimeout(to);
        resolve(window.ThumbmarkJS || window.Thumbmark || null);
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(to); resolve(null); } };
      document.head.appendChild(s);
    });
  }

  async function getFingerprint() {
    if (window._lgsFingerprint) return window._lgsFingerprint;
    try {
      var lib = await loadThumbmark();
      if (!lib || !lib.getFingerprint) return null;
      var fp = await lib.getFingerprint();
      if (fp && typeof fp === 'object' && fp.thumbmark) fp = String(fp.thumbmark);
      else fp = fp ? String(fp) : null;
      // Cache on window so GHL hidden form fields / other event handlers can read it.
      if (fp) window._lgsFingerprint = fp;
      return fp;
    } catch (_) { return null; }
  }

  // ── MS Clarity session-URL capture (no-op until Clarity is installed) ──────
  function clarityUrl() {
    try {
      // Microsoft Clarity exposes window.clarity as a queueing function once
      // its snippet has loaded. Their internal globals include the project ID
      // (window.__clarity?.s) and session ID — but those are subject to change.
      // Pull whatever we can via the documented `get` API; fall back to null.
      var c = window.clarity;
      if (typeof c !== 'function') return null;
      // The synchronous accessor isn't standard; in practice the easiest pattern
      // is to read window.__clarity_session_url if a host-page snippet has set it.
      if (window.__lgs_clarity_session_url) return window.__lgs_clarity_session_url;
      return null;
    } catch (_) { return null; }
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  function send(payload) {
    if (!CONFIG.SERVER_URL) CONFIG.SERVER_URL = location.origin;
    var url = CONFIG.SERVER_URL.replace(/\/$/, '') + '/api/events';
    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body, keepalive: true, credentials: 'omit',
      }).catch(function () {});
    }
    window._lgsLastEventId = payload.event_id;
  }

  // Shared payload builder — every event includes identity + funnel context.
  async function basePayload() {
    var fbclid = captureFbclid();
    var utms   = captureUtms();
    var fp     = await getFingerprint();
    return {
      event_id:    uuidv4(),
      event_time:  Math.floor(Date.now() / 1000),
      page_url:    window.location.href,
      page_slug:   detectPageSlug(),
      referrer:    document.referrer || null,
      fingerprint: fp,
      fbclid:      fbclid || null,
      fbc:         buildFbc(fbclid),
      fbp:         getCookie('_fbp') || null,
      user_agent:  navigator.userAgent,
      screen_res:  screenRes(),
      clarity_session_url: clarityUrl(),
      utm_source:   utms.utm_source   || null,
      utm_medium:   utms.utm_medium   || null,
      utm_campaign: utms.utm_campaign || null,
      utm_content:  utms.utm_content  || null,
      utm_term:     utms.utm_term     || null,
    };
  }

  async function firePageView()   {
    var p = await basePayload();
    p.event_name = 'PageView';
    send(p);
    startHeartbeat(p.event_id);
  }
  async function fireCTAClick()   { var p = await basePayload(); p.event_name = 'CTAClick';  send(p); }
  async function fireOptIn()      { var p = await basePayload(); p.event_name = 'OptIn';     send(p); }
  async function fireBooking()    { var p = await basePayload(); p.event_name = 'Booking';   send(p); }

  // ── Heartbeat — accumulate active seconds and patch the page_view row ─────
  // Active = document.visibilityState === 'visible'. Sends every 15s plus a
  // final beacon on pagehide / beforeunload. Server keeps the max value seen
  // so out-of-order updates don't shrink the count.
  function startHeartbeat(eventId) {
    if (!eventId) return;
    var activeMs = 0;
    var lastTick = Date.now();

    function tick() {
      var now = Date.now();
      if (document.visibilityState === 'visible') {
        activeMs += (now - lastTick);
      }
      lastTick = now;
    }

    function ping() {
      tick();
      var seconds = Math.floor(activeMs / 1000);
      if (seconds <= 0) return;
      var url  = (CONFIG.SERVER_URL || location.origin).replace(/\/$/, '') + '/api/events/heartbeat';
      var body = JSON.stringify({ event_id: eventId, time_on_page: seconds });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: body, keepalive: true, credentials: 'omit',
        }).catch(function () {});
      }
    }

    document.addEventListener('visibilitychange', tick);
    setInterval(ping, 15_000);
    window.addEventListener('pagehide',     ping);
    window.addEventListener('beforeunload', ping);
  }

  // Expose manual hooks — call these from your own button/form handlers.
  window.lgsTrackCTA     = fireCTAClick;
  window.lgsTrackOptin   = fireOptIn;
  window.lgsTrackBooking = fireBooking;

  // Auto-wire — attach listeners to elements tagged with data-lgs-* attributes
  // so the host page doesn't need to write any JS.
  function autowire() {
    document.querySelectorAll('[data-lgs-cta]').forEach(function (el) {
      el.addEventListener('click', function () { fireCTAClick(); }, { passive: true });
    });
    document.querySelectorAll('form[data-lgs-optin-form]').forEach(function (form) {
      form.addEventListener('submit', function () { fireOptIn(); }, { passive: true });
    });
    // For booking-confirm we fire on page load if the element exists — typical
    // pattern is a thank-you page with a "booking confirmed" banner.
    if (document.querySelector('[data-lgs-booking-confirm]')) {
      fireBooking();
    }
  }

  function init() {
    captureFbclid();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { firePageView(); autowire(); });
    } else {
      firePageView();
      autowire();
    }
  }

  init();
})();
