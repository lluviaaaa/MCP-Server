// Turns logs/server.jsonl (written by the server itself) into a readable tool-call transcript with
// a per-session efficiency self-check. The evidence is the log, not anyone's claims.
//
//   npm run transcript                                  all calls, written to TRANSCRIPT.md
//   npm run transcript -- --since "2026-10-12 09:00"    only the demo run
//   npm run transcript -- --gap 30 --stdout             sessions split after 30 idle minutes, print instead of writing
//
// A "session" here = a burst of calls separated from the next burst by an idle gap (default 20 min),
// which is what happens when you open a NEW chat for session 2.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT, loadDotEnv } from "../src/config.js";

const READ_ONLY_TOOLS = new Set(["list_files", "read_file", "search_files", "read_handoff"]);
const MUTATING_TOOLS = new Set(["write_file", "str_replace", "delete_file", "append_log", "git_commit"]);
const HANDOFF_NAMES = new Set(["project_state.md", "plan_log.md", "checkpoints.md", "decisions.md"]);
const OVERSIZED_CHARS = 8000;

const norm = (p) => String(p ?? "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
const startMs = (r) => new Date(r.ts).getTime() - (r.ms ?? 0);
const endMs = (r) => new Date(r.ts).getTime();
const keyOf = (r) => `${r.tool}:${r.argsHash}`;

export function readRecords(file) {
  const records = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      /* skip a damaged line */
    }
  }
  return records;
}

export function groupSessions(calls, gapMinutes = 20) {
  const sorted = [...calls].sort((a, b) => startMs(a) - startMs(b));
  const sessions = [];
  let lastEnd = -Infinity;
  for (const call of sorted) {
    if (sessions.length === 0 || startMs(call) - lastEnd > gapMinutes * 60_000) sessions.push([]);
    sessions[sessions.length - 1].push(call);
    lastEnd = Math.max(lastEnd, endMs(call));
  }
  return sessions;
}

function covers(prior, write) {
  const target = norm(write.args?.path);
  if (prior.tool === "read_file") return norm(prior.args?.path) === target;
  if (prior.tool === "search_files") {
    const prefix = norm(prior.args?.path ?? ".");
    return prefix === "" || prefix === "." || target === prefix || target.startsWith(`${prefix}/`);
  }
  if (prior.tool === "read_handoff") {
    const parts = target.split("/");
    return parts.length === 2 && parts[0] === norm(prior.args?.project) && HANDOFF_NAMES.has(parts[1]);
  }
  if (prior.tool === "write_file" || prior.tool === "str_replace") return norm(prior.args?.path) === target;
  return false;
}

/** The checks behind the rubric's "agent efficiency" criterion. They are heuristics: a prompt, not a grade. */
export function analyzeSession(calls) {
  const sorted = [...calls].sort((a, b) => startMs(a) - startMs(b));
  const byTool = {};
  let errors = 0;
  for (const c of sorted) {
    byTool[c.tool] = (byTool[c.tool] ?? 0) + 1;
    if (!c.ok) errors++;
  }

  // Reads before writes
  const blindWrites = [];
  for (const w of sorted) {
    const overwrite = w.tool === "write_file" && w.args?.if_version && w.args.if_version !== "new";
    const blindOverwriteAttempt = w.tool === "write_file" && !w.ok && /already exists/.test(w.error ?? "");
    if (!(w.tool === "str_replace" || overwrite || blindOverwriteAttempt)) continue;
    const informed = sorted.some((r) => r !== w && r.ok && endMs(r) <= startMs(w) + 1 && covers(r, w));
    if (!informed) blindWrites.push(`${w.tool} ${w.args?.path ?? ""}`.trim());
  }

  // Redundant reads and identical retries
  let redundantReads = 0;
  let retriesAfterError = 0;
  const counts = new Map();
  sorted.forEach((c, i) => {
    const key = keyOf(c);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    let prevIndex = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (keyOf(sorted[j]) === key) {
        prevIndex = j;
        break;
      }
    }
    if (prevIndex === -1) return;
    const between = sorted.slice(prevIndex + 1, i);
    const stateChanged = between.some((b) => b.ok && MUTATING_TOOLS.has(b.tool));
    if (READ_ONLY_TOOLS.has(c.tool) && sorted[prevIndex].ok && !stateChanged) redundantReads++;
    if (!sorted[prevIndex].ok && !stateChanged) retriesAfterError++;
  });
  const loops = [...counts.entries()].filter(([, n]) => n >= 3).map(([key, n]) => `${key.split(":")[0]} x${n}`);

  const oversized = sorted.filter((c) => (c.chars ?? 0) > OVERSIZED_CHARS).length;

  // Calls that ran at the same time = batched independent calls
  const overlapping = new Set();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (startMs(sorted[j]) >= endMs(sorted[i])) break;
      overlapping.add(i);
      overlapping.add(j);
    }
  }

  const first = sorted.length ? startMs(sorted[0]) : 0;
  const last = sorted.length ? Math.max(...sorted.map(endMs)) : 0;
  return {
    total: sorted.length,
    errors,
    byTool,
    seconds: Math.round((last - first) / 1000),
    blindWrites,
    redundantReads,
    retriesAfterError,
    loops,
    oversized,
    batchedCalls: overlapping.size,
    committed: (byTool.git_commit ?? 0) > 0,
    handedOff: (byTool.read_handoff ?? 0) > 0,
    loggedProgress: (byTool.append_log ?? 0) > 0,
  };
}

