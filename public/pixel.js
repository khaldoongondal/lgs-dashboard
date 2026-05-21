/**
 * LGS landing-page pixel.
 *
 * Captures fbclid + UTMs + ThumbmarkJS fingerprint + device signals and POSTs
 * a PageView event to /api/events.
 *
 * Drop into your VSL page just before </body>:
 *
 *   <script>
 *     window.LGS_SERVER_URL = 'https://YOUR_DASHBOARD.vercel.app';
 *   </script>
 *   <script src="https://YOUR_DASHBOARD.vercel.app/pixel.js" defer></script>
 *
 * After load, window._lgsLastEventId is set so the Meta browser pixel
 * can dedupe by passing it as eventID.
 */
(function () {
  'use strict';

  var CONFIG = {
    SERVER_URL:         (typeof window !== 'undefined' && window.LGS_SERVER_URL) || '',
    FBCLID_COOKIE_DAYS: 90,
    UTM_COOKIE_DAYS:    30,
    // jsDelivr UMD build of @thumbmarkjs/thumbmarkjs — exposes window.ThumbmarkJS
    THUMBMARK_URL:      'https://cdn.jsdelivr.net/npm/@thumbmarkjs/thumbmarkjs@0.20.5/dist/thumbmark.umd.js',
    THUMBMARK_TIMEOUT:  2500, // ms — don't block the pageview send forever
  };

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

  // ── URL params ─────────────────────────────────────────────────────────────
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

  // ── Screen resolution ──────────────────────────────────────────────────────
  function screenRes() {
    try {
      if (!window.screen) return null;
      return window.screen.width + 'x' + window.screen.height;
    } catch (_) { return null; }
  }

  // ── ThumbmarkJS dynamic loader ─────────────────────────────────────────────
  // Loads the library from a CDN on demand. Resolves with a stable fingerprint
  // string, or null if the library doesn't load within THUMBMARK_TIMEOUT.
  // Identity resolution still works via fbclid + email fallback if this fails.
  function loadThumbmark() {
    return new Promise(function (resolve) {
      // Already injected by host page?
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
    try {
      var lib = await loadThumbmark();
      if (!lib || !lib.getFingerprint) return null;
      var fp = await lib.getFingerprint();
      // Some builds return an object { thumbmark, ... }; coerce.
      if (fp && typeof fp === 'object' && fp.thumbmark) return String(fp.thumbmark);
      return fp ? String(fp) : null;
    } catch (_) { return null; }
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  function send(payload) {
    if (!CONFIG.SERVER_URL) {
      // Same-origin fallback: useful when pixel.js is served from the dashboard itself
      CONFIG.SERVER_URL = location.origin;
    }
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

  async function firePageView() {
    var fbclid = captureFbclid();
    var utms   = captureUtms();
    var fingerprint = await getFingerprint();
    send({
      event_id:    uuidv4(),
      event_name:  'PageView',
      event_time:  Math.floor(Date.now() / 1000),
      page_url:    window.location.href,
      referrer:    document.referrer || null,
      fingerprint: fingerprint,
      fbclid:      fbclid || null,
      fbc:         buildFbc(fbclid),
      fbp:         getCookie('_fbp') || null,
      user_agent:  navigator.userAgent,
      screen_res:  screenRes(),
      utm_source:   utms.utm_source   || null,
      utm_medium:   utms.utm_medium   || null,
      utm_campaign: utms.utm_campaign || null,
      utm_content:  utms.utm_content  || null,
      utm_term:     utms.utm_term     || null,
    });
  }

  function init() {
    captureFbclid();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', firePageView);
    } else {
      firePageView();
    }
  }

  init();
})();
