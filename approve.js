/* ============================================================
   approve.js — the Slack approval confirmation page.

   Reads record, action and token from the query string, shows only
   the action being confirmed, and POSTs the decision to our own
   /api/approve function, which forwards it to Make Scenario 2.

   Nothing secret lives here, and nothing secret needs to: the Make
   webhook URL is held by that function in an environment variable.
   Scenario 2 still enforces the real rule, that the token matches
   the record and has not been used before.
   ============================================================ */

(function () {
  'use strict';

  /* ---------- Configuration ---------- */

  // Same origin, so there is no CORS and no preflight to think about.
  // The Make webhook URL lives in MAKE_APPROVAL_WEBHOOK_URL, server side.
  var ENDPOINT = '/api/approve';

  /* ---------- What the five actions mean ---------- */

  var ACTIONS = {
    book_call: {
      label: 'Book a call',
      meaning: 'Approving sends the lead a reply that includes your booking link, and sets the record to Booked.'
    },
    send_reply: {
      label: 'Send reply',
      meaning: 'Approving sends the drafted reply as written and sets the record to Sent.'
    },
    request_more_info: {
      label: 'Request more info',
      meaning: 'Approving sends the drafted follow up asking the lead for the missing details.'
    },
    escalate_to_human: {
      label: 'Escalate to human',
      meaning: 'Approving marks the record as escalated so you handle it yourself. Nothing is emailed to the lead.'
    },
    discard: {
      label: 'Discard',
      meaning: 'Approving closes the record with no reply sent. Use this for spam and obvious noise.'
    }
  };

  /* ---------- Strict input validation ----------
     Everything below comes from the URL bar, so it is treated as
     hostile until it matches a pattern. Values are only ever written
     to the page with textContent, never innerHTML. */

  // Airtable record ids are currently "rec" plus 14 characters. The range is
  // deliberately a little wider than that, so a format change at Airtable's
  // end does not silently break every approval link in Slack.
  var RE_RECORD = /^rec[A-Za-z0-9]{12,20}$/;
  var RE_TOKEN  = /^[A-Za-z0-9_-]{16,128}$/;   // what Make generates

  var el = function (id) { return document.getElementById(id); };

  var params  = new URLSearchParams(window.location.search);
  var record  = params.get('record') || params.get('recordId') || '';
  var action  = params.get('action') || '';
  var token   = params.get('token')  || '';

  // Optional. Which of the two Slack links was clicked. It only decides which
  // button is emphasised here; both remain available, so a misclick in Slack
  // costs nothing. An unrecognised value is ignored rather than refused.
  var preset  = params.get('decision') || '';
  if (preset !== 'approve' && preset !== 'reject') preset = '';

  var states = {
    confirm: el('state-confirm'),
    working: el('state-working'),
    done:    el('state-done'),
    invalid: el('state-invalid')
  };

  function show(name) {
    Object.keys(states).forEach(function (key) {
      states[key].hidden = (key !== name);
    });
  }

  function invalid(reason) {
    el('invalid-reason').textContent = reason;
    show('invalid');
  }

  /* ---------- Validate before showing anything ---------- */

  if (!record || !action || !token) {
    invalid('The link is missing the record, action or token. Open the original Slack message and use the links there.');
    return;
  }
  if (!RE_RECORD.test(record)) {
    invalid('The record id in this link is not a valid Airtable record id.');
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    invalid('The action in this link is not one the agent can recommend. Nothing has been changed.');
    return;
  }
  if (!RE_TOKEN.test(token)) {
    invalid('The approval token in this link is malformed.');
    return;
  }

  /* ---------- Populate the confirm state ---------- */

  el('action-label').textContent  = ACTIONS[action].label;
  el('record-label').textContent  = record;
  el('action-meaning').textContent = ACTIONS[action].meaning;

  if (preset) {
    var hint = el('decision-hint');
    var btnApprove = el('btn-approve');
    var btnReject = el('btn-reject');

    hint.textContent = preset === 'reject'
      ? 'You clicked Reject in Slack. Confirm below, or approve instead.'
      : 'You clicked Approve in Slack. Confirm below, or reject instead.';
    hint.hidden = false;

    if (preset === 'reject') {
      btnReject.className = 'btn btn--primary';
      btnApprove.className = 'btn btn--ghost';
      el('confirm-actions').insertBefore(btnReject, btnApprove);
    }
  }

  show('confirm');

  /* ---------- Sending the decision ---------- */

  var ICON_OK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';

  var ICON_BAD =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>';

  function finish(ok, title, text, allowRetry) {
    el('done-verdict').className = 'verdict ' + (ok ? 'verdict--ok' : 'verdict--bad');
    el('done-icon').innerHTML = ok ? ICON_OK : ICON_BAD;   // static markup, not user input
    el('done-title').textContent = title;
    el('done-text').textContent = text;
    el('btn-retry').hidden = !allowRetry;
    show('done');
  }

  function send(decision) {
    el('working-title').textContent =
      decision === 'approve' ? 'Approving' : 'Rejecting';
    show('working');

    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 20000);

    // Same origin, so JSON is fine here: no CORS, no preflight. The
    // function re-encodes it as form data for Make, whose webhook was
    // taught that shape.
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: record,
        action: action,
        token: token,
        decision: decision
      }),
      signal: controller.signal
    })
      .then(function (res) {
        clearTimeout(timeout);
        return res.json()
          .catch(function () { return {}; })
          .then(function (payload) {
            return { ok: res.ok, status: res.status, payload: payload };
          });
      })
      .then(function (res) {
        var payload = res.payload || {};
        var refused = payload.status && payload.status !== 'ok';

        if (!res.ok || refused) {
          // Worth separating, because this one is a deployment problem
          // rather than anything the person clicking can do about it.
          if (payload.error === 'not_configured') {
            finish(false, 'Not set up yet',
              'The approval handler is not connected. MAKE_APPROVAL_WEBHOOK_URL is not set in the Vercel environment, or it was set without redeploying.',
              false);
            return;
          }

          // A platform timeout returns Vercel's own HTML error page rather
          // than our JSON, so there is no message to read. Go by the status.
          if (!payload.message && (res.status === 504 || res.status === 502)) {
            finish(false, 'No answer in time',
              'The approval handler did not respond. Check the Make execution history before trying again, in case it ran anyway.',
              true);
            return;
          }

          var why = payload.message ||
            'The approval handler refused the request. The most likely reason is that this link has already been used.';
          finish(false, 'Not accepted', why, payload.error === 'upstream_unavailable');
          return;
        }

        if (decision === 'approve') {
          finish(true, 'Approved',
            'The approval handler has it. ' + ACTIONS[action].meaning +
            ' You can close this tab.', false);
        } else {
          finish(true, 'Rejected',
            'The record is marked Rejected and nothing was sent to the lead. You can close this tab.', false);
        }
      })
      .catch(function (err) {
        clearTimeout(timeout);
        var msg = (err && err.name === 'AbortError')
          ? 'The approval handler did not answer within 20 seconds. Check the Make execution history before trying again, in case it did run.'
          : 'Could not reach the approval handler. Check your connection, then try again.';
        finish(false, 'Something went wrong', msg, true);
      });
  }

  el('btn-approve').addEventListener('click', function () { send('approve'); });
  el('btn-reject').addEventListener('click',  function () { send('reject'); });
  el('btn-retry').addEventListener('click',   function () { show('confirm'); });
})();