const cell = (text, max = 110) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").replaceAll("|", "\\|");
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
};
const showArgs = (args = {}) => cell(Object.entries(args).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", "));
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour12: false });

function renderSession(calls, index, stats) {
  const sorted = [...calls].sort((a, b) => startMs(a) - startMs(b));
  const start = startMs(sorted[0]);
  const roles = [...new Set(sorted.map((c) => c.role))].join(", ");
  const clients = [...new Set(sorted.map((c) => c.ua).filter(Boolean))].join(", ") || "unknown";
  const lines = [];
  lines.push(`## Session ${index + 1}: ${new Date(start).toLocaleString()} (${stats.seconds}s, ${stats.total} calls)`);
  lines.push("");
  lines.push(`Roles: ${roles} | Client(s): ${cell(clients, 80)}`);
  lines.push("");
  lines.push("| # | time | role | tool | arguments | result | ms |");
  lines.push("|---|------|------|------|-----------|--------|----|");
  sorted.forEach((c, i) => {
    const result = c.ok ? `ok, ${c.chars ?? 0} chars` : `ERROR: ${cell(c.error, 70)}`;
    lines.push(`| ${i + 1} | ${clock(startMs(c))} | ${c.role} | ${c.tool} | ${showArgs(c.args)} | ${result} | ${c.ms ?? ""} |`);
  });
  lines.push("");
  const mark = (good) => (good ? "[ok]   " : "[check]");
  lines.push("### Efficiency self-check (heuristics from the log)");
  lines.push("");
  lines.push(`- ${mark(stats.handedOff)} Session started by loading the handoff (read_handoff): ${stats.handedOff ? "yes" : "no"}`);
  lines.push(`- ${mark(stats.blindWrites.length === 0)} Edits made without reading the file first: ${stats.blindWrites.length}${stats.blindWrites.length ? ` (${stats.blindWrites.join("; ")})` : ""}`);
  lines.push(`- ${mark(stats.retriesAfterError === 0)} Identical retries right after an error: ${stats.retriesAfterError}`);
  lines.push(`- ${mark(stats.redundantReads === 0)} Redundant repeated reads (same call, nothing changed in between): ${stats.redundantReads}`);
  lines.push(`- ${mark(stats.loops.length === 0)} Possible loops (same call 3+ times): ${stats.loops.length ? stats.loops.join(", ") : "none"}`);
  lines.push(`- ${mark(stats.oversized === 0)} Oversized results (over ${OVERSIZED_CHARS} characters): ${stats.oversized}`);
  lines.push(`- ${stats.batchedCalls > 0 ? "[ok]   " : "[info] "} Calls that ran at the same time (batched): ${stats.batchedCalls}`);
  lines.push(`- ${mark(stats.loggedProgress)} Progress recorded with append_log: ${stats.loggedProgress ? "yes" : "no"}`);
  lines.push(`- ${mark(stats.committed)} Work committed with git_commit: ${stats.committed ? "yes" : "no"}`);
  lines.push(`- Errors: ${stats.errors} of ${stats.total} calls. By tool: ${Object.entries(stats.byTool).map(([t, n]) => `${t} ${n}`).join(", ")}`);
  lines.push("");
  return lines.join("\n");
}

