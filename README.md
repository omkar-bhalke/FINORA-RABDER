# FINOR-RABDER

TypeScript / Node 22 automation service for FINORA. Firebase Admin reads the same `users/{uid}/transactions` and `reportPreferences/daily` schema used by FINORA-112. Financial values use integer paise. No bank credentials are accepted.

## Run and deploy

Run `npm ci && npm test`. Use `npm start` for the API and `npm run worker` for scheduling. Render's Blueprint deploys both from this repository. Connect the exact GitHub repository under Render's New Blueprint, review its service plan and configure the environment group from .env.example in Render. Keep Firebase Admin and Meta credentials in the service environment. Set a supported Meta Graph API version. For the Android build, set Gradle property `finoraApiUrl` to the web service HTTPS origin.

Configure Meta's WhatsApp product with a business number, a token permitted to send WhatsApp messages and an approved utility template with four body parameters in this order: exact report period, income, expenses, transaction count. Subscribe the Meta app to WhatsApp messages and delivery statuses at `/webhook`. Configure the verification token in Render and Meta. The signing secret is the Meta App Secret. Install the Firestore rules and index from FINORA-112.

## API

* GET /health reports process liveness.
* GET /v1/preview returns the authenticated user's preceding 24-hour totals and UTC millisecond boundaries.
* POST /v1/recipient-challenge issues a ten-minute code for the currently consented E.164 recipient. The recipient must send the displayed text to the business number. A signed webhook from that number completes verification.
* GET /v1/status returns recipient verification, the service sending switch and recent per-user delivery records.
* GET /webhook verifies the Meta callback. POST /webhook verifies HMAC on the unmodified body before processing.

The /v1 endpoints require a Firebase ID token in Authorization: Bearer and a Firebase App Check token in X-Firebase-AppCheck. The sender only processes verified numbers with an explicit server-side production permit. After checking consent and production eligibility, an authorized operator sets `productionApproved: true` on the user's `integrations/recipient` document. Never grant production permits to test accounts. LIVE_REPORTS defaults to false. Revoke a permit to stop delivery, or pause reporting in Android.

The worker uses local calendar dates and the configured IANA time zone. Each due slot covers exactly 86,400,000 milliseconds. Each user and local report date has one outbox record, claimed transactionally. A fifteen-minute catch-up window tolerates short outages. Explicit throttling responses are retried. Ambiguous network responses require operator review, because Meta may already have accepted the message. There is no automatic replay of an ambiguous send. Webhook updates are monotonic.

The tests cover time offsets, duration, invalid schedules and numeric validation. Live Render deployment, Meta template approval, end-to-end Firebase authentication and production message delivery require external setup. Keep outbound sends disabled during integration testing.

Use an additional approved template named by META_DETAIL_TEMPLATE for optional report sections. Its fifth body parameter carries the user's selected category, budget, calculated balance and transaction details. Long transaction lists include an omitted-count notice. Balances require a manually recorded starting balance. Set FIREBASE_STORAGE_BUCKET to the bucket in the Android Firebase registration.

DELETE /v1/account requires a sign-in in the last five minutes. It removes the profile image, per-user Firestore records, challenge records and Firebase Auth account. Provide Firebase Admin permissions only on the intended project.

The emulator integration test injects a mock transport and exercises concurrent scheduling, verification gating and revocation without contacting Meta. Run FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 npm test against a local emulator. Without an emulator, the integration test is skipped.
