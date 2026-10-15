import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createAuth } from "../src/auth.js";
import { FailureLimiter, createHttpHandler } from "../src/http.js";

const tok = (c) => c.repeat(32);
const TOKENS = { admin: tok("a"), coder: tok("b"), reviewer: tok("c") };
const RPC = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

async function start(configOverrides = {}) {
  const records = [];
  const calls = [];
  const logger = {
    authFail: (r) => records.push({ event: "auth_fail", ...r }),
    event: (type, d) => records.push({ event: type, ...d }),
    error: (text) => records.push({ event: "error", text }),
    info() {},
    toolCall() {},
  };
  const handleMcp = async ({ role, ua, res, body }) => {
    calls.push({ role, ua, body });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, result: { reachedMcp: true, role } }));
  };
  const config = { allowPathToken: true, allowedOrigins: [], maxBodyBytes: 5000, ...configOverrides };
  const server = http.createServer(createHttpHandler({ auth: createAuth({ tokens: TOKENS }), handleMcp, logger, config }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    records,
    calls,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

const post = (base, url, { token, body = RPC, headers = {} } = {}) =>
  fetch(base + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body,
  });

test("GET /health needs no token and reveals nothing", async () => {
  const s = await start();
  const res = await fetch(`${s.base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  await s.close();
});

test("POST /mcp without a token: 401 with a Bearer challenge, MCP code never runs", async () => {
  const s = await start();
  const res = await post(s.base, "/mcp");
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate"), /^Bearer/);
  assert.equal(s.calls.length, 0);
  assert.equal(s.records.find((r) => r.event === "auth_fail").reason, "missing_token");
  await s.close();
});

test("wrong tokens are rejected: wrong value, wrong length, wrong scheme, partial token", async () => {
  const s = await start();
  for (const header of [`Bearer ${"z".repeat(64)}`, "Bearer short", `Basic ${TOKENS.admin}`, TOKENS.admin, `Bearer ${TOKENS.admin.slice(0, -1)}`, `Bearer ${TOKENS.admin}x`]) {
    const res = await post(s.base, "/mcp", { headers: { Authorization: header } });
    assert.equal(res.status, 401, header);
  }
  assert.equal(s.calls.length, 0);
  await s.close();
});

test("each token maps to its own role", async () => {
  const s = await start();
  for (const role of ["admin", "coder", "reviewer"]) {
    const res = await post(s.base, "/mcp", { token: TOKENS[role] });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).result.role, role);
  }
  assert.deepEqual(s.calls.map((c) => c.role), ["admin", "coder", "reviewer"]);
  await s.close();
});

test("the secret-URL route works with the right token and 404s otherwise", async () => {
  const s = await start();
  const ok = await post(s.base, `/s/${TOKENS.coder}/mcp`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).result.role, "coder");
  assert.equal((await post(s.base, `/s/${"q".repeat(40)}/mcp`)).status, 404);
  assert.equal((await post(s.base, `/s/%E0%A4%A/mcp`)).status, 404); // malformed percent-encoding
  assert.equal(s.calls.length, 1);
  await s.close();
});

test("the secret-URL route can be switched off", async () => {
  const s = await start({ allowPathToken: false });
  assert.equal((await post(s.base, `/s/${TOKENS.admin}/mcp`)).status, 404);
  assert.equal((await post(s.base, "/mcp", { token: TOKENS.admin })).status, 200);
  await s.close();
});

test("tokens are never written to the log, even when they appear in the URL", async () => {
  const s = await start();
  await post(s.base, `/s/${"w".repeat(40)}/mcp`);
  await post(s.base, "/mcp", { headers: { Authorization: `Bearer ${"v".repeat(40)}` } });
  const dump = JSON.stringify(s.records);
  assert.ok(!dump.includes("w".repeat(40)) && !dump.includes("v".repeat(40)));
  assert.ok(s.records.some((r) => r.route === "/s/[redacted]/mcp"));
  await s.close();
});

test("only POST reaches MCP: GET and DELETE get 405 (after auth), unauthenticated ones get 401", async () => {
  const s = await start();
  for (const method of ["GET", "DELETE", "PUT"]) {
    const authed = await fetch(`${s.base}/mcp`, { method, headers: { Authorization: `Bearer ${TOKENS.admin}` } });
    assert.equal(authed.status, 405, method);
    assert.equal(authed.headers.get("allow"), "POST");
    const anon = await fetch(`${s.base}/mcp`, { method });
    assert.equal(anon.status, 401, method);
  }
  await s.close();
});

test("content type, JSON syntax and body size are checked", async () => {
  const s = await start();
  const t = { token: TOKENS.admin };
  assert.equal((await post(s.base, "/mcp", { ...t, headers: { "Content-Type": "text/plain" } })).status, 415);
  const bad = await post(s.base, "/mcp", { ...t, body: "{not json" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);
  const big = await post(s.base, "/mcp", { ...t, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "x", params: { pad: "p".repeat(6000) } }) });
  assert.equal(big.status, 413);
  assert.equal(s.calls.length, 0);
  await s.close();
});

test("unknown paths are 404", async () => {
  const s = await start();
  for (const p of ["/", "/admin", "/mcp/extra", "/.env", "/s/x/other"]) assert.equal((await fetch(s.base + p)).status, 404, p);
  await s.close();
});

test("browser requests with an unknown Origin are refused; allowed origins pass", async () => {
  const s = await start({ allowedOrigins: ["https://good.example"] });
  const evil = await post(s.base, "/mcp", { token: TOKENS.admin, headers: { Origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
  const good = await post(s.base, "/mcp", { token: TOKENS.admin, headers: { Origin: "https://good.example" } });
  assert.equal(good.status, 200);
  const none = await post(s.base, "/mcp", { token: TOKENS.admin });
  assert.equal(none.status, 200);
  await s.close();
});

test("repeated failed logins from one address are throttled (429), even for a later valid token", async () => {
  const s = await start();
  for (let i = 0; i < 20; i++) assert.equal((await post(s.base, "/mcp", { token: "n".repeat(40) })).status, 401);
  const blocked = await post(s.base, "/mcp", { token: TOKENS.admin });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
  await s.close();
});

test("the client's name and the User-Agent are passed along; initialize is logged", async () => {
  const s = await start();
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-ai", version: "0.1" } } });
  await post(s.base, "/mcp", { token: TOKENS.admin, body, headers: { "User-Agent": "Claude-Connector/1.0" } });
  assert.equal(s.calls[0].ua, "Claude-Connector/1.0");
  const init = s.records.find((r) => r.event === "client_initialize");
  assert.equal(init.client.name, "claude-ai");
  assert.equal(init.role, "admin");
  await s.close();
});

test("an exception inside the MCP handler becomes a clean 500, not a crash or a stack trace", async () => {
  const logger = { authFail() {}, event() {}, info() {}, toolCall() {}, error() {} };
  const handler = createHttpHandler({
    auth: createAuth({ tokens: TOKENS }),
    handleMcp: async () => { throw new Error("secret internals"); },
    logger,
    config: { allowPathToken: true, allowedOrigins: [], maxBodyBytes: 5000 },
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const res = await post(`http://127.0.0.1:${server.address().port}`, "/mcp", { token: TOKENS.admin });
  assert.equal(res.status, 500);
  assert.ok(!(await res.text()).includes("secret internals"));
  server.close();
});

test("FailureLimiter forgets old failures", () => {
  const l = new FailureLimiter({ max: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) l.record("ip", 0);
  assert.equal(l.blocked("ip", 500), true);
  assert.equal(l.blocked("ip", 1500), false);
  assert.equal(l.blocked("other", 0), false);
});
