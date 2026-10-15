// git-lite tools: status, diff, commit, log. All of them go through src/git.js (execFile, no shell).
import { z } from "zod";
import { ToolError } from "../errors.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function makeGitTools({ sandbox, git }) {
  /** Paths in git's messages could reveal where the workspace lives on disk; hide that. */
  function scrub(text) {
    let out = String(text ?? "");
    for (const form of new Set([git.cwd, git.cwd.replaceAll("\\", "/")])) out = out.split(form).join("<workspace>");
    return out.trim();
  }

  function fail(result) {
    if (result.missing) throw new ToolError("git is not installed on the server's computer, so git tools are unavailable.");
    if (result.timedOut) throw new ToolError("git took too long and was stopped.");
    const detail = scrub(result.stderr).split("\n").slice(0, 4).join(" ");
    throw new ToolError(`git failed: ${detail || "unknown error"}`);
  }

  const gitStatus = {
    name: "git_status",
    title: "Git status",
    description:
      "Show the git status of the workspace in short form: branch, changed files and untracked files. " +
      "Use it before git_commit to see what will be committed, and after edits to confirm what changed. Read-only.",
    inputSchema: {
      path: z.string().max(400).optional().describe("Optional: only show status for this file or folder."),
    },
    annotations: READ_ONLY,
    async handler({ path: p } = {}) {
      const args = ["status", "--short", "--branch"];
      if (p && p !== ".") args.push("--", (await sandbox.resolve(p)).rel);
      const r = await git.run(args);
      if (!r.ok) fail(r);
      const lines = r.stdout.trim().split("\n").filter(Boolean);
      if (lines.length <= 1) return `${lines[0] ?? ""}\nWorking tree clean (nothing to commit).`.trim();
      return lines.join("\n");
    },
  };

  const gitDiff = {
    name: "git_diff",
    title: "Git diff",
    description:
      "Show uncommitted changes as a unified diff, optionally for one path, or only the staged changes. " +
      "New untracked files do not appear in a diff; they show up in git_status. Output is cut at max_chars. Read-only.",
    inputSchema: {
      path: z.string().max(400).optional().describe("Optional: only diff this file or folder."),
      staged: z.boolean().default(false).describe("Show only staged changes."),
      max_chars: z.number().int().min(500).max(20000).default(8000).describe("Cut the output after this many characters."),
    },
    annotations: READ_ONLY,
    async handler({ path: p, staged = false, max_chars = 8000 } = {}) {
      const args = ["diff", "--no-color"];
      if (staged) args.push("--staged");
      if (p && p !== ".") args.push("--", (await sandbox.resolve(p)).rel);
      const r = await git.run(args);
      if (!r.ok) fail(r);
      const out = r.stdout;
      if (!out.trim()) return "No changes to show. (New untracked files are listed by git_status, not git_diff.)";
      return out.length > max_chars ? `${out.slice(0, max_chars)}\n[diff cut at ${max_chars} characters; pass a path to see one file]` : out;
    },
  };

  const gitCommit = {
    name: "git_commit",
    title: "Git commit",
    description:
      "Stage changes and create a git commit in the workspace. With no paths it stages everything (like git add -A); with paths it stages only those. " +
      "Write a short, specific message saying what changed and why. Returns the new commit id, or says there was nothing to commit. " +
      "Use it after each finished step so work can be reviewed and recovered.",
    inputSchema: {
      message: z.string().min(3).max(200).describe("Commit message, one line, for example 'Add task list to study planner'."),
      paths: z.array(z.string().min(1).max(400)).max(50).optional().describe("Optional: files or folders to stage. Omit to stage everything."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler({ message, paths }) {
      const msg = String(message).replace(/\s*[\r\n]+\s*/g, " ").trim();
      if (msg.length < 3) throw new ToolError("Commit message is too short.");

      let addArgs = ["add", "-A"];
      if (paths && paths.length > 0) {
        const rels = [];
        for (const p of paths) rels.push((await sandbox.resolve(p, { allowRoot: false })).rel);
        addArgs = ["add", "--", ...rels];
      }
      const add = await git.run(addArgs);
      if (!add.ok) fail(add);

      const staged = await git.run(["diff", "--cached", "--quiet"]);
      if (staged.ok) return "Nothing to commit: there are no staged changes.";
      if (staged.code !== 1) fail(staged);

      const commit = await git.run(["commit", "--no-verify", `--message=${msg}`]);
      if (!commit.ok) fail(commit);

      const head = await git.run(["log", "-1", "--pretty=format:%h"]);
      const stat = await git.run(["show", "--stat", "--format=", "--no-color", "HEAD"]);
      const summary = stat.stdout.trim().split("\n").pop() ?? "";
      return `Committed ${head.stdout.trim()}: ${msg}\n${summary}`.trim();
    },
  };

  const gitLog = {
    name: "git_log",
    title: "Git log",
    description:
      "Show recent commits, newest first: short id, date, author and message. Optionally limit to one path. " +
      "Use it at the start of a session to see what earlier sessions did. Read-only.",
    inputSchema: {
      max_count: z.number().int().min(1).max(50).default(10).describe("How many commits to show."),
      path: z.string().max(400).optional().describe("Optional: only commits that touched this file or folder."),
    },
    annotations: READ_ONLY,
    async handler({ max_count = 10, path: p } = {}) {
      const args = ["log", `--max-count=${max_count}`, "--date=short", "--pretty=format:%h %ad %an: %s"];
      if (p && p !== ".") args.push("--", (await sandbox.resolve(p)).rel);
      const r = await git.run(args);
      if (!r.ok) {
        if (/does not have any commits yet|bad default revision/i.test(r.stderr)) return "No commits yet.";
        fail(r);
      }
      return r.stdout.trim() || "No commits found.";
    },
  };

  return [gitStatus, gitDiff, gitCommit, gitLog];
}
