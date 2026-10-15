// The sandbox: every path an agent sends is parsed, resolved against ONE root folder,
// and checked twice (lexically, then after resolving symbolic links) before any
// file system call is made. Anything that could leave the root is rejected.
import fs from "node:fs/promises";
import path from "node:path";
import { ToolError } from "./errors.js";

export class SandboxError extends ToolError {
  constructor(message) {
    super(message);
    this.name = "SandboxError";
  }
}

const MAX_PATH_CHARS = 400;
// Characters Windows forbids in names. ':' also blocks drive letters and NTFS alternate data streams.
const ILLEGAL_CHARS = /[<>:"|?*\u0000-\u001f]/;
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  if (rel === ".." || rel.startsWith(".." + path.sep)) return false;
  return !path.isAbsolute(rel);
}

/**
 * Lexical check. Returns the list of path segments, or throws SandboxError.
 * The rules are deliberately stricter than "normalise and hope":
 *  - no absolute paths, drive letters, UNC paths or '..' at all (even if it would stay inside)
 *  - no characters Windows treats specially, no trailing dot/space (Windows strips them), no device names
 *  - no 8.3 short names ("GIT~1" can alias ".git" on Windows)
 *  - the .git folder is never reachable (git_* tools are the only way in)
 */
export function parseRelativePath(input) {
  if (typeof input !== "string") throw new SandboxError("path must be a string.");
  if (input.length > MAX_PATH_CHARS) throw new SandboxError(`path is too long (max ${MAX_PATH_CHARS} characters).`);
  if (input.includes("\0")) throw new SandboxError("path contains a null byte.");

  const unified = input.replaceAll("\\", "/");
  if (unified.startsWith("/")) {
    throw new SandboxError(
      "Absolute paths are not allowed. Use a path relative to the workspace root, for example 'demo/notes.md' ('.' is the root).",
    );
  }
  if (/^[a-zA-Z]:/.test(unified)) {
    throw new SandboxError("Drive letters are not allowed. Use a path relative to the workspace root.");
  }

  const segments = [];
  for (const seg of unified.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw new SandboxError("'..' is not allowed: paths cannot leave the workspace.");
    if (ILLEGAL_CHARS.test(seg)) {
      throw new SandboxError(`The name '${seg}' contains a character that is not allowed (< > : " | ? * or a control character).`);
    }
    if (/[. ]$/.test(seg)) throw new SandboxError(`The name '${seg}' ends with a dot or space, which Windows silently removes.`);
    if (WINDOWS_DEVICE_NAMES.test(seg)) throw new SandboxError(`'${seg}' is a reserved device name on Windows.`);
    if (/~\d/.test(seg)) throw new SandboxError(`'${seg}' looks like a Windows short (8.3) name; use the full name.`);
    if (seg.toLowerCase() === ".git") throw new SandboxError("The .git folder is off limits. Use the git_* tools instead.");
    segments.push(seg);
  }
  return segments;
}

export function createSandbox(rootPath) {
  const root = path.resolve(rootPath);
  let realRootPromise = null;

  function getRealRoot() {
    realRootPromise ??= fs.realpath(root);
    return realRootPromise;
  }

  /**
   * Resolve an agent-supplied path to an absolute path inside the root.
   * Works for paths that do not exist yet (creating a file): the nearest existing
   * ancestor is resolved through symbolic links and must still be inside the root.
   */
  async function resolve(userPath, { allowRoot = true } = {}) {
    const segments = parseRelativePath(userPath);
    if (segments.length === 0 && !allowRoot) {
      throw new SandboxError("This tool needs a path to something inside the workspace, not the workspace root itself.");
    }
    const abs = path.join(root, ...segments);
    if (!isInside(root, abs)) throw new SandboxError("Path escapes the workspace."); // belt and braces

    const realRoot = await getRealRoot();
    let probe = abs;
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        if (!isInside(realRoot, real)) {
          throw new SandboxError("That path leads outside the workspace (symbolic link or junction).");
        }
        const firstReal = path.relative(realRoot, real).split(path.sep)[0] ?? "";
        if (firstReal.toLowerCase() === ".git") throw new SandboxError("That path leads into .git, which is off limits.");
        break;
      } catch (err) {
        if (err instanceof SandboxError) throw err;
        if (err.code === "ENOENT" || err.code === "ENOTDIR") {
          const parent = path.dirname(probe);
          if (parent === probe) throw err;
          probe = parent;
          continue;
        }
        throw err;
      }
    }
    return { abs, rel: segments.join("/") || ".", segments };
  }

  function relativeFromAbs(abs) {
    return path.relative(root, abs).split(path.sep).join("/") || ".";
  }

  return { root, resolve, relativeFromAbs, getRealRoot };
}
