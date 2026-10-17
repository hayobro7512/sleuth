# Go connector (Go mode)

Status (2026-10-16): working end to end. The Pack (your own Pack id) is uploaded, released, connected in Go, and added to the Sign-up Shield agent. In a fresh chat, "What should I know before signing up with shield.localhost again?" made Go call `GetMerchantHistory`; the server logged `GET /v1/merchants/shield.localhost -> 200` from `Coda-Server-Fetcher` through the tunnel, and Go answered with the saved dates and exact quotes.

**Gotchas found**
- `packs upload` is not enough: Go failed with "No live pack version found for packId <your id>" until `npx packs release pack.ts 1 --notes "..."` was run. Release again after every upload.
- A chat that already hit an error may answer from its own context without calling the tool; test in a fresh chat.
- The Discover list in Go's Connectors page does not show connection state; check "Your connectors".
- `localhost` is rejected by Go-side domain fields; use a real-looking name such as `shield.localhost`.
- The server logs one line per request (method, path, status, whether auth was present, never the token) so a failing connector call is visible.
- The bearer token lives in `ss_token.txt` (git-ignored, mode 600). Copy it without showing it: `cat ss_token.txt | pbcopy`. Sources: Packs SDK docs (coda.io/packs/build/latest) and the Superhuman help center.

## Why asynchronous
Nothing can call a Go agent from a web page, and Go's documented triggers are scheduled, proactive writing help, email, and Slack. So the extension files a **job**; Go reads it when someone asks ("check my pending pages"); the extension polls for the result and draws the highlights. Direct mode (the default) skips Go and stays automatic.

```
extension --POST /v1/page-jobs--> backend <--list pending / submit findings-- Pack (Go connector) <-- Sign-up Shield agent
extension --poll GET /v1/page-jobs/:id--> backend
```

## Backend routes (server/server.js)

| Caller | Route | Auth | Purpose |
|---|---|---|---|
| extension | `POST /v1/page-jobs` `{text,url}` | local only (no `x-forwarded-for`) | file a job -> `{jobId,status}` |
| extension | `GET` / `DELETE /v1/page-jobs/:id` | local only | poll / cancel |
| Pack | `GET /v1/page-jobs` | bearer `SS_TOKEN` | pending jobs `{jobs:[{jobId,page,text}]}` |
| Pack | `POST /v1/page-jobs/:id/findings` | bearer | submit findings -> `{accepted,dropped}` |
| Pack | `POST /v1/page-jobs/:id/fail` | bearer | mark failed |

- Every finding's `quote` must appear literally in the job text, or it is dropped.
- Labels accepted as `FAKE_URGENCY`, `fake urgency`, `FAKE URGENCY`; severity in any case.
- Raw page text is deleted when a job completes or fails; jobs expire after 30 minutes; job IDs are server-made UUIDs.

## Memory (opt-in history)
The extension's **History** button (top of the panel) is off by default. When on, flagged events are saved per merchant: domain, exact quote, label, severity, dates. No page text, no URL query, no personal data. Same wording on the same visit is one event with a count; a visit ends after 30 minutes of quiet. On a revisit the panel's "Before you continue" list mixes this page's findings with earlier ones ("Last time here: ...", with date and quote).

Routes (reads work locally or with the bearer token; deletes are local only):
`GET /v1/merchants`, `GET /v1/merchants/:domain`, `GET /v1/checklist?merchant=`, `DELETE /v1/merchants/:domain`, `DELETE /v1/events/:id`, and the dashboard at `/dashboard`.

Pack formulas: `ListMerchants`, `GetMerchantHistory(merchant)`, `GetChecklist(merchant)`. Their instructions tell Go to answer only from the returned data, cite dates and quotes, and never invent a merchant reputation. Add to the agent instructions: "For questions about a merchant, call GetMerchantHistory (or GetChecklist) and answer only from it. If nothing is saved, say so."

## The Pack (pack/pack.ts)

| Formula | Kind | Notes |
|---|---|---|
| `GetPendingPageJobs()` | read | caching off (`cacheTtlSecs: 0`), otherwise Go would see stale jobs |
| `SubmitPageFindings(jobId, findings)` | **action** | `findings` is a JSON array **string**, because Go can't set vararg parameters |
| `MarkPageJobFailed(jobId)` | **action** | |

- **Go asks you to confirm before running an action**, so expect one confirmation per submit.
- Auth: `HeaderBearerToken` with `requiresEndpointUrl: true`. When you connect the account you enter the backend URL and the token. No network domain is hardcoded; the Pack may only call that URL. The fetcher needs `https`, so `localhost` won't work through Go. Use a tunnel.
- Each formula's `instructions` tells the Go model the finding format and the exact-quote rule.

## Build, upload, connect

