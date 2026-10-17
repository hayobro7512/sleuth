# Sign-up Shield

Chrome extension that highlights pressure tactics (cookie banners, free trials, checkout, cancellation) and explains what "Accept" means. A local API calls NVIDIA's free hosted models; every flagged quote must appear literally on the page.

## Quick start (5 minutes, no Go needed)
Needs Node 18+ and Chrome.
1. `git clone https://github.com/hayobro7512/sleuth && cd sleuth`
2. Get a free key at https://build.nvidia.com ("Get API Key"). `cp .env.example .env` and paste the key into `.env`.
3. `sh start.sh` (leave it running).
4. Chrome → `chrome://extensions` → Developer mode → Load unpacked → pick the `extension/` folder.
5. Open http://shield.localhost:8787/demo/banner.html and click anywhere. Warnings appear under the text. `/demo/clean.html` should show none.
6. Your saved history (merchant names, flagged wording, prices only) is at http://localhost:8787/dashboard.

History saving is on by default and stores no page text, no personal data, no URL queries. Turn it off in the badge panel.
Use `shield.localhost`, not `localhost`, for demos: it is on the Grammarly agent's URL Blocklist so Grammarly corrections do not hide Go's warnings.

## Add Superhuman Go (underlines on real sites + chat about your history)
1. Build an agent in Go (go.superhuman.com → builder). Paste `docs/agent-instructions.md` as its instructions. Add the "While writing" trigger.
2. Connector: `cd pack && npm install && npx packs upload pack.ts` then `npx packs release pack.ts --use-latest` (needs a free Coda/Packs account). Add the connector to the agent.
3. Make the backend reachable: `sh scripts/run.sh` (see `docs/PERMANENT_TUNNEL.md` for a fixed address). Sign in to the connector with that https address and the token from `cat ss_token.txt | pbcopy`.
4. Ask the agent: "What should I know before buying from amazon.com?", "Rank my recurring costs per year", "What renews soon?"

Check the grounding filter: `node server/server.js --selftest`. Connector tests: `cd pack && SS_ENDPOINT=http://localhost:8787 SS_TOKEN=$(cat ../ss_token.txt) npm test` (backend started with the same `SS_TOKEN`).

## GoLens: build your own version of this
The trick that lets Go underline non-editable page text (make regions editable inside a real click, focus them one by one, lock the text) is now its own tool: **[GoLens](https://github.com/hayobro7512/golens)**. One command scaffolds a Chrome extension plus Go agent instructions for any kind of text (refund terms, medical notices, job ads). Sleuth's inline engine is the same code with Sleuth-specific cues added.

## Inline mode (default): Go underlines the page itself
No backend or model call. On a consent, trial, or checkout page the extension makes nearby text blocks editable and focuses one inside your next real click. Go's "While writing" trigger then underlines them with its own card. Findings from experiments: `docs/GO_INLINE_FINDINGS.md`. Switch modes with the badge, then **Mode**.

## Go mode (optional)
Click the badge, then **Mode**, to switch from Direct to Go agent. The extension then files a job and waits for the Go agent to analyze it. See `docs/GO_CONNECTOR.md`. Start the server with `SS_TOKEN=...` to enable connector routes.

## Memory
In the default inline mode Go's findings stay inside Go's UI, so with History on the extension also sends the redacted page text to the backend once, with nothing shown, to save the findings (analyzed by the NVIDIA model, not Go).
History is on by default (badge, then **History** to turn it off). Review or delete everything at http://localhost:8787/dashboard. The panel's "Before you continue" checklist uses this page plus earlier visits. Go reads the same history through the Pack (`docs/GO_CONNECTOR.md`).

## Purchases, renewals, and the weekly digest
Turn on **Track purchases** (badge, then the panel). On a confirmation page the extension asks "Did you complete a purchase?"; Yes or Not sure saves the plan, price, and trial end. Go answers "what is renewing soon?" and runs a Monday 9 AM digest from it (`docs/GO_CONNECTOR.md`). Start everything with `sh scripts/run.sh`.

## Known limits
- Reads text only: button size, color and pre-ticked state are not seen.
- Closed shadow DOM is unreachable. Iframes work (`all_frames`).
- Page text goes to the NVIDIA API; do not run it on private pages (email, banking).
- Free tier is ~40 requests/min; the server caps at 30/min.
