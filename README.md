# AI Agent Workflows

An AI agent that decides what to do with an inbound enquiry, and then waits for a human before doing any of
it. A visitor submits a form, an agent built with Make's AI Agents reads it, scores it, picks one of five
actions and drafts a reply. Everything lands in Airtable. Then the workflow deliberately stops and posts to
Slack, and nothing reaches the sender until someone clicks Approve.

Three modes, chosen by the inquiry type on the form:

- **Lead qualification** — scores 0 to 100 on fit, intent, budget signals, urgency and company legitimacy,
  then categorises as hot, warm, cold or spam.
- **Support triage** — classifies as billing, technical, account or other, sets a priority, and escalates
  anything urgent, angry or legal rather than answering it.
- **Research** — scrapes one URL with Firecrawl and writes a five bullet brief, or says plainly that it could
  not retrieve the page.

The front end is plain HTML, CSS and JavaScript. No framework, no build step, no `package.json`.

**Live demo:** https://YOUR_VERCEL_DOMAIN
**Walkthrough video:** YOUR_DEMO_VIDEO_URL

---

## Architecture

```
Visitor
  → Vercel site (Jotform embed, behind a Turnstile check)
  → Jotform webhook, with a secret token in the query string
  → Make Scenario 1
        validate token → parse rawRequest → validate fields
        → create Airtable record → run the agent → parse its JSON
        → update the record → route by recommended action
        → post an approval message to Slack
  → you click Approve or Reject in Slack
  → approve.html on Vercel
  → /api/approve on Vercel  (holds the Make webhook URL, validates first)
  → Make Scenario 2
        verify the token matches and is unused → mark it used
        → send the Gmail reply → close the record
        → answer the browser with JSON and a CORS header
```

Exactly two Make scenarios, because the free plan allows two active. Error handling lives in error handler
routes inside them rather than in a third scenario.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | The marketing page and the live demo |
| `approve.html` | Slack approval confirmation page, noindex |
| `styles.css` | Design tokens, light and dark themes, all components |
| `script.js` | Theme, nav, flow animation, Turnstile gate, iframe resizer |
| `approve.js` | Query string validation and the POST to `/api/approve` |
| `api/verify-turnstile.js` | Serverless function, server side Turnstile siteverify |
| `api/approve.js` | Serverless function, forwards approval decisions to Make. Holds the webhook URL |
| `.env.example` | Every environment variable, and what deliberately is not one |
| `.gitignore` | Keeps a real `.env` out of the repository |
| `vercel.json` | Security headers and the noindex header on the approval page |
| `robots.txt` | Allows the site, disallows the approval page and the API |
| `assets/` | `favicon.svg`, `og-image.png` |
| `tests/` | Postman collection: the 18 specified payloads plus research, negative and approval tests |

## Local preview

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. The Turnstile gate detects that the site key is still a placeholder and shows
the form anyway with a visible note, so the page is workable before Cloudflare is set up.

To exercise `/api/verify-turnstile` locally you need the Vercel CLI:

```bash
npm i -g vercel
vercel dev
```

---

## Deploying to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, click **Add New**, then **Project**, and import the repository.
3. Framework preset: **Other**. Leave the build command empty. Set the output directory to the project root,
   or leave it blank. There is nothing to build.
4. Click **Deploy**. The first deploy takes under a minute.
5. Add both environment variables under **Settings**, then **Environment Variables**, for Production and
   Preview. `.env.example` documents them, and copying it to `.env.local` is what makes `vercel dev` work:

   | Name | Value |
   | --- | --- |
   | `TURNSTILE_SECRET_KEY` | The secret key from your Cloudflare Turnstile widget |
   | `MAKE_APPROVAL_WEBHOOK_URL` | The complete Make Scenario 2 webhook URL |

6. **Redeploy.** Vercel only picks up a changed environment variable on the next deployment. Until you do,
   `/api/verify-turnstile` returns `not_configured` and the form never unlocks, and `/api/approve` reports
   that it is not connected. This is the single most common setup mistake here.
7. Note your production domain. You need it for the Turnstile hostname list, the canonical and Open Graph
   tags, and the approval links inside Make Scenario 1.

### Verifying the deploy

