# StockAI research deployment and recovery guide

This release includes provider research, a separate USD ledger/performance history, worker email, multiple research lists, saved/custom screens and reliability monitoring. Source availability is distinct from production configuration. No production sender, worker, backup schedule or offsite storage has been provisioned by these changes.

## Web and frontend deployment

Keep the existing MongoDB database, JWT secret and owner/public flags. ResearchAccount, PortfolioSnapshot and WorkerHeartbeat are additive collections. Existing manual holdings and original watchlist are not imported or rewritten. Use Node 22, deploy the merge revision to Render and Netlify if used, then confirm `/api/version` matches and `/api/health` reports a connected database. Update the PWA/cache `stockai-v28-useful-audit-1` and hard-refresh.

Finnhub research uses FINNHUB_KEY and the provider account's entitlements. Missing data remains unavailable; it is never estimated. Source and retrieval time are displayed. Currency confirmation may fall back to Yahoo chart metadata. Provider access and licensing must match the intended deployment use.

Netlify builds `.stockai-static` with the same public frontend allowlist as Express. Backend sources, tests, environment files and backups are excluded. Netlify still proxies API calls to Render, so a frontend-only preview is not a full-stack deployment or verification. Both hosts need the matching revision.

## Company research and screener

Company overview includes metrics, upcoming earnings and linked news. The lazy company-details action returns up to three annual reported filings (income statement, balance sheet, cash flow), plus up to 80 dividends/splits over the previous two years through the next 90 days. It preserves concept labels, periods and supplied units. Missing units read “Not supplied”; values are not relabeled as dollars or millions. Empty results and unavailable provider entitlements are distinct states. Schemas follow [Finnhub's official API specification](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/api/openapi.yaml).

Research lists support ten lists with thirty symbols each, notes, optional target prices and saved sorting. Targets are user notes, not forecasts. Search supports arrows, Enter and Escape and stores up to eight recent symbols per account in that browser.

Saved screens support fifteen presets. The default scanner samples thirty sector-balanced curated symbols; custom runs accept a research list or up to fifty explicit symbols and require confirmed USD currency. Non-USD or unconfirmed currency is excluded. Quote concurrency is bounded; optional P/E, ROE and ten-day average volume enrichment checks only the first ten current matches to bound quotas. Missing required metrics exclude the row. This is not a whole-exchange inventory.

## Ledger and performance

The separate ledger is USD-only, long-only and cash-funded. Record a deposit followed by actual buys, sells, dividends and fees. It does not reinterpret the original portfolio. Entries are chronological, append-only, capped at 1,000 per account and use retry IDs and optimistic revisions. They must be after the latest snapshot. Historical restatement, tax lots, margin, shorts, FX and brokerage execution are unsupported.

Manual forward/reverse split entries use new shares / old shares. They preserve total cost basis and cash and require an existing position. A quote observed before a recorded split cannot value that position. Record the effective time accurately, after previous entries/snapshots, and never record the same event twice. Review original filings/broker records before recording corporate actions. Fractional cash-in-lieu is not automatically accounted for. Chart bars follow provider adjustment policy and are not a total-return series.

Valuation requires recent real quotes and confirmed USD currency. Missing prices/currency prevent numeric equity snapshots; there is no cost-basis substitute. Fees enter average-cost realized/unrealized P/L. Manual snapshots or worker batches build actual history. A unique account/revision minute bucket prevents concurrent duplicates; a ledger revision check prevents recording an outdated book. The UI shows the most recent 365 actual snapshots. Two distinct observations are required for the labeled Modified Dietz return estimate. SPY comparison is a price return excluding dividends and requires both benchmark observations. Equity history is affected by cash flows; it is not an invented backtest or tax report.

## Sender readiness and worker email

Dashboard → Service health & monitoring has owner-only **Check email sender readiness** and **Send a test email to my account** controls. Setting presence is not proof of domain verification. The read-only readiness action distinguishes missing settings, malformed sender, rejected key, pending/verified domain and unknown verification. A send-only key may lack domain-read permission; verify directly in Resend rather than widening privileges merely for this indicator. See [Resend domain states](https://github.com/resend/resend-openapi/blob/main/resend.yaml).

The self-test sends only when clicked, only to the authenticated owner's address, and awaits provider acceptance. Acceptance does not prove inbox placement or worker delivery. The older test route that declared success before awaiting Resend is removed. Implementation tests sent no real emails.

1. Configure RESEND_API_KEY and RESEND_FROM_EMAIL privately in Render. Verify the sender domain/DNS in Resend. Configure SITE_URL to the exact HTTPS frontend origin for account verification/reset links. Do not put secrets in Git or chat.
2. Check readiness, then click the self-test. Confirm provider acceptance and independently inspect inbox/spam and the Resend delivery event.
3. Deploy `researchWorker.js` as a separate always-on Node worker using `npm ci --omit=dev` and `npm run worker`. `render-worker.example.yaml` is an optional paid-service blueprint, not an already-created service.
4. Supply the SAME MONGO_URI, FINNHUB_KEY, sender and owner/public settings as the web service; set BACKGROUND_ALERTS_ENABLED=true on the worker. Keep the web flag false until a recent successful worker heartbeat exists, then set its flag true. Preserve the existing access restrictions.
5. Opt in under Stock Movers → Email preferences. Worker checks bounded rotating alert batches every two minutes. It attempts one eligible account snapshot per cycle, no more often than hourly per account; population/queue/provider limits can increase latency. A renewable database lease prevents overlapping cycles.
6. Trigger a disposable alert with a verified quote, close the browser and confirm delivery history/inbox. In staging, test a stale/noncrossing quote, a temporary send failure, retry and opt-out. Do not deliberately break production credentials. Messages go only to the account address; locked-out users and pre-opt-in alerts are skipped.

Email delivery has five attempts, leases and stable provider idempotency keys, with sent/failed/skipped states. Failed items can be requeued by their owner after fixing configuration. This is retry-based delivery, not an exactly-once guarantee across arbitrary outages. No recent successful heartbeat for ten minutes is stale; inspect counts/partial failures.

## Monitoring, security and tests

Owner operations show database, uptime, worker health and aggregate API latency/error counts. API aggregates keep fixed categories, not raw request paths, queries, identities or payloads. Optional browser signals default off and send only a fixed error type/tab name, at most ten per page. No error messages, stacks, symbols or URLs are included. Counts reset with the web process; these are not durable analytics.

Set GitHub repository variable STOCKAI_MONITOR_URL to the production Render HTTPS origin. The production-health workflow runs every thirty minutes or manually and checks liveness, database, verified SPY response and deployment commit. It is skipped without that variable. Normal GitHub notification preferences control failures.

Session checks enforce HS256, database user existence, token version, verified-email and instance access flags. Database outages return unavailable rather than invalid-password errors. Existing account recovery/password changes revoke prior sessions. The request limiters remain process-local; multi-instance public scaling requires a shared/edge limiter.

- `npm test`: calculations, validation, provider/worker fixtures and regression checks.
- `npm run test:browser`: real Chromium desktop/phone layouts with explicitly simulated APIs. Covers all eight tabs after Portfolio, outage/light/reduced-motion views, lists/screens/ledger/preferences, keyboard search, custom screens, corporate actions and sender readiness. It does not use a live database or send emails. Linux/CI: `npx playwright install --with-deps chromium`. Windows: install Chromium with PLAYWRIGHT_BROWSERS_PATH set to the checkout's `.playwright-browsers` directory.
- `npm run test:integration`: an isolated disposable MongoDB replica set with actual routes/models and test JWTs. Covers two-account persistence/isolation, conflicting saves, idempotent entries, snapshot separation, expired/revoked/unverified sessions and encrypted restoration. It downloads a test MongoDB binary, uses fixture quotes and never connects to Atlas. CI runs it separately.
- CI audits production dependencies and keeps browser failure reports/traces. Passing tests are not evidence of live provider coverage, domain setup or inbox delivery.

## Encrypted backups and restoration drill

Prefer managed Atlas point-in-time backups for production. Supplementary scripts support at most 20,000 documents per application collection and 64 MB plaintext, stopping above those limits. They need a replica set (Atlas supports transactions), read account data in a snapshot transaction and retain BSON types/indexes. Worker heartbeat leases are omitted. Index definitions are captured afterward; avoid schema/index migration during export.

1. Privately set MONGO_URI, BACKUP_FILE ending `.stockai-backup`, and a unique BACKUP_PASSPHRASE of at least twenty characters. On a trusted administrative host run `npm run backup`. It writes a new AES-256-GCM archive, refuses overwrite and writes no plaintext file. Keep the passphrase in a separate secrets store; avoid command arguments, Git and chat.
2. Store archives offsite with controlled access. Configure daily managed/operator scheduling and retention. No storage account or production schedule is created by these scripts.
3. Set RESTORE_MONGO_URI to a separate empty database ending `_restore_test`, RESTORE_CONFIRM_DATABASE to its exact name, and the archive/passphrase settings. Run `npm run restore:test`. It refuses populated/other targets and never deletes a database. Wrong passphrases and damaged archives fail authentication. Recovery bumps session versions and removes password-reset/email-verification tokens so users need fresh sign-in/links.
4. Inspect collection counts, indexes, account ownership, holdings and ledger balances. The integration test exercises real encryption, BSON IDs/dates and restoration. Production promotion is a deliberate administration operation outside this tool. Keep the drill database inaccessible to the public application and dispose of it through your normal database administration process.

## Exact live verification after merge

1. Deploy both frontend and Render web backend at this revision; check `/api/version`, `/api/health` and PWA update. Verify `/server.js`, `/.env` and test/backup paths return 404 at every public origin.
2. As owner, inspect sender readiness, fix settings/domain DNS privately and perform the inbox self-test. Deploy/verify the worker separately and test one opted-in alert with the browser closed, then opt-out/failure/retry in staging.
3. With two permitted test accounts, save different lists/screens/ledger entries, reload, sign out/in and confirm isolation/persistence. For an owner-only deployment, use a separate staging service rather than relaxing production access. Exercise password reset and rejection of earlier sessions.
4. Check SPY, XLK and GLD on Dashboard/Markets, and every tab after leaving Portfolio. Compare source timestamps/currencies against provider records. Inspect a covered company's statements/dividends/splits against its original filing; check periods, units and ratios. Confirm non-USD/unconfirmed custom screener rows are excluded. Simulate provider outages in staging and confirm no numeric substitutes appear.
5. At phone and desktop widths, use keyboard search, research lists, custom screening and ledger entries including a split; capture two actual snapshots. Check controls, no horizontal overflow, light/dark and reduced motion.
6. Activate the external health workflow, inspect aggregate reliability and opt in to browser signals only if desired. Enable managed backup retention and complete the disposable restore drill before depending on recovery.

Hosting access is still required to inspect production settings and establish domain verification, inbox delivery, worker hosting, monitoring variables and scheduled offsite backups. Local/CI success does not establish those facts.


The next follow-up adds company comparison/CSV, connection reporting and chart/portfolio reliability repairs. See [the audit and complete tested cases](stockai-audit-2026-10-26.md). Portfolio quote responses now include verified USD/source/observation metadata and reject stale/unknown currency; deploy frontend and backend together.
