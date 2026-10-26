# StockAI audit — 26 October 2026

## Result and scope

The proposed follow-up adds company comparison with CSV export, a connection/feature readiness panel with a sanitized report, and repairs identified during the audit. **144 regression tests and one real disposable MongoDB integration scenario pass locally and in Linux CI. All 16 Chromium desktop/mobile scenarios pass in Linux CI, including actual CSV/JSON download contents.** The production dependency audit reports zero advisories. Syntax checks and the static frontend build pass.

The live site is still running PR #20's merge commit `da862e04ff008b1f0a5ef3ac3407167710ca55ac`. The new fixes need their follow-up PR merged and deployed to both frontend and Render. Local/browser fixture results below do not prove production account flows, provider entitlements or inbox delivery. The code is proposed in [PR #21](https://github.com/Jeet-Bharucha/StockAi/pull/21). No domain was purchased, email sent, hosting upgraded, production data modified or account restrictions changed during this audit.

## Problems found and fixed in the proposed change

1. The chat assistant called removed `_initSeed`/`_simQuote` functions for other tickers. It now uses fresh cached provider quotes or asks the user to select that symbol. No simulated substitute exists.
2. Missing/short/invalid chart history produced zero-valued assistant prices. It now reports unavailable. Symbol switches clear old chat context immediately.
3. Chat chips embedded invalid quoted JavaScript in HTML attributes. They now use real click listeners. Chat messages are HTML-escaped and stored roles/text are bounded; notification titles/bodies are escaped too.
4. The assistant labeled partial chart history as a 52-week range. It now labels the actual loaded-bar window and distinguishes loaded closes from current quotes. Volume claims require observed volume; a flat range cannot produce NaN/Infinity.
5. Shared RSI miscalculated zero-loss/flat histories and hid a valid RSI of zero. It now produces 100 for rising, 50 for flat and zero for falling prices; flat Bollinger ranges do not produce NaN. The assistant uses the shared RSI when available.
6. Switching to missing chart history could leave a previous symbol's full signal table/gauge/levels. These are cleared immediately, including the optional AI context.
7. The original portfolio quote route accepted quotes without freshness/currency evidence and used Yahoo's multi-day chart start close for daily changes. It now uses the verified quote adapter, confirms USD, includes observation/source metadata, bounds concurrency, coalesces/cache requests, and fails individual rows safely. Crypto quotes require a recent provider update timestamp; rate limits/missing fields remain unavailable.
8. A portfolio summary helper silently used purchase cost as current price. Missing quotes now produce null market totals/P&L. Existing holdings UI can still show an explicitly labeled cost-basis estimate while withholding P&L. Old best/worst/day stats are cleared after quote loss. CSV uses the same freshness/currency requirements.
9. Opening 3D with a missing library or unavailable renderer could hide a valid 2D chart. Missing dependencies/data now preserve 2D; a rendering exception restores it.
10. Malformed optional AI input could throw while constructing a provider prompt; provider error text could be returned directly. Inputs and response shapes are bounded/validated and provider failures return a generic error. No paid model call was made in this audit.
11. The unauthenticated status route could include active subscription symbols/client counts in private mode. Those account-activity fields are removed from public responses.
12. Currency checks unnecessarily fetched financial metrics/earnings. They now request only needed profile/currency metadata and share concurrent checks, reducing provider quota usage.

## New useful features

- **Compare company fundamentals:** up to four symbols; provider price/currency, session change, P/E, EPS, ROE, revenue growth and dividend yield. Each row retains source and observation/retrieval times; missing data stays unavailable. A CSV export includes provenance. There is no investment ranking or comparison of incompatible currency totals.
- **Connections & feature availability:** server/database, optional AI commentary, personal email setup/worker flag, password-recovery setup and access mode. A downloadable JSON report excludes account IDs, addresses, credentials, URLs and user portfolio data. The panel labels configuration presence separately from provider/inbox verification. Optional AI controls show unavailable when the provider key is absent; local chart explanations remain usable.

## Live production checks

Observed on 26 October through the live browser/API and Render connector. These are read-only checks of the current PR #20 deployment, not the proposed changes.

