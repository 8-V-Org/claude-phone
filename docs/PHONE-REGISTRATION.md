# SIP registration recovery

Both multi-registrar and legacy registrar use lib/registration-loop.js. Final 401/407 and other failures retry after 5,10,20,40,60 seconds (capped). Every attempt has a 30-second watchdog, including missing request callbacks. Only the current transaction generation may update state; duplicate/late responses are ignored. Success parses Contact expires then Expires, refreshes at 80% of granted lifetime, and rejects zero/invalid lifetimes. Stop clears retry, watchdog and health timers.

Every 30 seconds REGISTRATION_STATE logs a credential-free snapshot; the check restarts a loop lacking both watchdog and scheduled next attempt. registered means the last acknowledged binding has not expired, not end-to-end calling health. No new HTTP status endpoint is exposed. Use /opt/data/scripts/phone-ctl logs voice --tail 100. getStatus() is available on both wrappers.

Tests: node --test openclaw-adapter/*.test.cjs. Deployment: phone-ctl build voice, then phone-ctl recreate voice. Confirm repeated SUCCESS - Registered as ext 30911 lines across a refresh, not just a running container. Do not use repeated fast retries for persistent wrong credentials; backoff caps at one request per minute until corrected.
