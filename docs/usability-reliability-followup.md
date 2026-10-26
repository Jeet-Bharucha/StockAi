# StockAI usability and reliability follow-up

This release improves everyday research and navigation after PR #21. It does not claim that a market-data provider, email service or hosting plan can never fail.

## Changes

- Research shortcuts make Markets, company comparison and service status easy to find from the dashboard. Accent colors and a short entrance animation use the existing theme; reduced-motion preferences are respected.
- Chart comparisons now reject invalid symbols and require a loaded base chart. Clear, close, ticker changes and newer requests invalidate slow responses. Comparison labels explain the separate price scales rather than implying normalized returns.
- Changing the base stock clears previous moving-average and comparison overlays immediately, including when navigating from portfolio or market cards.
- Edit-holding, keyboard-shortcuts, account and data-setup dialogs have accessible names, contained keyboard focus, Escape dismissal from input fields, background interaction protection, scrollable content and focus restoration.
- Large dialog close buttons and mobile scrolling keep controls reachable. A skip link and focused section heading improve keyboard navigation.
- Company comparison distinguishes sign-in expiry, request limits and timeout errors from missing fundamentals. Old/future quote timestamps are rejected, unavailable session changes do not acquire a percent sign, and export is disabled until results exist or while refreshing.
- Service worker cache version advances so the new script and styles are delivered.

## Verification boundaries

Regression tests, browser fixtures and production data are separate evidence. Browser fixture tests never send email, invoke paid AI, modify production accounts or use production MongoDB. Live signed-in dashboard interactions remain unverified because the private-site login was not accessible in the audit browser.

Email sender configuration, reliable background alert processing, optional AI credentials and password recovery remain deployment setup work. This release does not enable these features or change production environment variables, access controls, paid plans or notification recipients.

## Post-merge checks

1. Wait for Render to report the merge revision as live; confirm `/api/version` matches and `/api/health` reports a connected database.
2. Hard-refresh the private dashboard. Use each research shortcut on desktop and a phone.
3. Open a chart comparison, clear it while loading, then change the base stock. The cleared line/legend must not return. Confirm closing comparison also removes it.
4. Open Edit Holding. Tab/Shift+Tab must remain inside; Escape from a field closes it and returns focus. On a short phone screen, scroll to Save Changes and the close button.
5. Compare company symbols. Check source/time/currency, CSV export, and explicit unavailable fields. An expired session must ask for sign-in rather than silently claiming fundamentals do not exist.
6. Recheck all eight tabs, light/dark mode, reduced motion and offline recovery. Missing provider data must never generate invented prices or returns.