```bash
# Should return 405 with an Allow: POST header
curl -i https://YOUR_VERCEL_DOMAIN/api/verify-turnstile

# Should return 400 and {"success":false,"error":"missing_token"}
curl -i -X POST https://YOUR_VERCEL_DOMAIN/api/verify-turnstile \
  -H "Content-Type: application/json" -d '{}'

# Should return 400 and {"status":"error","error":"bad_request"}, and reach Make not at all
curl -i -X POST https://YOUR_VERCEL_DOMAIN/api/approve \
  -H "Content-Type: application/json" -d '{"record":"nope"}'

# Should include X-Robots-Tag: noindex
curl -sI https://YOUR_VERCEL_DOMAIN/approve.html | grep -i robots
```

If any of them returns `not_configured`, go back to step 6.

---

## Setup order

Several values depend on others existing first. This order avoids backtracking:

1. **Airtable** base and Leads table, so you have the base id.
2. **Make Scenario 1** webhook, so you have a URL for Jotform.
3. **Jotform** form and webhook, using a secret token you invent now.
4. **Make Scenario 2** webhook, so you have a URL for `approve.js`.
5. **Vercel** deploy, so you have a domain.
6. **Cloudflare Turnstile**, which needs the domain from step 5.
7. Go back into the Slack module in Scenario 1 and paste the real domain into the approval links.

Step 7 is the one people forget. The Slack links cannot be finished until the site is live, so Scenario 1 is
the last thing you complete, not the first.

## Placeholders

Search the project for `YOUR_` and replace every hit.

**Safe in the front end, public by design.** Every one of these is a value the browser must have in order to
work, so it is readable by anyone who views source regardless of where you keep it. There is no build step
here, and even with one, substituting them from an env file would only make them harder for you to find while
leaving them exactly as public.

- `YOUR_JOTFORM_FORM_ID` — `index.html`, the iframe `data-src`
- `YOUR_TURNSTILE_SITE_KEY` — `index.html`, the `cf-turnstile` div. Cloudflare intends this one to be public
- `YOUR_VERCEL_DOMAIN` — canonical and Open Graph tags, which have to be literal text for crawlers
- `YOUR_PORTFOLIO_URL`, `YOUR_GITHUB_URL`, `YOUR_CONTACT_EMAIL`, `YOUR_BOOKING_LINK` — footer and FAQ
- `YOUR_DEMO_VIDEO_URL` — the case study video slot

**In the environment, never in the repository:** `TURNSTILE_SECRET_KEY` and `MAKE_APPROVAL_WEBHOOK_URL`. See
`.env.example`.

**In Make only:** the webhook token on Scenario 1, the Airtable personal access token, the Firecrawl key and
the Gmail connection. Nothing in this repository reads them, so nothing here needs to hold them.

---

## Credit usage

Make's free plan gives 1,000 credits a month. Credits are consumed per module operation, and the agent is
billed **one credit per operation plus credits for the tokens it uses** when running on Make's AI Provider.
Routers and filters cost nothing.

### Per submission

| Path | Scenario 1 | Scenario 2 | Total |
| --- | --- | --- | --- |
| Sales or support lead, approved and emailed | 8 modules + ~0.2 to 1.2 token credits | 6 | **≈ 14 to 15** |
| Research request, one scrape, approved | 8 modules + 1 tool call + ~0.6 to 2.9 token credits | 6 | **≈ 16 to 18** |
| Lead rejected in Slack | 8 + tokens | 4 | **≈ 12 to 13** |
| Escalated to a human, no email | 9 + tokens | — | **≈ 9 to 10** |
| Discarded as spam, never reaches Slack | 8 + tokens | — | **≈ 8 to 9** |

The token range is the gap between Make's Small tier and its Large tier. The system prompt is about 1,100
words and is resent on every run, so it is a meaningful share of each run's input cost.

### Per month

At a realistic mix, roughly **60 to 75 complete submissions a month**. Running the full Postman collection
costs around 300 credits on its own, so a month in which you also test thoroughly gets you closer to 50.

### Measure this, do not trust it

The table above is arithmetic from module counts, not a measurement. Published write-ups of agent workflows on
Make report figures as high as 43 to 50 credits per run, which would put the real capacity nearer 20 a month.
That figure may reflect a different scenario shape, a different model tier, or a different billing period.

**Run one real submission, open the execution in Make's History, and read the credit count on the row.** Then
divide 1,000 by it. That number is the one to put in your case study, and it is the only one worth planning
around.

### Keeping it down

- The hard cap of three tool calls, set in the agent's configuration, is the only enforcement that holds if
  the model ignores its prompt. After a few real runs, count the actual tool calls and lower it to match.