export function buildTranscript(records, { since, until, gapMinutes = 20, excludeUa = ["smoke"], onlyUa = null } = {}) {
  let calls = records.filter((r) => r.event === "tool_call");
  if (since) calls = calls.filter((c) => endMs(c) >= since.getTime());
  if (until) calls = calls.filter((c) => endMs(c) <= until.getTime());
  if (excludeUa?.length) calls = calls.filter((c) => !excludeUa.some((x) => String(c.ua ?? "").toLowerCase().includes(x.toLowerCase())));
  if (onlyUa) calls = calls.filter((c) => String(c.ua ?? "").toLowerCase().includes(onlyUa.toLowerCase()));

  const sessions = groupSessions(calls, gapMinutes).map((group) => ({ calls: group, stats: analyzeSession(group) }));
  const out = [];
  out.push("# Tool-call transcript");
  out.push("");
  out.push(`Generated ${new Date().toLocaleString()} from the server's own log (logs/server.jsonl). Sessions are separated by ${gapMinutes}+ idle minutes.`);
  out.push("");
  if (sessions.length === 0) {
    out.push("No tool calls found for the chosen filters.");
    return { markdown: out.join("\n"), sessions };
  }
  const total = sessions.reduce((n, s) => n + s.stats.total, 0);
  const errors = sessions.reduce((n, s) => n + s.stats.errors, 0);
  out.push(`**${sessions.length} session(s), ${total} tool calls, ${errors} errors.**`);
  out.push("");
  sessions.forEach((s, i) => {
    out.push(renderSession(s.calls, i, s.stats));
  });
  out.push("---");
  out.push("The self-check flags patterns worth explaining in your report or demo. It is not a grade, and a flagged item is not automatically wrong.");
  return { markdown: out.join("\n"), sessions };
}

function parseArgs(argv) {
  const opts = { gapMinutes: 20, excludeUa: ["smoke"], stdout: false, out: path.join(PROJECT_ROOT, "TRANSCRIPT.md"), file: null };
  const date = (label, text) => {
    const d = new Date(text);
    if (Number.isNaN(d.getTime())) throw new Error(`${label} must be a date such as "2026-10-12 09:00" (got "${text}")`);
    return d;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since") opts.since = date("--since", argv[++i]);
    else if (a === "--until") opts.until = date("--until", argv[++i]);
    else if (a === "--gap") opts.gapMinutes = Number(argv[++i]);
    else if (a === "--ua") opts.onlyUa = argv[++i];
    else if (a === "--include-smoke") opts.excludeUa = [];
    else if (a === "--stdout") opts.stdout = true;
    else if (a === "--out") opts.out = path.resolve(argv[++i]);
    else if (a === "--file") opts.file = path.resolve(argv[++i]);
    else throw new Error(`Unknown option ${a}`);
  }
  if (!Number.isFinite(opts.gapMinutes) || opts.gapMinutes < 1) throw new Error("--gap must be a number of minutes (1 or more)");
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    loadDotEnv();
    const opts = parseArgs(process.argv.slice(2));
    const file = opts.file ?? path.resolve(PROJECT_ROOT, process.env.LOG_DIR || "logs", "server.jsonl");
    if (!fs.existsSync(file)) throw new Error(`No log file at ${file}. Start the server and make some tool calls first.`);
    const { markdown, sessions } = buildTranscript(readRecords(file), opts);
    if (opts.stdout) {
      console.log(markdown);
    } else {
      fs.writeFileSync(opts.out, markdown + "\n");
      console.log(`Wrote ${opts.out} (${sessions.length} session(s)).`);
    }
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
}
