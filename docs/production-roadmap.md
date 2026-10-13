# StockAI: real product roadmap (not just a portfolio demo)

## What is live today

StockAI currently has **two different mechanisms**, which must not be mixed up:

1. **Technical indicator engine** (`js/aiPredictor.js`). This is a fixed,
   hand-written combination of RSI, MACD, moving averages, Bollinger bands,
   stochastic, OBV and momentum. Its score is **NOT** a model-calibrated
   probability, and it must not be advertised as a measured accuracy rate.
2. **Optional Claude commentary** (`/api/ai-analysis`). This explains the
   submitted indicator values in natural language if `ANTHROPIC_API_KEY` is set.
   Claude does **not** train on the user's stock history in this application;
   explanatory text does not establish prediction skill.

Market prices and candles are sourced through server API adapters; some
history comes from an unofficial Yahoo chart endpoint. Treat all quotes as
*latest available*, not guaranteed exchange-real-time. Portfolio holdings are
saved in MongoDB per authenticated user.

## Phase 1: measurable, practical decision support — this PR

- One-click historical signal check for the selected stock on up to three
  years of daily OHLCV data.
- Fixed 5-trading-session evaluation, non-overlapping events, no look-ahead:
  enter **next session's open** and observe return at session five close.
- Direction hit rate, **Wilson 95% interval**, sample count, mean hypothetical
  directional return after **0.10% estimated round-trip cost**, and corresponding
  long benchmark for identical time windows.
- Avoid showing an "accuracy" claim when history is missing or no directional
  events exist; mark fewer than 10 directional samples as insufficient and
  fewer than 30 as limited.
- Price ranges in the AI screen are +/- 2×ATR volatility scenarios; **not**
  statistically calibrated targets.
- The latest current signal is *not* part of its own backtest outcome.
- Tests verify causal inputs, data validation, window spacing and error cases.
- Important limitations: hand-tuned historical rules are exploratory; using a
  single instrument and retrospectively choosing parameters can overfit.
  Hypothetical entry/exit prices and fixed costs exclude actual spread,
  borrow restrictions, slippage, taxes, dividends and execution limitations.

## Phase 2: trusted predictions and forward performance tracking

**Do not call the product a forecast until a benchmarked model exists.**

- Create a versioned, immutable `PredictionSnapshot` collection storing:
  user/group, symbol, horizon, OHLCV data time, model/rule version, signal,
  scenario assumptions, generated time, and eventual resolved close price.
- Resolve outcomes from verified future sessions on a scheduled job, **never
  retroactively revise** predictions to match realized prices.
- Publish an aggregated evaluation dashboard: time-split evaluation,
  directional hit rate, precision/recall, calibration plots, proper time
  boundaries, confidence intervals, and comparisons to always-up and no-change.
- Add 1-day / 5-day / 20-day horizons, volatility-adjusted uncertainty,
  freshness indicator and explicit missing-data states.
- Only then prototype actual ML (logistic regression / gradient-boosted trees
  are reasonable baselines), trained on earlier data, tested on a strictly
  later period with purging around overlapping horizons and no target leakage.
- Model provenance, retraining jobs and drift monitoring. Do not promise
  guaranteed profit or treat in-sample backtest wins as out-of-sample proof.

**Acceptance:** 100+ matured, immutable forward signals across multiple
market regimes; documented baseline and uncertainty; no future data used in
features. No unsubstantiated percentage displayed as "accuracy."

## Phase 3: safe small-group account access

**Current private Render service is owner-only** when `ALLOWED_EMAIL` is set.
Friends **cannot** register/login there, even with a valid password. **Do not
disable `ALLOWED_EMAIL` or `SITE_PASSWORD` casually to solve this.**

- Deploy a separate small-group/public backend using its own Render service,
  random JWT secret and matching API proxy URL (if using Netlify).
- Prefer invitation-based registration, verified email ownership, rate limiting
  for login/signups and recovery, HTTPS-only authenticated app endpoints.
- Test two different users: private watchlists/portfolio/predictions cannot
  appear in the other's account or browser storage.
- Add simple privacy policy, terms, provider-data licensing review, abuse and
  cost controls for any paid model/API.
- Review dependency vulnerabilities and add automated dependency checks before
  inviting anyone outside a trusted testing group.

**Acceptance:** Two clean test accounts can register, log in separately,
refresh and retain data; neither can access another's holdings, alerts or
prediction history. Private owner site remains separate.

## Phase 4: usable everyday workflows

- Reliable watchlists, daily digest, alerts on verified prices, configurable
  thresholds, quiet hours and deduplicated email/push delivery.
- Server-persisted alerts that work while every browser is closed. Browser-only
  notifications are NOT reliable real-time background alerting.
- Paper-trade journal with timestamps and fee/slippage modeling; risk budget
  and position sizing tools; portfolio history based on real daily snapshots.
- Search results from a licensed symbol directory (currently only a curated
  ticker list is searchable by company name), recent symbols and saved layouts.
- Mobile accessibility, error recovery, telemetry and integration tests.

**Acceptance:** A person can track a watchlist and receive one trustworthy
alert without leaving the browser open, can see what price/time triggered it,
and can audit the outcome.

## Phase 5: release checklist

- CI green, browser smoke tests (desktop + phone), multi-account isolation
  checks, safe service-worker updates, graceful API failure handling.
- Verify market-data permissions, vendor rate limits, data delay disclosures,
  legal/regulatory implications of providing actionable signals to others.
- Document that StockAI is analytics/paper-trading software and does not
  place orders or manage users' money. Do not add broker credentials or real
  trade execution without a separate high-assurance security/legal review.
- Deploy staging first, then cautiously roll out; monitor errors/latency.
