/* ============================================================
   /api/approve — Vercel serverless function.

   The browser used to POST the approval decision straight at the
   Make Scenario 2 webhook, which meant that webhook URL had to sit
   in approve.js where anyone could read it and post to it. This
   function takes its place: the browser calls this same-origin
   endpoint, and the Make URL lives only in an environment variable.

   Three things fall out of that:

     1. The webhook URL is no longer public.
     2. There is no cross origin request left, so no CORS and no
        preflight question at all. The headers on Scenario 2 become
        inert rather than wrong, so nothing you already built breaks.
     3. Junk is rejected here, before it reaches Make. Every request
        that reaches a Make webhook costs a credit even when a filter
        stops the run, so validating first is a budget decision as
        much as a security one.

   Environment variable required:
     MAKE_APPROVAL_WEBHOOK_URL
   ============================================================ */

const ACTIONS = new Set([
  'book_call',
  'send_reply',
  'request_more_info',
  'escalate_to_human',
  'discard'
]);

const DECISIONS = new Set(['approve', 'reject']);

const RE_RECORD = /^rec[A-Za-z0-9]{12,20}$/;
const RE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

// Make's webhook holds the connection open until the scenario reaches a
// Webhook response module. Scenario 2 is quick, but Gmail can be slow.
const UPSTREAM_TIMEOUT_MS = 25000;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ status: 'error', error: 'method_not_allowed' });
  }

  const webhook = process.env.MAKE_APPROVAL_WEBHOOK_URL;
  if (!webhook) {
    console.error('MAKE_APPROVAL_WEBHOOK_URL is not set in the environment.');
    return res.status(500).json({
      status: 'error',
      error: 'not_configured',
      message: 'This site is not finished being set up. The approval handler is not connected yet.'
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};

  const record = typeof body.record === 'string' ? body.record : '';
  const action = typeof body.action === 'string' ? body.action : '';
  const token = typeof body.token === 'string' ? body.token : '';
  const decision = typeof body.decision === 'string' ? body.decision : '';

  // Fail here rather than spending a credit proving it in Make.
  if (!RE_RECORD.test(record) || !ACTIONS.has(action) ||
      !RE_TOKEN.test(token) || !DECISIONS.has(decision)) {
    return res.status(400).json({
      status: 'error',
      error: 'bad_request',
      message: 'That approval link is malformed.'
    });
  }

  // Forwarded form encoded, because Scenario 2's webhook was taught that
  // shape. Changing it here would mean re-determining the data structure
  // in Make for no benefit.
  const form = new URLSearchParams({ record, action, token, decision });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    const upstream = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal
    });

    clearTimeout(timer);

    const text = await upstream.text();

    // Scenario 2 answers with JSON from its Webhook response modules. If a
    // route is missing one, Make answers the plain string "Accepted"
    // instead, so say that plainly rather than showing a bare success.
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      payload = {
        status: upstream.ok ? 'ok' : 'error',
        message: upstream.ok
          ? 'The approval handler accepted the request but did not confirm what it did. Check the Make execution history.'
          : 'The approval handler refused the request.'
      };
    }

    return res.status(upstream.status).json(payload);
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    console.error('Approval forward failed:', err && err.message);
    return res.status(aborted ? 504 : 502).json({
      status: 'error',
      error: aborted ? 'upstream_timeout' : 'upstream_unavailable',
      message: aborted
        ? 'The approval handler did not answer in time. Check the Make execution history before retrying, in case it did run.'
        : 'Could not reach the approval handler.'
    });
  }
};
