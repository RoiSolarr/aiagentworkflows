/* ============================================================
   /api/verify-turnstile — Vercel serverless function.

   The browser sends the Turnstile token here; this function checks
   it against Cloudflare using the secret key, which lives only in a
   Vercel environment variable and never reaches the client.

   CommonJS on purpose: the project has no package.json, so Vercel's
   Node runtime treats .js files as CommonJS. Node 18+ on Vercel
   provides a global fetch.

   Environment variable required:
     TURNSTILE_SECRET_KEY
   ============================================================ */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Fail closed. A missing secret is a deployment mistake, not a reason
    // to wave visitors through.
    console.error('TURNSTILE_SECRET_KEY is not set in the environment.');
    return res.status(500).json({ success: false, error: 'not_configured' });
  }

  // Vercel parses JSON bodies automatically, but be tolerant of a raw string.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  const token = body && typeof body.token === 'string' ? body.token : '';
  if (!token || token.length > 2048) {
    return res.status(400).json({ success: false, error: 'missing_token' });
  }

  // Cloudflare recommends passing the client IP when it is available.
  const forwarded = req.headers['x-forwarded-for'];
  const remoteip = Array.isArray(forwarded)
    ? forwarded[0]
    : (forwarded || '').split(',')[0].trim();

  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteip) form.append('remoteip', remoteip);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const cfRes = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal
    });

    clearTimeout(timer);

    const data = await cfRes.json();

    if (data.success) {
      return res.status(200).json({ success: true });
    }

    // Surface the codes for debugging but never the secret or the raw token.
    console.warn('Turnstile verification failed:', data['error-codes']);
    return res.status(200).json({
      success: false,
      error: 'verification_failed',
      codes: data['error-codes'] || []
    });
  } catch (err) {
    console.error('Turnstile siteverify request failed:', err && err.message);
    return res.status(502).json({ success: false, error: 'upstream_unavailable' });
  }
};
