// End-to-end check of a RUNNING server using plain JSON-RPC over HTTP (no SDK needed).
// It also shows you the raw protocol: initialize -> notifications/initialized -> tools/list -> tools/call.
//   1. npm start          (terminal 1)
//   2. npm run smoke      (terminal 2)
import fs from "node:fs";
import path from "node:path";
import { loadConfig, loadDotEnv } from "../src/config.js";

loadDotEnv();
const config = loadConfig();
const base = (process.env.SMOKE_URL || `http://127.0.0.1:${config.port}`).replace(/\/+$/, "");
const UA = "mcp-file-server-smoke";
const admin = config.tokens.admin;
const reviewer = config.tokens.reviewer;
if (!admin) {
  console.error("The smoke test needs ADMIN_TOKEN in .env.");
  process.exit(1);
}

let nextId = 0;
let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
}

function parseBody(text, contentType) {
  if (!text) return null;
  if (String(contentType).includes("text/event-stream")) {
    const datas = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    for (let i = datas.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(datas[i]);
      } catch {
        /* keep looking */
      }
    }
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function rpc(token, method, params, { notification = false, url = "/mcp" } = {}) {
  const body = notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++nextId, method, params };
  const res = await fetch(base + url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": UA,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: parseBody(text, res.headers.get("content-type")), headers: res.headers };
}

async function call(token, name, args) {
  const r = await rpc(token, "tools/call", { name, arguments: args });
  const result = r.json?.result;
  const text = result?.content?.map((c) => c.text ?? "").join("\n") ?? r.json?.error?.message ?? "";
  return { status: r.status, text, isError: result?.isError === true || Boolean(r.json?.error) };
}

const versionFrom = (text) => /[Vv]ersion:?\s+([0-9a-f]{16})/.exec(text)?.[1];

async function main() {
  console.log(`\nSmoke test against ${base}\n`);

  // --- Door: health, authentication --------------------------------------------------------
  const health = await fetch(`${base}/health`);
  check("GET /health answers 200 without a token", health.status === 200);
  const noToken = await rpc(null, "tools/list", {});
  check("POST /mcp without a token is rejected (401)", noToken.status === 401, `status ${noToken.status}`);
  const badToken = await rpc("x".repeat(40), "tools/list", {});
  check("POST /mcp with a wrong token is rejected (401)", badToken.status === 401, `status ${badToken.status}`);

  // --- Protocol: the exchange from the course deck --------------------------------------------
  const init = await rpc(admin, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "1.0.0" },
  });
  check("initialize returns serverInfo and capabilities", Boolean(init.json?.result?.serverInfo && init.json?.result?.capabilities), JSON.stringify(init.json));
  console.log(`        server: ${init.json?.result?.serverInfo?.name} ${init.json?.result?.serverInfo?.version}, protocol ${init.json?.result?.protocolVersion}`);
  const initialized = await rpc(admin, "notifications/initialized", undefined, { notification: true });
  check("notifications/initialized is accepted (202, no body)", initialized.status === 202 || initialized.status === 200, `status ${initialized.status}`);

  const CORE_TOOLS = ["list_files", "read_file", "search_files", "write_file", "str_replace", "delete_file", "git_status", "git_diff", "git_commit", "git_log", "append_log", "read_handoff"];
  const list = await rpc(admin, "tools/list", {});
  const names = (list.json?.result?.tools ?? []).map((t) => t.name);
  const missingCore = CORE_TOOLS.filter((n) => !names.includes(n));
  check(`tools/list returns the ${CORE_TOOLS.length} core tools for admin (${names.length} in total, yours included)`, missingCore.length === 0, `missing: ${missingCore.join(", ")}`);
  const weak = (list.json?.result?.tools ?? []).filter((t) => (t.description ?? "").length < 80);
  check("every tool has a real description", weak.length === 0, weak.map((t) => t.name).join(", "));

  // --- Sandbox -------------------------------------------------------------------------------
  for (const [label, p] of [
    ["parent folder (..)", "../.env"],
    ["absolute path", "/etc/passwd"],
    ["Windows drive path", "C:\\Windows\\win.ini"],
    ["nested traversal", "demo/../../.env"],
    ["the .git folder", ".git/config"],
  ]) {
    const r = await call(admin, "read_file", { path: p });
    check(`sandbox blocks ${label}`, r.isError && !/root:|ADMIN_TOKEN/.test(r.text), r.text);
  }

  // --- Tools: a complete mini workflow ------------------------------------------------------
  fs.rmSync(path.join(config.workspaceRoot, "smoke-test"), { recursive: true, force: true });

  const ls = await call(admin, "list_files", { path: "." });
  check("list_files shows the workspace", !ls.isError && /demo/.test(ls.text), ls.text);

  const hand = await call(admin, "read_handoff", { project: "demo" });
  check("read_handoff loads the demo project in one call", !hand.isError && /PROJECT_STATE/.test(hand.text), hand.text);

  const created = await call(admin, "write_file", { path: "smoke-test/notes.md", content: "alpha\nbeta\ngamma\n" });
  check("write_file creates a new file", !created.isError && /Created/.test(created.text), created.text);
  const clobber = await call(admin, "write_file", { path: "smoke-test/notes.md", content: "overwrite" });
  check("write_file refuses to overwrite without if_version", clobber.isError && /if_version/.test(clobber.text), clobber.text);

  const read1 = await call(admin, "read_file", { path: "smoke-test/notes.md" });
  const v1 = versionFrom(read1.text);
  check("read_file returns content and a version", !read1.isError && Boolean(v1) && /beta/.test(read1.text), read1.text);

  const edit = await call(admin, "str_replace", { path: "smoke-test/notes.md", old_str: "beta", new_str: "BETA", if_version: v1 });
  check("str_replace edits exactly one place", !edit.isError && /Replaced 1/.test(edit.text), edit.text);
  const stale = await call(admin, "str_replace", { path: "smoke-test/notes.md", old_str: "gamma", new_str: "G", if_version: v1 });
  check("a stale if_version is rejected (lost-update guard)", stale.isError && /Version conflict/.test(stale.text), stale.text);

  const found = await call(admin, "search_files", { query: "BETA", path: "smoke-test" });
  check("search_files finds the edited line", !found.isError && /notes\.md:2:/.test(found.text), found.text);

  const logged = await call(admin, "append_log", { project: "smoke-test", file: "PLAN_LOG", entry: "smoke test entry", agent: "smoke" });
  check("append_log appends a timestamped entry", !logged.isError && /Appended/.test(logged.text), logged.text);
  const hand2 = await call(admin, "read_handoff", { project: "smoke-test" });
  check("read_handoff shows the new log entry", /smoke test entry/.test(hand2.text), hand2.text);

  const status = await call(admin, "git_status", {});
  check("git_status lists the new files", !status.isError && /smoke-test/.test(status.text), status.text);
  const commit = await call(admin, "git_commit", { message: "smoke: add smoke-test files", paths: ["smoke-test"] });
  check("git_commit commits only the given path", !commit.isError && /Committed/.test(commit.text), commit.text);
  const log = await call(admin, "git_log", { max_count: 3 });
  check("git_log shows the commit", /smoke: add/.test(log.text), log.text);
  const diff = await call(admin, "git_diff", {});
  check("git_diff runs", !diff.isError, diff.text);

  const noConfirm = await call(admin, "delete_file", { path: "smoke-test/notes.md", confirm: false });
  check("delete_file needs confirm=true", noConfirm.isError, noConfirm.text);
  const protectedDel = await call(admin, "delete_file", { path: "demo/PROJECT_STATE.md", confirm: true });
  check("handoff files cannot be deleted", protectedDel.isError && /handoff/.test(protectedDel.text), protectedDel.text);
  const del = await call(admin, "delete_file", { path: "smoke-test/notes.md", confirm: true });
  check("delete_file deletes with confirm=true", !del.isError && /Deleted/.test(del.text), del.text);

  // --- Roles and the secret-URL route --------------------------------------------------------
  if (reviewer) {
    const rlist = await rpc(reviewer, "tools/list", {});
    const rnames = (rlist.json?.result?.tools ?? []).map((t) => t.name);
    const WRITE_TOOLS = ["write_file", "str_replace", "git_commit", "delete_file"];
    check("reviewer sees the read tools but none of: write_file, str_replace, git_commit, delete_file", rnames.includes("read_file") && rnames.includes("append_log") && !rnames.some((n) => WRITE_TOOLS.includes(n)), rnames.join(", "));
    const rw = await call(reviewer, "write_file", { path: "smoke-test/x.md", content: "nope" });
    check("reviewer cannot call write_file", rw.isError, rw.text);
  }
  if (config.allowPathToken) {
    const viaPath = await rpc(null, "tools/list", {}, { url: `/s/${admin}/mcp` });
    check("secret-URL route works with the right token", viaPath.status === 200 && Array.isArray(viaPath.json?.result?.tools), `status ${viaPath.status}`);
    const wrongPath = await rpc(null, "tools/list", {}, { url: `/s/${"y".repeat(40)}/mcp` });
    check("secret-URL route returns 404 for a wrong token", wrongPath.status === 404, `status ${wrongPath.status}`);
  }

  // --- Clean up what the test created ----------------------------------------------------------
  fs.rmSync(path.join(config.workspaceRoot, "smoke-test"), { recursive: true, force: true });
  await call(admin, "git_commit", { message: "smoke: remove smoke-test files", paths: ["smoke-test"] });

  console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}: ${passed} passed, ${failed} failed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nCould not complete the smoke test: ${err.message}\nIs the server running (npm start) at ${base}?\n`);
  process.exit(1);
});
