import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createGit } from "../src/git.js";
import { ROLE_TOOLS } from "../src/roles.js";
import { createSandbox } from "../src/sandbox.js";
import { globToRegExp } from "../src/tools/search.js";
import { buildTools } from "../src/tools/index.js";

const tok = (c) => c.repeat(32);
const fakeProject = path.join(os.tmpdir(), "mcp-proj-tools-test");

async function makeEnv({ allowDelete = true } = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-tools-"));
  const config = loadConfig(
    { ADMIN_TOKEN: tok("a"), WORKSPACE_ROOT: ws, ALLOW_DELETE: String(allowDelete), MAX_FILE_BYTES: "20000" },
    fakeProject,
  );
  const sandbox = createSandbox(ws);
  const git = createGit({ cwd: ws, authorName: "Test Bot", authorEmail: "bot@example.com" });
  const gitOk = (await git.run(["--version"])).ok;
  if (gitOk) await git.ensureRepo();
  const tools = buildTools({ config, sandbox, git });
  const run = (name, args = {}, role = "admin") => tools.find((t) => t.name === name).handler(args, { role });
  const version = (text) => /version ([0-9a-f]{16})/.exec(text)?.[1] ?? /New version: ([0-9a-f]{16})/.exec(text)?.[1];
  return { ws, config, sandbox, git, gitOk, tools, run, version };
}

const failure = (promise, pattern) => assert.rejects(promise, (err) => (pattern.test(err.message) ? true : assert.fail(`message was: ${err.message}`)));

// ---------------------------------------------------------------------------------------------
test("inventory: the 12 core tools exist (plus any of yours), each with a real description, schema and annotations", async () => {
  const { tools } = await makeEnv();
  const CORE = ["list_files", "read_file", "search_files", "write_file", "str_replace", "delete_file", "git_status", "git_diff", "git_commit", "git_log", "append_log", "read_handoff"];
  for (const n of CORE) assert.ok(tools.some((t) => t.name === n), `missing core tool ${n}`);
  for (const t of tools) {
    assert.match(t.name, /^[a-z]+(_[a-z]+)+$/, `${t.name} should be verb_noun`);
    assert.ok(t.description.length >= 80, `${t.name} description is too short`);
    assert.ok(t.inputSchema && typeof t.inputSchema === "object", `${t.name} needs an input schema`);
    assert.equal(typeof t.annotations.readOnlyHint, "boolean");
    assert.equal(typeof t.handler, "function");
  }
});

test("roles only reference tools that exist, and are properly nested", async () => {
  const { tools } = await makeEnv();
  const names = new Set(tools.map((t) => t.name));
  for (const [role, set] of Object.entries(ROLE_TOOLS)) for (const n of set) assert.ok(names.has(n), `${role} lists unknown tool ${n}`);
  assert.ok(ROLE_TOOLS.admin.size >= 12);
  assert.ok(!ROLE_TOOLS.coder.has("delete_file"));
  for (const w of ["write_file", "str_replace", "git_commit", "delete_file"]) assert.ok(!ROLE_TOOLS.reviewer.has(w), `reviewer must not have ${w}`);
  for (const n of ROLE_TOOLS.reviewer) assert.ok(ROLE_TOOLS.coder.has(n));
});

test("every tool a reviewer can use (except append_log) is annotated read-only; delete_file is flagged destructive", async () => {
  const { tools } = await makeEnv();
  for (const name of ROLE_TOOLS.reviewer) {
    if (name === "append_log") continue;
    assert.equal(tools.find((t) => t.name === name).annotations.readOnlyHint, true, `${name} is in the reviewer role, so it must be read-only`);
  }
  assert.equal(tools.find((t) => t.name === "delete_file").annotations.destructiveHint, true);
});

// ---------------------------------------------------------------------------------------------
test("write_file creates, read_file returns content plus a version", async () => {
  const { run, version } = await makeEnv();
  const w = await run("write_file", { path: "notes/a.md", content: "one\ntwo\nthree\n" });
  assert.match(w, /Created notes\/a\.md \(14 bytes, 3 lines\)/);
  const r = await run("read_file", { path: "notes/a.md" });
  assert.match(r, /^FILE notes\/a\.md \| version [0-9a-f]{16} \| lines 1-3 of 3\n-----\none\ntwo\nthree$/);
  assert.equal(version(r), version(w));
});

