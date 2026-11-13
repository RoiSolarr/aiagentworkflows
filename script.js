/* ============================================================
   script.js — index.html only.

   Theme toggle, mobile navigation, the flow diagram reveal, the
   Turnstile gate in front of the Jotform embed, a postMessage
   listener that keeps that iframe at the right height, the click to
   load case study video, and the active section highlight in the nav.

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

    function apply(height) {
      // A floor and a ceiling, so one malformed message cannot collapse the
      // form to nothing or stretch the page to an absurd length.
      if (!isFinite(height) || height < 420 || height > 20000) return;
      frame.style.height = Math.ceil(height) + 'px';
      frame.style.minHeight = '0';
    }

    /* Jotform has shipped two shapes of this message over the years: the
       legacy "setHeight:<px>:<formId>" string and a structured object. Older
       forms send the first, newer ones the second, and which you get is not
       something this page can control, so both are handled. */
    window.addEventListener('message', function (e) {
      if (typeof e.origin !== 'string' || !JOTFORM_ORIGIN.test(e.origin)) return;

      if (typeof e.data === 'string') {
        var parts = e.data.split(':');
        if (parts[0] !== 'setHeight') return;
        apply(parseInt(parts[1], 10));
        return;
      }

      if (e.data && typeof e.data === 'object' && e.data.type === 'setHeight') {
        apply(parseInt(e.data.height, 10));
      }
    });
  }

  /* ---------- Case study video ----------
     The embed is injected on click rather than on page load. Nothing is
     requested from Loom until a visitor asks for it, which keeps the
     no-cookies line in the footer honest and saves everyone else the
     third party script. */

  function initVideo() {
    var box = document.getElementById('video');
    var btn = document.getElementById('video-play');
    if (!box || !btn) return;

    btn.addEventListener('click', function () {
      var src = btn.getAttribute('data-embed');
      if (!src) return;

      var frame = document.createElement('iframe');
      frame.className = 'video__frame';
      frame.src = src + '?autoplay=1';
      frame.title = 'AI Agent Workflows demo walkthrough';
      // allow= already grants fullscreen; adding allowfullscreen as well only
      // earns a console warning about one overriding the other.
      frame.allow = 'autoplay; fullscreen; picture-in-picture';
      frame.referrerPolicy = 'strict-origin';

      box.innerHTML = '';
      box.appendChild(frame);
      frame.focus({ preventScroll: true });
    });
  }

  /* ---------- Active section in the nav ----------
     A band across the middle of the viewport decides which section counts as
     current, so the highlight changes when a section is actually being read
     rather than the instant its top edge appears. */

  function initScrollSpy() {
    var nav = document.getElementById('site-nav');
    if (!nav || !('IntersectionObserver' in window)) return;

    var links = {};
    var sections = [];

    Array.prototype.forEach.call(nav.querySelectorAll('a[href^="#"]'), function (a) {
      var id = a.getAttribute('href').slice(1);
      var section = document.getElementById(id);
      if (!section) return;
      links[id] = a;
      sections.push(section);
    });
    if (!sections.length) return;

    var onScreen = {};

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        onScreen[entry.target.id] = entry.isIntersecting;
      });

      var current = null;
      for (var i = 0; i < sections.length; i++) {
        if (onScreen[sections[i].id]) { current = sections[i].id; break; }
      }

      Object.keys(links).forEach(function (id) {
        if (id === current) links[id].classList.add('is-active');
        else links[id].classList.remove('is-active');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach(function (section) { observer.observe(section); });
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
    initVideo();
    initScrollSpy();
    checkTurnstileConfigured();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();