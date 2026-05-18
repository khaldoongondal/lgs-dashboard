/**
 * LGS landing-page pixel.
 * Captures fbclid + UTMs + (optionally) ThumbmarkJS fingerprint
 * and posts a PageView event to /api/events.
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
    SERVER_URL: (typeof window !== 'undefined' && window.LGS_SERVER_URL) || '',
    FBCLID_COOKIE_DAYS: 90,
    UTM_COOKIE_DAYS:    30,
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

  // ── ThumbmarkJS slot (load on demand if available) ─────────────────────────
  async function getFingerprint() {
    try {
      // If you decide to include ThumbmarkJS, expose it on window.Thumbmark
      // or inline the library; here we just return null in v1.
      if (window.Thumbmark && window.Thumbmark.getFingerprint) {
        return await window.Thumbmark.getFingerprint();
      }
      return null;
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