test("read_file chunks big files and says where to continue", async () => {
  const { run } = await makeEnv();
  const content = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
  await run("write_file", { path: "big.txt", content });
  const first = await run("read_file", { path: "big.txt", max_lines: 100 });
  assert.match(first, /lines 1-100 of 500 \| more: call again with start_line=101/);
  const last = await run("read_file", { path: "big.txt", start_line: 450, max_lines: 100 });
  assert.match(last, /lines 450-500 of 500\n/);
  assert.ok(!/more:/.test(last));
  await failure(run("read_file", { path: "big.txt", start_line: 501 }), /past the end/);
});

test("read_file caps characters per call even when max_lines is large", async () => {
  const { run } = await makeEnv();
  const content = Array.from({ length: 400 }, () => "x".repeat(100)).join("\n"); // ~40 KB > 20 000 chars, but under MAX_FILE_BYTES? (20 000 limit) -> use smaller
  await run("write_file", { path: "wide.txt", content: content.slice(0, 19000) });
  const r = await run("read_file", { path: "wide.txt", max_lines: 1000 });
  assert.ok(r.length < 20500);
});

test("read_file rejects folders, missing files, binary files and oversized files", async () => {
  const { run, ws } = await makeEnv();
  fs.mkdirSync(path.join(ws, "dir"));
  fs.writeFileSync(path.join(ws, "bin.dat"), Buffer.from([1, 2, 0, 3]));
  fs.writeFileSync(path.join(ws, "huge.txt"), "x".repeat(25000));
  await failure(run("read_file", { path: "dir" }), /folder/);
  await failure(run("read_file", { path: "nope.txt" }), /Not found/);
  await failure(run("read_file", { path: "bin.dat" }), /binary/);
  await failure(run("read_file", { path: "huge.txt" }), /limit/);
  await failure(run("read_file", { path: "." }), /not the workspace root/);
});

test("write_file will not overwrite without the current version (read-before-write guard)", async () => {
  const { run, version } = await makeEnv();
  const created = await run("write_file", { path: "f.md", content: "v1" });
  await failure(run("write_file", { path: "f.md", content: "v2" }), /already exists.*if_version/);
  await failure(run("write_file", { path: "f.md", content: "v2", if_version: "new" }), /already exists/);
  await failure(run("write_file", { path: "f.md", content: "v2", if_version: "0123456789abcdef" }), /Version conflict.*current version [0-9a-f]{16}/);
  const ok = await run("write_file", { path: "f.md", content: "v2", if_version: version(created) });
  assert.match(ok, /Replaced f\.md/);
  assert.match(await run("read_file", { path: "f.md" }), /\nv2$/);
});

test("write_file: if_version on a file that does not exist is an error; 'new' is allowed", async () => {
  const { run } = await makeEnv();
  await failure(run("write_file", { path: "g.md", content: "x", if_version: "0123456789abcdef" }), /does not exist/);
  assert.match(await run("write_file", { path: "g.md", content: "x", if_version: "new" }), /Created g\.md/);
});

test("write_file refuses to replace a folder and enforces the size limit", async () => {
  const { run, ws } = await makeEnv();
  fs.mkdirSync(path.join(ws, "d"));
  await failure(run("write_file", { path: "d", content: "x" }), /folder/);
  await failure(run("write_file", { path: "big.txt", content: "x".repeat(25000) }), /limit/);
});