| Case | Result | Evidence / limit |
| --- | --- | --- |
| Current Render deploy | PASS | PR #20 merge revision is live; no extra deploy triggered. |
| `/api/version` | PASS | Matches `da862e04…`. |
| `/api/health` | PASS | `service: stockai`, `ok: true`, `database: connected`. |
| SPY quote | PASS | Positive Finnhub price, prior close, session change and observation timestamp returned. |
| XLK quote | PASS | Positive Finnhub price, prior close, session change and observation timestamp returned. |
| GLD quote | PASS | Positive Finnhub price, prior close, session change and observation timestamp returned. |
| SPY daily history, July–October range | PASS | Provider returned 82 daily candles (`s: ok`). |
| AAPL company-news feed | PASS | 245 provider articles returned; article content not copied into this report. |
| Malformed quote symbol | PASS | Explicit `Invalid market symbol`; no replacement price. |
| Unsigned account research request | PASS | `Sign in to continue`; account data not returned. |
| Account/public access configuration | VERIFIED PRIVATE | Registration closed; verification not required in current private mode. |
| Password reset | NOT READY | Live config reports passwordResetAvailable false. |
| Signed-in dashboard and account writes | NOT LIVE-VERIFIED | Private-site login still blocked this browser. User was asked to sign in; no credentials extracted or production data written. |
| New personal email sender | NOT READY | Render has RESEND_API_KEY, but RESEND_FROM_EMAIL and SITE_URL are absent; no linked env group. |
| New personal-alert worker | NOT DEPLOYED | No background-worker service in the confirmed workspace; flag absent. |
| Existing owner email scan | PARTIAL EVIDENCE | Earlier runtime logs report Resend submissions using the legacy test sender; inbox receipt was not independently confirmed. |
| Optional model commentary | NOT CONFIGURED | Runtime reports no ANTHROPIC_API_KEY. Local chart explanations do not require it. |
| Crypto provider | DEGRADED | Recent runtime logs contain CoinGecko HTTP 429 responses. Crypto availability cannot be claimed. |
| Scheduled offsite backup / restore | NOT LIVE-VERIFIED | Disposable restoration passes; managed scheduling, storage and retention not inspected/configured. |
| Failure notifications/production monitor | NOT LIVE-VERIFIED | Workflow exists; activation via repository variable/notification preferences was not established in this audit. |

## Browser cases — core scenarios passed on desktop and phone widths

The browser runs real Chromium against an isolated static app with explicitly simulated API responses. Persistence here means fixture state across reload; the separate Mongo test covers actual database persistence/isolation. External libraries/providers are controlled fixtures, so this does not establish live entitlements or real 3D/GPU availability.

| Scenario | Cases covered | Result |
| --- | --- | --- |
| Eight tabs after Portfolio | Dashboard, Technical Signals, Watchlist, Portfolio, Markets, News, Movers, Screener; one active view; visible chart/news/market cards; refresh | PASS × 2 sizes |
| Saved research workspace | Create list, save symbol/note/target, save/load screen, first-ten fundamental filter, ledger deposit, email preference, reload persistence | PASS × 2 |
| Provider outage | Explicit quote/news/chart/earnings unavailable states, no fake price, retry visibility, light mode, reduced motion, no page overflow | PASS × 2 |
| Search and company actions | Keyboard arrows/Enter/Escape, recent symbols, company events/unavailable filings, missing sender diagnostics, custom USD screen | PASS × 2 |
| New comparison/status/chat | Comparison, invalid >4 symbols, unavailable optional AI control, readiness panel, clickable chat chips, literal HTML message safety, unavailable 3D preserving 2D | PASS × 2 |
| Original holdings and alerts | Add/edit/remove holding, updated valuation, reload persistence; create/reload/remove saved alert | PASS × 2 |
| Missing-history symbol switch | Old signal table/RSI cleared; assistant says unavailable rather than $0 | PASS × 2 |
| Expired account / offline recovery | No phantom list after unauthorized account response; connection checks show unavailable and recover after network restoration | PASS × 2 |

