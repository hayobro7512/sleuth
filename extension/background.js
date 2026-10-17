// Content scripts can't call http://localhost from https pages; the service worker can.
const API = "http://localhost:8787";
const cache = new Map(); // ponytail: in-memory only, resets when the worker sleeps

async function call(path, opts) {
  const r = await fetch(API + path, opts);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.status === 204 ? {} : r.json();
}
const post = (path, body) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const handlers = {
  async analyze(m) {
    const key = m.key + (m.remember ? ":r" : "");
    if (!cache.has(key)) cache.set(key, await post("/analyze", { text: m.text, url: m.url, remember: m.remember === true, offer: m.offer }));
    return cache.get(key);
  },
  job: (m) => post("/v1/page-jobs", { text: m.text, url: m.url, remember: m.remember === true }), // Go mode: file a job for the Go agent
  poll: (m) => call(`/v1/page-jobs/${encodeURIComponent(m.id)}`),
  subscribe: (m) => post("/v1/subscriptions", m.body), // only after the user answered Yes or Not sure
  cancel: (m) => call(`/v1/page-jobs/${encodeURIComponent(m.id)}`, { method: "DELETE" }),
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const h = handlers[msg.type];
  if (!h) return;
  h(msg).then((data) => reply({ ok: true, data })).catch((e) => reply({ ok: false, error: String(e.message || e) }));
  return true; // keep the channel open for the async reply
});