1. **Tunnel** (cloudflared is not installed here): `brew install cloudflared`, then `cloudflared tunnel --url http://localhost:8787`. Copy the `https://....trycloudflare.com` URL. (Quick tunnels need no account; verify this is still true.)
2. **Server**: `SS_TOKEN=pick-a-secret sh start.sh`. Keep the secret out of chat.
3. **Upload the Pack** (needs your Superhuman Docs account):
   ```
   cd pack
   npm install
   npm install-scripts approve esbuild      # the CLI build step may need this
   npx packs register                        # opens a browser; paste the API token it shows
   npx packs create pack.ts --name "Sign-up Shield" --description "Reads page jobs from the Sign-up Shield browser extension and returns findings."
   npx packs upload pack.ts --notes "Initial version"
   ```
   The token is saved in `pack/.coda.json` (git-ignored). Never paste it into chat.
4. **Connect in Go**: open go.superhuman.com, left panel -> Connectors, find "Sign-up Shield", sign in with the tunnel URL and your `SS_TOKEN`. A private Pack should appear for you only; I could not verify exactly where it is listed.
5. **Agent Builder**: open Sign-up Shield -> Tools and Access -> + Add connections -> add the connector. Add to the agent instructions: "When asked to check pending pages: call GetPendingPageJobs. For each job, apply the Sign-up Shield rules to its `text`, quote exact words only, then call SubmitPageFindings. If a job can't be analyzed, call MarkPageJobFailed. Reply with one line per page."
6. **Extension**: click the badge -> **Mode** (top of the panel) -> Go agent. Reload the page. In Go say: "check my pending pages". Confirm the action prompts.

## Test it locally (no Go needed)
```
SS_TOKEN=t PORT=8788 sh start.sh
cd pack && SS_ENDPOINT=http://localhost:8788 SS_TOKEN=t npm test
```

## Known limits
- Go only runs when asked, so highlights appear only after you ask. The extension waits about 5 minutes per page.
- Go agent triggers cannot call the connector on their own for browsing pages. The documented proactive trigger ("While writing") underlines text you write, so it does not fit read-only pages.
- One shared bearer token reads all pending jobs. Fine for one user; add per-user tokens before sharing.
- The extension redacts emails, phone numbers, card-like and long numbers; names and street addresses can still slip through, so avoid private pages. Redacted words can't be quoted back.

## Subscriptions and renewals (added 2026-10-17)
- The extension's **Track purchases** toggle is off by default. When on, it remembers a price/trial offer it saw (in this browser only, two days) and, on a confirmation page ("Thank you for your purchase", "Your free trial has started"...), asks "Did you complete a purchase at <site>?" with Yes / Not sure / No. Only Yes or Not sure sends anything to the backend. A page alone never creates a subscription.
- Routes: `POST /v1/subscriptions`, `PATCH` and `DELETE /v1/subscriptions/:id` (local only); `GET /v1/subscriptions` and `GET /v1/subscriptions/upcoming?days=N` (local or bearer). `renewalDate` is the trial end when there is a trial, else the next charge (month/year math clamps, so Jan 31 + 1 month = Feb 28).
- Pack formulas: `ListSubscriptions()`, `GetUpcomingRenewals(days)`. The Pack must be uploaded AND released after every change: `npx packs upload pack.ts --notes "..."` then `npx packs release pack.ts --use-latest --notes "..."`.
- Tested end to end: banner page (offer noted: $239.88/year, 7-day trial) -> confirmation page prompt -> Yes -> saved with trial end 2026-10-24 -> `GET /upcoming` lists it -> in a fresh Go chat "What is renewing or ending in the next 14 days?" made Go call `GetUpcomingRenewals` and answer "$239.88/year, renewing October 24, 2026 (7 days left)" with the quote.
- Weekly digest: the Sign-up Shield agent now has a Scheduled trigger (every Monday 9:00 AM PDT) and instructions to call `GetUpcomingRenewals(14)`. The scheduled run itself has not fired yet (next Monday); the same tool call was tested in chat.
- Dashboard (`/dashboard`) lists subscriptions with Mark cancelled and Delete.
- Permanent address: see `docs/PERMANENT_TUNNEL.md`; `scripts/run.sh` starts server and tunnel from your own Terminal so nothing depends on a Claude session.

### Digest check (2026-10-17)
The Scheduled trigger has no instruction field of its own, and "Run agent" starts the agent with only the message "I want to run this agent". First run: the agent just said it was ready. The instructions now say that when started with no page content and no question it must call `GetUpcomingRenewals(14)` and give the digest. Second run: "Upcoming renewal: shield.localhost - $239.88/year on October 24, 2026 (7 days left)" with the quote. The real Monday 9:00 AM run has not fired yet.
