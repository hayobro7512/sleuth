# What Go's "While writing" trigger does with page text (tested 2026-10-16)

Agent: Sign-up Shield, trigger Proactive assistance > While writing, automatic, applies to Search & browser (plus other site categories). Tested in Chrome with the Grammarly/Go extension, on `demo/editable2.html`.

| Test | Result |
|---|---|
| Pre-filled textarea, page just loaded | no underline |
| Click into the textarea (no typing) | Go underlines 4 sentences, card says e.g. "FAKE URGENCY: ... Severity: Medium", with "Revise or ask a follow-up" |
| `contenteditable` div, real click | underlines appear |
| Same div, `focus()` from a script with no click | no underline (only Grammarly's own grammar mark) |
| Same, after an earlier real click, `focus()` from a script | no underline |
| Ordinary text made `contenteditable`, focus set inside a button's click handler | underline on "A card is required." |
| Focus set inside a `pointerdown` handler | focus is lost to the browser's own mousedown handling, nothing happens |
| Focus set inside a `click` handler on any blank spot | underline appears |
| One short sentence alone ("Only 2 spots left at this price! ...") | no underline: the agent's own rule says act only on qualifying screens |
| Same sentence with "Start your free trial today." in the same text | both urgency sentences underlined |

Conclusions
- Go acts on text it sees focused during a real user gesture; no typing needed. A script-only focus is ignored.
- The extension can do this on the user's next click: set `contenteditable="plaintext-only"` on a text block, focus it inside the `click` handler.
- Each block needs a qualifying cue in its own text, or the agent instructions must tell it to accept isolated text.
- Underlines show only while the block stays focused/editable. One block per click.
- Links and buttons are excluded from editable blocks: links don't navigate inside editable content.

## Later findings (same day, after the agent edits)
- Two gates in the agent, not one. (1) The agent instructions said "act only on qualifying screens". (2) The trigger's own Instructions line said "when viewing a ... page". A lone urgency sentence was underlined only after BOTH were widened to accept isolated text that itself contains a listed tactic (see `agent-instructions.md`; the trigger line now ends "...or any text block that itself contains a listed pressure tactic such as urgency wording, shaming decline text, renewal terms, or partner counts").
- Size gate: a bare one-line editable block (24 px tall) is ignored even when focused. The same text at 40 px tall gets the underline and Grammarly's badge. The extension pads small blocks to 40 px, shifts them up by the same amount with `translate`, and measures the next element to cancel any layout shift. Verified on `demo/banner.html`: only the padded paragraph's own box changed.
- Verified on the banner demo with the real agent: one click anywhere -> Go underlines "Only 2 spots left at this price! Offer ends in 09:59." with its card "FAKE URGENCY ... Severity: Medium" from Sign-up Shield. The next click moves to the next block, whose underlines ("Credit card required.", the renewal sentence) were added while the first stayed.
- One block is focused per click, in page order. The consent banner block is reached after the earlier ones.

## Why Go seemed to "correct the sentence" instead of warning (tested 2026-10-16)
- Cause: Grammarly's own agent also checks any editable field. When its grammar mark lands on the same words as a Sign-up Shield warning, Grammarly's mark wins and the warning is hidden. Seen: "Correct word order: Our 847 partners and we" over "We and our 847 partners", and "Punctuation problem: Friday," over "Monday to Friday 9-5".
- Page attributes do not help: `data-gramm="false"` silences Go as well as Grammarly; `lang="fr"` changes nothing; `spellcheck=false` is ignored by Grammarly.
- Fix for the demo: write demo copy that Grammarly has nothing to correct. After rewording `demo/banner.html`, all three blocks showed only purple Go underlines with cards VENDOR FLOOD (High), PRE-TICKED (High), FAKE URGENCY, HIDDEN RENEWAL.
- Fix for real sites: add the site to the built-in Grammarly agent's trigger "URL Blocklist" (Go -> Grammarly agent -> trigger -> URL Blocklist), or turn that agent's trigger off while using Sign-up Shield. This changes a saved setting, so it is the user's call.
- Clean page (`demo/clean.html`): no badge, no underlines. Blocks that contain buttons or links inside the same element are skipped.

## Demo host and what Go cannot do (tested 2026-10-16)
- The Grammarly agent's URL Blocklist rejects `localhost` ("Enter a domain only, like docs.example.com"). `shield.localhost` is accepted and Chrome resolves any `*.localhost` name to the local machine. It was added to the Grammarly agent's blocklist. Control test with the same text: on `localhost` Grammarly's red "Friday" mark appears and replaces Go's warning on "To cancel..."; on `shield.localhost` all three warnings are Go's, no corrections.
- Underline color is not configurable: the trigger's "Underline color" is a static preview, each agent has one fixed color (Sign-up Shield purple, Grammarly red/blue).
- Go cannot underline buttons or links (not editable). The extension adds an overlay for them: rule-based LOPSIDED CHOICE on the Accept button and EXTRA CLICKS on the Manage link, drawn in our own shadow-DOM layer (above Grammarly's marks) with severity colors and the severity written out. Only when the banner mentions data use and not "essential only" / "do not share" (so `clean.html` gets no marks).

## Amazon fix and delayed marks (tested 2026-10-16)
- Bug: on amazon.com/amazonprime the extension made the cart sidebar ("Your order qualifies for FREE delivery... at checkout") editable instead of the Prime offer, because blocks were taken in page order and that one matched a trigger word first.
- Fix: blocks are ranked by how many different cues they contain (prices, "/month", free trial, renew, cancel, "only N left", partners, "card required"...). A block with no cue is never sent to Go. After the fix the top picks on the Prime page were "Enjoy your free 30-day trial of Prime. After, Prime is just $14.99 per..." (4 cues) and "Only $14.99/month (plus tax) after trial. Cancel anytime." (3 cues).
- The button marks (Accept all, Manage options) stay hidden until 9 s after the first click (Go's scan took 6-10 s). Measured: hidden before the click and at 5 s, shown at 11 s. If a page has no text block for Go to scan, they show at once.
- Testing caveat: from an https page (Amazon), fetching a script from localhost hangs on Chrome's local-network check; test code was pasted inline instead.

## Hiding Grammarly's corrections only while Shield is active (tested 2026-10-16)
- Both agents' marks are drawn inside the open shadow root of `<grammarly-extension>`; Go's underline card is in `<superhuman-go-underline-card>`. Hiding `grammarly-mirror` or `superhuman-go-underlines` changes nothing; hiding `grammarly-extension` removes everything.
- Marks differ by background color: corrections `rgb(242,115,136)` / `rgb(255,153,171)`, Sign-up Shield `rgb(190,161,245)`. Class names are hashed and unstable, so the extension (`quietGrammarly`) goes by color, and hides only colored non-purple marks whose center lies over a block the extension made editable.
- Verified on `demo/gramm.html` (plain `localhost`, not on the Grammarly blocklist): the red "Friday" correction disappears and Go's purple marks remain.
- Limit: when a Grammarly correction overlaps a Go warning, Go's warning is not drawn at all (observed: "To cancel, call support Monday to Friday 9-5." got no purple mark on `localhost`). Hiding the correction does not bring that warning back. Only the URL Blocklist (agent never runs there) avoids both problems.
- Depends on Grammarly's internal markup; if it changes the function silently does nothing.

## One click, every region (tested 2026-10-16/17)
- Focusing several fields in the same task: Go scans only the last. A timer started inside the click can focus the next field and each scan then runs on its own; a gap of 1.5 s worked (9 s worked too). So one click scans every region, about a second apart (`REGION_GAP_MS`, up to 5 regions).
- A region is one container made editable. Its buttons, links, inputs, images, etc. get `contenteditable="false"` (islands). Tested: islands still click and navigate (button, link, "Accept all" handlers all fired), and all the text around them is scanned in one pass (4 marks in the trial box in a single pass).
- Regions with form controls, frames, video, or existing editable parts are never touched. Climbing stops below a container that holds a form control (on Amazon the climb had reached a container with the search box and skipped the Prime offer). Text inside `script`, `style`, `option`, `select`, `textarea` is ignored. Regions are ranked by cue score; a region with no cue (the cart sidebar) is never scanned.
- Text immutability (tested with a real accepted Grammarly suggestion, "Friday" + comma): the page text stayed identical. Edits are blocked with `beforeinput`/`paste`/`drop`/`cut`, and any change that lands within 800 ms of a click or key press is reverted by a MutationObserver. A change with no gesture just before it (a countdown tick) is left alone: tested.
- Not testable from here: the full click flow on amazon.com (code can only be run inline on that page). Region choice on the live Prime page was checked: the two offer paragraphs (4 and 3 cues) are picked and the search-box container is skipped.

## Red count icon (2026-10-17)
Grammarly's red bubble shows its total number (`div.status` inside `div.statusWrapper`, in the `grammarly-extension` shadow root). It still counted the corrections the extension hides, so it said 3 beside 2 visible lines. `quietGrammarly` now subtracts the hidden corrections (each is two elements: line + highlight) and hides the icon when none are left. Tested: 3 -> 2.
Region limit raised from 5 to 8 and the text scan from 60 to 100 matches, for pages like Amazon with many offers.

## Amazon checkout offers page (tested 2026-10-17, live page, only empty space clicked)
- Before: the extension scanned the offer region (362 chars, includes "auto-renews") and a second region, but Go underlined nothing: the agent's "prefer a miss over a false alarm" rule and "visual cues only when reliably available" rule meant a plainly stated price and "Cancel anytime" were not flagged.
- Fix, in the agent instructions: a "Sensitivity: wording-level patterns worth flagging" section with seven wording labels (TRIAL CONVERSION, CANCEL BURDEN, LOSS FRAMING, MEMBERSHIP GATE, PRICE ANCHORING, SOCIAL PRESSURE, UPSELL), Low severity or Medium when charged automatically, still exact quotes only, and HIDDEN RENEWAL for any "auto-renews / authorize us to charge" wording.
- After: "auto-renews" -> HIDDEN RENEWAL (Medium); "Cancel anytime." -> CANCEL BURDEN (Medium); "No access to exclusive member deals & savings events" underlined; the bold terms sentences ("You may cancel anytime by visiting this page and following the instructions. Cancel before your renewal date to avoid the next charge") underlined. Address and payment blocks were not scanned.
- Gap found: Go cannot underline buttons. New extension check `signupFindings`: when a region has a bright "yes" control (Try Prime, Start free trial, Join, Subscribe...) and a "No thanks / Not right now / Skip" link, the sizes are measured (Amazon: 203x35 pill vs 64x20 link = about 6x) and marks are drawn in the overlay: LOPSIDED CHOICE on the big button, HARD TO CLOSE on the small link. Run on the live page as a read-only snippet; shows after the scan like the cookie-banner marks.
- Region cues widened (no access, without Prime, minimum order, was/save/% off, best seller, upgrade, auto-renews, payment method on file) so more of such pages get scanned.
- Backend knows the new labels (history, checklist advice, direct mode).

## Costs, five-merchant backend test, Back button (2026-10-17)
- RECURRING COST label: the price that keeps being charged ("$14.99/month (plus taxes)") is underlined by Go (card: "...about $179.88 per year before taxes. Severity: Medium") and stored in history. Go only did this reliably once the instruction said it is MANDATORY, exactly one per region, anchored to the price words alone, and separate from the HIDDEN RENEWAL comment on nearby words.
- Stored without a model: the extension extracts `{price, billing, trialDays, quote}` from the page text; the backend adds a RECURRING COST finding if the quote is literally in the sent text. `GET /v1/costs` (Pack: `GetCostSummary`) parses every stored RECURRING COST quote plus confirmed subscriptions, computes the yearly amount, and ranks.
- Redaction now also removes street addresses, ZIP codes, "Visa ending in 3716", "Delivering to ...". Checked on the real Amazon checkout text: nothing identifying was left except the greeting "Thomas,".
- Five merchants tested (4 sample pages on `*.shield.localhost` + the Amazon checkout page, whose redacted text was sent exactly as the extension would). The Go agent, through the connector, in fresh chats:
  1. "List every merchant..." -> `ListMerchants`: 6 merchants with 3/6/5/4/6/6 findings, matching the backend.
  2. Cost ranking -> first attempt called only `ListSubscriptions` and wrongly said five merchants had no price. Fix: new tool `GetCostSummary` plus an instruction to use it for prices. Second attempt matched the backend: FitPass $479.88/yr, shield.localhost $239.88, Amazon $179.88, StreamFlix $155.88, BargainBox $119.88, CloudNotes $96, each with its quote.
  3. Cancellation comparison -> `GetMerchantHistory` for each. First run said FitPass had no cancellation wording: the backend's own analysis had missed "visit your home club in person or send certified mail". Fix: the backend prompt now has the wording-level labels and "always check cancellation wording". Re-run: FitPass ranked hardest.
  4. Amazon Prime checklist -> RECURRING COST first, then HIDDEN RENEWAL, CANCEL BURDEN, with save dates and exact quotes.
- Panel: "← Back" closes it; modes are a 3-way picker with the current one highlighted (the old button cycled and hid where you were).
