# StockAI capability coverage

The research essentials are present in source: symbol search, provider quotes and timestamps, historical charts with SMA/compare, technical signals, saved watchlists and portfolios, ETF market overview, news, curated movers, bounded screening, CSV export and saved browser-checked alerts. Production availability still depends on the active deployment, database and providers. Automated regression coverage is not a substitute for signed-in end-to-end QA.

The Aurora update adds brighter shared colors, visible primary/secondary actions, light/dark variants, hover/entry feedback with reduced-motion support, visible quote provenance/time, and chart retry. Prices stay still rather than flashing or animating through invented intermediate values.

For broader platform coverage, the following are **not connected or guaranteed**:

| Capability | Current gap |
| --- | --- |
| Fundamentals, financial statements, corporate actions and earnings | Needs a licensed and normalized data source; earnings currently displays an explicit unavailable state. |
| Exchange-wide screening | Current universe is curated and bounded, not an exchange inventory. |
| Background alerts and push/email delivery | Saved alerts are checked while the browser is open; dependable background delivery needs an always-on worker, delivery setup and monitoring. |
| Portfolio performance over time | Real daily account snapshots and treatment of cash flows/splits/dividends are needed; cost-basis P/L is not a historical return curve. |
| Intraday/exchange real-time coverage | Needs provider entitlements and licensing; latest-available quotes can be delayed. |
| Operational assurance | Run signed-in QA, provider-outage checks and deploy monitoring before claiming all flows are live. |

Reference used for capability categories: TradingView's official features overview, https://in.tradingview.com/features/. This is a comparison checklist, not a claim of feature parity.

Visual QA for this release: inspect all eight tabs at desktop and 360px widths in both themes, keyboard focus and reduced motion; check primary buttons, table overflow, menu visibility and unavailable states. Verify quote source/time against the response. Block candle requests, use Retry chart, then restore connectivity. Keep the tab-structure regression checks from PR #17.
