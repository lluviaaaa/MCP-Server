import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSession, buildTranscript, groupSessions } from "../scripts/make-transcript.js";

const T0 = Date.parse("2026-10-12T09:00:00Z");
let n = 0;
function rec(offsetSec, tool, args = {}, { ok = true, ms = 50, chars = 100, error, role = "coder", ua = "Claude-Connector", hash } = {}) {
  n++;
  return {
    event: "tool_call",
    ts: new Date(T0 + offsetSec * 1000).toISOString(),
    role, ua, tool, args,
    argsHash: hash ?? `h${JSON.stringify([tool, args])}`,
    ok, ms, chars,
    ...(error ? { error } : {}),
  };
}

test("calls separated by a long idle gap become separate sessions", () => {
  const calls = [rec(0, "read_handoff", { project: "demo" }), rec(30, "list_files"), rec(7200, "read_handoff", { project: "demo" })];
  const sessions = groupSessions(calls, 20);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].length, 2);
  assert.equal(sessions[1].length, 1);
  assert.equal(groupSessions(calls, 300).length, 1);
});

test("editing a file without reading it first is flagged; reading first is not", () => {
  const blind = analyzeSession([rec(0, "str_replace", { path: "a.md", old_str: "<1 chars>", new_str: "<1 chars>" })]);
  assert.deepEqual(blind.blindWrites, ["str_replace a.md"]);
  const informed = analyzeSession([rec(0, "read_file", { path: "a.md" }), rec(5, "str_replace", { path: "a.md" })]);
  assert.equal(informed.blindWrites.length, 0);
});

test("creating a new file needs no read; overwriting needs one; a refused blind overwrite is flagged", () => {
  assert.equal(analyzeSession([rec(0, "write_file", { path: "new.md" })]).blindWrites.length, 0);
  assert.equal(analyzeSession([rec(0, "write_file", { path: "x.md", if_version: "abc" })]).blindWrites.length, 1);
  const refused = analyzeSession([rec(0, "write_file", { path: "x.md" }, { ok: false, error: "'x.md' already exists (version ...)" })]);
  assert.equal(refused.blindWrites.length, 1);
});

test("read_handoff and search_files count as reading what they cover", () => {
  const viaHandoff = analyzeSession([rec(0, "read_handoff", { project: "demo" }), rec(5, "write_file", { path: "demo/PROJECT_STATE.md", if_version: "v" })]);
  assert.equal(viaHandoff.blindWrites.length, 0);
  const viaSearch = analyzeSession([rec(0, "search_files", { query: "todo", path: "src" }), rec(5, "str_replace", { path: "src/app.js" })]);
  assert.equal(viaSearch.blindWrites.length, 0);
  const wrongFolder = analyzeSession([rec(0, "search_files", { query: "todo", path: "docs" }), rec(5, "str_replace", { path: "src/app.js" })]);
  assert.equal(wrongFolder.blindWrites.length, 1);
});

test("an identical retry right after an error is flagged; retrying after a state change is not", () => {
  const same = { path: "a.md", content: "<3 chars>" };
  const flagged = analyzeSession([rec(0, "write_file", same, { ok: false, error: "x", hash: "H" }), rec(2, "write_file", same, { ok: false, error: "x", hash: "H" })]);
  assert.equal(flagged.retriesAfterError, 1);
  const fine = analyzeSession([
    rec(0, "write_file", same, { ok: false, error: "x", hash: "H" }),
    rec(2, "append_log", { project: "p" }),
    rec(4, "write_file", same, { hash: "H" }),
  ]);
  assert.equal(fine.retriesAfterError, 0);
});

test("repeating the same read with nothing changed is redundant; after a write it is not", () => {
  const r = { path: "a.md" };
  const redundant = analyzeSession([rec(0, "read_file", r, { hash: "R" }), rec(2, "read_file", r, { hash: "R" })]);
  assert.equal(redundant.redundantReads, 1);
  const verify = analyzeSession([rec(0, "read_file", r, { hash: "R" }), rec(2, "str_replace", { path: "a.md" }), rec(4, "read_file", r, { hash: "R" })]);
  assert.equal(verify.redundantReads, 0);
});

test("loops, oversized results and batched (simultaneous) calls are detected", () => {
  const loop = analyzeSession([0, 2, 4].map((t) => rec(t, "list_files", {}, { hash: "L" })));
  assert.deepEqual(loop.loops, ["list_files x3"]);
  assert.equal(analyzeSession([rec(0, "read_file", { path: "big" }, { chars: 9000 })]).oversized, 1);
  const parallel = analyzeSession([rec(10, "read_file", { path: "a" }, { ms: 200 }), rec(10, "read_file", { path: "b" }, { ms: 200 }), rec(20, "list_files", {}, { ms: 10 })]);
  assert.equal(parallel.batchedCalls, 2);
});

test("smoke-test calls are excluded by default and can be included", () => {
  const records = [rec(0, "list_files", {}, { ua: "mcp-file-server-smoke" }), rec(5, "list_files", {}, { ua: "Claude" })];
  assert.equal(buildTranscript(records).sessions[0].calls.length, 1);
  assert.equal(buildTranscript(records, { excludeUa: [] }).sessions[0].calls.length, 2);
  assert.equal(buildTranscript(records, { excludeUa: [], onlyUa: "claude" }).sessions[0].calls.length, 1);
});

test("since/until filters and the Markdown output", () => {
  const records = [rec(0, "read_handoff", { project: "demo" }), rec(60, "write_file", { path: "demo/a.md", content: "<5 chars>" }), rec(7200, "git_commit", { message: "x" })];
  const all = buildTranscript(records);
  assert.equal(all.sessions.length, 2);
  assert.match(all.markdown, /# Tool-call transcript/);
  assert.match(all.markdown, /\*\*2 session\(s\), 3 tool calls, 0 errors\.\*\*/);
  assert.match(all.markdown, /## Session 1/);
  assert.match(all.markdown, /## Session 2/);
  assert.match(all.markdown, /\| # \| time \| role \| tool \| arguments \| result \| ms \|/);
  assert.match(all.markdown, /path=demo\/a\.md, content=<5 chars>/);
  assert.match(all.markdown, /### Efficiency self-check/);
  const late = buildTranscript(records, { since: new Date(T0 + 3600 * 1000) });
  assert.equal(late.sessions.length, 1);
  assert.equal(buildTranscript([], {}).sessions.length, 0);
  assert.match(buildTranscript([], {}).markdown, /No tool calls found/);
});

test("pipes and newlines in arguments cannot break the Markdown table", () => {
  const md = buildTranscript([rec(0, "search_files", { query: "a|b\nc" })]).markdown;
  assert.match(md, /query=a\\\|b c/);
});
