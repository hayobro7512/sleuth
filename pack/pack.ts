// Sign-up Shield connector for Superhuman Go (a Pack).
// Lets the Go agent read page jobs filed by the browser extension and send back findings.
// Backend routes: see ../docs/GO_CONNECTOR.md. Auth: bearer token (SS_TOKEN) plus the backend's https URL.
import * as sdk from "@codahq/packs-sdk";

export const pack = sdk.newPack();

// The user enters the backend URL (for example a tunnel) and the token when connecting the account.
// With an endpoint URL and no declared network domain, the Pack may call only that URL.
pack.setUserAuthentication({
  type: sdk.AuthenticationType.HeaderBearerToken,
  requiresEndpointUrl: true,
  getConnectionName: async () => "Sign-up Shield backend",
});

// Only these labels are accepted by the backend; anything else is dropped there.
const LABELS =
  "LOPSIDED CHOICE, EXTRA CLICKS, PRE-TICKED, VENDOR FLOOD, SOFT WORDING, COOKIE WALL, HIDDEN RENEWAL, " +
  "PRICE FRAMING, CARD FOR FREE, FAKE URGENCY, CONFIRM-SHAMING, HARD TO CLOSE, FORCED ACCOUNT, PRE-PROMPT, " +
  "SNEAKED ADD-ON, ROACH MOTEL";

// ---- Memory: what the user's history says about merchants. Read-only; the user controls what is saved and can delete it. ----
const MEMORY_RULES =
  "Answer only from the returned data. Cite the date and the exact quoted wording for each point. " +
  "If nothing is saved for the merchant, say so plainly and do not guess. Do not give a general reputation for the merchant; " +
  "this is only the user's own private history.";

pack.addFormula({
  name: "ListMerchants",
  description: "Lists the merchants Sign-up Shield has saved flagged events for, with visit and event counts.",
  instructions: "Returns JSON {merchants:[{merchant, events, visits, last}]} (last is a millisecond timestamp). " + MEMORY_RULES,
  parameters: [],
  resultType: sdk.ValueType.String,
  cacheTtlSecs: 0,
  execute: async function ([], context) {
    const response = await context.fetcher.fetch({ method: "GET", url: "/v1/merchants", cacheTtlSecs: 0 });
    const merchants = response.body?.merchants ?? [];
    return merchants.length ? JSON.stringify(merchants) : "No saved history.";
  },
});

pack.addFormula({
  name: "GetMerchantHistory",
  description: "Gets the user's saved flagged events and a ranked checklist for one merchant domain.",
  instructions:
    "Use for questions like 'What should I know before buying from this merchant again?'. Returns JSON " +
    "{merchant, visits, events:[{label, quote, why, cost, severity, count, first, last}], checklist:[{label, text, evidence, severity, source}]}. " +
    "`first` and `last` are millisecond timestamps. " + MEMORY_RULES,
  parameters: [
    sdk.makeParameter({
      type: sdk.ParameterType.String,
      name: "merchant",
      description: "The merchant's domain, for example shop.example.com (no https:// and no path).",
    }),
  ],
  resultType: sdk.ValueType.String,
  cacheTtlSecs: 0,
  execute: async function ([merchant], context) {
    const response = await context.fetcher.fetch({
      method: "GET",
      url: `/v1/merchants/${encodeURIComponent(merchant)}`,
      cacheTtlSecs: 0,
    });
    return response.body?.events?.length ? JSON.stringify(response.body) : `No saved history for ${merchant}.`;
  },
});

pack.addFormula({
  name: "GetChecklist",
  description: "Gets a short, ranked pre-purchase checklist for a merchant, built from the user's saved history.",
  instructions: "Returns JSON {merchant, items:[{label, text, evidence, severity, source}]}. Each item is already tied to an exact quote. " + MEMORY_RULES,
  parameters: [
    sdk.makeParameter({
      type: sdk.ParameterType.String,
      name: "merchant",
      description: "The merchant's domain, for example shop.example.com.",
    }),
  ],
  resultType: sdk.ValueType.String,
  cacheTtlSecs: 0,
  execute: async function ([merchant], context) {
    const response = await context.fetcher.fetch({
      method: "GET",
      url: `/v1/checklist?merchant=${encodeURIComponent(merchant)}`,
      cacheTtlSecs: 0,
    });
    return response.body?.items?.length ? JSON.stringify(response.body) : `No saved history for ${merchant}.`;
  },
});

const SUBSCRIPTION_FIELDS =
  "JSON [{merchant, plan, price, billing ('week'|'month'|'year'), trialDays, startedAt, renewalDate, daysLeft, status, evidence}]. " +
  "renewalDate is the trial end when trialDays > 0, otherwise the next charge. These are only subscriptions and trials the user " +
  "confirmed in the browser extension; a page alone never creates one. ";

pack.addFormula({
  name: "GetCostSummary",
  description: "Ranks every saved merchant by the recurring price it charges, with the yearly amount.",
  instructions:
    "Use for any question about prices, what something costs, or yearly totals across merchants. Returns JSON " +
    "{costs:[{merchant, price, billing ('week'|'month'|'year'), perYear, quote, source ('page wording'|'confirmed by you'), lastSeen, trialDays, renewalDate}], noPrice:[merchants with no price saved]} " +
    "already sorted from most to least expensive per year. Report perYear and quote the wording. Merchants in noPrice simply have no price saved; do not guess one. " +
    "This is the right tool for prices: ListSubscriptions only holds purchases the user confirmed. " + MEMORY_RULES,
  parameters: [],
  resultType: sdk.ValueType.String,
  cacheTtlSecs: 0,
  execute: async function ([], context) {
    const response = await context.fetcher.fetch({ method: "GET", url: "/v1/costs", cacheTtlSecs: 0 });
    const body = response.body ?? {};
    return body.costs?.length || body.noPrice?.length ? JSON.stringify(body) : "No saved history.";
  },
});

