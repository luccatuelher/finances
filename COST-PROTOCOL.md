# Cost-protection protocol (Firebase / Google Cloud)

Goal: never get a surprise bill like the "runaway loop" stories. Do the steps **in this order**. Steps 1–3 matter most.
No secrets belong in this file (the repository is public). Console labels may differ slightly from what is written here.

Project: `webapps-cbefa` (shared by finances, boardhub, portfolio). Hosting is GitHub Pages (no usage billing).

---

## 1. Check the plan (2 min)

Firebase Console → project `webapps-cbefa` → bottom of the left sidebar shows **Spark** or **Blaze**.

- **Spark (free, no card):** there is no surprise bill. At the quota the service just stops. Go to step 2.
- **Blaze (pay as you go):** there is **no automatic spending cap**. Do steps 2 and 3 without skipping.
- Don't infer the plan from `storageBucket` in the app config: that field is filled in for every web app even if Storage is unused.
- If Blaze is only there for Storage in boardhub, keep it and rely on step 3. If nothing needs it, going back to Spark is the safest cap.

**Done when:** you know which plan it is.

## 2. Lock the rules of every service (the real control)

Rules decide who can generate reads/writes/downloads on your account. Check each service:

| Service | Where | Used by |
|---|---|---|
| Realtime Database | Build → Realtime Database → **Rules** | finances |
| Firestore | Build → Firestore Database → **Rules** | boardhub |
| Storage | Build → Storage → **Rules** | boardhub |

**Fail if you see any of these:**
- `if true`, or `".read": true` / `".write": true`;
- an expiry such as `request.time < timestamp.date(...)` (test-mode rules; they either expire and break the app or stay open);
- access that only requires a signed-in user (`request.auth != null`) when **anyone** can sign in with Google. Access must be tied to the owner: `request.auth.uid == userId` (or an explicit allow-list).

**Realtime Database must match `database.rules.json` in this repo** (only the `finances` and `finances_bak` blocks for this app; keep other apps' blocks in the console, do not overwrite the whole file):

```json
"finances":     { "$uid": { ".read": "auth != null && auth.uid === $uid", ".write": "auth != null && auth.uid === $uid" } },
"finances_bak": { "$uid": { ".read": "auth != null && auth.uid === $uid", ".write": "auth != null && auth.uid === $uid" } }
```

**Done when:** each service's rules are owner-scoped with no expiry. Paste the Firestore and Storage rules in the chat and Claude will version them in the boardhub repo.

## 3. Budget alert (Blaze only, 5 min)

Project settings (gear) → **Usage and billing** → **Details & settings** (opens Cloud Billing) → **Budgets & alerts** → **Create budget**.

- Scope: only project `webapps-cbefa`. Amount: **US$ 5 / month** (adjust to taste).
- Alert thresholds: **50%, 90%, 100%**. Email to the billing account owner (add a second address if you have one).
- This **only warns** — and with a delay of hours. It does not stop anything. A hard cap (Pub/Sub + a Cloud Function that unlinks billing) exists, but it can break live apps and also lags, so use it only if you explicitly want a hard ceiling.

**Done when:** a test budget exists and you receive the confirmation email.

## 4. Review the last 30 days

- Usage tab of each service (Realtime Database, Firestore, Storage, Authentication).
- Google Cloud Console → Billing → **Reports** → filter by project → cost per service.
- A single spike in reads/writes/downloads means a possible loop. Note the date and tell Claude: the app code and the CI history help find the cause.

**Done when:** no unexplained spike, or the spike is understood.

## 5. Restrict the browser API key (optional, low priority)

Google Cloud Console → APIs & Services → **Credentials** → the project's *Browser key* → Application restrictions → **HTTP referrers**:

- `https://luccatuelher.github.io/*`
- `https://webapps-cbefa.firebaseapp.com/*` (the sign-in iframe runs here — omitting it breaks login)
- `http://localhost:*/*` only if you develop locally.

The key is public by design and the data is protected by the rules (step 2); this only limits use of the key from other sites. **Test login right after changing it.**

---

## What the app already does (finances)

- **Sync circuit breaker:** if devices start a read/write loop (more than 60 reactive writes in 10 min, or 400 round-trips), sync pauses itself and shows "Pausado". The pause doubles on repeated trips (up to 6 h). The Sync button resumes immediately; signing in resets it. See `CONFIG.SYNC_DISJUNTOR_*`.
- Daily backup is limited to one write per day; background polling to GitHub is at most every 2 minutes (GitHub API, no cost).
- The Backup panel shows the data size and warns above 1.5 MB (each sync sends/receives the whole base).
- Browser-side protections: a Content-Security-Policy blocks injected scripts; the rules above block other users' data.

## If an alert fires or the numbers look wrong (emergency stop)

1. Realtime Database → Rules → set `".read": false, ".write": false` at the root and **Publish**. This stops all traffic immediately and is reversible (restore `database.rules.json`). For Firestore/Storage use `allow read, write: if false;`.
2. Check Usage to see which service and when it started; check which app/device was active.
3. Tell Claude the date and service. Fix the cause, then restore the rules.

## Routine (2 minutes, monthly)

- Look at Usage and billing for the month; confirm the budget email still goes to the right address.
- After any change to sync, listeners, or rules: run `node tools/checks.mjs` and look at the GitHub Actions result.
