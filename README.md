# 📈 StockAI — AI-Powered Stock Market Dashboard

> A full-featured stock market analysis platform built with vanilla JavaScript. Designed to look and function like a professional trading terminal — no frameworks, no backend required.

**🔗 Live Demo:** [stockai-app.netlify.app](https://stockai-app.netlify.app)

---

![StockAI Dashboard](https://img.shields.io/badge/Status-Live-brightgreen?style=flat-square)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow?style=flat-square&logo=javascript)
![PWA](https://img.shields.io/badge/PWA-Installable-blue?style=flat-square)
![Netlify](https://img.shields.io/badge/Hosted-Netlify-00C7B7?style=flat-square&logo=netlify)

---

## ✨ Features

### 📊 Charts & Analysis
- **Candlestick chart** with volume bars (LightweightCharts)
- **3D candlestick view** powered by Three.js — drag to rotate, scroll to zoom
- **Compare mode** — overlay any two stocks on the same chart
- **SMA overlays** — toggle SMA 20 / 50 / 200 on the chart

### 🤖 AI Prediction Engine
- Computes **7 technical indicators** client-side from raw price data:
  - RSI (14), MACD, Bollinger Bands, OBV, SMA, ATR, Momentum
- **Confidence gauge** — animated arc from SELL → HOLD → BUY
- **Buy / Sell / Neutral** signal count with reasoning
- **Price targets** — Bear case / Base case / Bull case range
- **Risk level meter** based on ATR volatility
- **Candlestick pattern detection** — Doji, Hammer, Engulfing, Morning Star, and more

### 💬 AI Chat Assistant
- Ask natural language questions: *"What's the RSI?"*, *"Buy or sell?"*, *"Any patterns?"*
- **Auto-updates context** when you switch stocks
- **Cross-stock queries** — ask about any ticker: *"How is TSLA doing?"*
- Quick-reply chips for common questions
- Persistent chat history across sessions

### 🔎 Stock Screener
- Screens **50 stocks** across 6 sectors
- Filter by: **Sector**, **RSI signal** (Oversold / Neutral / Overbought), **Market Cap** (Large / Mid / Small), **Performance**, **Price range**
- Sort by: % change, price, RSI, volume
- RSI computed per-symbol from simulated candle data
- Flip cards reveal Mkt Cap, Volume, 52W High/Low on hover

### 💼 Portfolio Tracker
- Add holdings (symbol, shares, buy price)
- **Live P&L** — value, cost, profit/loss, % return
- **30-day sparkline** chart of portfolio value
- **Donut chart** — allocation % per position
- Analytics: Positions, Largest Hold, Best Performer, Diversification level
- Export to CSV

### 🌐 Markets Overview
- **Sector heat map** — 8 ETFs colored by intensity (XLK, XLF, XLV, XLE…)
- US Indices, Commodities, International markets
- **Live ticker tape** — 15 symbols scrolling across the top
- **Daily AI Briefing** — Bull/Bear/Neutral sentiment with top movers

### 🔔 Alerts & Notifications
- Set price alerts (above / below target)
- Browser push notifications when alerts trigger
- **Notification center** — persistent bell icon with unread badge
- Alerts log in notification history

### 🗺 Additional Features
- **Watchlist** — add/remove stocks, click to open chart
- **News feed** — company and market news
- **Earnings calendar** — recent reports and upcoming dates
- **Trending tab** — top movers and most watched
- **Onboarding tour** — 7-step spotlight walkthrough
- **Keyboard shortcuts** — `1–7` tabs, `/` search, `C` chat, `?` shortcuts
- **Light / Dark theme** toggle
- **PWA** — installable on desktop and mobile, offline-capable

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript (ES6+), HTML5, CSS3 |
| Charts | [LightweightCharts](https://github.com/tradingview/lightweight-charts) |
| 3D | [Three.js](https://threejs.org/) |
| Canvas | HTML5 Canvas API (gauge, donut chart, portfolio sparkline) |
| Data | [Finnhub API](https://finnhub.io/) with deterministic simulation fallback |
| Auth | Client-side sessions with localStorage |
| PWA | Service Worker + Web App Manifest |
| Hosting | [Netlify](https://netlify.com) |

---

## 📁 Project Structure

```
StockMarket/
├── index.html          # Landing page (3D animated globe)
├── login.html          # Sign in page
├── register.html       # Create account page
├── dashboard.html      # Main trading terminal
├── profile.html        # User profile & settings
├── 404.html            # Error page
├── sw.js               # Service Worker (PWA / offline)
├── manifest.json       # PWA manifest
├── favicon.svg         # App icon
└── js/
    ├── auth.js         # Auth system (register, login, sessions)
    ├── stockApi.js     # Finnhub API + simulation fallback + WebSocket
    ├── dashboard.js    # Main dashboard logic (all tabs, charts, features)
    ├── aiPredictor.js  # Technical indicator engine (RSI, MACD, BB, OBV…)
    ├── chat.js         # AI chat widget
    ├── features.js     # Portfolio, Watchlist, PriceAlerts, helpers
    └── animations.js   # 3D tilt, particle effects, canvas animations
```

---

## 🚀 Getting Started

### Run locally
```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/stockai.git
cd stockai

# Install dependencies (just a local dev server)
npm install

# Add your Finnhub API key
echo "FINNHUB_KEY=your_key_here" > .env

# Start the server
npm start
```
Then open `http://localhost:3001`

> **No API key?** The app runs fully on simulated data — just open `index.html` directly in a browser or use any static server.

### Deploy to Netlify (static, no backend)
1. Copy only the static files (exclude `node_modules`, `.env`, `server.js`)
2. Drag & drop the folder at [netlify.com/drop](https://app.netlify.com/drop)
3. Done — the app runs on simulated data with no server needed

---

## 🔑 Environment Variables

Only needed if running the Node.js backend for live Finnhub data:

| Variable | Description |
|---|---|
| `FINNHUB_KEY` | Your [Finnhub API key](https://finnhub.io/) (free tier works) |
| `PORT` | Server port (default: `3001`) |

> The browser never exposes the API key — it stays on the server.

---

## 📸 Screenshots

| Landing Page | Dashboard | AI Predictions |
|---|---|---|
| 3D animated globe hero | Candlestick chart + AI signals | Gauge + price targets |

| Stock Screener | Portfolio | AI Chat |
|---|---|---|
| RSI + sector filters | Donut chart + P&L | Cross-stock queries |

---

## ⚠️ Disclaimer

StockAI is built for **educational and portfolio purposes only**. All data shown is either simulated or sourced from public APIs. Nothing on this platform constitutes financial advice. Do not make real investment decisions based on this tool.

---

## 📄 License

MIT — feel free to fork, modify, and use this project.

---

<div align="center">
  Built with ❤️ by <a href="https://github.com/YOUR_USERNAME">Your Name</a>
</div>
