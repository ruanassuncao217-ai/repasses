import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/proxy.js";

const env = { ANTHROPIC_API_KEY: "sk-ant-segredo", CLINIC_TOKENS: "cardiolima:tok123,integrale:tok456", ALLOWED_ORIGINS: "https://assuncao.github.io", ALLOWED_MODELS: "claude-sonnet-5-5,claude-haiku-5-5", MAX_TOKENS: "1500" };
const req = (o = {}) => new Request("https://proxy.test/", { method: o.method || "POST", headers: { origin: o.origin ?? "https://assuncao.github.io", "content-type": "application/json", ...(o.token !== null ? { "x-clinic-token": o.token ?? "tok123" } : {}) }, body: o.method === "OPTIONS" ? undefined : JSON.stringify(o.body ?? { model: "claude-sonnet-5-5", max_tokens: 500, messages: [{ role: "user", content: "oi" }] }) });

test("proxy: bloqueia origem, token e método inválidos", async () => {
  assert.equal((await worker.fetch(req({ origin: "https://outro.site" }), env)).status, 403);
  assert.equal((await worker.fetch(req({ token: "errado" }), env)).status, 403);
  assert.equal((await worker.fetch(req({ token: null }), env)).status, 403);
  assert.equal((await worker.fetch(new Request("https://proxy.test/", { method: "GET", headers: { origin: "https://assuncao.github.io" } }), env)).status, 405);
  const pre = await worker.fetch(req({ method: "OPTIONS" }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://assuncao.github.io");
});

test("proxy: injeta a chave, força modelo permitido e limita tokens", async () => {
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url, init }; return new Response('{"content":[]}', { status: 200, headers: { "content-type": "application/json" } }); };
  const r = await worker.fetch(req({ body: { model: "claude-opus-qualquer", max_tokens: 99999, messages: [{ role: "user", content: "oi" }], extra: "x" } }), env);
  assert.equal(r.status, 200);
  assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
  assert.equal(sent.init.headers["x-api-key"], "sk-ant-segredo");
  const b = JSON.parse(sent.init.body);
  assert.equal(b.model, "claude-sonnet-5-5");
  assert.equal(b.max_tokens, 1500);
  assert.equal(b.extra, undefined);
  assert.equal(b.metadata.user_id, "cardiolima");
});
