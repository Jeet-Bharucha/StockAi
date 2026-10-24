# Research workspace deployment and operations

This release implements six areas: unified company research, a separate transaction ledger/performance history, opt-in worker email alerts, multiple research lists, saved/fundamental screens, and automated browser/health monitoring.

## Web deployment

1. Keep the existing MongoDB database, authentication secrets and owner/public flags. New account-scoped collections are additive: ResearchAccount, PortfolioSnapshot and WorkerHeartbeat. Existing holdings and the original watchlist are not imported, rewritten or deleted.
2. Deploy the merged revision to Render and Netlify if used. Use Node 22. The worker is optional for web features; keep BACKGROUND_ALERTS_ENABLED=false until its separate service is running.
3. Finnhub fundamentals/earnings use FINNHUB_KEY and the account's provider entitlement. Source and retrieval time are shown. Unavailable fields remain unavailable. Currency confirmation for USD snapshots may fall back to Yahoo chart metadata. Provider access and licensing must match the deployment's intended use.
4. Check /api/health (connected database), /api/version (Render's RENDER_GIT_COMMIT) and cache stockai-v26-research-4. Hard-refresh the dashboard.

## Ledger and performance

- The new ledger is USD-only, long-only and cash-funded. Start with a deposit, then record actual buys/sells/dividends/fees in chronological order. Entries must also be after the latest snapshot; historical restatement is not supported. It does not silently reinterpret the old manually entered holdings.
- Transactions are append-only, capped at 1,000 entries/account, have retry identifiers and optimistic account versions. Mistakes require compensating entries at the correct current time; there is no destructive ledger reset in this release. No automatic split, merger, tax-lot or FX accounting is claimed.
- Quotes must have recent provider timestamps and confirmed USD currency. Missing prices/currency prevent a numeric equity snapshot. Cost-basis fallback is not used for returns. Fees enter average-cost realized/unrealized P/L.
- Capture snapshots manually, or let the worker capture hourly batches. A unique per-account/revision minute bucket prevents concurrent duplicate snapshots. The UI reads the most recent 365 actual snapshots, not an invented historical curve. Returns require two distinct times and use a labeled Modified Dietz estimate with external cash-flow times. They are not tax reports or guaranteed time-weighted returns. SPY comparison is a price return excluding dividends; no benchmark percentage appears when either benchmark observation is missing.

## Background email alerts

1. Deploy researchWorker.js as a separate always-on Node worker using npm ci --omit=dev and npm run worker. render-worker.example.yaml is an optional paid-service blueprint, not an automatic change to the free website.
2. Supply the SAME MONGO_URI, FINNHUB_KEY and owner/public access settings as the website. Configure RESEND_API_KEY and a verified RESEND_FROM_EMAIL privately on both services; use BACKGROUND_ALERTS_ENABLED=true on the worker. No credentials belong in Git.
3. Worker checks rotate bounded alert batches every two minutes; actual latency depends on queue size/providers. Each cycle attempts one eligible ledger snapshot, rotating accounts no more often than hourly; larger account populations increase the interval. A renewable MongoDB lease prevents overlapping cycles, and atomic alert resolution prevents duplicate trigger records.
4. After a successful heartbeat, set BACKGROUND_ALERTS_ENABLED=true on the web service. Users must opt in under Stock Movers > Email preferences. Email goes only to the account address, and older alerts from before opt-in are skipped. Turning the preference off skips pending delivery. Users locked out by the configured owner restriction are not emailed.
5. Delivery records have leases, five attempts, a stable provider idempotency key and sent/failed/skipped status. This is retry-based delivery, not an exactly-once guarantee across arbitrary provider outages. Failed delivery can be requeued by its account owner from alert history after fixing sender configuration. Check spam/provider logs and the verified sender for delivery issues.
6. Test an opted-in disposable alert with a verified crossing, a noncrossing/stale quote, temporary mail failure, retry and opt-out before relying on notifications. Implementation tests use simulated recipients; no test email was sent to a real user.

## Monitoring and verification

- Dashboard > Service health provides owner-only database/uptime and worker heartbeat/counts. No successful heartbeat for ten minutes is stale; partial failures are reported separately.
- Set GitHub repository variable STOCKAI_MONITOR_URL to the production Render HTTPS origin. The production-health workflow then runs every 30 minutes (or manually), checks liveness/database, a verified SPY provider response, and compares /api/version against the repository revision. Without the variable the job is intentionally skipped. GitHub's normal workflow-notification preferences control failure notifications.
- npm test runs pure and mocked account-route/worker tests. npm run test:browser runs actual Chromium at desktop and iPhone-sized widths against an isolated static host with explicit API fixtures; it does not use live secrets or MongoDB. On Linux/CI install Chromium with npx playwright install --with-deps chromium. On Windows set PLAYWRIGHT_BROWSERS_PATH to the checkout's .playwright-browsers directory before installation (the config uses that same local path).
- Browser checks cover all eight tabs after leaving Portfolio, chart/news/movers, list/screen/ledger/preference persistence, light/reduced motion and failed quote/news/candle responses. CI keeps a browser report and failure screenshots/traces.
- Before production use, repeat the signed-in flows with two real test accounts against MongoDB to verify access isolation and persistence. Confirm fundamental units/currency against the provider, correct entry accounting, worker/email outcomes and mobile controls. Browser fixture success is not proof of provider availability or live email delivery.

## Feature scope

Research lists support 10 lists × 30 symbols with notes, optional targets and saved sorting. Saved screens support 15 presets across devices, with existing price/RSI/cap/session filters plus optional P/E, ROE and 10-day average volume. Fundamental enrichment deliberately checks only the first 10 current matches to bound upstream quotas. This is not an exchange-wide security inventory. Personal target prices are user notes, not forecasts or alert conditions.
