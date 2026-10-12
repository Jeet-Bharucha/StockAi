# StockAI — AI-Powered Stock Market Platform

A full-stack real-time stock market dashboard with AI analysis, automated alerts, and live price feeds.

**Live Demo:** [stockai-main.onrender.com](https://stockai-main.onrender.com)

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green) ![Claude AI](https://img.shields.io/badge/Claude-AI-orange) ![Finnhub](https://img.shields.io/badge/Finnhub-WebSocket-blue)

---

## Features

### Real-Time Market Data
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
| `ALLOWED_EMAIL` | No | Restrict login to one email (private mode) |

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

## License

MIT
