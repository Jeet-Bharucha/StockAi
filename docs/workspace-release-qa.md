# Workspace release verification

This change improves shared dashboard behavior and presentation. Automated tests do not establish that every external provider or signed-in production flow is available.

Before merge: inspect the Netlify preview at desktop, tablet and 360px phone widths, in light/dark mode and with reduced motion. Check header controls, chart actions, portfolio edit/delete controls, notification panel, mobile navigation and keyboard focus. Verify a missing chart library cannot leave the opening loader covering the app.

After merge: confirm Render and Netlify production use the merge commit, CI passes, and the service worker uses stockai-v26-tab-structure-2. Hard-refresh or reopen the installed PWA. Through normal owner authentication, confirm /api/health reports database connected.

| View | Required live check |
| --- | --- |
| Dashboard | Select SPY, XLK and GLD; quote begins independently of slow profile/history; switch symbols quickly and confirm no previous symbol's data remains. Refresh, ranges, SMA and compare work when history exists. |
| Technical Signals | Insufficient history shows no numeric signal; sufficient history computes indicators; historical/forward evidence and explicitly requested AI commentary return data or useful errors. |
| Watchlist | Add, remove, sort, reload and verify persistence using the owner's test symbols. |
| Portfolio | Add/edit/remove a disposable holding, refresh prices, inspect mobile horizontal scrolling and export CSV. |
| Markets | All three grids render before requests complete; Refresh and click-throughs work; source/timestamps are visible. |
| News | Change stock/market mode and refresh; headlines open their publisher and outage states are explicit. |
| Stock Movers | Verify sort order and quote coverage; test saved-alert create/remove with a disposable alert. |
| Screener | Run a bounded scan, apply filters, open a result, export CSV; unavailable quotes are excluded or labeled. |

With DevTools offline/request blocking, check the offline notice and unavailable states. Restore connectivity and retry. A failed quote must never become a simulated price or a default 0% gain. Verify the fallback independently in a controlled environment by rejecting Finnhub, then rejecting both providers (expect QUOTE_UNAVAILABLE).

No account flags, credentials, database schemas or production records need changing for this release.
