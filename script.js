/* ============================================================
   script.js — index.html only.

   Theme toggle, mobile navigation, the flow diagram reveal, the
   Turnstile gate in front of the Jotform embed, and a small
   postMessage listener that keeps the iframe at the right height.

   Loaded without defer so the global Turnstile callbacks below
   exist before Cloudflare's async script finishes loading.
   ============================================================ */

(function () {
  'use strict';

  var THEME_KEY = 'aaw-theme';
  var root = document.documentElement;

  /* ---------- Theme ---------- */

  function labelToggle(btn, theme) {
    var goingDark = theme !== 'dark';
    btn.setAttribute('aria-label', goingDark ? 'Switch to dark mode' : 'Switch to light mode');
    btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }

  function initTheme() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;

    labelToggle(btn, root.getAttribute('data-theme') || 'light');

    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      labelToggle(btn, next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
    });

    // Follow the system only while the visitor has never chosen for themselves.
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function (e) {
      var saved = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* ignore */ }
      if (saved) return;
      var theme = e.matches ? 'dark' : 'light';
      root.setAttribute('data-theme', theme);
      labelToggle(btn, theme);
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ---------- Mobile navigation ---------- */

  function initNav() {
    var toggle = document.getElementById('nav-toggle');
    var nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;

    function close() {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
    }

    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });

    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        close();
        toggle.focus();
      }
    });
  }

  /* ---------- Flow diagram reveal ---------- */

  function initFlow() {
    var flow = document.getElementById('flow');
    if (!flow) return;

    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) {
      flow.classList.add('is-in');
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });

    observer.observe(flow);
  }

  /* ---------- Jotform iframe height ----------
     Jotform posts "setHeight:<px>:<formId>" from inside the iframe.
     Listening for it ourselves avoids loading Jotform's resizer script
     and keeps the Content Security Policy tight. If the message never
     arrives, the CSS min-height keeps the form usable. */

  function initFrameResizer() {
    var frame = document.getElementById('jotform');
    if (!frame) return;

    // Origin is matched as a plain string. Parsing it with new URL() throws on
    // the "null" origin that sandboxed frames and some extensions send.
    var JOTFORM_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*jotform\.com$/;

    window.addEventListener('message', function (e) {
      if (typeof e.origin !== 'string' || !JOTFORM_ORIGIN.test(e.origin)) return;
      if (typeof e.data !== 'string') return;

      var parts = e.data.split(':');
      if (parts[0] !== 'setHeight') return;

      var height = parseInt(parts[1], 10);
      if (!isFinite(height) || height < 200 || height > 20000) return;

      frame.style.height = height + 'px';
      frame.style.minHeight = '0';
    });
  }

  /* ---------- Turnstile gate ---------- */

  var gate       = document.getElementById('gate');
  var gateStatus = document.getElementById('gate-status');
  var formFrame  = document.getElementById('form-frame');
  var iframe     = document.getElementById('jotform');

  function status(message, state) {
    if (!gateStatus) return;
    gateStatus.textContent = message;
    if (state) gateStatus.setAttribute('data-state', state);
    else gateStatus.removeAttribute('data-state');
  }

  // hideGate is false in the unconfigured case, where the explanatory note
  // stays above the form. moveFocus is false on page load, so nothing steals
  // focus from a visitor who has not interacted yet.
  function revealForm(options) {
    var opts = options || {};
    if (!formFrame || !iframe) return;

    if (!iframe.getAttribute('src')) {
      iframe.setAttribute('src', iframe.getAttribute('data-src'));
    }
    if (gate && opts.hideGate !== false) gate.hidden = true;

    formFrame.hidden = false;

    if (opts.moveFocus) {
      formFrame.setAttribute('tabindex', '-1');
      formFrame.focus({ preventScroll: true });
    }
  }

  // Exposed globally because Cloudflare calls them by name from the widget.
  window.onTurnstileSuccess = function (token) {
    status('Checking…');

    fetch('/api/verify-turnstile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (data) {
        if (data && data.success) {
          status('Verified. Loading the form.', 'ok');
          revealForm({ moveFocus: true });
        } else {
          status('That check did not pass. Reload the page and try again.', 'error');
          if (window.turnstile) window.turnstile.reset();
        }
      })
      .catch(function () {
        status('Could not reach the verification service. Reload the page and try again.', 'error');
        if (window.turnstile) window.turnstile.reset();
      });
  };

  window.onTurnstileError = function () {
    status('The bot check failed to load. Reload the page, or disable any blocker for this site.', 'error');
  };

  window.onTurnstileExpired = function () {
    status('The check expired. Complete it again.', 'error');
    if (window.turnstile) window.turnstile.reset();
  };

  /* If Turnstile has not been configured yet, say so plainly and show the
     form anyway. A silently empty demo section is worse than a visible
     configuration note, and Jotform's own CAPTCHA still applies. */
  function checkTurnstileConfigured() {
    var widget = document.getElementById('turnstile-widget');
    if (!widget) return;

    var key = widget.getAttribute('data-sitekey') || '';
    if (key.indexOf('YOUR_') !== 0) return;

    widget.hidden = true;
    status('Turnstile is not configured yet, so the bot check is skipped. Set YOUR_TURNSTILE_SITE_KEY to enable it.', 'error');
    revealForm({ hideGate: false });
  }

  /* ---------- Go ---------- */

  function init() {
    initTheme();
    initNav();
    initFlow();
    initFrameResizer();
    checkTurnstileConfigured();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