pack.addFormula({
  name: "ListSubscriptions",
  description: "Lists the subscriptions and free trials the user confirmed, with their renewal dates.",
  instructions: "Returns " + SUBSCRIPTION_FIELDS + MEMORY_RULES,
  parameters: [],
  resultType: sdk.ValueType.String,
  cacheTtlSecs: 0,
  execute: async function ([], context) {
    const response = await context.fetcher.fetch({ method: "GET", url: "/v1/subscriptions", cacheTtlSecs: 0 });
    const subs = response.body?.subscriptions ?? [];
    return subs.length ? JSON.stringify(subs) : "No confirmed subscriptions or trials.";
  },
});

pack.addFormula({
  name: "GetUpcomingRenewals",
  description: "Lists confirmed trials and subscriptions that renew or end soon.",
  instructions:
    "Use for 'what is renewing soon?' and for the weekly digest. Returns " + SUBSCRIPTION_FIELDS +
    "Only confirmed, not-cancelled items within the window. For each, give the merchant, the amount, the date, and how many days are left. " +
    "To add cancellation steps, call GetMerchantHistory for that merchant and quote only what it returns. " + MEMORY_RULES,
  parameters: [
    sdk.makeParameter({
      type: sdk.ParameterType.Number,
      name: "days",
      description: "How many days ahead to look. Defaults to 30.",
      optional: true,
    }),
  ],
  resultType: sdk.ValueType.String,
  cacheTtlSecs: 0,
  execute: async function ([days], context) {
    const n = Math.min(Math.max(Math.round(days ?? 30), 1), 365);
    const response = await context.fetcher.fetch({ method: "GET", url: `/v1/subscriptions/upcoming?days=${n}`, cacheTtlSecs: 0 });
    const items = response.body?.upcoming ?? [];
    return items.length ? JSON.stringify(items) : `Nothing renews in the next ${n} days.`;
  },
});

pack.addFormula({
  name: "GetPendingPageJobs",
  description: "Lists web pages the Sign-up Shield browser extension has sent for review.",
  instructions:
    "Returns a JSON list of pending jobs: {jobId, page, text}. `text` is the visible text of a cookie banner, " +
    "signup, trial, checkout or cancellation page, already redacted. Analyze each job's text with the Sign-up " +
    "Shield rules, then call SubmitPageFindings once per job.",
  parameters: [],
  resultType: sdk.ValueType.String,
  cacheTtlSecs: 0, // results must never be reused: jobs change every minute
  execute: async function ([], context) {
    const response = await context.fetcher.fetch({
      method: "GET",
      url: "/v1/page-jobs",
      cacheTtlSecs: 0,
    });
    const jobs = response.body?.jobs ?? [];
    return jobs.length ? JSON.stringify(jobs) : "No pending page jobs.";
  },
});

pack.addFormula({
  name: "SubmitPageFindings",
  description: "Sends Sign-up Shield findings for one page job back so the browser extension can highlight them.",
  instructions:
    "Call once per job. `findings` is a JSON array string. Each item: " +
    '{"quote": exact words copied from the job text (8-200 characters, no paraphrase), ' +
    '"label": one of ' + LABELS + ", " +
    '"whatItDoes": one plain sentence, "whatItCostsYou": one sentence about money, time or privacy, ' +
    '"severity": "low" | "medium" | "high"}. Use an empty array [] when nothing qualifies. ' +
    "Quotes that are not literally in the job text are dropped.",
  isAction: true, // Go asks the user to confirm before running actions
  parameters: [
    sdk.makeParameter({
      type: sdk.ParameterType.String,
      name: "jobId",
      description: "The jobId from GetPendingPageJobs.",
    }),
    sdk.makeParameter({
      type: sdk.ParameterType.String,
      name: "findings",
      description: "JSON array string of findings for this job.",
    }),
  ],
  resultType: sdk.ValueType.String,
  execute: async function ([jobId, findings], context) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(findings);
    } catch {
      throw new sdk.UserVisibleError("findings must be a valid JSON array string.");
    }
    if (!Array.isArray(parsed)) throw new sdk.UserVisibleError("findings must be a JSON array.");
    const response = await context.fetcher.fetch({
      method: "POST",
      url: `/v1/page-jobs/${encodeURIComponent(jobId)}/findings`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ findings: parsed }),
    });
    const { accepted, dropped } = response.body ?? {};
    return `Accepted ${accepted} finding(s), dropped ${dropped} that were not exact quotes from the page.`;
  },
});

pack.addFormula({
  name: "MarkPageJobFailed",
  description: "Marks a page job as failed when its text can't be analyzed.",
  isAction: true,
  parameters: [
    sdk.makeParameter({
      type: sdk.ParameterType.String,
      name: "jobId",
      description: "The jobId from GetPendingPageJobs.",
    }),
  ],
  resultType: sdk.ValueType.String,
  execute: async function ([jobId], context) {
    await context.fetcher.fetch({
      method: "POST",
      url: `/v1/page-jobs/${encodeURIComponent(jobId)}/fail`,
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return "OK";
  },
});
