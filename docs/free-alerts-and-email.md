# Free alert checks and owner email setup

## Free mode

Set `WEB_ALERT_CHECKS_ENABLED=true` on the existing web service. After a 30-second startup delay, it checks saved price alerts approximately every five minutes **only while that web process is awake**. It does not ping the service to prevent sleep, create hosting resources, or run an always-on worker. Sleep, restart and provider failures can delay or miss a price crossing; this is not continuous monitoring.

The loop waits for MongoDB, finishes a cycle before scheduling the next, and retries failures. The existing database lease prevents overlapping cycles across instances. Private-instance checks filter every alert/delivery query to the permitted owner before requesting quotes or changing records. Existing quote validation, opt-in timestamps, recipient access rules, delivery leases, capped retries and provider idempotency remain in use. It does not enable email preferences automatically and does not create automatic portfolio snapshots in free mode. Pending deliveries resume on a later awake cycle. A dedicated `BACKGROUND_ALERTS_ENABLED=true` configuration takes precedence and disables this local loop.

Keep the separate worker flag false on this free deployment. The connection panel and owner health panel identify the mode and distinguish configuration from heartbeat and inbox delivery.

## Owner-only email

The existing Resend key is retained. `RESEND_FROM_EMAIL=StockAI <onboarding@resend.dev>` selects Resend's testing sender; `SITE_URL` is the exact StockAI HTTPS origin. The sender can send only to the email associated with the Resend account. These settings expose the existing password-recovery path but do not prove delivery. Sending to general subscribers still requires a verified domain.

Readiness now identifies owner-test mode without searching the user's domain list for resend.dev. The owner-only self-test retains its fixed account recipient and authentication/rate limits. Rejections return an allowlisted explanation for key, permission, recipient-test restriction, sender-domain, rate-limit and timeout failures. Raw provider details, addresses, keys and URLs are not returned.

## Validation and rollout

150 regression tests pass locally, including the scheduler's disabled mode, database readiness, failure retry, non-overlap, stop behavior and dedicated-worker priority; email classification is tested for privacy and recipient restrictions. A desktop/mobile browser scenario checks the free-mode wording and preserves email opt-out.

After merge, confirm the new revision is live, `/api/health` reports MongoDB connected, and `/api/capabilities` reports processing mode `web-best-effort` with `backgroundWorkerEnabled=false`. In the signed-in owner panel, inspect the latest successful cycle and counts after the startup delay. Send one owner test email from the existing button, record its status, and check inbox/spam. If rejected, follow the displayed safe reason. Do not call email delivered solely because the provider accepted it. Do not test password reset by changing the owner's password without the owner's participation.
