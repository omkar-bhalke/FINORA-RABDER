# Parent Connect deployment

Render generates the previous 24 hours' statement for the saved local time, sends it through the official WhatsApp Business Cloud API and receives delivery callbacks. The phone may be off at the scheduled time. Firestore stores existing ledger records, consent and scheduling. Realtime Database streams bot activity into Parent Connect. APK installation alone does not start the worker.

1. In Firebase project `finoraaaaaa`, check that Realtime Database is enabled for the URL in the supplied Android configuration. Review and merge any existing rules before deployment. From FINORA-112, deploy `firebase deploy --project finoraaaaaa --only database,firestore:indexes`. Apply the project's Firestore rules after reviewing any existing app data access requirements.
2. In Render choose **New → Blueprint**, select [omkar-bhalke/FINORA-RABDER](https://github.com/omkar-bhalke/FINORA-RABDER) and its main branch, and load `render.yaml`. Review instance costs before applying. Keep both the web service and the always-on background worker running. Both use `npm ci --include=dev && npm run build`. The web service starts with `npm start` and the worker with `npm run worker`.
3. In Render Environment Groups open finora-config and add the following values so both services receive them. Redeploy both services after saving. Use the backend's `.env.example`. Set `FIREBASE_DATABASE_URL` to the existing RTDB URL and `FIREBASE_STORAGE_BUCKET` to the project's bucket. Store the Admin service account JSON, Meta token, app secret and webhook verification token in Render. Keep `LIVE_REPORTS=false` during setup.
4. Open the web service's HTTPS URL with `/health`. A JSON status of `ok` confirms the HTTP process is up. In Firebase Console → Realtime Database → Data, set the string `serviceConfig/reportApiUrl` to that HTTPS origin without a path. The app discovers it when a signed-in user opens a report action. A Gradle `finoraApiUrl` override takes precedence for development.
5. Configure the business phone number, phone number ID, supported Graph API version and approved template names. Subscribe Meta's **messages** webhook to the web service's `/webhook` endpoint using the same verification token. Summary templates accept four parameters for period, income, expenses and count. The detail template accepts a fifth parameter.
6. In FINORA → Profile → Parent Connect, save the parent's phone number in international format, report time, timezone, sharing choices and consent. Preview the saved settings on Render. Request a verification code. The parent sends that exact code from their own WhatsApp number to the business number within ten minutes. Check integration status in the app.
7. For a verified, consenting production recipient, an authorized operator enables `productionApproved` on that user's server-owned Firestore `integrations/recipient` record. Keep test accounts unapproved. Enable scheduled reporting in the app and set `LIVE_REPORTS=true` on the production worker and API when ready for actual delivery.
8. Open **Parent Connect → Statement bot log**. Each of the latest 30 scheduled reports shows the scheduled time, generation time, WhatsApp acceptance time and latest delivery callback when available. Times use the configured report timezone. A report can be accepted before delivery is confirmed. Uncertain network outcomes are retained for review to avoid duplicate sends. The worker syncs the log each cycle and retries outstanding writes after temporary RTDB outages.

Report log records under `reportActivity/{uid}/{local-date}` contain a snapshot of the statement parameters shared with WhatsApp, the masked recipient suffix, per-attempt events, and delivery timestamps. Tap **View statement & message history** to inspect them. A user can read their own entries. Client writes to report activity and service configuration are denied. Use the supplied database rules before setting the server origin. For Android Play Integrity, register the app's signing certificate and use an eligible test installation before testing authenticated Render endpoints.

## Debug APK se pehla connection

Install the current APK from the Android repo's apk directory and sign in to the supplied Firebase project. The debug build uses a per-installation Firebase App Check debug token. Open a Render preview action, find the locally generated token in Android Studio Logcat under DebugAppCheckProvider, and register it in Firebase Console → App Check → Android app → Manage debug tokens. Keep the token private and revoke it after testing. Release builds use Play Integrity.

## Render environment values

| Key | Value to enter in finora-config |
|---|---|
| FIREBASE_SERVICE_ACCOUNT | Service account JSON for finoraaaaaa with access to the app's Firestore, RTDB, Auth and Storage resources. Store as a single secret value. |
| FIREBASE_DATABASE_URL | https://finoraaaaaa-default-rtdb.asia-southeast1.firebasedatabase.app |
| FIREBASE_STORAGE_BUCKET | finoraaaaaa.firebasestorage.app |
| META_BUSINESS_NUMBER | International-format WhatsApp Business number parents send verification codes to |
| META_PHONE_NUMBER_ID | Phone Number ID from WhatsApp Manager |
| META_ACCESS_TOKEN | System-user access token permitted to send WhatsApp Business messages |
| META_APP_SECRET | Meta application secret for validating webhook signatures |
| META_VERIFY_TOKEN | A secret value you generate and enter in both Render and Meta webhook setup |
| META_GRAPH_VERSION | Active Meta Graph API version for your Meta app, including the leading v |
| META_TEMPLATE / META_DETAIL_TEMPLATE | Approved summary and detail template names |
| META_TEMPLATE_LANGUAGE | Exact approved language code for both templates |
| LIVE_REPORTS | false during setup, true for consented production delivery |

**First check** — fetch /health, sign into the app, save Parent Connect settings, and tap Preview saved report settings on Render. Check the preview against a known ledger entry. After recipient verification, a real scheduled production report should produce a generated event, a send attempt and a provider acceptance. Sent, delivered and read events appear when Meta supplies them. If no report appears, check the worker state, your timezone, production approval, consent, Firestore indexes and the worker log for report_log_sync_failed.
