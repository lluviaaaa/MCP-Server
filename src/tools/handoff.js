// The handoff protocol. Agents never talk to each other; they leave state in files and take turns.
//   PROJECT_STATE.md  - one page: where are we NOW (rewritten, protected by if_version)
//   PLAN_LOG.md       - append-only: what we intend to do next and why
//   CHECKPOINTS.md    - append-only: what is finished AND verified, and how to resume
//   DECISIONS.md      - append-only: choices made and the reason
// Append-only logs cannot be overwritten by a second agent, which is what makes sharing safe.
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ToolError } from "../errors.js";
import { lockKey, withLock } from "../locks.js";
import { formatBytes, readTextSnapshot } from "../fileio.js";

const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LOG_FILES = ["PLAN_LOG", "CHECKPOINTS", "DECISIONS"];
const STATE_CAP = 8000;
const LOG_CAP = 3000;

function checkProject(project) {
  if (typeof project !== "string" || !PROJECT_NAME.test(project)) {
    throw new ToolError("project must be a folder name such as 'demo' (letters, digits, dot, dash or underscore; start with a letter or digit).");
  }
}

function splitEntries(text) {
  const starts = [];
  const re = /^## /gm;
  let m;
  while ((m = re.exec(text))) starts.push(m.index);
  return starts.map((start, i) => text.slice(start, starts[i + 1] ?? text.length).trimEnd());
}

function tailEntries(text, count, cap) {
  const all = splitEntries(text);
  const chosen = all.slice(-count);
  while (chosen.length > 1 && chosen.join("\n\n").length > cap) chosen.shift();
  let body = chosen.join("\n\n");
  if (body.length > cap) body = `...${body.slice(-cap)}`;
  return { total: all.length, shown: chosen.length, body };
}

export function makeHandoffTools({ config, sandbox }) {
  const appendLog = {
    name: "append_log",
    title: "Append to a project log",
    description:
      "Append a timestamped entry to a project's PLAN_LOG.md, CHECKPOINTS.md or DECISIONS.md. These logs are append-only, so several agents can write " +
      "without overwriting each other. PLAN_LOG: what you intend to do next and why. CHECKPOINTS: what is finished and verified, and how to resume. " +
      "DECISIONS: a choice you made and the reason. Use 'agent' to say who you are (for example 'session-2 coder'). " +
      "The project folder is created if it does not exist.",
    inputSchema: {
      project: z.string().min(1).max(64).describe("Project folder name directly under the workspace root, e.g. 'demo'."),
      file: z.enum(LOG_FILES).describe("Which log to append to."),
      entry: z.string().min(1).max(4000).describe("The text of the entry. Keep it short and concrete."),
      agent: z.string().min(1).max(60).optional().describe("Who is writing, e.g. 'session-2 coder'. Defaults to your role."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler({ project, file, entry, agent }, call = {}) {
      checkProject(project);
      if (!LOG_FILES.includes(file)) throw new ToolError(`file must be one of ${LOG_FILES.join(", ")}.`);
      const rel = `${project}/${file}.md`;
      const { abs } = await sandbox.resolve(rel, { allowRoot: false });
      const who = (agent && String(agent).trim()) || call.role || "agent";
      const stamp = new Date().toISOString();
      // Entries are separated by "## " headings, so demote any headings inside the entry text.
      const safeEntry = String(entry).trim().replace(/^#{1,2}(?=\s)/gm, "###");
      const block = `\n## ${stamp} - ${who} (${call.role ?? "unknown role"})\n${safeEntry}\n`;

      await withLock(lockKey(abs), async () => {
        let size = 0;
        let exists = true;
        try {
          size = (await fs.stat(abs)).size;
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
          exists = false;
        }
        if (size + Buffer.byteLength(block) > config.maxFileBytes) {
          throw new ToolError(`${rel} is full (${formatBytes(size)}). Ask the owner to archive it.`);
        }
        if (!exists) {
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, `# ${file} - ${project}\n_Append-only. Newest entries at the bottom._\n${block}`);
        } else {
          await fs.appendFile(abs, block);
        }
      });
      return `Appended to ${rel} at ${stamp}.`;
    },
  };

  const readHandoff = {
    name: "read_handoff",
    title: "Read project handoff",
    description:
      "Load everything a new session needs to continue a project in ONE call: the full PROJECT_STATE.md (with its version) plus the most recent entries " +
      "of PLAN_LOG.md, CHECKPOINTS.md and DECISIONS.md. Call this first at the start of every session, before any other tool. " +
      "Files that do not exist yet are reported as missing, not as errors.",
    inputSchema: {
      project: z.string().min(1).max(64).describe("Project folder name directly under the workspace root, e.g. 'demo'."),
      log_entries: z.number().int().min(1).max(20).default(5).describe("How many recent entries to show from each log."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler({ project, log_entries = 5 }) {
      checkProject(project);
      const sections = [`HANDOFF for project '${project}'`];

      async function load(name) {
        const { abs, rel } = await sandbox.resolve(`${project}/${name}`, { allowRoot: false });
        try {
          return await readTextSnapshot(abs, rel, config.maxFileBytes);
        } catch (err) {
          if (err.code === "ENOENT") return null;
          throw err;
        }
      }

      const state = await load("PROJECT_STATE.md");
      if (!state) {
        sections.push("=== PROJECT_STATE.md === (missing: create it with write_file before you stop)");
      } else {
        const body = state.text.length > STATE_CAP ? `${state.text.slice(0, STATE_CAP)}\n[cut: read_file the rest]` : state.text;
        sections.push(`=== PROJECT_STATE.md | version ${state.version} ===\n${body.trimEnd()}`);
      }

      for (const name of LOG_FILES) {
        const snap = await load(`${name}.md`);
        if (!snap) {
          sections.push(`=== ${name}.md === (missing)`);
          continue;
        }
        const { total, shown, body } = tailEntries(snap.text, log_entries, LOG_CAP);
        sections.push(`=== ${name}.md | last ${shown} of ${total} entries ===\n${body || "(no entries yet)"}`);
      }
      return sections.join("\n\n");
    },
  };

  return [appendLog, readHandoff];
}