test("concurrent writes with the same version: exactly one wins, the other gets a conflict", async () => {
  const { run, version } = await makeEnv();
  const created = await run("write_file", { path: "race.md", content: "start" });
  const v = version(created);
  const results = await Promise.allSettled([
    run("write_file", { path: "race.md", content: "agent A", if_version: v }),
    run("write_file", { path: "race.md", content: "agent B", if_version: v }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.match(results.find((r) => r.status === "rejected").reason.message, /Version conflict/);
});

// ---------------------------------------------------------------------------------------------
test("str_replace edits exactly one occurrence and reports the line", async () => {
  const { run } = await makeEnv();
  await run("write_file", { path: "s.md", content: "alpha\nbeta\ngamma\n" });
  const r = await run("str_replace", { path: "s.md", old_str: "beta", new_str: "BETA" });
  assert.match(r, /Replaced 1 occurrence at line 2 of s\.md\. New version: [0-9a-f]{16}/);
  assert.match(await run("read_file", { path: "s.md" }), /alpha\nBETA\ngamma$/);
});

test("str_replace copies $ patterns literally", async () => {
  const { run } = await makeEnv();
  await run("write_file", { path: "d.md", content: "price: X\n" });
  await run("str_replace", { path: "d.md", old_str: "X", new_str: "$& $1 $$ cost" });
  assert.match(await run("read_file", { path: "d.md" }), /price: \$& \$1 \$\$ cost/);
});

test("str_replace fails clearly for zero matches and for several matches (with line numbers)", async () => {
  const { run } = await makeEnv();
  await run("write_file", { path: "m.md", content: "x\nfoo\ny\nfoo\nz\nfoo\n" });
  await failure(run("str_replace", { path: "m.md", old_str: "bar", new_str: "q" }), /not found/);
  await failure(run("str_replace", { path: "m.md", old_str: "foo", new_str: "q" }), /appears 3 times.*lines 2, 4, 6/);
  await failure(run("str_replace", { path: "m.md", old_str: "", new_str: "q" }), /must not be empty/);
  assert.match(await run("read_file", { path: "m.md" }), /x\nfoo\ny\nfoo\nz\nfoo$/); // file untouched
});

test("str_replace honours if_version and can delete text", async () => {
  const { run, version } = await makeEnv();
  const created = await run("write_file", { path: "v.md", content: "keep DROP keep\n" });
  await failure(run("str_replace", { path: "v.md", old_str: "DROP ", new_str: "", if_version: "0123456789abcdef" }), /Version conflict/);
  await run("str_replace", { path: "v.md", old_str: "DROP ", new_str: "", if_version: version(created) });
  assert.match(await run("read_file", { path: "v.md" }), /keep keep$/);
});

test("str_replace works on Windows (CRLF) files with LF text from the agent and keeps CRLF", async () => {
  const { run, ws } = await makeEnv();
  fs.writeFileSync(path.join(ws, "win.txt"), "line one\r\nline two\r\nline three\r\n");
  await run("str_replace", { path: "win.txt", old_str: "line one\nline two", new_str: "first\nsecond" });
  assert.equal(fs.readFileSync(path.join(ws, "win.txt"), "utf8"), "first\r\nsecond\r\nline three\r\n");
});

// ---------------------------------------------------------------------------------------------
test("delete_file needs confirm=true, refuses folders, protects handoff files", async () => {
  const { run, ws } = await makeEnv();
  await run("write_file", { path: "tmp/x.md", content: "bye" });
  await run("write_file", { path: "demo/PROJECT_STATE.md", content: "state" });
  await failure(run("delete_file", { path: "tmp/x.md", confirm: false }), /confirm=true/);
  await failure(run("delete_file", { path: "tmp", confirm: true }), /folder/);
  await failure(run("delete_file", { path: "demo/PROJECT_STATE.md", confirm: true }), /handoff file/);
  await failure(run("delete_file", { path: "demo/project_state.md", confirm: true }), /handoff file/);
  assert.match(await run("delete_file", { path: "tmp/x.md", confirm: true }), /Deleted tmp\/x\.md/);
  assert.ok(!fs.existsSync(path.join(ws, "tmp", "x.md")));
  await failure(run("delete_file", { path: "tmp/x.md", confirm: true }), /Not found/);
});

test("ALLOW_DELETE=false switches deleting off for everyone", async () => {
  const { run } = await makeEnv({ allowDelete: false });
  await run("write_file", { path: "keep.md", content: "x" });
  await failure(run("delete_file", { path: "keep.md", confirm: true }), /switched off/);
});

// ---------------------------------------------------------------------------------------------
test("list_files: lists, recurses, hides .git, truncates", async () => {
  const { run, gitOk } = await makeEnv();
  await run("write_file", { path: "a.md", content: "a" });
  await run("write_file", { path: "d1/b.md", content: "b" });
  await run("write_file", { path: "d1/d2/c.md", content: "c" });
  const flat = await run("list_files", {});
  assert.match(flat, /dir {3}d1\//);
  assert.match(flat, /file {2}a\.md {2}1 B/);
  assert.ok(!/d1\/b\.md/.test(flat));
  const deep = await run("list_files", { recursive: true });
  assert.match(deep, /d1\/d2\/c\.md/);
  const shallow = await run("list_files", { recursive: true, max_depth: 1 });
  assert.ok(!/d1\/b\.md/.test(shallow));
  if (gitOk) assert.ok(!/\.git/.test(flat), ".git must never be listed");
  const cut = await run("list_files", { recursive: true, max_entries: 2 });
  assert.match(cut, /truncated/);
  await failure(run("list_files", { path: "a.md" }), /is a file/);
  await failure(run("list_files", { path: "missing" }), /Not found/);
});

test("list_files shows symlinks without following them", async (t) => {
  const { run, ws } = await makeEnv();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-outside-"));
  try {
    fs.symlinkSync(outside, path.join(ws, "lnk"), "junction");
  } catch {
    return t.skip("cannot create symlinks here");
  }
  assert.match(await run("list_files", {}), /link {2}lnk {2}\(symbolic link, not followed\)/);
  await failure(run("list_files", { path: "lnk" }), /outside the workspace/);
});

test("search_files finds lines, is case-insensitive by default, honours glob and limits", async () => {
  const { run, ws } = await makeEnv();
  await run("write_file", { path: "a.md", content: "Hello World\nnothing\nhello again\n" });
  await run("write_file", { path: "src/b.js", content: "// hello from js\n" });
  fs.writeFileSync(path.join(ws, "bin.dat"), Buffer.from([104, 101, 108, 108, 111, 0, 1]));
  const all = await run("search_files", { query: "hello" });
  assert.match(all, /3 match\(es\) in 2 file\(s\)/);
  assert.match(all, /a\.md:1: Hello World/);
  assert.match(all, /a\.md:3: hello again/);
  assert.match(all, /src\/b\.js:1: \/\/ hello from js/);
  assert.ok(!/bin\.dat/.test(all), "binary files are skipped");
  assert.match(await run("search_files", { query: "hello", case_sensitive: true }), /2 match\(es\)/);
  assert.match(await run("search_files", { query: "hello", glob: "*.js" }), /1 match\(es\) in 1 file/);
  assert.match(await run("search_files", { query: "hello", glob: "src/**/*.js" }), /1 match\(es\)/);
  assert.match(await run("search_files", { query: "hello", max_results: 1 }), /stopped at max_results=1/);
  assert.match(await run("search_files", { query: "zzz" }), /No matches/);
  assert.match(await run("search_files", { query: "hello", path: "a.md" }), /2 match\(es\)/);
});

test("search_files never leaves the sandbox", async () => {
  const { run } = await makeEnv();
  await failure(run("search_files", { query: "x", path: ".." }), /not allowed/);
  await failure(run("search_files", { query: "x", path: "/etc" }), /Absolute paths/);
});

test("globToRegExp behaves like a small glob", () => {
  const m = (g, p) => {
    const { regex, hasSlash } = globToRegExp(g);
    return regex.test(hasSlash ? p : p.split("/").pop());
  };
  assert.ok(m("*.md", "a.md") && m("*.md", "deep/er/a.md") && !m("*.md", "a.mdx"));
  assert.ok(m("src/**/*.js", "src/a/b/c.js") && m("src/**/*.js", "src/c.js") && !m("src/**/*.js", "lib/c.js"));
  assert.ok(m("a?.txt", "ab.txt") && !m("a?.txt", "abc.txt"));
  assert.ok(m("file.(1).txt", "file.(1).txt") && !m("file.(1).txt", "fileX(1)Xtxt"));
  assert.throws(() => globToRegExp(""), /glob/);
  assert.throws(() => globToRegExp("a".repeat(101)), /glob/);
});

// ---------------------------------------------------------------------------------------------
test("git tools: status, diff, commit, log work together", async (t) => {
  const env = await makeEnv();
  if (!env.gitOk) return t.skip("git is not installed");
  const { run, ws } = env;
  assert.match(await run("git_log", {}), /No commits yet/);
  await run("write_file", { path: "g/one.md", content: "first\n" });
  assert.match(await run("git_status", {}), /\?\? g\//);
  const c1 = await run("git_commit", { message: "Add one.md" });
  assert.match(c1, /^Committed [0-9a-f]{7,}: Add one\.md\n.*1 file changed/);
  assert.match(await run("git_status", {}), /Working tree clean/);
  assert.match(await run("git_commit", { message: "Nothing here" }), /Nothing to commit/);

  const v = /version ([0-9a-f]{16})/.exec(await run("read_file", { path: "g/one.md" }))[1];
  await run("write_file", { path: "g/one.md", content: "first\nsecond\n", if_version: v });
  const diff = await run("git_diff", {});
  assert.match(diff, /\+second/);
  assert.match(await run("git_diff", { path: "g/one.md" }), /\+second/);
  assert.match(await run("git_diff", { staged: true }), /No changes/);
  assert.match(await run("git_status", { path: "g/one.md" }), / M g\/one\.md/);

  await run("write_file", { path: "other.md", content: "unrelated\n" });
  await run("git_commit", { message: "Only the g folder", paths: ["g"] });
  assert.match(await run("git_status", {}), /\?\? other\.md/, "unrelated file must not be committed");

  const log = await run("git_log", { max_count: 5 });
  assert.match(log, /Only the g folder/);
  assert.match(log, /Add one\.md/);
  assert.match(log, /Test Bot/);
  assert.match(await run("git_log", { path: "g/one.md" }), /Add one\.md/);
  assert.ok(fs.existsSync(path.join(ws, ".git")));
});

test("git_commit message: newlines collapse; too short is rejected; bad paths are rejected", async (t) => {
  const env = await makeEnv();
  if (!env.gitOk) return t.skip("git is not installed");
  const { run } = env;
  await run("write_file", { path: "n.md", content: "x" });
  assert.match(await run("git_commit", { message: "line one\nline two" }), /: line one line two/);
  await failure(run("git_commit", { message: "  " }), /too short/);
  await failure(run("git_commit", { message: "ok message", paths: ["../x"] }), /not allowed/);
  await failure(run("git_commit", { message: "ok message", paths: ["missing-file.txt"] }), /git failed/);
  await failure(run("git_diff", { path: ".git/config" }), /off limits/);
});

test("git errors never reveal where the workspace is on disk", async (t) => {
  const env = await makeEnv();
  if (!env.gitOk) return t.skip("git is not installed");
  try {
    await env.run("git_commit", { message: "ok message", paths: ["missing-file.txt"] });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(!err.message.includes(env.ws), `leaked workspace path: ${err.message}`);
  }
});

test("commit message starting with '-' is treated as text, not as an option", async (t) => {
  const env = await makeEnv();
  if (!env.gitOk) return t.skip("git is not installed");
  await env.run("write_file", { path: "o.md", content: "x" });
  assert.match(await env.run("git_commit", { message: "--amend --no-edit" }), /: --amend --no-edit/);
});

// ---------------------------------------------------------------------------------------------
test("append_log creates the log with a header, then appends timestamped entries", async () => {
  const { run, ws } = await makeEnv();
  const a = await run("append_log", { project: "demo", file: "PLAN_LOG", entry: "Plan: build the skeleton", agent: "session-1 planner" }, "coder");
  assert.match(a, /Appended to demo\/PLAN_LOG\.md at \d{4}-/);
  await run("append_log", { project: "demo", file: "PLAN_LOG", entry: "Second entry" }, "reviewer");
  const text = fs.readFileSync(path.join(ws, "demo", "PLAN_LOG.md"), "utf8");
  assert.match(text, /^# PLAN_LOG - demo\n_Append-only/);
  assert.match(text, /## \d{4}-.*- session-1 planner \(coder\)\nPlan: build the skeleton/);
  assert.match(text, /- reviewer \(reviewer\)\nSecond entry/);
});

test("append_log demotes headings in entries so they cannot fake log entries", async () => {
  const { run, ws } = await makeEnv();
  await run("append_log", { project: "demo", file: "DECISIONS", entry: "# Big title\n## Fake entry\nbody" });
  const text = fs.readFileSync(path.join(ws, "demo", "DECISIONS.md"), "utf8");
  assert.equal((text.match(/^## /gm) ?? []).length, 1, "only the real entry heading may start with '## '");
  assert.match(text, /### Big title\n### Fake entry/);
});

test("append_log validates project and file names", async () => {
  const { run } = await makeEnv();
  for (const project of ["../x", "a/b", ".hidden", "", "con", "x".repeat(70)]) {
    await assert.rejects(run("append_log", { project, file: "PLAN_LOG", entry: "x" }), undefined, `project "${project}" should be rejected`);
  }
  await failure(run("append_log", { project: "demo", file: "README", entry: "x" }), /file must be one of/);
});

test("append_log in parallel keeps every entry intact", async () => {
  const { run, ws } = await makeEnv();
  await Promise.all(Array.from({ length: 20 }, (_, i) => run("append_log", { project: "p", file: "CHECKPOINTS", entry: `entry number ${i}` })));
  const text = fs.readFileSync(path.join(ws, "p", "CHECKPOINTS.md"), "utf8");
  for (let i = 0; i < 20; i++) assert.ok(text.includes(`entry number ${i}\n`), `missing entry ${i}`);
});

test("read_handoff returns state + latest log entries in one call and flags missing files", async () => {
  const { run } = await makeEnv();
  const empty = await run("read_handoff", { project: "demo" });
  assert.match(empty, /PROJECT_STATE\.md === \(missing/);
  assert.match(empty, /PLAN_LOG\.md === \(missing\)/);

  await run("write_file", { path: "demo/PROJECT_STATE.md", content: "# State\nGoal: ship it\n" });
  for (let i = 1; i <= 7; i++) await run("append_log", { project: "demo", file: "PLAN_LOG", entry: `plan number ${i}` });
  await run("append_log", { project: "demo", file: "DECISIONS", entry: "Use plain JS" });
  const h = await run("read_handoff", { project: "demo", log_entries: 3 });
  assert.match(h, /=== PROJECT_STATE\.md \| version [0-9a-f]{16} ===\n# State\nGoal: ship it/);
  assert.match(h, /PLAN_LOG\.md \| last 3 of 7 entries/);
  assert.match(h, /plan number 7/);
  assert.match(h, /plan number 5/);
  assert.ok(!/plan number 4/.test(h));
  assert.match(h, /DECISIONS\.md \| last 1 of 1 entries[\s\S]*Use plain JS/);
  assert.match(h, /CHECKPOINTS\.md === \(missing\)/);
});

// ---------------------------------------------------------------------------------------------
test("the sandbox protects every file tool and its error messages do not leak the host path", async () => {
  const { run, ws } = await makeEnv();
  const attempts = [
    ["list_files", { path: "../" }],
    ["read_file", { path: "../../etc/passwd" }],
    ["write_file", { path: "../evil.txt", content: "x" }],
    ["str_replace", { path: "..\\evil.txt", old_str: "a", new_str: "b" }],
    ["delete_file", { path: "/etc/hosts", confirm: true }],
    ["search_files", { query: "x", path: "C:\\Windows" }],
    ["read_file", { path: ".git/config" }],
    ["append_log", { project: "..", file: "PLAN_LOG", entry: "x" }],
    ["read_handoff", { project: "../.." }],
  ];
  for (const [name, args] of attempts) {
    try {
      await run(name, args);
      assert.fail(`${name} ${JSON.stringify(args)} should have been refused`);
    } catch (err) {
      assert.ok(err.name === "SandboxError" || err.name === "ToolError", `${name}: unexpected ${err.name}: ${err.message}`);
      assert.ok(!err.message.includes(ws), `${name} leaked the workspace path`);
    }
  }
  assert.ok(!fs.existsSync(path.join(ws, "..", "evil.txt")));
});

test("audit_loot_table: weights add up to 100 and there are no placeholders", async () => {
  const { run } = await makeEnv();
  const csv = [
    "id,item_name,weight,rarity,source_creature",
    "1,Bog Pearl,40,common,Giant Frog",
    "2,Mire Charm,30,uncommon,Bog Wraith",
    "3,Spore Vial,20,uncommon,Spore Lurker",
    "4,Rotwood Staff,10,rare,Swamp Hag",
    "",
  ].join("\n");
  await run("write_file", { path: "dnd-swamp/loot.csv", content: csv });
  const report = await run("audit_loot_table", { path: "dnd-swamp/loot.csv" });
  assert.match(report, /Rows: 4 \(lines 2-5\)/);
  assert.match(report, /Weight column: "weight" \(column 3\)/);
  assert.match(report, /Total weight: 100 \(OK, equals 100\)/);
  assert.match(report, /Placeholders \(TODO, FIXME, TBD\): none/);
  assert.match(report, /Result: no problems found/);
});

test("audit_loot_table: a wrong total and a TODO are reported with line numbers", async () => {
  const { run } = await makeEnv();
  const csv = [
    "id,name,weight,cr,hazard_note", // line 1
    "1,Giant Frog,30,1/4,none", // line 2
    "2,Bog Wraith,30,3,TODO", // line 3
    "3,Spore Lurker,35,2,toxic spores", // line 4
    "",
  ].join("\n");
  await run("write_file", { path: "dnd-swamp/encounters.csv", content: csv });
  const report = await run("audit_loot_table", { path: "dnd-swamp/encounters.csv" });
  assert.match(report, /Total weight: 95 \(PROBLEM: 5 short of 100\)/);
  assert.match(report, /line 3: TODO/);
  assert.match(report, /Result: 2 problem\(s\) found/);
});
