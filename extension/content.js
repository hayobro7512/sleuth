(() => {
  if (window.__ssLoaded) return;
  window.__ssLoaded = true;
  if (document.documentElement.hasAttribute("data-ss-ignore")) return; // our own dashboard shows flagged quotes; never analyze it
  if (/(^|\.)(go\.superhuman\.com|docs\.superhuman\.com|coda\.io)$/.test(location.hostname)) return; // the tools we build with

  // Only pages that look like consent / signup / checkout / cancel get analyzed.
  const TRIGGER = /cookie|consent|free trial|subscri|auto-?renew|renews|checkout|cancel|billing|order summary|accept all|reject all|manage (options|preferences)/gi;
  const MAX_RUNS = 3;
  const COLORS = { High: "rgba(255,70,70,.35)", Medium: "rgba(255,170,0,.40)", Low: "rgba(255,230,0,.35)" };

  let runs = 0, lastKey = "", findings = [], card = null, checklist = [], history = false, remembered = false, track = false, askedPurchase = false;

  // ---- text index: normalized page text + a map back to DOM positions ----
  function indexPage() {
    const chars = [], map = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let prevSpace = true;
    while (walker.nextNode() && chars.length < 80000) {
      const node = walker.currentNode, p = node.parentElement;
      if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(p.tagName)) continue;
      if (p.checkVisibility && !p.checkVisibility({ checkVisibilityCSS: true })) continue;
      const s = node.nodeValue;
      for (let i = 0; i < s.length; i++) {
        if (/\s/.test(s[i])) {
          if (prevSpace) continue;
          chars.push(" "); prevSpace = true;
        } else { chars.push(s[i]); prevSpace = false; }
        map.push([node, i]);
      }
    }
    return { text: chars.join(""), map };
  }

  // Send only windows around trigger words so late-appended banners aren't cut off.
  function windows(text) {
    const spans = [];
    for (const m of text.matchAll(TRIGGER)) {
      const a = Math.max(0, m.index - 1500), b = Math.min(text.length, m.index + 2500);
      const last = spans[spans.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b); else spans.push([a, b]);
    }
    return spans.map(([a, b]) => text.slice(a, b)).join("\n…\n").slice(0, 12000);
  }

  function findRange(idx, quote) {
    const at = idx.text.indexOf(quote);
    if (at < 0) return null;
    const [n1, o1] = idx.map[at], [n2, o2] = idx.map[at + quote.length - 1];
    const r = new Range();
    r.setStart(n1, o1);
    r.setEnd(n2, o2 + 1);
    return r;
  }

  // ---- UI (shadow DOM keeps page CSS out) ----
  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:12px;top:12px;"; // top right: cookie banners sit at the bottom
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font:13px/1.4 system-ui,sans-serif;color:#1c1c1e}
    .badge{background:#fff;border:1px solid #bbb;border-radius:999px;padding:6px 12px;cursor:pointer;box-shadow:0 2px 8px #0003;display:none}
    .panel,.tip{position:fixed;background:#fff;border:1px solid #bbb;border-radius:10px;box-shadow:0 4px 16px #0004;padding:10px 12px;display:none;max-width:320px}
    .panel{right:12px;top:52px;max-height:70vh;overflow:auto}
    .tag{display:inline-block;font-weight:700;font-size:11px;border-radius:4px;padding:1px 6px;margin-right:6px}
    .High{background:#ffd0d0}.Medium{background:#ffe2a8}.Low{background:#fff3a0}
    .item{padding:6px 0;border-top:1px solid #eee;cursor:pointer}.item:first-child{border-top:0}
    .q{color:#555;font-style:italic}.card{background:#f3f6ff;border-radius:8px;padding:8px;margin-bottom:6px}
    .head{display:flex;gap:8px;align-items:center;margin-bottom:8px}.back{cursor:pointer;border:1px solid #bbb;border-radius:6px;background:#fff;padding:3px 8px}
    .opt{display:block;width:100%;text-align:left;margin:3px 0;padding:5px 8px;border:1px solid #bbb;border-radius:6px;background:#fff;cursor:pointer}.opt.on{border:2px solid #5b3cc4;font-weight:700}
    .ask{position:fixed;right:12px;top:60px;background:#fff;border:1px solid #bbb;border-radius:10px;box-shadow:0 4px 16px #0004;padding:10px 12px;max-width:320px;display:none}
    .row{display:flex;gap:6px;margin-top:8px}
    .marks{position:fixed;left:0;top:0;width:0;height:0}
    .box{position:fixed;border:3px solid var(--c);border-radius:6px;pointer-events:none;box-shadow:0 0 0 2px #fff9}
    .pill{position:fixed;background:var(--c);color:#fff;border:0;border-radius:999px;padding:2px 9px;font:700 11px/1.5 system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 4px #0006;white-space:nowrap}
  </style><div class="marks"></div><div class="ask"></div><div class="tip"></div><div class="panel"></div><button class="badge"></button>`;
  const $ = (s) => root.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function fillEntry(box, f) {
    const head = el("div"); head.append(el("span", `tag ${f.severity}`, f.label), el("b", "", f.severity));
    box.append(head, el("div", "q", `“${f.quote}”`), el("div", "", f.why), el("div", "", `Costs you: ${f.cost}`));
  }

  const MODES = {
    inline: "Go inline (Go underlines the page itself)",
    direct: "Direct (NVIDIA backend)",
    go: "Go agent (job + connector)",
  };
  const ORDER = ["inline", "direct", "go"];
  function modeButton() {
    const m = el("button", "mode", `Mode: ${MODES[mode]}. Click to switch.`);
    m.onclick = () => {
      mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
      try { chrome.storage.local.set({ mode }); } catch {}
      m.textContent = `Mode: ${MODES[mode]}. Saved. Reload the page to use it.`;
    };
    return m;
  }

  function panelHeader() {
    const head = el("div", "head"), back = el("button", "back", "← Back");
    back.setAttribute("aria-label", "Back to the page");
    back.onclick = () => { $(".panel").style.display = "none"; };
    head.append(back, el("b", "", "Sign-up Shield"));
    return head;
  }

  // Three choices you can switch between and come back from, instead of one button that cycles and hides where you were.
  function modePicker() {
    const box = el("div", "modes"), note = el("div", "q", "Pick how pages are checked."), btns = {};
    for (const k of ORDER) {
      const b = el("button", "opt", MODES[k]);
      b.classList.toggle("on", k === mode);
      b.setAttribute("aria-pressed", String(k === mode));
      b.onclick = () => {
        mode = k;
        try { chrome.storage.local.set({ mode }); } catch {}
        for (const [id, x] of Object.entries(btns)) { x.classList.toggle("on", id === k); x.setAttribute("aria-pressed", String(id === k)); }
        note.textContent = `Saved: ${MODES[k]}. Reload the page to use it.`;
      };
      btns[k] = b;
      box.append(b);
    }
    box.append(note);
    return box;
  }

  function historyButton() {
    const label = () => `History: ${history ? "ON. Saves merchant name and flagged wording only." : "off. Click to turn saving back on."}`;
    const b = el("button", "mode", label());
    b.onclick = () => {
      history = !history;
      try { chrome.storage.local.set({ history }); } catch {}
      b.textContent = label();
    };
    return b;
  }

  function trackButton() {
    const label = () => `Track purchases: ${track ? "ON. Asks you after a purchase and saves renewal dates only if you say yes." : "off. Click to track trials and renewals."}`;
    const b = el("button", "mode", label());
    b.onclick = () => {
      track = !track;
      try { chrome.storage.local.set({ track }); } catch {}
      b.textContent = label();
    };
    return b;
  }

  function modeOnlyPanel(note) {
    const panel = $(".panel");
    panel.replaceChildren(panelHeader(), modePicker(), historyButton(), trackButton(), el("div", "", note));
    $(".badge").onclick = () => { panel.style.display = panel.style.display === "block" ? "none" : "block"; };
  }

  function renderPanel() {
    const panel = $(".panel"), badge = $(".badge");
    panel.replaceChildren();
    panel.append(panelHeader(), modePicker(), historyButton(), trackButton());
    if (checklist.length) { // evidence-linked: every item comes from this page or an earlier visit
      const box = el("div", "card");
      box.append(el("b", "", "Before you continue"));
      for (const it of checklist) {
        const row = el("div", "item");
        row.append(el("span", `tag ${it.severity}`, it.label), el("span", "", it.text),
          el("div", "q", `“${it.evidence}” (${it.source})`));
        box.append(row);
      }
      panel.append(box);
    }
    if (card) {
      const c = el("div", "card");
      c.append(el("b", "", "What “Accept” means"), el("div", "", `Cookies: ${card.kinds}`),
        el("div", "", `Partners: ${card.vendors}`), el("div", "", `Typical effect: ${card.effect}`),
        el("div", "", `Rejecting: ${card.reject}`));
      panel.append(c);
    }
    for (const f of findings) {
      const item = el("div", "item");
      fillEntry(item, f);
      item.onclick = () => f.range?.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
      panel.append(item);
    }
    if (findings.length) { // handoff: Go can't be called from a page, so the user pastes context into it
      const b = el("button", "", "Copy summary for Go");
      b.onclick = async () => {
        const lines = findings.map((f) => `- ${f.label}: "${f.quote}" (${f.why})`).join("\n");
        try {
          await navigator.clipboard.writeText(`Sign-up Shield flagged ${findings.length} things on ${location.hostname}. Explain them simply and tell me what to do:\n${lines}`);
          b.textContent = "Copied. Paste into Go (Ctrl+Cmd+Shift+G)";
        } catch { b.textContent = "Copy blocked on this page"; }
      };
      panel.append(b);
    }
    badge.style.display = "block";
    badge.textContent = findings.length
      ? `Shield: ${findings.length} to know${remembered ? " (saved to your history)" : ""}`
      : "Shield: no pressure tactics spotted";
    badge.onclick = () => { panel.style.display = panel.style.display === "block" ? "none" : "block"; };
    if (!findings.length && !card) setTimeout(() => (badge.style.display = "none"), 4000);
  }

  // Visible status so a 5-15 s analysis doesn't look like nothing is happening.
  function status(text, hideAfter) {
    if (!document.body.contains(host)) document.body.append(host);
    const badge = $(".badge");
    badge.style.display = "block";
    badge.textContent = text;
    if (hideAfter) setTimeout(() => { if (badge.textContent === text) badge.style.display = "none"; }, hideAfter);
  }

  function paint() {
    CSS.highlights.clear();
    for (const sev of ["High", "Medium", "Low"]) {
      const ranges = findings.filter((f) => f.range && f.severity === sev).map((f) => f.range);
      if (ranges.length) CSS.highlights.set(`ss-${sev}`, new Highlight(...ranges));
    }
  }

  // ---- layout checks: warnings on buttons and links, which Go cannot underline ----
  // Rule-based on purpose: which choices exist and how big they are are facts in the page, not guesses. Drawn in our own
  // overlay (top of the page, above Grammarly's marks), with a severity color and the severity written out.
  const ACCEPT = /^\s*(accept|allow|agree|i agree|got it|ok|okay|yes)\b/i;
  const REJECT = /\b(reject|decline|deny|refuse|only (essential|necessary)|necessary only|essential only|no thanks)\b/i;
  const MANAGE = /\b(manage|settings|preferences|customi[sz]e|options|more choices)\b/i;
  const DATA_USE = /partners|advertis|\bads\b|analytics|marketing|personali[sz]|profiling|tracking|third[- ]part|legitimate interest/i;
  const NO_DATA = /do not share|don't share|essential (cookies )?only|only essential|strictly necessary/i;
  const CLICKABLE = "button,a[href],[role=button],input[type=button],input[type=submit]";
  const SEV_COLOR = { High: "#b71c1c", Medium: "#b45309", Low: "#8a6d00" }; // white text on each is at least 4.5:1
  const markedEls = new WeakSet(), marks = [];
  let marksArmed = false, marksRevealed = false, revealTimer = null;
  const REVEAL_AFTER_MS = 9000; // Go's scan of a block took 6-10 s in tests; the button marks appear with its results
  const revealMarks = () => { marksRevealed = true; placeMarks(); };

  const labelOf = (c) => (c.value || c.getAttribute("aria-label") || c.innerText || c.textContent || "").trim().replace(/\s+/g, " ");
  const areaOf = (c) => { const r = c.getBoundingClientRect(); return r.width * r.height; };
  const isShown = (c) => areaOf(c) > 0 && (!c.checkVisibility || c.checkVisibility());

  function consentRegions() {
    const regions = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let hits = 0;
    while (w.nextNode() && hits < 6) {
      const n = w.currentNode;
      if (!n.parentElement || !/cookie|consent|privacy|our partners|accept all|reject all|manage (options|preferences)/i.test(n.nodeValue)) continue;
      hits++;
      let region = n.parentElement;
      while (region.parentElement && region.parentElement !== document.body && region.parentElement.innerText.length < 2500) region = region.parentElement;
      regions.add(region);
    }
    return regions;
  }

  function layoutFindings() {
    const out = [];
    for (const region of consentRegions()) {
      const text = region.innerText || "";
      if (!DATA_USE.test(text) || NO_DATA.test(text)) continue; // plain "essential cookies only" notices are fine
      const clicks = [...region.querySelectorAll(CLICKABLE)].filter(isShown).map((c) => ({ c, label: labelOf(c) })).filter((x) => x.label);
      const accept = clicks.find((x) => ACCEPT.test(x.label));
      const reject = clicks.find((x) => REJECT.test(x.label));
      const manage = clicks.find((x) => x !== accept && !REJECT.test(x.label) && MANAGE.test(x.label));
      if (!accept || reject) continue;
      const times = manage ? Math.round(areaOf(accept.c) / Math.max(1, areaOf(manage.c))) : 0;
      out.push({ el: accept.c, label: "LOPSIDED CHOICE", severity: "Medium", quote: `${accept.label} (button)`,
        why: "Accepting is one click, and this banner has no one-click Reject button" +
          (times >= 2 ? `. The Accept button is about ${times} times larger than the options link.` : "."),
        cost: "Rejecting takes extra steps, so many people accept. Their data may be shared with advertising partners." });
      if (manage) out.push({ el: manage.c, label: "EXTRA CLICKS", severity: "Medium", quote: `${manage.label} (link)`,
        why: `Rejecting is hidden behind “${manage.label}” instead of a one-click Reject.`,
        cost: "It takes more time and screens to say no than to say yes." });
    }
    return out;
  }

  // A sign-up screen where "yes" is a big bright button and "no" is a small text link. Go cannot underline buttons, so this is
  // drawn in our overlay. The size of each choice is measured from the page, not guessed.
  const PRIMARY = /\b(try prime|start (your )?(free )?(\d+-day )?(trial|membership)|join( now)?|subscribe|sign up|get started|upgrade|free trial)\b/i;
  const DECLINE = /^\s*(no,? thanks|not right now|not now|skip|maybe later|continue without|decline)\b/i;
  const looksClickable = (e) => e.matches(CLICKABLE) || getComputedStyle(e).cursor === "pointer";

  // The visible shape of a button: Amazon draws the yellow pill on a wrapper around the text, so climb to the largest
  // small ancestor that has its own background or border.
  function visualBox(e) {
    let best = e, area = areaOf(e);
    for (let p = e.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) {
      const cs = getComputedStyle(p), r = p.getBoundingClientRect();
      if (r.width > 420 || r.height > 120) break;
      if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.borderTopWidth !== "0px") { if (areaOf(p) >= area) { best = p; area = areaOf(p); } }
    }
    return best;
  }

  function signupFindings() {
    const out = [], regions = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let hits = 0;
    while (w.nextNode() && hits < 40) {
      const n = w.currentNode, t = n.nodeValue.trim();
      if (!n.parentElement || t.length > 30 || !(PRIMARY.test(t) || DECLINE.test(t))) continue;
      hits++;
      let r = n.parentElement;
      while (r.parentElement && r.parentElement !== document.body && r.parentElement.innerText.length < 2500) r = r.parentElement;
      regions.add(r);
    }
    for (const region of regions) {
      const labeled = [...region.querySelectorAll("a,button,span,div,input")]
        .filter((e) => e.children.length === 0 || e.tagName === "BUTTON" || e.tagName === "A")
        .map((e) => ({ e, label: labelOf(e) })).filter((x) => x.label && x.label.length <= 30 && isShown(x.e));
      const yes = labeled.find((x) => PRIMARY.test(x.label) && looksClickable(x.e));
      const no = labeled.find((x) => DECLINE.test(x.label) && looksClickable(x.e));
      if (!yes || !no) continue;
      const yb = visualBox(yes.e), nb = visualBox(no.e);
      const times = Math.round(areaOf(yb) / Math.max(1, areaOf(nb)));
      if (times < 2) continue;
      out.push({ el: yb, label: "LOPSIDED CHOICE", severity: times >= 4 ? "Medium" : "Low", quote: `${yes.label} (button)`,
        why: `Saying yes is a large button and saying no is a small link, about ${times} times smaller.`,
        cost: "It is easy to start a paid plan without noticing, and the way out is easy to miss." });
      out.push({ el: nb, label: "HARD TO CLOSE", severity: "Low", quote: `${no.label} (link)`,
        why: `The way out, “${no.label}”, is a small text link next to a large button.`,
        cost: "A hurried click lands on the big button instead." });
    }
    return out;
  }

  function placeMarks() {
    for (const m of marks) {
      const r = m.f.el.getBoundingClientRect();
      const on = marksRevealed && m.f.el.isConnected && r.width > 0 && (!m.f.el.checkVisibility || m.f.el.checkVisibility());
      m.box.style.display = m.pill.style.display = on ? "block" : "none";
      if (!on) continue;
      Object.assign(m.box.style, { left: r.left - 3 + "px", top: r.top - 3 + "px", width: r.width + 6 + "px", height: r.height + 6 + "px" });
      const left = Math.min(Math.max(4, r.left - 3), innerWidth - m.pill.offsetWidth - 4); // keep the pill on screen
      Object.assign(m.pill.style, { left: left + "px", top: (r.top > 28 ? r.top - 28 : r.bottom + 6) + "px" });
    }
  }

  function openMarkTip(f, anchor) {
    const tip = $(".tip");
    tip.replaceChildren();
    fillEntry(tip, f);
    tip.style.display = "block";
    const r = anchor.getBoundingClientRect();
    tip.style.left = Math.min(Math.max(8, r.left), innerWidth - 340) + "px";
    tip.style.top = (r.top - tip.offsetHeight - 6 > 8 ? r.top - tip.offsetHeight - 6 : r.bottom + 6) + "px";
  }

  function showLayoutMarks() {
    let added = 0;
    for (const f of [...layoutFindings(), ...signupFindings()]) {
      if (markedEls.has(f.el)) continue;
      markedEls.add(f.el);
      const box = el("div", "box"), pill = el("button", "pill", `${f.label} · ${f.severity}`);
      box.style.setProperty("--c", SEV_COLOR[f.severity]);
      pill.style.setProperty("--c", SEV_COLOR[f.severity]);
      pill.setAttribute("aria-label", `${f.label}, ${f.severity} severity. Show details.`);
      pill.onclick = (e) => { e.stopPropagation(); openMarkTip(f, pill); };
      $(".marks").append(box, pill);
      marks.push({ f, box, pill });
      added++;
    }
    if (!added) return false;
    if (!document.body.contains(host)) document.body.append(host);
    placeMarks();
    if (!marksArmed) {
      marksArmed = true;
      addEventListener("scroll", placeMarks, true);
      addEventListener("resize", placeMarks);
      setInterval(placeMarks, 500); // layout can change without a scroll
      addEventListener("click", (e) => { if (e.target !== host) $(".tip").style.display = "none"; }, true);
      addEventListener("keydown", (e) => { if (e.key === "Escape") $(".tip").style.display = "none"; }, true);
    }
    return true;
  }

  // ---- hover / tap tooltip ----
  function tipAt(x, y) {
    const tip = $(".tip");
    const pos = document.caretRangeFromPoint?.(x, y);
    const hit = pos && findings.find((f) => {
      try { return f.range && f.range.isPointInRange(pos.startContainer, pos.startOffset); } catch { return false; }
    });
    if (!hit) { tip.style.display = "none"; return; }
    tip.replaceChildren();
    fillEntry(tip, hit);
    tip.style.display = "block";
    tip.style.left = Math.min(x + 12, innerWidth - 340) + "px";
    tip.style.top = Math.min(y + 16, innerHeight - 140) + "px";
  }
  let busy = false;
  document.addEventListener("mousemove", (e) => {
    if (busy || !findings.length) return;
    busy = true;
    requestAnimationFrame(() => { tipAt(e.clientX, e.clientY); busy = false; });
  });
  document.addEventListener("click", (e) => findings.length && tipAt(e.clientX, e.clientY)); // touch + desktop

  // In inline mode Go's findings stay inside Go's own UI, so the extension cannot read them. With History on, the page text
  // (redacted, qualifying pages only) is also sent to the backend once, with nothing shown, so the findings can be saved.
  // ponytail: this save is analyzed by the NVIDIA model, not by Go; replace it if Go ever exposes its findings to extensions.
  const recorded = new Set();
  async function recordQuietly(pageText) {
    if (!history) return;
    const text = windows(pageText);
    const key = location.hostname + ":" + text.length + ":" + text.slice(0, 200);
    if (recorded.has(key)) return;
    recorded.add(key);
    const res = await ask({ type: "analyze", key: key + ":r", text: redact(text), url: location.hostname + location.pathname, remember: true, offer: extractOffer(pageText) });
    if (res?.ok && res.data.remembered) status("Shield: saved to your history", 4000);
  }

  // ---- purchase and subscription tracking (opt-in) ----
  // Offers (price and trial length) are remembered in this browser only. Nothing goes to the backend unless the user answers
  // "Did you complete this purchase?" with Yes or Not sure on a confirmation page. A page alone never counts as a purchase.
  const PRICE = [
    /\$\s?(\d{1,4}(?:\.\d{2})?)\s*(?:\/|per\s+|a\s+)\s*(month|mo|year|yr|week)\b/i,
    /\$\s?(\d{1,4}(?:\.\d{2})?)\b[^.]{0,40}?\b(?:per|a|each)\s+(month|year|week)\b/i,
  ];
  const CONFIRMED = /\b(order (?:is )?(?:confirmed|placed|complete)|thank you for your (?:purchase|order)|your (?:free )?trial (?:has )?(?:started|begun|is active)|subscription is (?:now )?active|you(?:'|’)re subscribed|payment (?:successful|received))\b/i;

  function extractOffer(text) {
    let m = null;
    for (const re of PRICE) if ((m = text.match(re))) break;
    if (!m) return null;
    const unit = m[2].toLowerCase();
    const billing = unit.startsWith("mo") ? "month" : unit.startsWith("y") ? "year" : "week";
    const t = text.match(/\b(\d{1,3})[- ]day\b[^.]{0,20}\btrial|free (?:for )?(\d{1,3}) days|after (\d{1,3}) days/i);
    // The price sentence only: back to the last sentence end (or about 40 characters, at a word boundary), forward to the next one.
    const before = text.slice(Math.max(0, m.index - 70), m.index);
    const cut = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "), before.lastIndexOf("? "));
    const tail = before.slice(-40), lead = cut >= 0 ? before.slice(cut + 2) : before.length > 40 ? tail.slice(tail.indexOf(" ") + 1) : before;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 90);
    const end = after.search(/[.!?](\s|$)/);
    const quote = (lead + m[0] + (end >= 0 ? after.slice(0, end + 1) : after.slice(0, after.lastIndexOf(" ") > 0 ? after.lastIndexOf(" ") : 0))).trim();
    return { price: Number(m[1]), billing, trialDays: t ? Number(t[1] || t[2] || t[3]) : 0, quote: quote.slice(0, 240) };
  }

  const siteName = () => location.hostname.replace(/^www\./, "");
  const store = (obj) => { try { chrome.storage.local.set(obj); } catch {} };
  const fromStore = (keys) => new Promise((resolve) => { try { chrome.storage.local.get(keys, (r) => resolve(r || {})); } catch { resolve({}); } });

  async function rememberOffer(text) {
    if (!track) return;
    const offer = extractOffer(text);
    if (!offer) return;
    const { offers = {} } = await fromStore("offers");
    offers[siteName()] = { ...offer, seenAt: Date.now() };
    for (const k of Object.keys(offers)) if (Date.now() - offers[k].seenAt > 2 * 864e5) delete offers[k]; // keep two days
    store({ offers });
  }

  async function maybeAskPurchase(text) {
    if (!track || askedPurchase || !CONFIRMED.test(text)) return;
    askedPurchase = true;
    const { offers = {}, asked = {} } = await fromStore(["offers", "asked"]);
    const site = siteName();
    if (Date.now() - (asked[site] || 0) < 432e5) return; // already asked in the last 12 hours
    asked[site] = Date.now();
    store({ asked });
    const seen = offers[site] && Date.now() - offers[site].seenAt < 2 * 864e5 ? offers[site] : null;
    showPurchaseCard(site, seen || extractOffer(text));
  }

  function showPurchaseCard(site, offer) {
    if (!document.body.contains(host)) document.body.append(host);
    const card = $(".ask");
    card.replaceChildren();
    card.style.display = "block";
    const facts = offer
      ? `${offer.trialDays ? `Free trial of ${offer.trialDays} days, then ` : ""}$${offer.price} per ${offer.billing}`
      : "No price was found on the pages you visited.";
    card.append(el("b", "", `Did you complete a purchase at ${site}?`), el("div", "q", facts),
      el("div", "", "Sign-up Shield saves this only if you say Yes or Not sure. A page alone never counts."));
    const row = el("div", "row");
    const send = async (status) => {
      if (status === "no") { card.style.display = "none"; return; }
      const res = await ask({ type: "subscribe", body: { url: site, price: offer?.price, billing: offer?.billing, trialDays: offer?.trialDays,
        evidence: offer ? redact(offer.quote) : null, status } });
      card.replaceChildren(el("b", "", res?.ok
        ? `Saved.${res.data.renewalDate ? ` ${offer?.trialDays ? "The trial ends" : "The next charge is"} ${res.data.renewalDate}.` : ""}`
        : "Could not save. Is the server running?"));
      setTimeout(() => { card.style.display = "none"; }, 7000);
    };
    for (const [label, status] of [["Yes", "confirmed"], ["Not sure", "possible"], ["No", "no"]]) {
      const b = el("button", "", label);
      b.onclick = () => send(status);
      row.append(b);
    }
    card.append(row);
  }

  // ---- main loop ----
  async function run() {
    if (!document.body || runs >= MAX_RUNS) return;
    const idx = indexPage();
    maybeAskPurchase(idx.text); // confirmation pages often have none of the trigger words
    TRIGGER.lastIndex = 0;
    if (idx.text.length < 80 || !TRIGGER.test(idx.text)) return;
    rememberOffer(idx.text);
    if (mode === "inline") { // no network: Go underlines the text; our overlay marks the buttons Go cannot reach
      const armed = armInline(), marked = showLayoutMarks();
      if (!armed && !inlineArmed) revealMarks(); // no text for Go to scan, so nothing to wait for
      if (armed || marked) runs++;
      recordQuietly(idx.text); // only when the user turned History on
      return;
    }
    const text = windows(idx.text);
    const key = location.hostname + ":" + text.length + ":" + text.slice(0, 200) + text.slice(-200);
    if (key === lastKey) return;
    lastKey = key; runs++;
    // host + path only: query strings can carry tokens or personal data
    const body = { text: redact(text), url: location.hostname + location.pathname, remember: history, offer: extractOffer(idx.text) };
    status(mode === "go" ? "Shield (Go mode): sent. In Go, say “check my pending pages”." : "Shield: checking this page…");
    const res = mode === "go" ? await viaGo(body, key) : await ask({ type: "analyze", key, ...body });
    if (!res?.ok) {
      console.warn("[Sign-up Shield]", res?.error);
      status(mode === "go" ? `Shield (Go mode): ${res?.error || "failed"}` : "Shield: can't reach the server (is start.sh running?)", 8000);
      return;
    }
    const fresh = indexPage(); // DOM may have changed during the call
    findings = res.data.findings.map((f) => ({ ...f, range: findRange(fresh, f.quote) })).filter((f) => f.range);
    card = res.data.card;
    checklist = res.data.checklist || [];
    remembered = res.data.remembered === true;
    if (!document.body.contains(host)) document.body.append(host);
    paint(); renderPanel();
  }

  // ---- transports: "direct" calls the API, "go" files a job that the Go agent picks up through a connector ----
  let mode = "inline", jobId = null, gone = false;
  try {
    chrome.storage.local.get(["mode", "history", "track"], (r) => {
      if (ORDER.includes(r?.mode)) mode = r.mode;
      history = r?.history !== false; // on by default (saves merchant name + flagged wording only); the panel button turns it off
      track = r?.track === true;     // opt-in: purchase and subscription tracking
    });
  } catch {}

  // ---- inline mode: make text regions editable so Go's own "While writing" underlines appear on the page ----
  // Tested facts: Go only scans a field it sees focused inside a real user gesture. Focusing several fields in the same task
  // keeps only the last one, but a timer started inside the click can focus the next field, and each scan then runs on its
  // own (1.5 s apart worked). A region is one container = one field; its buttons and links become non-editable islands, so
  // they still click and navigate while all the text around them is scanned in one pass.
  const ISLANDS = "a,button,input,select,textarea,label,img,svg,video,audio,canvas,iframe,[role=button],[role=link],[role=tab],[role=menuitem],summary";
  const NO_REGION = "input:not([type=hidden]),textarea,select,iframe,video,canvas,[contenteditable]"; // forms and media are never edited
  const REGION_GAP_MS = 1200, MAX_REGIONS = 8;
  const inlineQueue = [], inlineSeen = new WeakSet();
  let inlineArmed = false;

  // Cues that make a region worth sending to Go. Page order is a bad ranking: on Amazon the cart sidebar ("...at checkout")
  // came before the Prime offer and got picked instead, so regions are ranked by how many different cues they contain.
  const CUES = [
    /\$\s?\d/, /\b\d+(\.\d+)?\s*(\/|per)\s*(month|mo|year|yr|week)\b/i, /free trial|\b\d+-day\b|\bfree for\b/i,
    /renew|auto-?pay|charged automatically/i, /cancel/i, /only \d+|\d+ (left|remaining)|ends? (in|soon)|limited[- ](time|offer)|hurry/i,
    /partners|advertis|marketing|profiling|tracking|legitimate interest/i, /no thanks|i'?d rather/i, /card (is )?required|credit card/i,
    /no access|without (prime|a membership)|members?(hip)? (only|save)|minimum order/i, /(was|list price)\s*\$|save \$|\d+% off/i,
    /best seller|most popular|people (are )?(viewing|bought)|bought in (the )?past/i, /upgrade|protection plan|bundle/i,
    /authorize us to charge|payment method on file|auto-?renews/i,
  ];
  const cueScore = (t) => CUES.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);

  function findRegions() {
    const cands = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let hits = 0;
    while (w.nextNode() && hits < 100) {
      const n = w.currentNode;
      TRIGGER.lastIndex = 0;
      if (!n.parentElement || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|SELECT|TEXTAREA)$/.test(n.parentElement.tagName) || !TRIGGER.test(n.nodeValue)) continue;
      hits++;
      let r = n.parentElement;
      // climb to the largest container that still has no form controls (a search box or dropdown makes it off limits)
      while (r.parentElement && r.parentElement !== document.body && r.parentElement.innerText.length < 2500 && !r.parentElement.querySelector(NO_REGION)) r = r.parentElement;
      cands.add(r);
    }
    const ok = [...cands].filter((r) => !inlineSeen.has(r) && r.checkVisibility?.() !== false && !r.closest("[contenteditable],[data-ss-edit],select,textarea")
      && !r.querySelector(NO_REGION) && (r.innerText || "").trim().length >= 40);
    return ok
      .filter((r) => !ok.some((o) => o !== r && o.contains(r))) // keep the outermost region
      .map((r) => ({ r, score: cueScore(r.innerText) }))
      .filter((x) => x.score > 0) // a region with no cue (like a cart sidebar) is never sent to Go
      .sort((a, b) => b.score - a.score) // stable: ties keep page order
      .slice(0, MAX_REGIONS)
      .map((x) => x.r);
  }

  // Tested: Go ignores a bare one-line field (24 px tall) but checks the same text at 40 px. Pad small regions, keep the text
  // where it was (translate), and measure the next element to cancel any layout shift (margins collapse, so a fixed
  // negative margin is not enough).
  const MIN_FIELD_PX = 40;
  function padIfSmall(b) {
    if (getComputedStyle(b).display === "inline") b.style.display = "inline-block";
    const h = b.getBoundingClientRect().height;
    if (h >= MIN_FIELD_PX) return;
    const pad = Math.ceil((MIN_FIELD_PX - h) / 2);
    const probe = () => { const n = b.nextElementSibling; return n ? n.getBoundingClientRect().top : b.parentElement.getBoundingClientRect().height; };
    const before = probe();
    b.style.paddingTop = b.style.paddingBottom = pad + "px";
    b.style.translate = `0 -${pad}px`; // the text stays where it was
    for (let i = 0; i < 4; i++) {
      const shift = probe() - before;
      if (Math.abs(shift) < 0.5) break;
      b.style.marginBottom = parseFloat(getComputedStyle(b).marginBottom) - shift + "px";
    }
  }

  // The page's text must never change. Edits are blocked as they are attempted, and any that get through (a suggestion
  // accepted from Grammarly's or Go's card, for example) are undone when they land right after a click or key press. A change
  // with no gesture just before it is the page itself (a countdown tick) and is left alone.
  let lastGesture = 0;
  function lockText(r) {
    for (const ev of ["beforeinput", "paste", "drop", "cut"]) r.addEventListener(ev, (e) => e.preventDefault(), true);
    const opts = { subtree: true, characterData: true, characterDataOldValue: true, childList: true };
    const guard = new MutationObserver((records) => {
      if (Date.now() - lastGesture > 800) return;
      guard.disconnect();
      for (const rec of records.reverse()) {
        if (rec.type === "characterData") rec.target.nodeValue = rec.oldValue;
        else {
          for (const n of rec.addedNodes) if (n.parentNode === rec.target) rec.target.removeChild(n);
          for (const n of rec.removedNodes) rec.target.insertBefore(n, rec.nextSibling?.parentNode === rec.target ? rec.nextSibling : null);
        }
      }
      guard.observe(r, opts);
    });
    guard.observe(r, opts);
  }

  function activateRegion(r) {
    padIfSmall(r);
    for (const e of r.querySelectorAll(ISLANDS)) if (!e.hasAttribute("contenteditable")) { e.setAttribute("contenteditable", "false"); e.setAttribute("data-ss-island", ""); }
    r.setAttribute("data-ss-edit", "");
    r.setAttribute("contenteditable", "true");
    r.spellcheck = false;
    lockText(r);
    r.focus({ preventScroll: true });
  }

  // Grammarly's own correction marks hide Go's warnings when they overlap. Both are drawn in the open shadow root of
  // <grammarly-extension> and differ by color (tested: corrections rgb(242,115,136) and rgb(255,153,171), Sign-up Shield
  // rgb(190,161,245)). Hide the colored, non-purple marks that sit over a region we made editable; nothing else on the page.
  // ponytail: depends on Grammarly's internal markup, so it silently does nothing if that changes; the URL Blocklist still works.
  const isGoPurple = (r, g, b) => b - g >= 60 && r - g >= 15;
  function quietGrammarly() {
    const zones = [...document.querySelectorAll("[data-ss-edit]")].map((b) => b.getBoundingClientRect());
    if (!zones.length) return;
    const zoneOf = (rc) => {
      const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
      return zones.findIndex((z) => cx >= z.left && cx <= z.right && cy >= z.top - 6 && cy <= z.bottom + 6);
    };
    const roots = [...document.querySelectorAll("grammarly-extension")].map((h) => h.shadowRoot).filter(Boolean);
    const hidden = zones.map(() => 0);
    for (const root of roots) {
      for (const d of root.querySelectorAll("div")) {
        const m = getComputedStyle(d).backgroundColor.match(/[\d.]+/g);
        if (!m) continue;
        const [r, g, b, a = 1] = m.map(Number);
        if (a === 0 || Math.max(r, g, b) - Math.min(r, g, b) < 60 || isGoPurple(r, g, b)) continue; // transparent, grey/white, or Go
        const rc = d.getBoundingClientRect(), zi = rc.width > 0 ? zoneOf(rc) : -1;
        if (zi >= 0) { d.style.visibility = "hidden"; hidden[zi]++; }
      }
    }
    // The red count icon is Grammarly's total, which still includes the corrections we hid. Each correction is drawn as two
    // elements (line + highlight), so subtract hidden/2, and hide the icon when nothing is left to show.
    for (const root of roots) {
      for (const st of root.querySelectorAll(".status")) {
        if (st.children.length || !/^\d+$/.test(st.textContent.trim())) continue; // the number only
        const zi = zoneOf(st.getBoundingClientRect());
        if (zi < 0 || !hidden[zi]) continue; // nothing hidden here: leave Grammarly's own number alone
        if (st.textContent !== st.dataset.ssLast) st.dataset.ssOrig = st.textContent; // Grammarly wrote a new number
        const want = Math.max(0, Number(st.dataset.ssOrig) - Math.ceil(hidden[zi] / 2));
        st.dataset.ssLast = String(want);
        if (st.textContent !== String(want)) st.textContent = String(want);
        const wrap = st.closest(".statusWrapper") || st.parentElement;
        if (wrap) wrap.style.visibility = want > 0 ? "" : "hidden";
      }
    }
  }
  let quietTimer = null;

  function armInline() {
    for (const r of findRegions()) { inlineSeen.add(r); inlineQueue.push(r); }
    if (!inlineQueue.length) return false;
    status("Shield: Go checks this page on your next click");
    modeOnlyPanel("Go underlines the warning text on the page after your next click. Click an underline for Go's explanation.");
    if (inlineArmed) return true;
    inlineArmed = true;
    for (const ev of ["pointerup", "click", "keydown"]) addEventListener(ev, () => { lastGesture = Date.now(); }, true);
    const step = (e) => {
      if (e.target.closest?.("input,textarea,select") || e.target.isContentEditable) return; // never steal focus from a field
      const batch = inlineQueue.splice(0).filter((r) => r.isConnected);
      if (!batch.length) return;
      // One click scans every region: the first now, the rest one after another from a timer started inside this click.
      batch.forEach((r, i) => (i === 0 ? activateRegion(r) : setTimeout(() => r.isConnected && activateRegion(r), i * REGION_GAP_MS)));
      if (!quietTimer) quietTimer = setInterval(quietGrammarly, 400);
      status("Shield: Go is checking this page", 5000);
      if (!marksRevealed && !revealTimer) revealTimer = setTimeout(revealMarks, REVEAL_AFTER_MS + batch.length * REGION_GAP_MS); // button marks follow the scan
    };
    addEventListener("click", step, true);
    addEventListener("keydown", step, true);
    return true;
  }
  const ask = (msg) => new Promise((resolve) =>
    chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r)));

  async function viaGo(body, key) {
    const sub = await ask({ type: "job", key, ...body });
    if (!sub?.ok) return sub;
    jobId = sub.data.jobId;
    for (let i = 0; i < 100 && !gone; i++) { // ~5 min: Go only runs when someone asks it
      await new Promise((r) => setTimeout(r, 3000));
      const r = await ask({ type: "poll", id: jobId });
      if (!r?.ok) return r;
      if (r.data.status === "complete") return r;
      if (r.data.status === "failed") return { ok: false, error: "Go reported a failure" };
    }
    return { ok: false, error: gone ? "page closed" : "timed out waiting for Go" };
  }
  addEventListener("pagehide", () => { gone = true; if (jobId) chrome.runtime.sendMessage({ type: "cancel", id: jobId }); });

  // Strip likely personal data before the text leaves the browser.
  // ponytail: regex only; names and street addresses can still slip through, so avoid private pages
  function redact(s) {
    return s
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
      .replace(/\b(?:visa|master ?card|amex|american express|discover)\b[^.\n]{0,24}?\d{4}\b/gi, "[card]") // "Visa ending in 3716"
      .replace(/\b(?:\d[ -]?){13,19}\b/g, "[card]")
      .replace(/\b\d{1,6}\s+(?:[A-Z0-9][\w.'-]*\s+){1,4}(?:way|st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|pl|place|hwy|pkwy|parkway)\b[^.\n]{0,60}/gi, "[address]")
      .replace(/\b(delivering to|ship(?:ping)? to|deliver to|bill(?:ing)? (?:to|address))\b[^.\n]{0,60}/gi, "$1 [redacted]")
      .replace(/\b\d{5}(?:-\d{4})?\b/g, "[zip]")
      .replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[phone]" : m))
      .replace(/\b\d{6,}\b/g, "[number]");
  }

  const style = document.createElement("style");
  style.textContent = Object.entries(COLORS)
    .map(([k, v]) => `::highlight(ss-${k}){background-color:${v};text-decoration:underline wavy #d33;}`).join("\n")
    + "\n[data-ss-edit]{outline:none!important;caret-color:transparent!important;}";
  document.documentElement.append(style);

  setTimeout(run, 1500); // banners often load late
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(run, 2000); })
    .observe(document.body, { childList: true, subtree: true });
})();
