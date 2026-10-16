# StockAI — AI-Powered Stock Market Platform

A full-stack real-time stock market dashboard with AI analysis, automated alerts, and live price feeds.

**Live Demo:** [stockai-main.onrender.com](https://stockai-main.onrender.com)

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green) ![Claude AI](https://img.shields.io/badge/Claude-AI-orange) ![Finnhub](https://img.shields.io/badge/Finnhub-WebSocket-blue)

---

## Features

### Real-Time Market Data
- Historical OHLCV for charts and stock/ETF alert scans now uses Yahoo Finance chart data
  (through a server-side adapter), because Finnhub's `/stock/candle` can return HTTP 403
  for subscriptions without candle access.
- Finnhub remains in place for quotes, profiles, IPOs, and the live WebSocket feed.
- The Yahoo chart endpoint is unofficial and can be rate-limited or change.
  If historical data is unavailable, the API returns an error rather than
  fabricating OHLCV candles. Use a licensed historical-data provider for production.
- Live price feeds via Finnhub WebSocket for stocks, ETFs, and crypto
- Interactive candlestick charts with volume overlays
- Real-time price tickers with % change indicators

### AI-Powered Analysis
- **Technical Analysis Engine** — RSI, MACD, Bollinger Bands, SMA 50/200, Stochastic, OBV, Momentum
- **Claude AI Integration** — Natural language market analysis via Anthropic's Claude Haiku
- Golden Cross / Death Cross detection
- Candlestick pattern recognition (Hammer, Engulfing, Doji, Morning Star, etc.)

### Automated Alert Engine
- Scans **20 stocks + 10 ETFs** every 30 min during market hours (Mon–Fri)
- Scans **8 crypto pairs** (BTC, ETH, SOL, XRP, BNB, DOGE, AVAX, LINK) every 2 hours, 24/7
- Monitors **upcoming IPOs** within a 7-day window
- Sends **email + SMS alerts** for:
  - Strong Buy / Sell signals (75%+ confidence, 4+ indicators agreeing)
  - Golden Cross / Death Cross events
  - Major movers (5%+ daily move)
  - New IPO launches
- Deduplication via MongoDB — no repeat alerts within 24 hours

### Portfolio Management
- Track holdings across stocks, ETFs, and crypto
- Real-time P&L calculation
- Persistent watchlist management

### Public-launch hardening (security review required)

The Render backend serves only allowlisted StockAI HTML pages and frontend assets;
it no longer exposes files such as `server.js`, `package-lock.json`,
`accountRoutes.js`, `render.yaml` or files under `tests/` over HTTP.
Security response headers add clickjacking protection, MIME sniffing prevention,
safer referrers, and no-store API response defaults. Market WebSocket clients
are capped at 100 connections, 12 subscribed symbols per browser, and 60
shared upstream symbols. Finnhub REST symbol parameters are normalized and
URL-encoded, and upstream requests have a timeout.

**These are targeted improvements, not a claim that StockAI is secure for
arbitrary public traffic.** The GitHub CI workflow now logs and archives an
`npm audit --omit=dev` report of production dependencies. Existing full
`npm ci` logs previously reported 14 advisories including critical ones;
the affected runtime packages and exploitability must be reviewed. Production
Render blueprints use `npm ci --omit=dev` so Android/dev tools aren't deployed
to the Node web service. That does not fix vulnerabilities in runtime
dependencies, and the full CI suite still installs dev packages.

Before setting `PUBLIC_SITE_ENABLED=true` and
`PUBLIC_SIGNUPS_ENABLED=true`, review the audit, test account isolation,
email verification and recovery, and real market-data provider licensing.
**Keep your existing Render owner restriction and credentials unchanged until
the launch checklist is completed.**

### Security
- JWT authentication (30-day tokens)
- Bcrypt password hashing
- Optional private-mode: HTTP Basic Auth gate + email allowlist
- All API keys server-side only, never exposed to the frontend

### Progressive Web App
- Service worker caching for offline support
- Installable on Android via Capacitor
- Responsive design for mobile and desktop

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js, Express.js |
| **Database** | MongoDB Atlas + Mongoose |
| **Authentication** | JWT + Bcrypt |
| **Real-time** | WebSocket (Finnhub) + ws library |
| **AI Analysis** | Anthropic Claude API (claude-haiku-4-5) |
| **Market Data** | Finnhub API |
| **Alerts** | Nodemailer (Gmail SMTP) + Twilio SMS |
| **Scheduling** | node-cron |
| **Mobile** | Capacitor (Android/iOS) |
| **Hosting** | Render.com |

---

## Getting Started

### Prerequisites
- Node.js 20.19+ (Node.js 22 recommended; required by Mongoose 9)
- MongoDB Atlas account (free tier works)
- Finnhub API key (free at [finnhub.io](https://finnhub.io))

### Installation

```bash
git clone https://github.com/Jeet-Bharucha/StockAi.git
cd StockAi
npm install
cp .env.example .env
# Fill in your keys in .env
npm start
```

Open [http://localhost:3001](http://localhost:3001)

---

## Configuration

| Variable | Required | Description |
|---|---|---|
| `FINNHUB_KEY` | Yes | From [finnhub.io/dashboard](https://finnhub.io/dashboard) (free) |
| `MONGO_URI` | Yes | MongoDB Atlas connection string |
| `JWT_SECRET` | Yes | Any long random string |
| `ANTHROPIC_API_KEY` | No | Enables Claude AI analysis |
| `ALERT_GMAIL_USER` | No | Gmail address to send alerts from |
| `ALERT_GMAIL_PASS` | No | Gmail App Password (16 chars) |
| `ALERT_EMAIL_TO` | No | Where to receive alerts |
| `SITE_PASSWORD` | No | HTTP Basic Auth gate (private mode) |
| `ALLOWED_EMAIL` | Private only | Restrict login to the owner's email (private mode) |
| `OWNER_SETUP_KEY` | Private initial signup | Temporary random secret (24+ bytes) required to create the private owner's first MongoDB account |
| `SITE_URL` | Password recovery | Exact https:// origin of the deployment's login pages (no path) |
| `RESEND_FROM_EMAIL` | Password recovery | Verified email sender address in Resend; use with RESEND_API_KEY |
| `RESEND_API_KEY` | Password recovery | Resend API key; keep private in the host environment |

---

## Alert System

The automated engine scans all watchlist symbols on a cron schedule and sends notifications when strong signals are detected.

**Default watchlist:** AAPL, MSFT, NVDA, TSLA, AMZN, GOOGL, META, AMD, NFLX, JPM, V, PLTR + SPY, QQQ, ARKK, GLD + BTC, ETH, SOL, XRP, BNB, DOGE, AVAX, LINK

Edit `WATCHLIST` in `alertEngine.js` to customise.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Client (Browser)                      │
│         HTML/CSS/JS  ←→  WebSocket  ←→  REST API        │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   Express Server                         │
│  Auth (JWT)  │  Finnhub WS  │  Alert Engine (cron)      │
└──────────┬───────────────────────┬──────────────────────┘
           │                       │
┌──────────▼──────┐    ┌───────────▼──────────────────────┐
│  MongoDB Atlas  │    │  External APIs                    │
│  Users          │    │  Finnhub — prices, IPOs           │
│  Holdings       │    │  Claude AI — market analysis      │
│  Alert Logs     │    │  Gmail SMTP — email/SMS alerts    │
└─────────────────┘    └──────────────────────────────────┘
```

---

## Deployment and login troubleshooting

The Express backend is expected at `https://stockai-main.onrender.com`. It handles
`/api/auth/login` and connects to MongoDB Atlas. **Static hosting alone cannot
authenticate users.** If you serve the HTML on Netlify, `netlify.toml` proxies
`/api/*` requests to that Render backend. When the Render service is missing,
suspended, or renamed, the Netlify site can still load but sign-in will fail.

### Check the existing service before creating another

1. Open `https://stockai-main.onrender.com/ping`. A plain `ok` means Node is
   running, **not** that login can access the database.
2. Open `https://stockai-main.onrender.com/api/health`. Expect HTTP 200 with
   `{"service":"stockai","ok":true,"database":"connected"}`. A JSON HTTP 503
   means the backend is running but MongoDB is not ready. HTML, 404, or DNS
   errors mean the backend/deployment or proxy needs attention.
3. In the existing Render service, review **Events** and **Logs**, then check
   **Environment** for `MONGO_URI`, `JWT_SECRET`, and `FINNHUB_KEY`.
   Verify MongoDB Atlas is active, credentials are still valid, and its
   Network Access rules permit the Render service. Do **not** post these
   secrets publicly or commit them in Git.
4. If the service is gone, recreate it using `render.yaml` or deploy a Node
   web service with Build `npm ci`, Start `npm start`, and Node 22.
   Enter secret values privately in Render. **Use the original MongoDB Atlas
   database to keep existing accounts and portfolios.** A brand-new database
   cannot contain your old users.
5. If the Render hostname changes, update the `/api/*` target in
   `netlify.toml` and redeploy Netlify. Its frontend and backend must point
   at the same active API. For a direct Render deployment no proxy is needed.
6. Run `npm test` to verify the login transport error handling. The login
   and registration pages now show API/database readiness with a **Retry**
   control. A fresh service worker takes precedence over old cached pages.

The `/ping` route is for liveness monitoring; `/api/health` is the database
readiness check. Optional UptimeRobot checks can use `/ping` to keep a free
service warm when allowed by the hosting plan.

---

## Single-website public beta (preserves existing owner account)

No second domain is required. Leave `PUBLIC_SITE_ENABLED=false` while testing: this preserves the original owner-only StockAI deployment. A deliberate `PUBLIC_SITE_ENABLED=true` switch allows public account logins on the **same** service, without clearing `ALLOWED_EMAIL` or replacing your database/JWT secret. Public registration separately requires `PUBLIC_SIGNUPS_ENABLED=true` and verified Resend email. **Do not enable a public launch until security, vendor rights and account-isolation checks are complete.** See [single-website rollout instructions](docs/public-launch-and-accuracy.md#one-website-rollout-keep-stockai-mainonrendercom).

## StockAI Research Workspace refinements

The main tabs now support practical, **provider-verified** research instead
of generic static demo cards:

- **Dashboard:** market ETF snapshot, tracked-symbol search, technical
  indicators and a concise latest-available price chart.
- **Technical Signals:** deterministic indicator explanations are free and
  shown by default. Optional Claude commentary is only requested when the
  user clicks **Explain with AI** (reduces accidental API costs); current
  signal evidence/history and forward journal remain separate.
- **Watchlist:** account-persisted symbols with verified quote coverage,
  A–Z/gainer/decliner/largest-move sorting and actionable network errors.
  Invalid/unavailable symbols are never shown as valid zero-move quotes.
  To protect market API quotas, at most 30 saved symbols are fetched per visit.
- **Portfolio:** symbol concentration, top-three allocation and live-quote
  coverage. Estimated weights are marked when some positions use cost basis.
  This is **not** a real historical portfolio return or a trading suggestion.
- **Markets:** sector ETF sampling and verified up/down/unchanged counts,
  leaders, laggards and unweighted sample session move (not total market
  breadth).
- **News:** recent, deduplicated provider headlines, manual refresh,
  direct original publisher links and explicit unavailable states.
- **Stock Movers (formerly Trending):** ranked **curated** movers by real
  latest-available session price change, not fabricated internet trends.
- **Screener:** curated, capped per-run universe with accurate taxonomy,
  quote coverage, missing-data states, sector/price/RSI/cap filters, sorting,
  and formula-safe CSV export. Scans up to 30 names at a time, not every
  listed security or live exchange universe.
- **Price Alerts:** remain MongoDB-backed, with actual provider checks while
  StockAI is open—not guaranteed background monitoring.

UI and API work can still fail when Finnhub/Yahoo providers are unavailable
or delayed. No numeric prediction accuracy is claimed without forward evidence.
All existing private owner/public feature flags, MongoDB accounts and
portfolio records are unchanged by this research UI release.

## MongoDB-saved price alerts

Price alerts now persist in MongoDB under the authenticated user's ID and can
be viewed from another device. Previous browser-local alerts are offered for
one-time import when the API is available; browser copies are preserved if
import fails. A server-verified quote with a provider timestamp is required
before an alert can be marked triggered. Once triggered, an alert is resolved
atomically and won't fire twice. Users can delete alerts individually or
clear them with their account data.

**This is NOT unattended 24/7 price monitoring.** The signed-in dashboard
checks outstanding alerts when opened and approximately every two minutes
while the page remains visible and online. The free Render service can
sleep; there are no guaranteed background checks, push delivery, or emails
while the user is offline. Price feeds may be delayed or temporarily
unavailable, in which case no alert is falsely reported as triggered.
Real background alert delivery requires a separately budgeted always-on
worker/cron service, provider licensing, email/push opt-in and monitoring.
Per-account checks use a bounded number of unique symbols per request.

## Public beta and forward-verified signal performance

For verified public email accounts and timestamped, genuinely forward-measured technical signals, see **[Public launch & accuracy guide](docs/public-launch-and-accuracy.md)**. The original owner deployment remains private. This release adds opt-in public signup and a five-session forward signal journal, but does not claim the existing seven-indicator algorithm has a scientifically established prediction accuracy.

## Owner login versus public user login

**Do not point a public Netlify website at the private Render backend.**
The existing `netlify.toml` proxies public frontend API requests to
`https://stockai-main.onrender.com`, which is the private backend if it has
`ALLOWED_EMAIL` set. In that configuration, **every other user's login is denied
even when their password is right**.

For two actual websites, deploy the *same GitHub repository* to two independent
backend services (both can use MongoDB Atlas but must use their own secrets):

| Setting | Private Render backend | Public Render backend |
|---|---|---|
| `SITE_PASSWORD` | Set a strong owner-only Basic Auth password | Unset |
| `ALLOWED_EMAIL` | Set your exact MongoDB account email | Unset |
| `JWT_SECRET` | Strong unique random string | Different strong random string |
| `MONGO_URI` | Use existing database to preserve your account | May share Atlas with userId isolation |
| `SITE_URL` | The private service HTTPS origin | The public website's HTTPS origin |

**On Netlify**, replace the URLs in `netlify.toml`'s `/api/*` and `/ws`
redirects with the **public** Render backend URL. Do not point these at the
private instance. Redeploy Netlify after that change. Each site will display
its effective `/api/auth/config` mode as private or public.

### Recover private owner login without losing MongoDB portfolios

If `/login.html` reports that the email/password was not recognized but
`/api/health` reports MongoDB connected:

1. **Do not delete your MongoDB database, user collection or portfolio** to
   solve a password mismatch. The private owner email is controlled by the
   `ALLOWED_EMAIL` setting.
2. In Render → StockAI (Main) → Environment, set a **temporary**
   `OWNER_SETUP_KEY` containing **at least 32 random bytes** (64 random hex
   characters is convenient). This is a different credential from both
   `SITE_PASSWORD` and your user password. Let Render deploy.
3. Open `/owner-recovery.html` on the **private** site and enter the email
   matching `ALLOWED_EMAIL`, a new account password, and the temporary
   `OWNER_SETUP_KEY`. The form works whether your owner record already
   exists in MongoDB or still needs creating.
4. Existing record: changes **only the password** and invalidates old logins,
   leaving the user's ID, name, holdings and watchlist untouched. Missing
   MongoDB record: creates an owner account; an old browser-only account is
   **not** silently imported.
5. Sign in from `/login.html` using the new password. Immediately **delete
   `OWNER_SETUP_KEY` from Render Environment and redeploy**. No special key
   should remain enabled after recovery.

The recovery endpoint is available only on a private backend configured with
`ALLOWED_EMAIL`. Its random key is compared using timing-safe byte equality,
and the form never stores it in localStorage or URL parameters. Do not share
your key, passwords, or database URI in chat or GitHub.

### Existing account recovery

- **On the private instance**, set a temporary `OWNER_SETUP_KEY` in Render
  (for example generate 32 random bytes with a local password manager),
  redeploy, then enter the same key on the private registration form to create
  the owner's first MongoDB account. **Remove `OWNER_SETUP_KEY` after signup**
  and redeploy to disable new private account registration. An old browser
  password does not automatically authenticate with MongoDB.
- If the account was registered using StockAI's **old localStorage-only
  login**, it is **not** automatically in MongoDB. You must create a MongoDB
  account on the right deployment. Old browser-only portfolio information
  is not auto-migrated, to prevent moving someone else's data.
- If the account exists in MongoDB but you can't remember its password, use
  `forgot-password.html` once recovery is configured: set `SITE_URL`,
  `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` privately in Render and verify
  the sender domain/account with Resend. A reset email has a 30-minute,
  one-time-use token; changing the password invalidates existing logins.
- `SITE_PASSWORD` (the browser's HTTP Basic Auth popup) is a **different
  password** from your MongoDB **StockAI account password**. Do not paste
  either value or your MongoDB URI into GitHub or chat.
- Each site has its own login UI and private/public notice. The browser
  alone cannot override backend `ALLOWED_EMAIL`. Never remove
  `ALLOWED_EMAIL` from the private service to solve public login errors.
- When changing your profile or password, the updated data now goes to
  MongoDB rather than an obsolete `stockai_users` browser array.
- "Sign Out Everywhere" invalidates stored JWT sessions; alert/chat/notification
  data in browser storage is scoped per logged-in account.

**Public launch security:** Account sign-up is still username/password-only,
without email confirmation; add an email verification requirement before
allowing untrusted public users or accepting sensitive data. Do not expose
billable provider API keys to public browsers.

Run `npm test` for auth and account-route regression tests after installing
dependencies.

---

## License

MIT
