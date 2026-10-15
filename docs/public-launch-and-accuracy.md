# StockAI public launch: verified accounts & measurable forward outcomes

## What this release actually provides

- Opt-in public registration, with email verification before login.
- Separate account-scoped holdings, watchlists and forward-signal journals.
- Basic IP login/signup/recovery/provider throttling. These are **single-server
  limits**, not a substitute for shared rate limits or bot/abuse defenses.
- A **Forward Signal Journal**: the server independently recomputes the
  deterministic rule-based indicator signal from verified Yahoo-backed daily
  candles; ignores client-supplied signal/score. Saves an immutable timestamped
  observation per user, per symbol, per daily close, per rule version.
- To prevent hindsight, save is permitted **before 9 AM ET or after 6 PM ET** (or weekends). From 9 AM to 6 PM ET on weekdays the server refuses to backdate a signal. After 6 PM it requires the completed daily bar for that day. This conservative schedule can reject late or holiday data rather than claiming false accuracy.
- Upon viewing the journal in a later session, matures any pending prediction
  when at least **five future completed trading sessions** of candles exist.
  It measures entry at next session's open and exit at session five's close;
  uncompleted same-day candles do not count.
- Stores the actual dated outcome, performance per user, and **only displays
  a directional hit rate after 30 resolved non-neutral signals**. Before then
  the interface explicitly says **Not enough data**.
- Charts and signals are informational. This is not broker order execution
  or a guaranteed or calibrated machine-learning forecast.

**Important:** This does not magically make the predictor accurate. The
current engine is hand-coded RSI/MACD/MA/momentum technical rules. It has no
externally validated out-of-sample accuracy. The historical Signal Check is
exploratory, and your forward signal journal is intentionally evaluated only
from data that arrived after the signal was saved. Even after 30 observations,
selection bias, overlapping signal samples, market regimes, stock splits,
dividends, bid/ask spreads, fees, tax, and slippage remain limitations.
Do not advertise the resulting hit rate as a guaranteed future probability.

## One-website rollout: keep `stockai-main.onrender.com`

You said `stockai-main.onrender.com` is the **only** StockAI website, so
there is no need to require a second deployment. This code adds an **explicit,
reversible single-service launch switch**. Your existing owner's MongoDB
`_id`, JWT secret, login, private holdings, watchlist and prediction journal
are not migrated or erased.

**Before turning public on:** back up the database, resolve the security
findings in Issue #9, confirm the market-data vendor permits the intended
public use, verify email sender/delivery, and smoke-test data isolation for
at least two independent accounts. CI alone is NOT a production audit.

**Stage 1 — deploy this PR with default settings:**

- Keep `ALLOWED_EMAIL`, `SITE_PASSWORD`, `MONGO_URI`, `JWT_SECRET` and
  any existing private owner settings **unchanged**.
- Set `PUBLIC_SITE_ENABLED=false` (or omit it). All existing private rules
  remain active. Setting `PUBLIC_SIGNUPS_ENABLED=true` alone CANNOT open
  the site.
- Verify the current owner can still sign in and their saved portfolio loads.

**Stage 2 — prepare public signups on the same Render service:**

- Set `OWNER_EMAIL` to your **existing** account's email. Keep
  `ALLOWED_EMAIL` unchanged: it remains the owner's legacy identity in
  private mode and is **not** an access restriction when public mode is on.
