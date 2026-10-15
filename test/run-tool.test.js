import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ToolError } from "../src/errors.js";
import { createLogger, hashArgs, summarizeArgs } from "../src/logger.js";
import { runTool } from "../src/run-tool.js";

function fakeLogger() {
  const calls = [];
  const errors = [];
  return { calls, errors, toolCall: (c) => calls.push(c), error: (text, err) => errors.push({ text, err }) };
}

test("success: returns a text block and logs ok", async () => {
  const logger = fakeLogger();
  const tool = { name: "demo_tool", handler: async (args, call) => `hello ${args.name} as ${call.role}` };
  const result = await runTool(tool, { name: "Ana" }, { role: "coder", logger });
  assert.deepEqual(result, { content: [{ type: "text", text: "hello Ana as coder" }] });
  assert.equal(logger.calls[0].ok, true);
  assert.equal(logger.calls[0].tool, "demo_tool");
  assert.equal(logger.calls[0].role, "coder");
});

test("a ToolError becomes isError with exactly its message", async () => {
  const logger = fakeLogger();
  const tool = { name: "t", handler: async () => { throw new ToolError("old_str appears 3 times"); } };
  const result = await runTool(tool, {}, { role: "admin", logger });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "Error: old_str appears 3 times");
  assert.equal(logger.errors.length, 0, "expected errors are not server crashes");
});

test("an unexpected error never leaks its message, stack or paths to the agent, but is logged", async () => {
  const logger = fakeLogger();
  const tool = { name: "t", handler: async () => { throw new TypeError("boom at C:\\secret\\place\\file.js:12"); } };
  const result = await runTool(tool, {}, { role: "admin", logger });
  assert.equal(result.isError, true);
  assert.ok(!/boom|secret|file\.js|at /.test(result.content[0].text), result.content[0].text);
  assert.match(result.content[0].text, /Internal server error/);
  assert.equal(logger.errors.length, 1);
  assert.match(logger.errors[0].err.message, /boom/);
});

test("operating-system errors are translated by code", async () => {
  const logger = fakeLogger();
  const err = Object.assign(new Error("ENOENT: no such file or directory, open '/home/x/secret.txt'"), { code: "ENOENT" });
  const result = await runTool({ name: "t", handler: async () => { throw err; } }, {}, { role: "admin", logger });
  assert.ok(!result.content[0].text.includes("/home/x"));
  assert.match(result.content[0].text, /Not found/);
});

test("very long output is truncated with a notice", async () => {
  const logger = fakeLogger();
  const result = await runTool({ name: "t", handler: async () => "x".repeat(500) }, {}, { role: "admin", logger, maxOutputChars: 100 });
  assert.ok(result.content[0].text.length < 250);
  assert.match(result.content[0].text, /output truncated at 100 characters/);
});

test("summarizeArgs keeps file content out of the log and shortens long strings", () => {
  const s = summarizeArgs({ path: "a.md", content: "SECRET BODY", old_str: "abc", new_str: "def", entry: "diary", q: "x".repeat(300), n: 5, list: ["a", "b"] });
  assert.equal(s.path, "a.md");
  assert.equal(s.content, "<11 chars>");
  assert.equal(s.old_str, "<3 chars>");
  assert.equal(s.new_str, "<3 chars>");
  assert.equal(s.entry, "<5 chars>");
  assert.match(s.q, /\.\.\.\(300 chars\)$/);
  assert.equal(s.n, 5);
  assert.deepEqual(s.list, ["a", "b"]);
  assert.ok(!JSON.stringify(s).includes("SECRET BODY"));
});

test("hashArgs is stable, order-independent and sensitive to content", () => {
  assert.equal(hashArgs({ a: 1, b: { y: 2, x: 1 } }), hashArgs({ b: { x: 1, y: 2 }, a: 1 }));
  assert.notEqual(hashArgs({ content: "one" }), hashArgs({ content: "two" }));
  assert.match(hashArgs({}), /^[0-9a-f]{10}$/);
});

test("the real logger writes one JSON object per line and never the file content", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-log-"));
  const logger = createLogger({ dir, echo: false });
  const tool = { name: "write_file", handler: async () => "ok" };
  await runTool(tool, { path: "a.md", content: "TOP SECRET CONTENT" }, { role: "coder", ua: "claude", logger });
  logger.authFail({ ip: "1.2.3.4", route: "/mcp", reason: "bad_token" });
  const lines = fs.readFileSync(path.join(dir, "server.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, "tool_call");
  assert.equal(lines[0].tool, "write_file");
  assert.equal(lines[0].role, "coder");
  assert.equal(lines[0].ua, "claude");
  assert.equal(lines[0].ok, true);
  assert.equal(lines[0].args.content, "<18 chars>");
  assert.ok(!JSON.stringify(lines).includes("TOP SECRET CONTENT"));
  assert.equal(lines[1].event, "auth_fail");
  assert.ok(lines[0].ts && typeof lines[0].ms === "number");
});

test("logging failures never break the server (unwritable log folder)", () => {
  const logger = createLogger({ dir: path.join(os.tmpdir(), "no", "\0bad"), echo: false });
  assert.doesNotThrow(() => logger.event("x", {}));
});
