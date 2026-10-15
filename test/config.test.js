import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigError, loadConfig } from "../src/config.js";

const tok = (c) => c.repeat(32);
const project = path.join(os.tmpdir(), "mcp-proj-config-test");
const base = { ADMIN_TOKEN: tok("a"), CODER_TOKEN: tok("b"), REVIEWER_TOKEN: tok("c") };

test("valid environment produces a frozen config with sensible defaults", () => {
  const c = loadConfig(base, project);
  assert.equal(c.host, "127.0.0.1");
  assert.equal(c.port, 3333);
  assert.equal(c.workspaceRoot, path.join(project, "workspace"));
  assert.deepEqual(Object.keys(c.tokens).sort(), ["admin", "coder", "reviewer"]);
  assert.equal(c.allowPathToken, true);
  assert.ok(Object.isFrozen(c));
});

test("refuses to start with no tokens", () => {
  assert.throws(() => loadConfig({}, project), ConfigError);
  assert.throws(() => loadConfig({ ADMIN_TOKEN: "" }, project), /No access tokens/);
});

test("rejects short or badly shaped tokens", () => {
  assert.throws(() => loadConfig({ ADMIN_TOKEN: "short" }, project), /24-128/);
  assert.throws(() => loadConfig({ ADMIN_TOKEN: `${"a".repeat(30)} !` }, project), /24-128/);
});

test("rejects two roles sharing one token", () => {
  assert.throws(() => loadConfig({ ADMIN_TOKEN: tok("a"), CODER_TOKEN: tok("a") }, project), /share the same value/);
});

test("a single role is enough", () => {
  const c = loadConfig({ ADMIN_TOKEN: tok("a") }, project);
  assert.deepEqual(Object.keys(c.tokens), ["admin"]);
});

test("workspace may not contain the server's own files (that would expose .env)", () => {
  assert.throws(() => loadConfig({ ...base, WORKSPACE_ROOT: ".." }, project), /must not contain/);
  assert.throws(() => loadConfig({ ...base, WORKSPACE_ROOT: "." }, project), /must not contain/);
  assert.throws(() => loadConfig({ ...base, WORKSPACE_ROOT: path.parse(project).root }, project), ConfigError);
});

test("workspace may not live inside src, scripts, logs, ...", () => {
  assert.throws(() => loadConfig({ ...base, WORKSPACE_ROOT: "src/files" }, project), /"src"/);
  assert.throws(() => loadConfig({ ...base, WORKSPACE_ROOT: "logs/ws" }, project), /"logs"/);
});

test("logs may not be inside the workspace", () => {
  assert.throws(() => loadConfig({ ...base, LOG_DIR: "workspace/logs" }, project), /LOG_DIR/);
});

test("a workspace outside the project folder is fine", () => {
  const elsewhere = path.join(os.tmpdir(), "my-notes");
  assert.equal(loadConfig({ ...base, WORKSPACE_ROOT: elsewhere }, project).workspaceRoot, elsewhere);
});

test("numbers and booleans are validated", () => {
  assert.throws(() => loadConfig({ ...base, PORT: "abc" }, project), /PORT/);
  assert.throws(() => loadConfig({ ...base, PORT: "70000" }, project), /PORT/);
  assert.throws(() => loadConfig({ ...base, ALLOW_DELETE: "maybe" }, project), /ALLOW_DELETE/);
  assert.equal(loadConfig({ ...base, ALLOW_DELETE: "false", ALLOW_PATH_TOKEN: "0" }, project).allowDelete, false);
});

test("PUBLIC_URL must be a bare https address", () => {
  assert.equal(loadConfig({ ...base, PUBLIC_URL: "https://x.ngrok-free.app/" }, project).publicUrl, "https://x.ngrok-free.app");
  assert.throws(() => loadConfig({ ...base, PUBLIC_URL: "x.ngrok-free.app" }, project), /PUBLIC_URL/);
  assert.throws(() => loadConfig({ ...base, PUBLIC_URL: "https://x.ngrok-free.app/mcp" }, project), /PUBLIC_URL/);
});

test("ALLOWED_ORIGINS is parsed as a list", () => {
  assert.deepEqual(loadConfig({ ...base, ALLOWED_ORIGINS: "https://a.com, https://b.com," }, project).allowedOrigins, ["https://a.com", "https://b.com"]);
});
