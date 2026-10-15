// "git-lite": a thin, safe wrapper around the git command line.
// - execFile, never a shell, so agent-supplied text cannot become shell syntax
// - cwd is always the workspace root
// - paths are validated by the sandbox first and always placed after "--"
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function createGit({ cwd, authorName, authorEmail, timeoutMs = 15_000 }) {
  const baseArgs = [
    "-c", "core.quotepath=false",
    "-c", "core.autocrlf=false",
    "-c", "core.safecrlf=false",
    "-c", "commit.gpgsign=false",
    "-c", `user.name=${authorName}`,
    "-c", `user.email=${authorEmail}`,
  ];

  function run(args) {
    return new Promise((resolve) => {
      execFile(
        "git",
        [...baseArgs, ...args],
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
        },
        (error, stdout, stderr) => {
          if (error && error.code === "ENOENT") {
            resolve({ ok: false, missing: true, code: 127, stdout: "", stderr: "git is not installed or not on PATH." });
            return;
          }
          resolve({
            ok: !error,
            missing: false,
            timedOut: Boolean(error && error.killed),
            code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
            stdout: String(stdout),
            stderr: String(stderr),
          });
        },
      );
    });
  }

  /** Make sure the workspace is its own repository (not a folder inside some parent repo). */
  async function ensureRepo() {
    if (fs.existsSync(path.join(cwd, ".git"))) return { ok: true, created: false };
    const init = await run(["init"]);
    if (init.missing) return { ok: false, reason: init.stderr };
    if (!init.ok) return { ok: false, reason: init.stderr.trim() || "git init failed" };
    await run(["symbolic-ref", "HEAD", "refs/heads/main"]);
    return { ok: true, created: true };
  }

  return { run, ensureRepo, cwd };
}