- Firecrawl runs once per submission and only when a website was given.
- The validation filters sit before the Airtable create, so junk submissions cost one credit rather than nine.
- Discarded leads skip Scenario 2 entirely.

---

## Tests

`tests/AI-Agent-Workflows.postman_collection.json` imports into Postman as nine folders and 38 requests: the
18 specified payloads, plus three research requests, five negative tests, six against the approval handler
and six against the site's own functions.

Fill in every value on the collection's Variables tab first. The seven `q` variables are the `rawRequest` key
names Jotform generated for your form, which you read off a real submission in Make's execution history. They
are not predictable, and the defaults in the file are a plausible guess, not your form.

**Scenario 1 requests assert delivery only.** That scenario has no Webhook response module, so Make answers
`Accepted` whether the token filter passed or stopped the run. Each request's description says what to check
in Airtable and Make's history instead. Scenario 2 does answer through response modules, so those requests
assert status codes, CORS headers and bodies properly.

```bash
npm i -g newman
newman run tests/AI-Agent-Workflows.postman_collection.json \
  -e your-environment.json \
  --folder "8 · Scenario 2, approval handler"
```

Folder 8 is the cheap regression check after any edit to Scenario 2: full assertions, about 10 credits.

---

## Troubleshooting

### Setup and deployment

| Symptom | Cause |
| --- | --- |
| `/api/verify-turnstile` returns `not_configured` | `TURNSTILE_SECRET_KEY` is set but you have not redeployed since. |
| The form never appears, no error shown | Turnstile failed to load. Check an ad blocker, and check your domain is in the widget's hostname list. |
| Turnstile passes but the server rejects it | You are mixing a test site key with a production secret, or the reverse. They have to be swapped as a pair. |
| The form is a white rectangle in dark mode | The Jotform page background is not transparent. Set it in Jotform's Form Designer. |
| The iframe is cut off at the bottom | Jotform's `setHeight` message is not arriving. The CSS `min-height` is the fallback; check the browser console for a blocked message. |

### Make Scenario 1

| Symptom | Cause |
| --- | --- |
| Every field empty in module 3 | The `q` key names are wrong. Read them off a real submission rather than guessing. |
| The agent reasons about a blank message | Module 2 parsed fine, but `qMessage` points at the wrong key. |
| Module 6 fails on JSON that looks valid | The agent wrapped it in a markdown fence. Tighten the OUTPUT section of the system prompt. |
| A submission vanishes with no record and no alert | Module 2 failed to parse `rawRequest` and has no error handler. Add one: a Slack alert carrying `{{1.rawRequest}}`, then an Ignore directive. |
| Slack links 404 | `YOUR_VERCEL_DOMAIN` is still a placeholder in the Slack module. |
| Nothing happens at all | The token filter is stopping the run. Check the Jotform webhook URL still has `?token=` on it. |

### Make Scenario 2 and the approval page

| Symptom | Cause |
| --- | --- |
| "The approval handler is not connected" | `MAKE_APPROVAL_WEBHOOK_URL` is not set, or was set without a redeploy. |
| "That approval link is malformed" | `/api/approve` rejected the shape. Nothing reached Make. Check the four query parameters in the Slack link. |
| The page spins, then "No answer in time" | A Scenario 2 route reached its end without a Webhook response module. Every route needs one, error handler routes included. |
| Consistent timeouts on a slow Gmail send | The function waits 25 seconds, but the platform may cut it shorter on your plan. If so, add a `functions` entry in `vercel.json` raising `maxDuration` for `api/approve.js`, if your plan allows it. |
| "accepted the request but did not confirm" | Make answered the plain string `Accepted`, meaning execution never reached a Webhook response module on that route. |
| A valid link is refused | The token was already used, or Token Used was never reset after a previous test. |
| The reply never arrives | Check Status. If it says Approved rather than Sent, Gmail failed after the token was marked used. The error handler should have told you in Slack. |

### Budget

| Symptom | Cause |
| --- | --- |
| Everything stops working near the end of the month | The 1,000 credits are spent. Check Make's usage page before assuming a bug. |
| Credits disappearing with no submissions | Something is probing the webhook URL. Each probe fires the webhook before the token filter stops it. Rotate the token if it is severe. |

---

## Security

Six layers, each covering a gap in the one above:

1. **Cloudflare Turnstile** on the page, verified server side before the form is revealed.
2. **Jotform's CAPTCHA** on the form itself.
3. **A secret token** on the Scenario 1 webhook.
4. **Validation filters** in Make, before any credit is spent on the agent.
5. **The agent's own spam and injection classification.**
6. **Human approval in Slack**, which stops everything the rest let through.

### An honest note about Turnstile

The widget on this page is verified **server side** by `/api/verify-turnstile` before the form is revealed,
which is the correct way to do it and which stops casual bots and scripted scrapers.

It does not fully protect the form. The form is a Jotform iframe with its own public URL, so a determined bot
can post to Jotform directly and never load this page at all. Layers 2 and 3 are what actually cover that gap.

**The stronger alternative** is to drop the iframe and build a custom form in `index.html` that posts to a
serverless function, which verifies the Turnstile token and only then forwards the submission to Make. One
code path, real server side gating, full control of styling. The cost is losing Jotform's builder, its
submission storage and its dashboard. For a portfolio demo that showcases Jotform as part of the stack, the
iframe is the right trade. For a form collecting real business leads, the custom form is.

### Approval links

Each submission gets a random token stored on its Airtable record. Scenario 2 checks that the token matches
that record and has not been used, then marks it used **before** sending, so two fast clicks cannot send two
emails. `approve.js` validates the record id, action and token against strict patterns before rendering
anything, and writes every value to the page with `textContent` rather than `innerHTML`, because that page
reads directly from the URL bar. `/api/approve` validates the same four fields again server side, where the
browser cannot skip the check.

### Why the approval POST goes through a function

The browser used to post straight at the Make webhook, which meant that URL had to be in `approve.js` for
anyone to read. It carries no authentication of its own, so a URL on the page is an endpoint strangers can
fire at, and every request that reaches a Make webhook costs a credit even when a filter stops the run.

`/api/approve` holds the URL in an environment variable instead, and rejects a malformed payload before
forwarding anything. Three things follow:

- The webhook URL is no longer public.
- There is no cross origin request left, so **CORS no longer applies to this flow at all**. The
  `Access-Control-Allow-Origin` headers on Scenario 2's response modules become inert rather than wrong, so
  leave them: they cost nothing and they keep the direct path working if you ever want it back.
- Preview deployments now work. Each preview has its own hostname, which used to break the CORS match.

Note that CORS was never the thing protecting the webhook anyway. It controls whether a calling page may
**read** a response, not whether the request arrives. The single use token is the protection.

### Content Security Policy

`vercel.json` sets a restrictive CSP. Two things to know if you change the pages:

- `script-src` includes `'unsafe-inline'` because both pages carry a small inline script that sets the theme
  before first paint. Removing that script lets you drop `'unsafe-inline'`, at the cost of a colour flash.
- `connect-src` is `'self'` only. The browser talks to this site's own functions and nothing else. If you
  revert to posting directly at Make, add `https://*.make.com` back.

---

## Known limits

- **The free plan is a demo budget.** Roughly 60 to 75 complete submissions a month, and you should measure
  rather than take that number from this file.
- **Turnstile on an embedded form is partial protection.** Explained above.
- **The agent's judgement needs watching.** A research request whose scrape fails is the dangerous case: an
  invented company brief raises no error anywhere, nothing turns red, and the output reads perfectly well. The
  `tests/` collection includes a dead URL specifically to catch this.
- **Slack's free plan limits message history.** Approval links live in Slack messages, so a link whose message
  has aged out is unreachable even though its token is still valid in Airtable.
- **Vercel's Hobby plan is for non commercial use.** A portfolio demo is fine. Pointing this at real paying
  client leads is arguably not.
- **The approval function has no rate limit.** It validates shape and rejects junk for free, but a determined
  caller sending well formed junk still reaches Make and still costs a credit per request. Rate limiting needs
  somewhere to keep state, which the Hobby plan does not give you. If this ever matters, the signal to watch
  is unexplained executions in Make's history.

## Accessibility and performance

Semantic landmarks, a skip link, visible focus rings, `aria-pressed` on the theme toggle and `aria-expanded`
on the mobile menu. All motion is disabled under `prefers-reduced-motion`. Two web font families loaded with
`display=swap`. No analytics, no tracking, no cookies beyond a single `localStorage` theme preference.

---

Built by Roi Vincent P. Solar · [Portfolio](YOUR_PORTFOLIO_URL) · [GitHub](YOUR_GITHUB_URL)
