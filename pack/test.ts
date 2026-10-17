// Runs the Pack's formulas against a real backend with a hand-made fetcher.
// Usage: SS_ENDPOINT=http://localhost:8788 SS_TOKEN=... npm test   (backend started with the same SS_TOKEN)
import assert from "node:assert";
import { pack } from "./pack";

const endpoint = process.env.SS_ENDPOINT ?? "";
const token = process.env.SS_TOKEN ?? "";
if (!endpoint || !token) throw new Error("Set SS_ENDPOINT and SS_TOKEN.");

// Mimics the platform fetcher: prepends the endpoint to relative URLs, adds the bearer token, parses JSON.
const context: any = {
  fetcher: {
    fetch: async (req: any) => {
      const res = await fetch(endpoint + req.url, {
        method: req.method,
        headers: { ...req.headers, Authorization: `Bearer ${token}`, "x-forwarded-for": "203.0.113.9" }, // looks like a tunnel
        body: req.body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, body: await res.json() };
    },
  },
};
const formula = (name: string) => (pack as any).formulas.find((f: any) => f.name === name);
const run = (name: string, args: (string | number)[]) => formula(name).execute(args, context);
const extension = async (path: string, init?: any) => (await fetch(endpoint + path, init)).json(); // local route, no tunnel header

async function main() {
  const text = "We value your privacy. Only 2 spots left at this price! After 7 days your plan renews at $239.88/year.";
  await extension("/v1/merchants/pack-test.example", { method: "DELETE" }); // start clean
  assert.strictEqual(await run("ListMerchants", []).then((s: string) => s.includes("pack-test.example")), false);
  const job = await extension("/v1/page-jobs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "Pack-Test.example/cart?token=SECRET", text, remember: true }),
  });

  const pending = await run("GetPendingPageJobs", []);
  assert.ok(pending.includes(job.jobId), "pending list should contain the new job");

  const findings = JSON.stringify([
    { quote: "Only 2 spots left at this price!", label: "FAKE_URGENCY", whatItDoes: "Invents scarcity.", whatItCostsYou: "Rushed decision.", severity: "high" },
    { quote: "this sentence is not on the page", label: "SOFT WORDING" },
  ]);
  assert.strictEqual(await run("SubmitPageFindings", [job.jobId, findings]),
    "Accepted 1 finding(s), dropped 1 that were not exact quotes from the page.");
  const done = await extension(`/v1/page-jobs/${job.jobId}`);
  assert.strictEqual(done.status, "complete");
  assert.strictEqual(done.findings[0].label, "FAKE URGENCY");

  assert.strictEqual(await run("GetPendingPageJobs", []), "No pending page jobs.");

  // memory: saved because remember was true; the URL query never reaches the store
  assert.ok((await run("ListMerchants", [])).includes("pack-test.example"));
  const history = JSON.parse(await run("GetMerchantHistory", ["pack-test.example"]));
  assert.strictEqual(history.events[0].label, "FAKE URGENCY");
  assert.ok(!JSON.stringify(history).includes("SECRET"));
  const list = JSON.parse(await run("GetChecklist", ["pack-test.example"]));
  assert.ok(list.items[0].text.startsWith("Last time here:") && list.items[0].evidence.includes("Only 2 spots"));
  assert.strictEqual(await run("GetMerchantHistory", ["never-seen.example"]), "No saved history for never-seen.example.");
  const unsaved = await extension("/v1/page-jobs", { // history off: nothing may be stored
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "other-test.example/x", text, remember: false }),
  });
  await run("SubmitPageFindings", [unsaved.jobId, findings]);
  assert.strictEqual(await run("GetMerchantHistory", ["other-test.example"]), "No saved history for other-test.example.");
  await extension("/v1/merchants/pack-test.example", { method: "DELETE" });
  assert.strictEqual(await run("GetMerchantHistory", ["pack-test.example"]), "No saved history for pack-test.example.");

  // costs: stored RECURRING COST wording is ranked by yearly amount
  const costJob = async (url: string, quote: string) => {
    const txt = `Intro text here. ${quote} More words follow after that sentence.`;
    const j = await extension("/v1/page-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, text: txt, remember: true }) });
    await run("SubmitPageFindings", [j.jobId, JSON.stringify([{ quote, label: "RECURRING COST", whatItDoes: "w", whatItCostsYou: "c", severity: "low" }])]);
  };
  await costJob("cost-cheap.example/x", "The plan is $5 per month after the trial.");
  await costJob("cost-dear.example/x", "Membership is $30 per month on a yearly agreement.");
  const costs = JSON.parse(await run("GetCostSummary", []));
  const mine = costs.costs.filter((x: any) => x.merchant.startsWith("cost-"));
  assert.deepStrictEqual(mine.map((x: any) => [x.merchant, x.perYear]), [["cost-dear.example", 360], ["cost-cheap.example", 60]]);
  for (const m of ["cost-cheap.example", "cost-dear.example"]) await extension(`/v1/merchants/${m}`, { method: "DELETE" });

  // subscriptions: only what the user confirmed through the extension's local route shows up for Go
  const json = { method: "POST", headers: { "Content-Type": "application/json" } };
  const soon = await extension("/v1/subscriptions", { ...json, body: JSON.stringify({ url: "pack-sub.example/signup", plan: "Plus", price: 9.99, billing: "month", trialDays: 3, status: "confirmed" }) });
  const later = await extension("/v1/subscriptions", { ...json, body: JSON.stringify({ url: "pack-sub-later.example", price: 99, billing: "year", status: "confirmed" }) });
  const maybe = await extension("/v1/subscriptions", { ...json, body: JSON.stringify({ url: "pack-sub-maybe.example", trialDays: 2, status: "possible" }) });
  assert.ok((await run("ListSubscriptions", [])).includes("pack-sub.example"));
  const soonList = JSON.parse(await run("GetUpcomingRenewals", [7]));
  assert.ok(soonList.some((x: any) => x.merchant === "pack-sub.example" && x.daysLeft <= 3));
  assert.ok(!soonList.some((x: any) => x.merchant === "pack-sub-later.example")); // renews in a year
  assert.ok(!soonList.some((x: any) => x.merchant === "pack-sub-maybe.example")); // never confirmed
  await extension(`/v1/subscriptions/${soon.id}`, { ...json, method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
  assert.ok(!(await run("GetUpcomingRenewals", [7])).includes("pack-sub.example")); // cancelled ones drop off
  for (const x of [soon, later, maybe]) await extension(`/v1/subscriptions/${x.id}`, { method: "DELETE" });

  await assert.rejects(run("SubmitPageFindings", ["x", "not json"]), /valid JSON/);
  await assert.rejects(run("SubmitPageFindings", ["x", '{"a":1}']), /JSON array/);

  const job2 = await extension("/v1/page-jobs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "demo/b", text }),
  });
  assert.strictEqual(await run("MarkPageJobFailed", [job2.jobId]), "OK");
  assert.strictEqual((await extension(`/v1/page-jobs/${job2.jobId}`)).status, "failed");

  console.log("pack tests ok");
}
main().catch((e) => { console.error(e); process.exit(1); });