Actual-download content checks for company comparison CSV, portfolio CSV and sanitized connection JSON **passed in Linux CI**. This Windows sandbox cancelled those browser downloads before disk creation; the assertions stayed enabled and were verified in Linux rather than skipped. See [the successful code verification run](https://github.com/Jeet-Bharucha/StockAi/actions/runs/40389584714) for commit `bebc6cf9…`.

## Real database integration case

PASS against a disposable one-member MongoDB replica set, test JWTs, two test users and fixture quotes. It covers actual route/model persistence; private list/ledger/snapshot separation; competing optimistic saves (one succeeds and one conflicts); idempotent transaction retries; expired/revoked/unverified sessions and database-unavailable errors; AES-GCM archive round-trip preserving BSON IDs/dates/indexes; restore to an empty explicitly confirmed `_restore_test` database; restored session-version bump; refusal to overwrite a populated target. It never connects to production Atlas.

## Remaining setup and exact post-merge checks

1. Merge the follow-up PR only after its CI checks pass. Deploy both Render and any separate frontend; confirm `/api/version` equals the merge commit and the PWA updates to `stockai-v28-useful-audit-1`.
2. Sign in normally. On phone and desktop visit all eight tabs after Portfolio. Check Connections, compare AAPL/MSFT, export the comparison/report and use the chart assistant. Select a covered stock, then an invalid/uncovered symbol; ensure old signals and prices do not remain.
3. Use disposable test records on staging to exercise holding/list/alert/ledger writes, reload and second-account isolation. Do not delete or overwrite real holdings just to test. Password/account deletion cases require disposable staging users.
4. Compare portfolio source/timestamps/currency with provider records. On staging simulate stock/crypto outages, stale/future/non-USD quotes and 429s; unavailable rows and withheld P&L are expected. A labeled cost-basis estimate is not a current price.
5. Gmail stays the receiving inbox; no domain purchase is planned. A verified sender/domain is still required for general-user Resend delivery. The existing `onboarding@resend.dev` sender is limited to owner testing. Do not enable public registration or promise subscriber email without completing sender setup, worker deployment, opt-in, delivery/retry/opt-out verification and appropriate hosting.
6. Optional model commentary requires its provider setup; no key was requested in chat. The current free web service can sleep, so its in-process legacy cron does not establish always-on delivery. Confirm the operational choice before relying on unattended alerts.
7. Activate managed/offsite backups and complete a separate restore drill; configure external health checks/notifications. The new readiness panel reports settings, not proof of those external outcomes.

This audit covers the cases listed and tested. It does not establish every possible device, browser, market instrument, provider outage, accessibility requirement, load level, security condition or disaster-recovery outcome. No penetration/load test, email inbox test, paid AI request, actual GPU test, brokerage transaction or production account mutation was performed.

## Complete regression-test inventory

All cases below passed locally. Tests include pure calculations and controlled route/provider/database fixtures; they are not all live end-to-end tests.

1. PASS — profile edit updates the authenticated MongoDB record
2. PASS — password update requires correct current password and revokes existing JWT versions
3. PASS — deleting account without the password does not delete any data
4. PASS — portfolio deletion is scoped to the logged-in account
5. PASS — successful login stores the token and session
6. PASS — invalid credentials explain MongoDB account mismatch without claiming the server is offline
7. PASS — disconnected MongoDB returns actionable login feedback
8. PASS — HTML from a misconfigured proxy is identified instead of treated as an auth response
9. PASS — upstream outage is different from invalid credentials
10. PASS — health check distinguishes Node up with MongoDB down
11. PASS — health check passes only when the database is connected
12. PASS — network failures do not leak implementation exceptions to users
13. PASS — Nodemailer 10 remains compatible with simple StockAI SMTP messages
14. PASS — exclude incomplete same-day daily candle, never use it for a forward outcome
15. PASS — cannot save a backdated prior-close signal after the next session opens
16. PASS — forward outcome uses NEXT session OPEN and FIFTH future CLOSE
17. PASS — never publish measured hit rate before thirty real forward directional outcomes
18. PASS — server recomputes signal from trusted candle bars and ignores forged direction
19. PASS — converts actual OHLCV bars to chart API format without simulated data
20. PASS — rejects invalid symbols and bad ranges before network access
21. PASS — rejects provider HTTP errors instead of constructing fictional OHLCV data
22. PASS — does not convert malformed or absent candles into fabricated prices
23. PASS — valid quote is marked provider-backed and preserves actual price
24. PASS — provider downtime returns an error instead of inventing a market price
25. PASS — no or invalid quote cannot become a fake live price
26. PASS — historical data outage cannot generate random candles
27. PASS — market overview explicitly marks unavailable symbols
28. PASS — Finnhub quote keeps correct observed time, previous close and source
29. PASS — Yahoo fallback uses previous session close, never five-day chart baseline
30. PASS — a Yahoo quote without current-session previous close is rejected instead of fabricating gain
31. PASS — old market quotes never become fake current data
32. PASS — quote lookup falls back from 403 / rate limit without returning demo prices
33. PASS — duplicate concurrent lookup makes one upstream call
34. PASS — both providers down returns explicit unavailable, not random simulation
35. PASS — rejects injected symbols before reaching provider
36. PASS — normalizes legitimate stock, ETF, index and crypto symbols
37. PASS — invalid symbols cannot inject provider URL parameters or arbitrarily long payloads
38. PASS — client messages accept only expected actions and valid symbols
39. PASS — limits each client and global subscription cardinality while allowing existing symbols
40. PASS — all three market sections render cards before any asynchronous quote resolves
41. PASS — failed quote providers show unavailable text in every market section
42. PASS — manual retry clears stale in-memory quotes, and is independently actionable
43. PASS — PWA update and market retry are wired into the dashboard markup
44. PASS — deployment monitor detects database failure, version drift and invalid destinations
45. PASS — deployment monitor rejects fabricated or stale successful quote payloads
46. PASS — existing owner login can be restored without changing identity or watchlist
47. PASS — wrong setup key never changes a user record
48. PASS — portfolio uses MongoDB response rather than old local storage
49. PASS — a failed add never reports a phantom saved holding
50. PASS — successful addition updates the view only after server confirms
51. PASS — failed edit preserves prior holding values
52. PASS — successful deletion removes only the confirmed holding
53. PASS — temporary network failure preserves already-loaded portfolio and exposes an error
54. PASS — portfolio summary does not present a missing market quote as the buy price or zero profit
55. PASS — alert validation rejects incorrect targets and accepts ticker with dot
56. PASS — account alerts are saved, scoped to user and trigger only once
57. PASS — provider price that never crossed a target cannot trigger the alert
58. PASS — clear all deletes only the caller’s alerts
59. PASS — public signup is opt-in and cannot borrow owner-only settings
60. PASS — verification tokens are random and only a digest is stored
61. PASS — public signup does not issue login tokens before proof of email
62. PASS — failed initial verification delivery removes only new unverified user
63. PASS — valid verification token is single use and enables this user
64. PASS — sender diagnostics distinguish missing, rejected, send-only and verified without sending
65. PASS — email self test authenticates owner, ignores submitted recipient, and reports rejection
66. PASS — telemetry aggregates bounded categories and rejects arbitrary payloads
67. PASS — authenticated encrypted backups preserve BSON and reject wrong passwords, tampering and unsafe restores
68. PASS — forward and reverse splits preserve basis and reject pre-split valuation
69. PASS — reported financial data preserves period and units while unavailable actions stay null
70. PASS — saved custom screener symbols are normalized, deduplicated and bounded
71. PASS — static publishing includes the app and excludes backend sources, backups and test data
72. PASS — MongoDB watchlist only updates in-memory state after successful server confirmation
73. PASS — rapid additions are serialized so the second write includes the first
74. PASS — unavailable initial account watchlist never gets replaced by empty state
75. PASS — delayed account read never rolls back an acknowledged MongoDB watchlist write
76. PASS — watchlist input is normalized and rejects invalid ticker syntax
77. PASS — quote percent is computed from the real previous close when provider omits change
78. PASS — quote missing both provider change and prior-close rejects instead of showing 0%
79. PASS — curated research universe is correctly classified, diverse and contains no obsolete Twitter listing
80. PASS — screener applies real sector, performance, price, cap and RSI filters
81. PASS — market snapshot counts missing quotes separately from unchanged ETFs
82. PASS — watchlist sorting always places unquoted symbols after verified movers
83. PASS — portfolio insights combine the same ticker across accounts and flag estimated values
84. PASS — news strips duplicate/stale/unsafe headlines instead of implying they are current
85. PASS — CSV output quotes text and neutralizes spreadsheet formulas
86. PASS — all tab-specific research features are wired to the dashboard and valid JS
87. PASS — ledger handles cash, fees, average-cost sales and dividends without altering existing holdings
88. PASS — snapshot valuation rejects missing, stale, future and non-USD quotes
89. PASS — Modified Dietz weights external flows and SPY comparison uses actual snapshots
90. PASS — research state validates symbols, numeric targets and bounded lists; unknown fields do not persist
91. PASS — account state is isolated, optimistic saves reject stale revisions and ledger retries are idempotent
92. PASS — only verified real snapshots are recorded and concurrent ledger edits abort valuation
93. PASS — fundamentals are cached, malformed symbols are rejected before provider and absent metrics stay absent
94. PASS — worker atomically triggers alerts, honors opt-in and does not redeliver sent alerts
95. PASS — email failure is recorded and retryable; stale quotes never trigger an alert
96. PASS — worker lease rejects overlapping cycles
97. PASS — USD valuation confirms ETF currency from Yahoo metadata if the stock profile is missing
98. PASS — ledger entries cannot be backdated across an existing performance snapshot
99. PASS — clear-all-data includes account research collections without touching another account
100. PASS — historical check requires valid, chronological OHLCV data
101. PASS — first signal uses >=210 prior trading sessions and next-open entry
102. PASS — evaluation windows cannot overlap; historical signals are determined without future bars
103. PASS — Wilson uncertainty reports no confidence band without directional evidence
104. PASS — async historical replay matches synchronous summary
105. PASS — default private deployment remains completely owner only
106. PASS — single-site public flag admits normal users without revoking owner or opening owner APIs
107. PASS — no email delivery means no new public registrations even though existing users can login
108. PASS — explicit OWNER_EMAIL overrides historic allowlist without importing or deleting users
109. PASS — opening an installation without identifying its owner fails closed
110. PASS — public frontend pages and their CSS/JS assets remain accessible
111. PASS — backend sources, dependencies, credentials and CI files are not public static assets
112. PASS — frontend guard denies unsafe paths without passing to static handler
113. PASS — browser security headers protect APIs while preserving local HTTP development
114. PASS — public service status does not expose active subscriptions or client counts
115. PASS — every workspace tab is a direct sibling in main, never inside a hidden tab
116. PASS — actual switchTab reveals Markets, News, Movers and Screener after leaving Portfolio
117. PASS — index.html: scripts parse, styles load, and local JS assets exist
118. PASS — login.html: scripts parse, styles load, and local JS assets exist
119. PASS — register.html: scripts parse, styles load, and local JS assets exist
120. PASS — dashboard.html: scripts parse, styles load, and local JS assets exist
121. PASS — profile.html: scripts parse, styles load, and local JS assets exist
122. PASS — forgot-password.html: scripts parse, styles load, and local JS assets exist
123. PASS — reset-password.html: scripts parse, styles load, and local JS assets exist
124. PASS — owner-recovery.html: scripts parse, styles load, and local JS assets exist
125. PASS — verify-email.html: scripts parse, styles load, and local JS assets exist
126. PASS — terminal uses the brighter Aurora accent palette
127. PASS — dashboard keeps persistent portfolio and starts market panels independently
128. PASS — portfolio symbol batches validate before providers, deduplicate and cap at 50
129. PASS — portfolio prices require verified currency/timestamps, retain source and never use a cost substitute
130. PASS — portfolio batching limits concurrency, coalesces quotes and preserves available rows during a failure
131. PASS — crypto prices fail closed on rate limit, stale observations and missing volume-change fields
132. PASS — capability summaries reveal no keys, addresses or URLs and do not claim delivered email
133. PASS — assistant missing/short/malformed history produces no invented zero price or trade signal
134. PASS — assistant handles other tickers without removed simulation functions and escapes HTML
135. PASS — assistant labels short history honestly and flat bars do not create NaN/Infinity
136. PASS — AI request validation accepts actual predictor output and rejects malformed payloads before provider use
137. PASS — shared RSI returns neutral for flat prices, 100 for rising and zero for falling prices
138. PASS — currency checks coalesce and do not spend earnings/metric requests merely to price a portfolio
139. PASS — simultaneous panel reads share a request and failed requests can be retried
140. PASS — malformed quote symbols never reach the server
141. PASS — quote starts while history and profile are pending, and failed history clears old bars
142. PASS — all data tabs dispatch independently, suppress duplicate loads and offer retry after rejection
143. PASS — quotes preserve provider provenance and observation time for visible freshness labels
144. PASS — chart retry evicts only the selected history and retries current symbol