- Set `SITE_URL=https://stockai-main.onrender.com`.
- Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` with a sender domain
  verified for sending to arbitrary external addresses.
- Test delivery using provider-native tools; never put API keys in GitHub,
  chat or screenshots.

**Stage 3 — controlled switch, after security and end-to-end testing:**

- In Render Environment, set `PUBLIC_SITE_ENABLED=true` to open the *pages*
  and allow public users to log in. This bypasses the old `SITE_PASSWORD`
  Basic Auth popup for HTML pages. The Basic Auth secret remains configured
  but is inactive while the explicit public switch is on.
- Set `PUBLIC_SIGNUPS_ENABLED=true` only when verified delivery works.
  The site **does not** issue login sessions to new accounts until they
  verify email.
- Check `/api/auth/config`: it should show `mode:"public"`,
  `registrationOpen:true`.
- Public accounts cannot sign up with `OWNER_EMAIL`; owner-only API routes
  continue to check the owner email in the verified MongoDB user record.
- Test with two independently verified emails in different browsers.
  Confirm private portfolios, watchlists and journals do not cross accounts,
  and a non-owner cannot reach private admin alert-testing routes.

**Rollback:** set `PUBLIC_SITE_ENABLED=false` and redeploy. The personal
allowlist and old site password will again protect the site; the public
accounts stay safely in MongoDB but cannot login until reopening. Do not
delete public MongoDB records during rollback. Do not change the old JWT
secret during this rollout.

**Operational note:** this is a staged path, not an instruction to flip the
switch today. Opening this one domain publicly exposes the same deployment
to public traffic. Budget for upgrades, robust throttling and security
hardening as soon as public demand increases.

## Alternative: separate public service (not required)

If traffic grows, a dedicated public service/database is safer for isolation.
Follow the separate-service template below when needed, not as a prerequisite
for today's one-website design.

## Do NOT expose the private owner site by simply deleting its settings

Your existing `stockai-main.onrender.com` uses `ALLOWED_EMAIL` and potentially
`SITE_PASSWORD`. Your existing MongoDB data and restored owner login must be
preserved. **The application changes in this PR do not alter Render settings
or make the old instance public.**

Recommended deployment:

1. **Deploy a separate Render web service**, e.g. `stockai-public`, from
   the same GitHub main branch. Use `render-public.yaml` as the template or
   set its environment values manually. This may have additional costs.
2. Use a **different MongoDB database name** (it can be on the same Atlas
   cluster) and a **new random JWT_SECRET** distinct from the private
   service's. Do not reuse private user credentials or transfer passwords.
3. On the public service, do **not** set `ALLOWED_EMAIL`,
   `SITE_PASSWORD`, or `OWNER_SETUP_KEY`.
4. Configure `SITE_URL` to the exact HTTPS origin of the site's pages
   (no final slash or path), e.g. its new Render domain.
5. Configure `RESEND_API_KEY` and `RESEND_FROM_EMAIL` using a
   **verified sending domain** that is permitted to send to any registrant.
   A free trial/onboarding sender may only send to the owner and is not
   sufficient for public registration.
6. Test registration on a **test** account, delivery to that email,
   verification, login, separate watchlist/holding storage, logout and
   password recovery. Test that a second user's JWT cannot fetch or alter
   the first user's portfolio or signal journal.
7. Only after that, set `PUBLIC_SIGNUPS_ENABLED=true` on the **public**
   service and redeploy. Its `/api/auth/config` should report:
   `mode:"public"`, `registrationOpen:true`.
8. If you also use a separate **Netlify** frontend, **update both**
   `/api/*` and `/ws` proxy destinations in `netlify.toml` to the
   **new public Render URL**, then redeploy Netlify. That file currently
   proxies to private `stockai-main.onrender.com`, which will block
   everyone except the owner. Do **not** blindly merge a guessed domain.
   The public Render site can serve both API and frontend without Netlify.
9. Keep private StockAI untouched, including its `ALLOWED_EMAIL` and
   existing database. Make a MongoDB backup before inviting people.

If `PUBLIC_SIGNUPS_ENABLED` is omitted or false, or the mail service is
missing/misconfigured, registration fails closed; existing accounts can still
log in. Accounts created via verified public registration **cannot log in**
until the one-time, 24-hour emailed token is used. A resend flow is available
at `/verify-email.html`. Password reset remains available with Resend.

### Practical quality gates before public advertisement

- Recheck real Yahoo/Finnhub terms, redistribution/display rights and
  whether data is delayed. The Yahoo historical endpoint in this project is
  unofficial, so availability and permissions cannot be guaranteed.
- Review Node dependency vulnerabilities, run CI + E2E tests, inspect rate
  limits/costs and add production-grade distributed limiting/captcha if
  public abuse warrants it.
- Review app terms, privacy policy, cookie/storage behavior and account
  erasure/export behavior. Existing recovery and token storage need a
  dedicated browser-security audit for broad public launch.
- Eventually train, calibrate and validate any genuinely predictive ML model
  against later untouched data, always include strong baselines (buy-and-hold,
  direction-only, no-change), and publish uncertainty plus failures. A label
  reading `AI` is not evidence that a model learns from prices.
- Keep business logic/model versions immutable for settled forward records.
  If the seven-indicator rules change, bump `MODEL_VERSION` in
  `forwardTracking.js` instead of silently comparing new signals with
  old outcomes.

## Local validation

```bash
npm ci
npm test
```

After merging, verify private StockAI still works. The public site is **not
live until you provision/configure it** as above.
