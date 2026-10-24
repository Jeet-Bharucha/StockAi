# StockAI capability coverage

The research essentials are present in source: symbol search, provider quotes and timestamps, historical charts with SMA/compare, technical signals, saved watchlists and portfolios, ETF market overview, news, curated movers, bounded screening, CSV export and saved browser-checked alerts. Production availability still depends on the active deployment, database and providers. Automated regression coverage is not a substitute for signed-in end-to-end QA.

The Aurora update adds brighter shared colors, visible primary/secondary actions, light/dark variants, hover/entry feedback with reduced-motion support, visible quote provenance/time, and chart retry. Prices stay still rather than flashing or animating through invented intermediate values.

The account research release adds provider-backed fundamentals and earnings, an independent USD transaction ledger with actual snapshots and SPY comparison, opt-in worker email, multiple lists/notes/targets, saved fundamental screens and browser/production monitoring. See [deployment and operating instructions](research-workspace-rollout.md) for prerequisites and limits.

Still outside this implementation: exchange-wide security discovery, automatic corporate-action/FX/tax-lot accounting, licensed exchange-real-time coverage guarantees, browser push delivery and brokerage execution. Fundamental fields depend on provider entitlements; background email requires the separate worker and verified sender. The capability categories were compared against [TradingView's official features](https://in.tradingview.com/features/); this is not a claim of full parity.
